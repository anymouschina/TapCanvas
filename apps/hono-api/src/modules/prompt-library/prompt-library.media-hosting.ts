import { createHash } from "node:crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import type { WorkerEnv } from "../../types";
import { putResponseToStorage } from "../asset/asset.hosting.stream-upload";
import {
	createObjectStorageClientFromConfig,
	extractObjectStorageErrorDetails,
	resolveObjectStorageConfigForProvider,
	type ObjectStorageConfig,
} from "../asset/rustfs.client";
import type { ParsedPromptMedia, PromptMediaKind } from "./prompt-library.types";

// The abort signal remains attached while the response body streams. Prompt
// videos can legitimately need more than one minute to transfer, so this is a
// transfer deadline rather than a short headers-only timeout.
const MEDIA_FETCH_TIMEOUT_MS = 5 * 60_000;
const MEDIA_FETCH_ATTEMPTS = 3;
const MEDIA_FETCH_RETRY_DELAYS_MS = [1_000, 3_000];
const MEDIA_ARCHIVE_CONCURRENCY = 8;
const PROMPT_MEDIA_PREFIX = "prompt-library";

type PromptMediaHostingDependencies = {
	fetch: typeof fetch;
};

const defaultDependencies: PromptMediaHostingDependencies = { fetch };

class NonRetryableMediaResponseError extends Error {}

function normalizeContentType(value: string | null): string {
	return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function requireHttpUrl(value: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`提示词媒体 URL 无效：${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`提示词媒体 URL 必须使用 http(s)：${value}`);
	}
	return parsed;
}

function contentTypeForExpectedKind(input: {
	kind: PromptMediaKind;
	contentType: string;
	url: URL;
}): string {
	if (input.contentType.startsWith(`${input.kind}/`)) return input.contentType;
	if (input.contentType === "application/octet-stream") {
		const path = input.url.pathname.toLowerCase();
		if (input.kind === "video" && path.endsWith(".mp4")) return "video/mp4";
		if (input.kind === "video" && path.endsWith(".webm")) return "video/webm";
		if (input.kind === "image" && /\.(?:jpe?g|png|webp|gif|avif)$/.test(path)) {
			if (/\.png$/.test(path)) return "image/png";
			if (/\.webp$/.test(path)) return "image/webp";
			if (/\.gif$/.test(path)) return "image/gif";
			if (/\.avif$/.test(path)) return "image/avif";
			return "image/jpeg";
		}
	}
	throw new Error(`提示词媒体响应类型不匹配：期望 ${input.kind}，实际 ${input.contentType || "未提供"}，URL ${input.url}`);
}

export function buildPromptMediaObjectKey(input: {
	sourceUrl: string;
	kind: PromptMediaKind;
	role: "media" | "thumbnail";
}): string {
	const digest = createHash("sha256").update(input.sourceUrl).digest("hex");
	return `${PROMPT_MEDIA_PREFIX}/${input.role}/${input.kind}/${digest}`;
}

function publicObjectUrl(config: ObjectStorageConfig, key: string): string {
	return `${config.publicBase.replace(/\/+$/, "")}/${key}`;
}

function isR2PublicUrl(config: ObjectStorageConfig, value: string): boolean {
	return value === config.publicBase || value.startsWith(`${config.publicBase.replace(/\/+$/, "")}/`);
}

function isObjectMissing(error: unknown): boolean {
	const details = extractObjectStorageErrorDetails(error);
	return details.httpStatus === 404 || details.code === "NoSuchKey" || details.name === "NotFound";
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchPromptMediaWithRetry(input: {
	dependencies: PromptMediaHostingDependencies;
	sourceUrl: URL;
	kind: PromptMediaKind;
}): Promise<Response> {
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= MEDIA_FETCH_ATTEMPTS; attempt += 1) {
		try {
			const response = await input.dependencies.fetch(input.sourceUrl, {
				redirect: "follow",
				headers: {
					Accept: input.kind === "video" ? "video/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
					"User-Agent": "TapCanvasPromptMediaArchiver/1.0",
				},
				signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
			});
			if (response.ok) return response;
			const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
			if (!retryable) {
				throw new NonRetryableMediaResponseError(`提示词媒体下载失败：HTTP ${response.status} ${input.sourceUrl}`);
			}
			if (attempt === MEDIA_FETCH_ATTEMPTS) {
				throw new Error(`提示词媒体下载失败：HTTP ${response.status} ${input.sourceUrl}`);
			}
			await response.body?.cancel().catch(() => undefined);
			lastError = new Error(`提示词媒体下载暂时失败：HTTP ${response.status} ${input.sourceUrl}`);
		} catch (error) {
			if (error instanceof NonRetryableMediaResponseError) throw error;
			lastError = error;
			if (attempt === MEDIA_FETCH_ATTEMPTS) break;
		}
		await wait(MEDIA_FETCH_RETRY_DELAYS_MS[attempt - 1] ?? 3_000);
	}
	throw lastError instanceof Error ? lastError : new Error(`提示词媒体下载失败：${input.sourceUrl}`);
}

async function objectExists(input: {
	config: ObjectStorageConfig;
	client: S3Client;
	key: string;
}): Promise<boolean> {
	try {
		await input.client.send(new HeadObjectCommand({ Bucket: input.config.bucket, Key: input.key }));
		return true;
	} catch (error) {
		if (isObjectMissing(error)) return false;
		throw error;
	}
}

async function archiveRemoteUrlToR2(input: {
	env: WorkerEnv;
	sourceUrl: string;
	kind: PromptMediaKind;
	role: "media" | "thumbnail";
	config?: ObjectStorageConfig;
	client?: S3Client;
	dependencies?: PromptMediaHostingDependencies;
}): Promise<string> {
	const config = input.config ?? resolveObjectStorageConfigForProvider(input.env, "r2");
	const client = input.client ?? createObjectStorageClientFromConfig(config);
	if (isR2PublicUrl(config, input.sourceUrl)) return input.sourceUrl;
	const sourceUrl = requireHttpUrl(input.sourceUrl);
	const key = buildPromptMediaObjectKey({ sourceUrl: sourceUrl.toString(), kind: input.kind, role: input.role });
	const targetUrl = publicObjectUrl(config, key);
	if (await objectExists({ config, client, key })) return targetUrl;

	const dependencies = input.dependencies ?? defaultDependencies;
	const response = await fetchPromptMediaWithRetry({ dependencies, sourceUrl, kind: input.kind });
	const contentType = contentTypeForExpectedKind({
		kind: input.kind,
		contentType: normalizeContentType(response.headers.get("content-type")),
		url: sourceUrl,
	});
	const contentLengthRaw = response.headers.get("content-length");
	const contentLengthValue = contentLengthRaw ? Number(contentLengthRaw) : Number.NaN;
	const contentLength = Number.isFinite(contentLengthValue) && contentLengthValue >= 0
		? Math.floor(contentLengthValue)
		: null;
	await putResponseToStorage({
		client,
		bucket: config.bucket,
		key,
		res: response,
		contentType,
		contentLength,
	});
	return targetUrl;
}

export async function archiveParsedPromptMediaToR2(
	env: WorkerEnv,
	media: ParsedPromptMedia[],
): Promise<ParsedPromptMedia[]> {
	const config = resolveObjectStorageConfigForProvider(env, "r2");
	const client = createObjectStorageClientFromConfig(config);
	return Promise.all(media.map(async (item) => ({
		...item,
		url: await archiveRemoteUrlToR2({ env, config, client, sourceUrl: item.url, kind: item.kind, role: "media" }),
		thumbnailUrl: item.thumbnailUrl
			? await archiveRemoteUrlToR2({ env, config, client, sourceUrl: item.thumbnailUrl, kind: "image", role: "thumbnail" })
			: null,
	})));
}

export type PromptMediaArchiveProgress = {
	processed: number;
	total: number;
	mediaArchived: number;
	thumbnailsArchived: number;
	failed: number;
};

export type PromptMediaArchiveResult = PromptMediaArchiveProgress & {
	failures: Array<{ mediaId: string; reason: string }>;
};

export async function archiveExistingPromptMediaToR2(input: {
	db: PrismaClient;
	env: WorkerEnv;
	onProgress?: (progress: PromptMediaArchiveProgress) => void;
}): Promise<PromptMediaArchiveResult> {
	const config = resolveObjectStorageConfigForProvider(input.env, "r2");
	const client = createObjectStorageClientFromConfig(config);
	const rows = await input.db.prompt_library_media.findMany({ orderBy: { created_at: "asc" } });
	let cursor = 0;
	let processed = 0;
	let mediaArchived = 0;
	let thumbnailsArchived = 0;
	const failures: PromptMediaArchiveResult["failures"] = [];
	const archiveNext = async (): Promise<void> => {
		while (true) {
			const row = rows[cursor];
			cursor += 1;
			if (!row) return;
			try {
				if (row.media_kind !== "image" && row.media_kind !== "video") {
					throw new Error(`提示词媒体 ${row.id} 的类型无效：${row.media_kind}`);
				}
				const mediaAlreadyArchived = isR2PublicUrl(config, row.media_url);
				const thumbnailAlreadyArchived = !row.thumbnail_url || isR2PublicUrl(config, row.thumbnail_url);
				const [mediaUrl, thumbnailUrl] = await Promise.all([
					mediaAlreadyArchived
						? Promise.resolve(row.media_url)
						: archiveRemoteUrlToR2({ env: input.env, config, client, sourceUrl: row.media_url, kind: row.media_kind, role: "media" }),
					!row.thumbnail_url || thumbnailAlreadyArchived
						? Promise.resolve(row.thumbnail_url)
						: archiveRemoteUrlToR2({ env: input.env, config, client, sourceUrl: row.thumbnail_url, kind: "image", role: "thumbnail" }),
				]);
				if (!mediaAlreadyArchived || !thumbnailAlreadyArchived) {
					await input.db.prompt_library_media.update({
						where: { id: row.id },
						data: { media_url: mediaUrl, thumbnail_url: thumbnailUrl },
					});
				}
				if (!mediaAlreadyArchived) mediaArchived += 1;
				if (row.thumbnail_url && !thumbnailAlreadyArchived) thumbnailsArchived += 1;
			} catch (error) {
				failures.push({ mediaId: row.id, reason: error instanceof Error ? error.message : String(error) });
			} finally {
				processed += 1;
				input.onProgress?.({ processed, total: rows.length, mediaArchived, thumbnailsArchived, failed: failures.length });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(MEDIA_ARCHIVE_CONCURRENCY, rows.length) }, () => archiveNext()));
	return { processed, total: rows.length, mediaArchived, thumbnailsArchived, failed: failures.length, failures };
}
