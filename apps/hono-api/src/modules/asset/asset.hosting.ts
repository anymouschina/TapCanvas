import type { AppContext } from "../../types";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { AppError } from "../../middleware/error";
import {
	TaskAssetSchema,
	type TaskAssetDto,
	type TaskKind,
} from "../task/task.schemas";
import {
	createAssetRow,
	findGeneratedAssetBySourceUrl,
	updateAssetDataRow,
} from "./asset.repo";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";
import {
	createRustfsClient,
	createRustfsClientFromConfig,
	extractObjectStorageErrorDetails,
	resolveRustfsConfig,
	toObjectStorageConfigDiagnostics,
	type RustfsConfig,
} from "./rustfs.client";

type HostedAssetMeta = {
	type: "image" | "video";
	url: string;
	thumbnailUrl?: string | null;
	vendor?: string;
	taskKind?: TaskKind;
	prompt?: string | null;
	modelKey?: string | null;
	taskId?: string | null;
	sourceUrl?: string | null;
};

type AssetHostingStatus = "pending" | "running" | "ready" | "failed" | "disabled";

type AssetHostingMeta = {
	status: AssetHostingStatus;
	message?: string | null;
	updatedAt?: string | null;
	hostedAt?: string | null;
};

function isAssetHostingDisabled(c: AppContext): boolean {
	const hostingDisabledFlag = String(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		((c.env as any).ASSET_HOSTING_DISABLED ?? ""),
	)
		.trim()
		.toLowerCase();
	return (
		hostingDisabledFlag === "1" ||
		hostingDisabledFlag === "true" ||
		hostingDisabledFlag === "yes" ||
		hostingDisabledFlag === "on"
	);
}

function isNodeRuntime(): boolean {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const processRef = (globalThis as any)?.process;
	return !!processRef?.versions?.node;
}

function detectExtension(url: string, contentType: string): string {
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split(".");
		if (parts.length > 1) {
			const ext = parts.pop() || "";
			if (ext && /^[a-z0-9]+$/i.test(ext)) return ext.toLowerCase();
		}
	} catch {
		// ignore
	}
	return "bin";
}

function buildStorageKey(userId: string, ext: string, prefix?: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const date = new Date();
	const datePrefix = `${date.getUTCFullYear()}${String(
		date.getUTCMonth() + 1,
	).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	const dir = prefix ? prefix.replace(/^\/+|\/+$/g, "") : "gen";
	return `${dir}/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

function parseContentLength(headers: Headers): number | null {
	const raw = headers.get("content-length");
	if (!raw) return null;
	const num = Number(raw);
	if (!Number.isFinite(num) || num < 0) return null;
	return Math.floor(num);
}

function stripUrlSearchAndHash(input: string): string {
	try {
		const url = new URL(input);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return input;
	}
}

type ParsedBase64DataUrl = {
	mimeType: string;
	base64: string;
};

function parseBase64DataUrl(input: string): ParsedBase64DataUrl | null {
	const trimmed = (input || "").trim();
	if (!trimmed) return null;
	if (!/^data:/i.test(trimmed)) return null;
	const idx = trimmed.indexOf(",");
	if (idx === -1) return null;
	const meta = trimmed.slice("data:".length, idx);
	if (!/;base64/i.test(meta)) return null;
	const mimeType = meta.split(";")[0]?.trim() || "application/octet-stream";
	const base64 = trimmed.slice(idx + 1).trim();
	if (!base64) return null;
	return { mimeType, base64 };
}

function decodeBase64ToBytes(base64: string): Uint8Array {
	const cleaned = (base64 || "").replace(/\s+/g, "");
	if (!cleaned) return new Uint8Array(0);
	if (typeof atob === "function") {
		const binary = atob(cleaned);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyGlobal: any = globalThis as any;
	if (anyGlobal?.Buffer) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return new Uint8Array((anyGlobal.Buffer as any).from(cleaned, "base64"));
	}
	throw new Error("Base64 decode is not supported in current runtime");
}

function sniffMimeTypeFromBytes(bytes: Uint8Array, fallbackMimeType: string): string {
	if (!bytes || bytes.byteLength === 0) return fallbackMimeType;
	const b = bytes;

	// JPEG: FF D8 FF
	if (b.byteLength >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
		return "image/jpeg";
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		b.byteLength >= 8 &&
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47 &&
		b[4] === 0x0d &&
		b[5] === 0x0a &&
		b[6] === 0x1a &&
		b[7] === 0x0a
	) {
		return "image/png";
	}

	// GIF: "GIF87a" / "GIF89a"
	if (
		b.byteLength >= 6 &&
		b[0] === 0x47 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x38 &&
		(b[4] === 0x37 || b[4] === 0x39) &&
		b[5] === 0x61
	) {
		return "image/gif";
	}

	// WebP: "RIFF" .... "WEBP"
	if (
		b.byteLength >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	) {
		return "image/webp";
	}

	return fallbackMimeType;
}

async function trySha256Hex(bytes: Uint8Array): Promise<string | null> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const subtle = (crypto as any)?.subtle;
		if (!subtle || typeof subtle.digest !== "function") return null;
		const digest = await subtle.digest("SHA-256", bytes);
		const out = Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		return out || null;
	} catch {
		return null;
	}
}

async function buildInlineSourceKey(input: {
	mimeType: string;
	bytes: Uint8Array;
}): Promise<string> {
	const hash = await trySha256Hex(input.bytes);
	const mime = (input.mimeType || "application/octet-stream").trim().toLowerCase();
	if (hash) return `inline:${mime};sha256:${hash}`;
	return `inline:${mime};uuid:${crypto.randomUUID()}`;
}

type StorageTarget = { kind: "rustfs"; config: RustfsConfig };

async function uploadToStorageFromUrl(options: {
	c: AppContext;
	userId: string;
	sourceUrl: string;
	prefix?: string;
	storage: StorageTarget;
	publicBase: string;
}): Promise<{ key: string; url: string }> {
	const { c, userId } = options;
	const publicBase = options.publicBase.trim().replace(/\/+$/, "");
	const sourceUrl = (options.sourceUrl || "").trim();
	if (!sourceUrl) {
		throw new AppError("Asset hosting failed: sourceUrl is empty", {
			status: 502,
			code: "asset_hosting_source_url_missing",
		});
	}
	if (!/^https?:\/\//i.test(sourceUrl)) {
		throw new AppError("Asset hosting failed: sourceUrl must be http(s)", {
			status: 502,
			code: "asset_hosting_source_url_invalid",
			details: { sourceUrl },
		});
	}

	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(c, sourceUrl, undefined, {
			tag: "asset:fetchSource",
		});
	} catch (err: any) {
		throw new AppError("OSS 上传失败：拉取源文件失败", {
			status: 502,
			code: "asset_hosting_fetch_failed",
			details: { message: err?.message || String(err), sourceUrl },
		});
	}

	if (!res.ok) {
		throw new AppError("OSS 上传失败：拉取源文件返回非 200", {
			status: 502,
			code: "asset_hosting_fetch_non_200",
			details: { upstreamStatus: res.status, sourceUrl },
		});
	}

	const rawContentType =
		res.headers.get("content-type") || "application/octet-stream";
	const contentType = rawContentType.split(";")[0].trim();
	const contentLength = parseContentLength(res.headers);
	const ext = detectExtension(sourceUrl, contentType);
	const key = buildStorageKey(userId, ext, options.prefix);

	try {
		const stream = res.body;
		const client = createRustfsClient(c.env);

		// Node runtime: avoid streaming bodies which can become "flowing" and break AWS signer hashing.
			if (isNodeRuntime()) {
				const buf = new Uint8Array(await res.arrayBuffer());
				await client.send(
					new PutObjectCommand({
					Bucket: options.storage.config.bucket,
					Key: key,
					Body: buf,
					ContentType: contentType,
					CacheControl: "public, max-age=31536000, immutable",
						ContentLength: buf.byteLength,
					}),
				);
			} else {
			const streamUsable = !!stream && !stream.locked;
			const fallbackClone = streamUsable ? res.clone() : null;
			try {
				await client.send(
					new PutObjectCommand({
						Bucket: options.storage.config.bucket,
						Key: key,
							Body: streamUsable ? stream : new Uint8Array(await res.arrayBuffer()),
						ContentType: contentType,
						CacheControl: "public, max-age=31536000, immutable",
						ContentLength:
							typeof contentLength === "number" ? contentLength : undefined,
					}),
				);
			} catch (err: any) {
				const message =
					typeof err?.message === "string" ? err.message : String(err);
				if (
					fallbackClone &&
					(message.includes("ReadableStream did not return bytes") ||
						message.includes("ReadableStream is currently locked") ||
						message.includes("Unable to calculate hash"))
				) {
						const buf = new Uint8Array(await fallbackClone.arrayBuffer());
						await client.send(
						new PutObjectCommand({
							Bucket: options.storage.config.bucket,
							Key: key,
							Body: buf,
							ContentType: contentType,
							CacheControl: "public, max-age=31536000, immutable",
							ContentLength: buf.byteLength,
						}),
					);
				} else {
					throw err;
				}
			}
		}
		console.log("[asset-hosting] object storage put ok", { key });
	} catch (err: any) {
		const storageError = extractObjectStorageErrorDetails(err);
		const storageConfig = toObjectStorageConfigDiagnostics(
			options.storage.config,
		);
		console.warn("[asset-hosting] OSS put failed", {
			...storageError,
			...storageConfig,
			sourceUrl: stripUrlSearchAndHash(sourceUrl),
			storageKind: options.storage.kind,
			key,
			contentType,
			contentLength,
		});
		throw new AppError("OSS 上传失败：写入对象存储失败", {
			status: 500,
			code: "asset_hosting_put_failed",
			details: {
				...storageError,
				...storageConfig,
				sourceUrl: stripUrlSearchAndHash(sourceUrl),
				storageKind: options.storage.kind,
				key,
				contentType,
				contentLength,
			},
		});
	}

	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	return { key, url };
}

async function uploadToStorageFromInlineBytes(options: {
	userId: string;
	prefix?: string;
	storage: StorageTarget;
	publicBase: string;
	mimeType: string;
	bytes: Uint8Array;
}): Promise<{ key: string; url: string }> {
	const publicBase = options.publicBase.trim().replace(/\/+$/, "");
	const sniffed = sniffMimeTypeFromBytes(options.bytes, options.mimeType);
	const contentType = (sniffed || "application/octet-stream")
		.split(";")[0]
		.trim();
	const ext = detectExtension("", contentType);
	const key = buildStorageKey(options.userId, ext, options.prefix);

	const client = createRustfsClientFromConfig(options.storage.config);
	await client.send(
		new PutObjectCommand({
			Bucket: options.storage.config.bucket,
			Key: key,
			Body: options.bytes,
			ContentType: contentType,
			CacheControl: "public, max-age=31536000, immutable",
		}),
	);

	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
	return { key, url };
}

function buildGeneratedAssetName(payload: {
	type: "image" | "video";
	prompt?: string | null;
}) {
	const prefix = payload.type === "video" ? "Video" : "Image";
	const cleanedPrompt = (payload.prompt || "").replace(/\s+/g, " ").trim();
	if (cleanedPrompt) {
		const shortened =
			cleanedPrompt.length > 64
				? `${cleanedPrompt.slice(0, 64)}...`
				: cleanedPrompt;
		return `${prefix} | ${shortened}`;
	}
	const now = new Date().toISOString().replace("T", " ").slice(0, 19);
	return `${prefix} ${now}`;
}

async function persistGeneratedAsset(
	c: AppContext,
	userId: string,
	meta: HostedAssetMeta,
): Promise<string | null> {
	const safeUrl = (meta.url || "").trim();
	if (!safeUrl) return null;

	const name = buildGeneratedAssetName({
		type: meta.type,
		prompt: meta.prompt,
	});

	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "generation",
				type: meta.type,
				url: safeUrl,
				thumbnailUrl: meta.thumbnailUrl ?? null,
				vendor: meta.vendor || null,
				taskKind: meta.taskKind || null,
				prompt: meta.prompt || null,
				modelKey: meta.modelKey || null,
				taskId:
					typeof meta.taskId === "string" && meta.taskId.trim()
						? meta.taskId.trim()
						: null,
				sourceUrl:
					typeof meta.sourceUrl === "string"
						? meta.sourceUrl
						: null,
			},
			projectId: null,
		},
		nowIso,
	);
	return row.id;
}

function attachAssetId(
	asset: TaskAssetDto,
	assetId: string | null | undefined,
): TaskAssetDto {
	const normalizedAssetId =
		typeof assetId === "string" && assetId.trim() ? assetId.trim() : null;
	if (!normalizedAssetId) return asset;
	return TaskAssetSchema.parse({
		...asset,
		assetId: normalizedAssetId,
	});
}

export async function stageTaskAssetsForAsyncHosting(options: {
	c: AppContext;
	userId: string;
	assets: TaskAssetDto[] | undefined;
	meta?: {
		taskKind?: TaskKind;
		prompt?: string | null;
		vendor?: string;
		modelKey?: string | null;
		taskId?: string | null;
	};
}): Promise<TaskAssetDto[]> {
	const { c, userId, assets, meta } = options;
	if (!userId || !assets?.length) return assets || [];

	const normalized: TaskAssetDto[] = [];
	for (const asset of assets) {
		const parsed = TaskAssetSchema.safeParse(asset);
		if (!parsed.success) continue;
		const url = (parsed.data.url || "").trim();
		if (!url) continue;
		normalized.push({
			...parsed.data,
			url,
			thumbnailUrl:
				typeof parsed.data.thumbnailUrl === "string"
					? parsed.data.thumbnailUrl
					: parsed.data.thumbnailUrl ?? null,
		});
	}
	if (!normalized.length) return [];

	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	const hostingDisabled = isAssetHostingDisabled(c);
	const isHostedUrl = (url: string): boolean => {
		const trimmed = (url || "").trim();
		if (!trimmed) return false;
		if (publicBase) return trimmed.startsWith(`${publicBase}/`);
		return /^\/?gen\//.test(trimmed);
	};

	const inlineIndices: number[] = [];
	const inlineAssets: TaskAssetDto[] = [];
	const remoteAssets: TaskAssetDto[] = [];

	for (let i = 0; i < normalized.length; i += 1) {
		const asset = normalized[i]!;
		const inlineData = parseBase64DataUrl(asset.url);
		if (inlineData) {
			inlineIndices.push(i);
			inlineAssets.push(asset);
		} else {
			remoteAssets.push(asset);
		}
	}

	let outputAssets: TaskAssetDto[] = normalized;

	// Inline data URLs can be very large; try hosting them synchronously so callers
	// get back a normal URL without bloating the task payload.
	if (inlineAssets.length) {
		try {
			const hostedInline = await hostTaskAssetsInWorker({
				c,
				userId,
				assets: inlineAssets,
				meta,
			});
			if (hostedInline.length === inlineAssets.length) {
				outputAssets = [...normalized];
				for (let i = 0; i < inlineIndices.length; i += 1) {
					const idx = inlineIndices[i]!;
					const hosted = hostedInline[i];
					if (!hosted) continue;
					outputAssets[idx] = hosted;
				}
			}
		} catch (err: any) {
			console.warn(
				"[asset-hosting] inline hosting failed (fallback to data: URL)",
				err?.message || err,
			);
		}
	}

	// Best-effort: persist generation assets immediately with pending status so UI can reuse them,
	// then host in background to replace external URLs with OSS URLs.
	try {
		const nowIso = new Date().toISOString();

		for (let remoteIndex = 0; remoteIndex < remoteAssets.length; remoteIndex += 1) {
			const asset = remoteAssets[remoteIndex]!;
			const url = (asset.url || "").trim();
			if (!url) continue;

			const lookupSource = url;
			let existingAssetId: string | null = null;
			try {
				const existing = await findGeneratedAssetBySourceUrl(
					c.env.DB,
					userId,
					lookupSource,
				);
				existingAssetId = existing?.id ?? null;
			} catch (err: any) {
				console.warn(
					"[asset-hosting] stage findGeneratedAssetBySourceUrl failed",
					err?.message || err,
				);
			}
			if (existingAssetId) {
				const outputIndex = outputAssets.findIndex((item) => item.url === url);
				if (outputIndex >= 0) {
					outputAssets[outputIndex] = attachAssetId(
						outputAssets[outputIndex]!,
						existingAssetId,
					);
				}
				continue;
			}

			const name = buildGeneratedAssetName({
				type: asset.type,
				prompt: meta?.prompt ?? null,
			});

			const hosting: AssetHostingMeta = (() => {
				if (isHostedUrl(url)) {
					return { status: "ready", updatedAt: nowIso, hostedAt: nowIso };
				}
				if (hostingDisabled) {
					return { status: "disabled", updatedAt: nowIso };
				}
				return { status: "pending", updatedAt: nowIso };
			})();

			const createdRow = await createAssetRow(
				c.env.DB,
				userId,
				{
					name,
					data: {
						kind: "generation",
						type: asset.type,
						url,
						thumbnailUrl: asset.thumbnailUrl ?? null,
						vendor: meta?.vendor || null,
						taskKind: meta?.taskKind || null,
						prompt: meta?.prompt || null,
						modelKey: meta?.modelKey || null,
						taskId:
							typeof meta?.taskId === "string" && meta.taskId.trim()
								? meta.taskId.trim()
								: null,
						sourceUrl: lookupSource,
						hosting,
					},
					projectId: null,
				},
				nowIso,
			);
			const outputIndex = outputAssets.findIndex((item) => item.url === url);
			if (outputIndex >= 0) {
				outputAssets[outputIndex] = attachAssetId(
					outputAssets[outputIndex]!,
					createdRow.id,
				);
			}
		}
	} catch (err: any) {
		console.warn(
			"[asset-hosting] stage persist failed",
			err?.message || err,
		);
	}

	if (!hostingDisabled && remoteAssets.length) {
		const shouldHost = remoteAssets.some((asset) => {
			const url = (asset.url || "").trim();
			return url && !isHostedUrl(url);
		});
		if (shouldHost) {
			const execCtx = (c as any)?.executionCtx;
			const work = async () => {
				try {
					await hostTaskAssetsInWorker({
						c,
						userId,
						assets: remoteAssets,
						meta,
					});
				} catch (err: any) {
					console.warn(
						"[asset-hosting] async hosting failed",
						err?.message || err,
					);
				}
			};

			try {
				if (execCtx && typeof execCtx.waitUntil === "function") {
					execCtx.waitUntil(work());
				} else {
					void work();
				}
			} catch {
				void work();
			}
		}
	}

	return outputAssets;
}

export async function hostTaskAssetsInWorker(options: {
	c: AppContext;
	userId: string;
	assets: TaskAssetDto[] | undefined;
	meta?: {
		taskKind?: TaskKind;
		prompt?: string | null;
		vendor?: string;
		modelKey?: string | null;
		taskId?: string | null;
	};
}): Promise<TaskAssetDto[]> {
	const { c, userId, assets, meta } = options;
	if (!userId || !assets?.length) return assets || [];

	const hosted: TaskAssetDto[] = [];
	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	const hostingDisabled = isAssetHostingDisabled(c);
	let cachedStorage: StorageTarget | null = null;
	const getStorageOrThrow = (): StorageTarget => {
		if (cachedStorage) return cachedStorage;
		const rustfs = resolveRustfsConfig(c.env);
		if (rustfs) {
			cachedStorage = { kind: "rustfs", config: rustfs };
			return cachedStorage;
		}
		throw new AppError("Object storage is not configured", {
			status: 500,
			code: "oss_not_configured",
			details: {
				bindings: [
					"R2_BUCKET_URL",
					"R2_ENDPOINT_URL",
					"R2_BUCKET",
					"RUSTFS_ENDPOINT_URL",
					"RUSTFS_BUCKET",
				],
			},
		});
	};
	const isHostedUrl = (url: string): boolean => {
		const trimmed = (url || "").trim();
		if (!trimmed) return false;
		if (publicBase) return trimmed.startsWith(`${publicBase}/`);
		return /^\/?gen\//.test(trimmed);
	};

		for (const asset of assets) {
			const parsed = TaskAssetSchema.safeParse(asset);
			if (!parsed.success) continue;
			let value = parsed.data;

			const originalUrl = (value.url || "").trim();
			if (!originalUrl) {
				continue;
			}

			const inlineData = parseBase64DataUrl(originalUrl);
			const inlineBytes = inlineData ? decodeBase64ToBytes(inlineData.base64) : null;
			const inlineMimeType =
				inlineData && inlineBytes
					? sniffMimeTypeFromBytes(inlineBytes, inlineData.mimeType)
					: null;
			const lookupSource = inlineData
				? await buildInlineSourceKey({
						mimeType: inlineMimeType || inlineData.mimeType,
						bytes: inlineBytes!,
					})
				: originalUrl;

			let reusedExisting = false;
			let didUpload = false;
			let existingRowId: string | null = null;
			let existingRowData: any = null;

			try {
				const existing = await findGeneratedAssetBySourceUrl(
					c.env.DB,
					userId,
					lookupSource,
				);
				if (existing && existing.data) {
					existingRowId = existing.id;
					let parsedData: any = null;
					try {
						parsedData = JSON.parse(existing.data);
					} catch {
						parsedData = null;
					}
					existingRowData = parsedData;
					const existingUrl =
						parsedData && typeof parsedData.url === "string"
							? parsedData.url.trim()
							: "";
					const existingThumb =
						parsedData && typeof parsedData.thumbnailUrl === "string"
							? parsedData.thumbnailUrl
							: value.thumbnailUrl ?? null;

					if (existingUrl && isHostedUrl(existingUrl)) {
						value = attachAssetId(TaskAssetSchema.parse({
							...value,
							url: existingUrl,
							thumbnailUrl: existingThumb,
						}), existingRowId);
						reusedExisting = true;
					}
				}
			} catch (err: any) {
				console.warn(
					"[asset-hosting] findGeneratedAssetBySourceUrl failed",
					err?.message || err,
				);
			}

			if (!reusedExisting) {
				// data:*;base64,... 不符合我们的接口规范：必须上传到 OSS 后返回 URL（即便禁用了 hosting 也要处理）
				if (inlineData && inlineBytes) {
					const uploaded = await uploadToStorageFromInlineBytes({
						userId,
						prefix: value.type === "video" ? "gen/videos" : "gen/images",
						storage: getStorageOrThrow(),
						publicBase,
						mimeType: inlineMimeType || inlineData.mimeType,
						bytes: inlineBytes,
					});
					value = TaskAssetSchema.parse({
						...value,
						url: uploaded.url,
					});
					didUpload = true;
				} else if (!hostingDisabled && !isHostedUrl(originalUrl)) {
					const uploaded = await uploadToStorageFromUrl({
						c,
						userId,
						sourceUrl: originalUrl,
						prefix: value.type === "video" ? "gen/videos" : "gen/images",
						storage: getStorageOrThrow(),
						publicBase,
					});
					value = TaskAssetSchema.parse({
						...value,
						url: uploaded.url,
					});
					didUpload = true;
				}
			}

			{
				const thumbRaw =
					typeof value.thumbnailUrl === "string" ? value.thumbnailUrl.trim() : "";
				if (thumbRaw && thumbRaw !== value.url && !isHostedUrl(thumbRaw)) {
					const inlineThumb = parseBase64DataUrl(thumbRaw);
					if (inlineThumb) {
						const thumbBytes = decodeBase64ToBytes(inlineThumb.base64);
						const thumbMimeType = sniffMimeTypeFromBytes(
							thumbBytes,
							inlineThumb.mimeType,
						);
						const uploadedThumb = await uploadToStorageFromInlineBytes({
							userId,
							prefix: "gen/thumbnails",
							storage: getStorageOrThrow(),
							publicBase,
							mimeType: thumbMimeType,
							bytes: thumbBytes,
						});
						value = TaskAssetSchema.parse({
							...value,
							thumbnailUrl: uploadedThumb.url,
						});
					} else if (!hostingDisabled) {
						const uploadedThumb = await uploadToStorageFromUrl({
							c,
							userId,
							sourceUrl: thumbRaw,
							prefix: "gen/thumbnails",
							storage: getStorageOrThrow(),
							publicBase,
						});
						value = TaskAssetSchema.parse({
							...value,
							thumbnailUrl: uploadedThumb.url,
						});
					}
				}
			}

			let resultAsset = value;

			if (!reusedExisting) {
				if (existingRowId && !didUpload) {
					// 已存在旧记录（可能是未托管 URL）；本次未成功上传时不重复写入
				} else {
					try {
						if (existingRowId && didUpload) {
						const nowIso = new Date().toISOString();
						const baseData =
							existingRowData && typeof existingRowData === "object"
								? existingRowData
								: {};
							await updateAssetDataRow(
								c.env.DB,
								userId,
							existingRowId,
							{
								...baseData,
								kind: "generation",
								type: value.type,
								url: value.url,
								thumbnailUrl: value.thumbnailUrl ?? null,
								vendor: meta?.vendor || null,
									taskKind: meta?.taskKind || null,
									prompt: meta?.prompt || null,
									modelKey: meta?.modelKey ?? null,
									taskId: meta?.taskId ?? null,
									sourceUrl: lookupSource,
									hosting: {
										status: "ready",
										updatedAt: nowIso,
										hostedAt: nowIso,
									} satisfies AssetHostingMeta,
								},
								nowIso,
							);
							resultAsset = attachAssetId(resultAsset, existingRowId);
						} else {
							const createdAssetId = await persistGeneratedAsset(c, userId, {
								type: value.type,
								url: value.url,
								thumbnailUrl: value.thumbnailUrl ?? null,
								vendor: meta?.vendor,
								taskKind: meta?.taskKind,
								prompt: meta?.prompt,
								modelKey: meta?.modelKey ?? null,
								taskId: meta?.taskId ?? null,
								sourceUrl: lookupSource,
							});
							resultAsset = attachAssetId(resultAsset, createdAssetId);
						}
					} catch (err: any) {
						console.warn(
						"[asset-hosting] persistGeneratedAsset failed",
						err?.message || err,
					);
				}
			}

			if (reusedExisting) {
				resultAsset = attachAssetId(resultAsset, existingRowId);
			}
			hosted.push(resultAsset);
		}
	}

	return hosted;
}
