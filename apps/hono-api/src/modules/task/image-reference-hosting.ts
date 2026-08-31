import { randomUUID } from "node:crypto";

import type { S3Client } from "@aws-sdk/client-s3";

import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { putResponseToStorage } from "../asset/asset.hosting.stream-upload";
import {
	createObjectStorageClientFromConfig,
	extractObjectStorageObjectKey,
	resolveObjectStorageConfig,
	type ObjectStorageConfig,
} from "../asset/rustfs.client";

const MAX_REFERENCE_IMAGE_BYTES = 64 * 1024 * 1024;

export type ImageReferenceTransportMapping = {
	sourceUrl: string;
	transportUrl: string;
	hosted: boolean;
};

type ImageReferenceHostingDependencies = {
	fetch: typeof fetch;
	createClient: (config: ObjectStorageConfig) => S3Client;
	upload: typeof putResponseToStorage;
	randomId: () => string;
};

const defaultDependencies: ImageReferenceHostingDependencies = {
	fetch,
	createClient: createObjectStorageClientFromConfig,
	upload: putResponseToStorage,
	randomId: randomUUID,
};

function safeUserSegment(userId: string): string {
	return (userId.trim() || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function extensionForContentType(contentType: string): string {
	const extensions: Record<string, string> = {
		"image/avif": "avif",
		"image/gif": "gif",
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
	};
	return extensions[contentType] ?? "img";
}

function normalizeContentType(value: string | null): string {
	return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function requireHttpUrl(rawUrl: string): string {
	const value = rawUrl.trim();
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new AppError("图片参考资产 URL 无效，禁止提交上游生成任务", {
			status: 400,
			code: "image_reference_transport_url_invalid",
			details: { sourceUrl: value },
		});
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new AppError("图片参考资产必须是可下载的 http(s) URL", {
			status: 400,
			code: "image_reference_transport_url_invalid",
			details: { sourceUrl: value, protocol: parsed.protocol },
		});
	}
	return parsed.toString();
}

function redactUrlForLog(rawUrl: string): string {
	const parsed = new URL(rawUrl);
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

function buildReferenceObjectKey(input: {
	userId: string;
	contentType: string;
	randomId: string;
}): string {
	const now = new Date();
	const day = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
		now.getUTCDate(),
	).padStart(2, "0")}`;
	return `gen/reference-transport/${safeUserSegment(input.userId)}/${day}/${input.randomId}.${extensionForContentType(input.contentType)}`;
}

async function hostExternalReference(input: {
	config: ObjectStorageConfig;
	client: S3Client;
	userId: string;
	sourceUrl: string;
	dependencies: ImageReferenceHostingDependencies;
}): Promise<ImageReferenceTransportMapping> {
	let response: Response;
	try {
		response = await input.dependencies.fetch(input.sourceUrl, {
			redirect: "follow",
			signal: AbortSignal.timeout(30_000),
		});
	} catch (error) {
		throw new AppError("图片参考资产下载失败，未提交上游生成任务", {
			status: 409,
			code: "image_reference_transport_download_failed",
			details: {
				sourceUrl: input.sourceUrl,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	if (!response.ok) {
		throw new AppError("图片参考资产不可访问，未提交上游生成任务", {
			status: 409,
			code: "image_reference_transport_download_failed",
			details: { sourceUrl: input.sourceUrl, httpStatus: response.status },
		});
	}
	const contentType = normalizeContentType(response.headers.get("content-type"));
	if (!contentType.startsWith("image/")) {
		throw new AppError("图片参考资产响应不是图片，未提交上游生成任务", {
			status: 409,
			code: "image_reference_transport_content_type_invalid",
			details: { sourceUrl: input.sourceUrl, contentType: contentType || null },
		});
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength === 0) {
		throw new AppError("图片参考资产响应为空，未提交上游生成任务", {
			status: 409,
			code: "image_reference_transport_empty",
			details: { sourceUrl: input.sourceUrl },
		});
	}
	if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
		throw new AppError("图片参考资产超过传输上限，未提交上游生成任务", {
			status: 413,
			code: "image_reference_transport_too_large",
			details: {
				sourceUrl: input.sourceUrl,
				bytes: bytes.byteLength,
				maxBytes: MAX_REFERENCE_IMAGE_BYTES,
			},
		});
	}
	const key = buildReferenceObjectKey({
		userId: input.userId,
		contentType,
		randomId: input.dependencies.randomId(),
	});
	try {
		await input.dependencies.upload({
			client: input.client,
			bucket: input.config.bucket,
			key,
			res: new Response(bytes, { headers: { "content-type": contentType } }),
			contentType,
			contentLength: bytes.byteLength,
		});
	} catch (error) {
		throw new AppError("图片参考资产转存失败，未提交上游生成任务", {
			status: 502,
			code: "image_reference_transport_upload_failed",
			details: {
				sourceUrl: input.sourceUrl,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return {
		sourceUrl: input.sourceUrl,
		transportUrl: `${input.config.publicBase.replace(/\/+$/, "")}/${key}`,
		hosted: true,
	};
}

/**
 * Normalizes every image reference before a paid upstream submission. References
 * already on the active object store keep their bytes and canonical public URL;
 * all other images are downloaded, validated and copied to a new immutable key.
 */
export async function prepareImageReferenceTransport(input: {
	c: AppContext;
	userId: string;
	urls: string[];
	dependencies?: Partial<ImageReferenceHostingDependencies>;
}): Promise<ImageReferenceTransportMapping[]> {
	const urls = [...new Set(input.urls.map((url) => url.trim()).filter(Boolean))];
	if (urls.length === 0) return [];
	const config = resolveObjectStorageConfig(input.c.env);
	if (!config) {
		throw new AppError("图片参考资产传输需要对象存储配置", {
			status: 500,
			code: "image_reference_transport_storage_unavailable",
		});
	}
	const dependencies: ImageReferenceHostingDependencies = {
		...defaultDependencies,
		...input.dependencies,
	};
	const client = dependencies.createClient(config);
	const cache = new Map<string, ImageReferenceTransportMapping>();
	const mappings: ImageReferenceTransportMapping[] = [];
	for (const rawUrl of urls) {
		const sourceUrl = requireHttpUrl(rawUrl);
		const cached = cache.get(sourceUrl);
		if (cached) {
			mappings.push(cached);
			continue;
		}
		const existingKey = extractObjectStorageObjectKey(config, sourceUrl);
		const mapping = existingKey
			? {
					sourceUrl,
					transportUrl: `${config.publicBase.replace(/\/+$/, "")}/${existingKey}`,
					hosted: false,
				}
			: await hostExternalReference({
					config,
					client,
					userId: input.userId,
					sourceUrl,
					dependencies,
				});
		cache.set(sourceUrl, mapping);
		mappings.push(mapping);
		console.info(
			"[image-reference-transport]",
			JSON.stringify({
				sourceUrl: redactUrlForLog(mapping.sourceUrl),
				transportUrl: redactUrlForLog(mapping.transportUrl),
				hosted: mapping.hosted,
			}),
		);
	}
	return mappings;
}
