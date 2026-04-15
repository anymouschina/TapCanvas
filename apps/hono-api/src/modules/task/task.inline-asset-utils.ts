import { PutObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import {
	createRustfsClient,
	resolveRustfsConfig,
} from "../asset/rustfs.client";

export function decodeBase64ToBytes(base64: string): Uint8Array {
	const cleaned = (base64 || "").trim();
	if (!cleaned) return new Uint8Array(0);
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function detectImageExtensionFromMimeType(contentType: string): string {
	const ct = (contentType || "").toLowerCase();
	if (ct === "image/png") return "png";
	if (ct === "image/jpeg") return "jpg";
	if (ct === "image/webp") return "webp";
	if (ct === "image/gif") return "gif";
	return "bin";
}

function buildInlineAssetKey(userId: string, ext: string, prefix: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const date = new Date();
	const datePrefix = `${date.getUTCFullYear()}${String(
		date.getUTCMonth() + 1,
	).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	const dir = prefix ? prefix.replace(/^\/+|\/+$/g, "") : "gen";
	return `${dir}/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

export async function uploadInlineImageToRustfs(options: {
	c: AppContext;
	userId: string;
	mimeType: string;
	base64: string;
	prefix?: string;
}): Promise<string> {
	const { c, userId, mimeType, base64 } = options;
	const rustfs = resolveRustfsConfig(c.env);
	if (!rustfs) {
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
	}

	const ext = detectImageExtensionFromMimeType(mimeType);
	const key = buildInlineAssetKey(userId, ext, options.prefix || "gen/images");
	const bytes = decodeBase64ToBytes(base64);
	const client = createRustfsClient(c.env);
	await client.send(
		new PutObjectCommand({
			Bucket: rustfs.bucket,
			Key: key,
			Body: bytes,
			ContentType: mimeType || "application/octet-stream",
		}),
	);

	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}
