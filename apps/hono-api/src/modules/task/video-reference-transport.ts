import { createHash, randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { parseSafePublicHttpUrl } from "../asset/public-http-url";
import { putResponseToStorage } from "../asset/asset.hosting.stream-upload";
import { createObjectStorageClientFromConfig, resolveObjectStorageConfig } from "../asset/rustfs.client";

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

/** Exact URL identity replacement preserves every reference, role and manifest order. */
export function replaceReferenceTransportUrls(value: unknown, mappings: ReadonlyMap<string, string>): unknown {
	if (typeof value === "string") return mappings.get(value) ?? value;
	if (Array.isArray(value)) return value.map((item: unknown) => replaceReferenceTransportUrls(item, mappings));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferenceTransportUrls(item, mappings)]));
	}
	return value;
}

export async function encodeReferenceWithinLimit(bytes: Buffer, maxBytes: number): Promise<Buffer> {
	if (bytes.length <= maxBytes) return bytes;
	const { createCanvas, loadImage } = await import("@napi-rs/canvas");
	const image = await loadImage(bytes);
	for (const maxEdge of [4096, 3072, 2048, 1536, 1024]) {
		const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
		const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
		const context = canvas.getContext("2d");
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const result = canvas.toBuffer("image/jpeg", 92);
		if (result.length <= maxBytes) return result;
	}
	throw new AppError("参考图片转码后仍超过配置的传输限制", { status: 413, code: "video_reference_transport_too_large" });
}

async function readBoundedImage(response: Response): Promise<Buffer> {
	if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
		throw new AppError("视频参考图片无法读取", { status: 502, code: "video_reference_transport_download_failed", details: { status: response.status } });
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Video reference response body missing");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_DOWNLOAD_BYTES) {
				await reader.cancel();
				throw new AppError("参考图超过下载限制", { status: 413, code: "video_reference_download_too_large" });
			}
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	if (!size) throw new Error("Video reference image is empty");
	return Buffer.concat(chunks);
}

/** Only submission transport changes; original assets and canvas URLs remain immutable. */
export async function prepareVideoReferenceTransport(input: {
	c: AppContext;
	urls: string[];
	extras: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
	const raw = (input.c.env as Record<string, unknown>).VIDEO_REFERENCE_MAX_BYTES ?? process.env.VIDEO_REFERENCE_MAX_BYTES;
	if (raw === undefined || raw === "") return input.extras;
	const maxBytes = Number(raw);
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("VIDEO_REFERENCE_MAX_BYTES must be a positive integer");
	// Provider-hosted asset handles are already registered upstream and have no downloadable URL.
	const urls = [...new Set(input.urls)].filter((url) => new URL(url).protocol !== "asset:");
	if (!urls.length) return input.extras;
	const config = resolveObjectStorageConfig(input.c.env);
	if (!config) throw new Error("Video reference transport requires object storage");
	const mappings = new Map<string, string>();
	const receipts: Array<{ sourceHash: string; originalBytes: number; transportBytes: number; transportUrl: string }> = [];
	for (const url of urls) {
		if (!parseSafePublicHttpUrl(url)) throw new AppError("视频参考图片必须使用公网 HTTP(S) 地址", { status: 400, code: "video_reference_transport_url_invalid" });
		const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
		const bytes = await readBoundedImage(response);
		if (bytes.length <= maxBytes) continue;
		const encoded = await encodeReferenceWithinLimit(bytes, maxBytes);
		const key = `gen/reference-transport/video/${randomUUID()}.jpg`;
		await putResponseToStorage({ client: createObjectStorageClientFromConfig(config), bucket: config.bucket, key,
			res: new Response(new Uint8Array(encoded), { headers: { "content-type": "image/jpeg" } }), contentType: "image/jpeg", contentLength: encoded.length });
		const transportUrl = `${config.publicBase.replace(/\/+$/, "")}/${key}`;
		mappings.set(url, transportUrl);
		const receipt = { sourceHash: createHash("sha256").update(url).digest("hex"), originalBytes: bytes.length, transportBytes: encoded.length, transportUrl };
		receipts.push(receipt);
		console.info("[video-reference-transport] resized", { sourceHash: receipt.sourceHash, originalBytes: bytes.length, transportBytes: encoded.length, maxBytes });
	}
	const mapped = replaceReferenceTransportUrls(input.extras, mappings) as Record<string, unknown>;
	return receipts.length ? { ...mapped, videoReferenceTransport: receipts } : mapped;
}
