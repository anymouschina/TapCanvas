import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import {
	CreateAssetSchema,
	PublicAssetSchema,
	RenameAssetSchema,
	ServerAssetSchema,
} from "./asset.schemas";
import {
	createAssetRow,
	deleteAssetRow,
	listAssetsForUser,
	listPublicAssets,
	renameAssetRow,
} from "./asset.repo";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";

export const assetRouter = new Hono<AppEnv>();

const DEFAULT_THUMB_SIZE = 720;
const MAX_THUMB_SIZE = 1280;
const DEFAULT_THUMB_QUALITY = 80;

function clampNumber(value: number | undefined, min: number, max: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function normalizeContentType(raw: string | null | undefined): string {
	const ct = typeof raw === "string" ? raw : "";
	return (ct.split(";")[0] || "").trim().toLowerCase() || "application/octet-stream";
}

function sanitizeUploadName(raw: unknown): string {
	if (typeof raw !== "string") return "";
	return raw
		.trim()
		.slice(0, 160)
		.replace(/[\u0000-\u001F\u007F]/g, "")
		.replace(/[\\/]/g, "_");
}

function normalizeOptionalText(raw: unknown, maxLen: number): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
	return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function detectUploadExtensionFromMeta(options: {
	contentType: string;
	fileName?: string;
}): string {
	const name = options.fileName || "";
	const contentType = normalizeContentType(options.contentType);
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name) {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) {
		return contentType.slice("image/".length) || "png";
	}
	return "bin";
}

function inferMediaKind(options: {
	contentType: string;
	fileName?: string;
}): "image" | "video" | null {
	const contentType = normalizeContentType(options.contentType);
	if (contentType.startsWith("image/")) return "image";
	if (contentType.startsWith("video/")) return "video";
	const name = options.fileName || "";
	const ext = (name.split(".").pop() || "").toLowerCase();
	if (!ext) return null;
	if (["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(ext)) return "image";
	if (["mp4", "webm", "mov"].includes(ext)) return "video";
	return null;
}

function parseHttpByteRangeHeader(header: string): R2Range | null {
	const raw = typeof header === "string" ? header.trim() : "";
	if (!raw) return null;
	const match = raw.match(/^bytes=(.+)$/i);
	if (!match || !match[1]) return null;

	// Only support a single range: `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
	const spec = match[1].split(",")[0]?.trim() || "";
	if (!spec) return null;
	const [startStr, endStr] = spec.split("-");
	if (typeof endStr === "undefined") return null;

	if (!startStr) {
		const suffix = Number(endStr);
		if (!Number.isFinite(suffix) || suffix <= 0) return null;
		return { suffix: Math.floor(suffix) };
	}

	const start = Number(startStr);
	if (!Number.isFinite(start) || start < 0) return null;
	if (!endStr) return { offset: Math.floor(start) };

	const end = Number(endStr);
	if (!Number.isFinite(end) || end < start) return null;
	return { offset: Math.floor(start), length: Math.floor(end - start + 1) };
}

function resolveR2ServedRange(
	range: R2Range | undefined,
	size: number,
): { start: number; end: number; length: number } | null {
	if (!range) return null;
	if (!Number.isFinite(size) || size <= 0) return null;

	if ("suffix" in range) {
		const requested = Math.floor(range.suffix);
		if (!Number.isFinite(requested) || requested <= 0) return null;
		const length = Math.min(size, requested);
		const start = Math.max(0, size - length);
		const end = start + length - 1;
		return { start, end, length };
	}

	const offsetRaw = "offset" in range ? range.offset : undefined;
	const offset =
		typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw >= 0
			? Math.floor(offsetRaw)
			: 0;
	const lengthRaw = "length" in range ? range.length : undefined;
	const length =
		typeof lengthRaw === "number" && Number.isFinite(lengthRaw) && lengthRaw > 0
			? Math.floor(lengthRaw)
			: Math.max(0, size - offset);

	if (offset >= size || length <= 0) return null;
	const capped = Math.min(length, size - offset);
	return { start: offset, end: offset + capped - 1, length: capped };
}

async function readStreamToBytes(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> {
	if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// ignore
				}
				throw new Error("file is too large");
			}
			chunks.push(value);
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function getPublicBase(c: Pick<AppContext, "env" | "req">): string {
	return resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
}

function detectUploadExtension(file: File): string {
	const name = (file as any).name as string | undefined;
	const rawType = file.type || "";
	const contentType = rawType.split(";")[0].trim();
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name && typeof name === "string") {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) {
		return contentType.slice("image/".length) || "png";
	}
	return "bin";
}

function buildUserUploadKey(userId: string, ext: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const now = new Date();
	const datePrefix = `${now.getUTCFullYear()}${String(
		now.getUTCMonth() + 1,
	).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	return `uploads/user/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

function isHostedUrl(url: string, publicBase: string): boolean {
	const trimmed = (url || "").trim();
	if (!trimmed) return false;
	if (publicBase) {
		return trimmed.startsWith(`${publicBase}/`);
	}
	// Fallback: default R2 key prefix
	return /^\/?gen\//.test(trimmed);
}

function buildPublicThumbUrl(options: {
	requestUrl: string;
	targetUrl: string;
	publicBase: string;
	width?: number;
	height?: number;
	quality?: number;
}): string | null {
	const { requestUrl, targetUrl, publicBase } = options;
	const trimmed = (targetUrl || "").trim();
	if (!trimmed || !isHostedUrl(trimmed, publicBase)) return null;
	let base: URL;
	try {
		base = new URL(requestUrl);
	} catch {
		return null;
	}
	const thumb = new URL("/assets/public-thumb", base.origin);
	thumb.searchParams.set("url", trimmed);
	if (options.width) thumb.searchParams.set("w", String(options.width));
	if (options.height) thumb.searchParams.set("h", String(options.height));
	if (options.quality) thumb.searchParams.set("q", String(options.quality));
	return thumb.toString();
}

assetRouter.get("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const cursor = c.req.query("cursor") || null;

	const rows = await listAssetsForUser(c.env.DB, userId, { limit, cursor });
	const payload = rows.map((row) =>
		ServerAssetSchema.parse({
			id: row.id,
			name: row.name,
			data: row.data ? JSON.parse(row.data) : null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			userId: row.owner_id,
			projectId: row.project_id,
		}),
	);
	const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
	return c.json({ items: payload, cursor: nextCursor });
});

assetRouter.post("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateAssetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const nowIso = new Date().toISOString();
	const row = await createAssetRow(c.env.DB, userId, parsed.data, nowIso);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.put("/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RenameAssetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const nowIso = new Date().toISOString();
	const row = await renameAssetRow(
		c.env.DB,
		userId,
		id,
		parsed.data.name,
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

assetRouter.delete("/:id", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteAssetRow(c.env.DB, userId, id);
	return c.body(null, 204);
});

// Public R2 asset proxy: serves objects stored in R2_ASSETS without requiring a custom domain.
assetRouter.get("/r2/*", async (c) => {
	const bucket = (c.env as any).R2_ASSETS as R2Bucket | undefined;
	if (!bucket) {
		return c.json({ error: "OSS storage is not configured" }, 500);
	}

	const pathname = new URL(c.req.url).pathname;
	const prefix = "/assets/r2/";
	const key = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
	if (!key) {
		return c.json({ error: "key is required" }, 400);
	}

	const rangeHeader = c.req.header("range") || c.req.header("Range") || "";
	const range = rangeHeader ? parseHttpByteRangeHeader(rangeHeader) : null;

	let obj: R2ObjectBody | null = null;
	try {
		obj = range ? await bucket.get(key, { range }) : await bucket.get(key);
	} catch {
		obj = null;
	}

	if (!obj) {
		if (range) {
			try {
				const head = await bucket.head(key);
				if (head) {
					const headers = new Headers();
					headers.set("Accept-Ranges", "bytes");
					headers.set("Content-Range", `bytes */${head.size}`);
					headers.set("Access-Control-Allow-Origin", "*");
					return new Response(null, { status: 416, headers });
				}
			} catch {
				// ignore
			}
		}
		return c.json({ error: "not found" }, 404);
	}

	const headers = new Headers();
	headers.set(
		"Content-Type",
		(obj.httpMetadata?.contentType as string | undefined) ||
			"application/octet-stream",
	);
	headers.set(
		"Cache-Control",
		(obj.httpMetadata?.cacheControl as string | undefined) ||
			"public, max-age=31536000, immutable",
	);
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges,ETag");
	headers.set("Accept-Ranges", "bytes");
	if ((obj as any).etag) headers.set("ETag", String((obj as any).etag));

	if (range) {
		const served = resolveR2ServedRange(obj.range, obj.size);
		if (served) {
			headers.set("Content-Length", String(served.length));
			headers.set("Content-Range", `bytes ${served.start}-${served.end}/${obj.size}`);
			return new Response(obj.body, { status: 206, headers });
		}
	}

	headers.set("Content-Length", String(obj.size));
	return new Response(obj.body, { status: 200, headers });
});

// Upload a user asset file to OSS (R2) and persist it as an asset row.
assetRouter.post("/upload", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const bucket = (c.env as any).R2_ASSETS as R2Bucket | undefined;
	if (!bucket) {
		return c.json({ error: "OSS storage is not configured" }, 500);
	}

	const MAX_BYTES = 30 * 1024 * 1024;
	const contentTypeHeader = normalizeContentType(c.req.header("content-type"));
	const isMultipart = contentTypeHeader.includes("multipart/form-data");

	let kind: "image" | "video" | null = null;
	let contentType = contentTypeHeader;
	let originalName: string | null = null;
	let size: number | null = null;
	let uploadValue: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob | null = null;
	let uploadPump: Promise<void> | null = null;
	let name = "";
	let prompt: string | null = null;
	let vendor: string | null = null;
	let modelKey: string | null = null;
	let taskKind: string | null = null;

	if (isMultipart) {
		const form = await c.req.formData();
		const file = form.get("file");
		if (!(file instanceof File)) {
			return c.json({ error: "file is required" }, 400);
		}

		originalName = sanitizeUploadName((file as any).name || "");
		contentType = normalizeContentType(file.type);
		kind = inferMediaKind({ contentType, fileName: originalName });
		if (!kind) {
			return c.json({ error: "only image/video files are allowed" }, 400);
		}

		if (typeof file.size === "number") {
			size = file.size;
			if (size > MAX_BYTES) {
				return c.json({ error: "file is too large (max 30MB)" }, 413);
			}
		}

		const nameValue = form.get("name");
		const rawName =
			typeof nameValue === "string" && nameValue.trim()
				? nameValue.trim()
				: originalName || "";
		name = sanitizeUploadName(rawName) || (kind === "video" ? "Video" : "Image");

		prompt = normalizeOptionalText(form.get("prompt"), 8000);
		vendor = normalizeOptionalText(form.get("vendor"), 64);
		modelKey = normalizeOptionalText(form.get("modelKey"), 128);
		taskKind = normalizeOptionalText(form.get("taskKind"), 64);

		uploadValue = file;
	} else {
		originalName = sanitizeUploadName(c.req.header("x-file-name") || "");
		contentType = contentTypeHeader;
		kind = inferMediaKind({ contentType, fileName: originalName || undefined });
		if (!kind) {
			return c.json({ error: "only image/video files are allowed" }, 400);
		}

		const contentLengthHeader = c.req.header("content-length");
		const parsedLen =
			typeof contentLengthHeader === "string" && contentLengthHeader
				? Number(contentLengthHeader)
				: NaN;
		const hasContentLength = Number.isFinite(parsedLen);
		const declaredSizeHeader = c.req.header("x-file-size");
		const declaredSize =
			typeof declaredSizeHeader === "string" && declaredSizeHeader
				? Number(declaredSizeHeader)
				: NaN;

		size = hasContentLength
			? parsedLen
			: Number.isFinite(declaredSize)
				? declaredSize
				: null;
		if (size != null && size > MAX_BYTES) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}

		name = sanitizeUploadName(c.req.query("name") || "") || (kind === "video" ? "Video" : "Image");
		prompt =
			normalizeOptionalText(
				c.req.header("x-asset-prompt") ||
					c.req.header("x-tap-asset-prompt") ||
					c.req.query("prompt") ||
					"",
				8000,
			) ?? null;
		vendor =
			normalizeOptionalText(
				c.req.header("x-asset-vendor") ||
					c.req.header("x-tap-asset-vendor") ||
					c.req.query("vendor") ||
					"",
				64,
			) ?? null;
		modelKey =
			normalizeOptionalText(
				c.req.header("x-asset-model-key") ||
					c.req.header("x-tap-asset-model-key") ||
					c.req.query("modelKey") ||
					"",
				128,
			) ?? null;
		taskKind =
			normalizeOptionalText(
				c.req.header("x-asset-task-kind") ||
					c.req.header("x-tap-asset-task-kind") ||
					c.req.query("taskKind") ||
					"",
				64,
			) ?? null;
		const bodyStream = c.req.raw.body as ReadableStream<Uint8Array> | null;
		if (!bodyStream) {
			return c.json({ error: "request body is required" }, 400);
		}

		if (hasContentLength) {
			uploadValue = bodyStream;
		} else if (size != null) {
			const fixed = new FixedLengthStream(size);
			uploadPump = bodyStream.pipeTo(fixed.writable);
			uploadValue = fixed.readable;
		} else {
			try {
				const bytes = await readStreamToBytes(bodyStream, MAX_BYTES);
				size = bytes.byteLength;
				uploadValue = bytes;
			} catch (err: any) {
				const msg = String(err?.message || "");
				if (/too large/i.test(msg)) {
					return c.json({ error: "file is too large (max 30MB)" }, 413);
				}
				throw err;
			}
		}
	}

	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: originalName || undefined,
	});
	const key = buildUserUploadKey(userId, ext);

	if (!uploadValue) {
		return c.json({ error: "request body is required" }, 400);
	}
	try {
		const putPromise = bucket.put(key, uploadValue, {
			httpMetadata: {
				contentType,
				cacheControl: "public, max-age=31536000, immutable",
			},
		});
		if (uploadPump) {
			await Promise.all([putPromise, uploadPump]);
		} else {
			await putPromise;
		}
	} catch (err: any) {
		const msg = String(err?.message || "");
		if (/too large/i.test(msg)) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}
		throw err;
	}

	const publicBase = getPublicBase(c);
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	const nowIso = new Date().toISOString();
	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "upload",
				type: kind,
				url,
				contentType,
				size,
				originalName: originalName || null,
				key,
				prompt,
				vendor,
				modelKey,
				taskKind,
			},
			projectId: null,
		},
		nowIso,
	);
	const payload = ServerAssetSchema.parse({
		id: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userId: row.owner_id,
		projectId: row.project_id,
	});
	return c.json(payload);
});

// Public TapShow feed: all OSS-hosted image/video assets
assetRouter.get("/public", async (c) => {
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;

	const typeParam = (c.req.query("type") || "").toLowerCase();
	const requestedType =
		typeParam === "image" || typeParam === "video" ? typeParam : null;

	const publicBase = getPublicBase(c);
	const isHosted = (url: string): boolean => isHostedUrl(url, publicBase);

	const rows = await listPublicAssets(c.env.DB, { limit });
	const items = rows
		.map((row) => {
			let parsed: any = null;
			try {
				parsed = row.data ? JSON.parse(row.data) : null;
			} catch {
				parsed = null;
			}
			const data = (parsed || {}) as any;
			const rawType =
				typeof data.type === "string"
					? (data.type.toLowerCase() as string)
					: "";
			const type =
				rawType === "image" || rawType === "video" ? rawType : null;
			const url = typeof data.url === "string" ? data.url : null;
			if (!type || !url || !isHosted(url)) {
				return null;
			}

			const thumbnailSource =
				typeof data.thumbnailUrl === "string"
					? data.thumbnailUrl
					: null;
			const thumbnailUrl =
				type === "image"
					? buildPublicThumbUrl({
							requestUrl: c.req.url,
							targetUrl: thumbnailSource || url,
							publicBase,
							width: DEFAULT_THUMB_SIZE,
							height: DEFAULT_THUMB_SIZE,
							quality: DEFAULT_THUMB_QUALITY,
						})
					: thumbnailSource && isHosted(thumbnailSource)
						? thumbnailSource
						: null;
			const duration =
				typeof data.duration === "number" && Number.isFinite(data.duration)
					? data.duration
					: typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds)
						? data.durationSeconds
						: typeof data.videoDurationSeconds === "number" && Number.isFinite(data.videoDurationSeconds)
							? data.videoDurationSeconds
							: null;
			const prompt =
				typeof data.prompt === "string" ? data.prompt : null;
			const vendor =
				typeof data.vendor === "string" ? data.vendor : null;
			const modelKey =
				typeof data.modelKey === "string" ? data.modelKey : null;

			return PublicAssetSchema.parse({
				id: row.id,
				name: row.name,
				type,
				url,
				thumbnailUrl,
				duration,
				prompt,
				vendor,
				modelKey,
				createdAt: row.created_at,
				ownerLogin: row.owner_login,
				ownerName: row.owner_name,
				projectName: row.project_name,
			});
		})
		.filter((v): v is ReturnType<typeof PublicAssetSchema.parse> => !!v)
		.filter((item) =>
			requestedType ? item.type === requestedType : true,
		);

	return c.json(items);
});

// CDN-friendly thumbnail proxy with Cloudflare Image Resizing
assetRouter.get("/public-thumb", async (c) => {
	const publicBase = getPublicBase(c);
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!isHostedUrl(target, publicBase)) {
		return c.json({ message: "url is not allowed" }, 400);
	}

	const parsedW = Number.parseInt(c.req.query("w") || "", 10);
	const parsedH = Number.parseInt(c.req.query("h") || "", 10);
	const parsedQ = Number.parseInt(c.req.query("q") || "", 10);
	const width = Number.isFinite(parsedW)
		? clampNumber(parsedW, 16, MAX_THUMB_SIZE)
		: DEFAULT_THUMB_SIZE;
	const height = Number.isFinite(parsedH)
		? clampNumber(parsedH, 16, MAX_THUMB_SIZE)
		: width;
	const quality = Number.isFinite(parsedQ)
		? clampNumber(parsedQ, 30, 95)
		: DEFAULT_THUMB_QUALITY;

	const resizeOptions = {
		fit: "cover",
		width,
		height,
		quality,
		format: "auto" as const,
	};

	try {
		let res: Response;
		try {
			res = await fetch(target, {
				// Cloudflare Image Resizing happens at the edge; no need to re-upload thumbnails
				cf: { image: resizeOptions },
			} as RequestInit);
		} catch {
			// 开发环境或不支持 cf:image 时，退化为直接拉取原图
			res = await fetch(target);
		}
		if (!res.ok) {
			return c.json(
				{ message: `fetch upstream failed: ${res.status}` },
				502,
			);
		}
		const headers = new Headers(res.headers);
		headers.set(
			"Cache-Control",
			"public, max-age=604800, stale-while-revalidate=86400",
		);
		headers.set("Access-Control-Allow-Origin", "*");
		return new Response(res.body, {
			status: res.status,
			headers,
		});
	} catch (err: any) {
		return c.json(
			{ message: err?.message || "public thumb proxy failed" },
			500,
		);
	}
});

// Proxy image: /assets/proxy-image?url=...
assetRouter.get("/proxy-image", authMiddleware, async (c) => {
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!/^https?:\/\//i.test(target)) {
		return c.json({ message: "only http/https urls are allowed" }, 400);
	}

	try {
		const resp = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Origin: "https://tapcanvas.local",
				},
			},
			{ tag: "asset:proxy-image" },
		);
		const ct = resp.headers.get("content-type") || "application/octet-stream";
		const headers = new Headers();
		headers.set("Content-Type", ct);
		headers.set("Cache-Control", "public, max-age=60");
		headers.set("Access-Control-Allow-Origin", "*");
		return new Response(resp.body ?? (await resp.arrayBuffer()), {
			status: resp.status,
			headers,
		});
	} catch (err: any) {
		return c.json(
			{ message: err?.message || "proxy image failed" },
			500,
		);
	}
});

// Proxy video: /assets/proxy-video?url=...
// Used by WebCut (which loads MP4 via fetch/streams and thus needs CORS-compatible responses).
assetRouter.get("/proxy-video", authMiddleware, async (c) => {
	const raw = (c.req.query("url") || "").trim();
	if (!raw) {
		return c.json({ message: "url is required" }, 400);
	}
	let target = raw;
	try {
		target = decodeURIComponent(raw);
	} catch {
		// ignore
	}
	if (!/^https?:\/\//i.test(target)) {
		return c.json({ message: "only http/https urls are allowed" }, 400);
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return c.json({ message: "invalid url" }, 400);
	}

	// Safety: avoid becoming a general-purpose open proxy (even though it's auth-protected).
	// Extend this allowlist if you need to support more upstreams.
	const host = parsed.hostname.toLowerCase();
	let r2PublicHost: string | null = null;
	try {
		const r2PublicBase = getPublicBase(c);
		if (r2PublicBase) {
			r2PublicHost = new URL(r2PublicBase).hostname.toLowerCase();
		}
	} catch {
		r2PublicHost = null;
	}

	const allowed =
		host === "videos.openai.com" ||
		host.endsWith(".openai.com") ||
		host.endsWith(".openaiusercontent.com") ||
		(!!r2PublicHost && host === r2PublicHost);
	if (!allowed) {
		return c.json({ message: "upstream host is not allowed" }, 400);
	}

	try {
		const range = c.req.header("range") || c.req.header("Range") || null;
		const resp = await fetchWithHttpDebugLog(
			c,
			target,
			{
				headers: {
					Origin: "https://tapcanvas.local",
					...(range ? { Range: range } : null),
				},
			},
			{ tag: "asset:proxy-video" },
		);

		// Allow 200/206 only
		if (!(resp.status === 200 || resp.status === 206)) {
			return c.json(
				{ message: `fetch upstream failed: ${resp.status}` },
				502,
			);
		}

		const ct = resp.headers.get("content-type") || "";
		if (!/^video\//i.test(ct) && !/mp4/i.test(ct)) {
			return c.json({ message: `upstream is not a video: ${ct || "unknown"}` }, 400);
		}

		const headers = new Headers();
		headers.set("Content-Type", ct || "video/mp4");
		const contentLength = resp.headers.get("content-length");
		if (contentLength) headers.set("Content-Length", contentLength);
		const acceptRanges = resp.headers.get("accept-ranges");
		if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
		const contentRange = resp.headers.get("content-range");
		if (contentRange) headers.set("Content-Range", contentRange);
		const origin = c.req.header("origin") || "";
		headers.set("Access-Control-Allow-Origin", origin || "*");
		headers.set("Access-Control-Allow-Credentials", "true");
		headers.set(
			"Access-Control-Expose-Headers",
			"Content-Length,Content-Range,Accept-Ranges",
		);
		headers.set("Vary", "Origin");

		// Signed URLs should not be cached for long.
		headers.set("Cache-Control", "private, max-age=60");

		return new Response(resp.body, {
			status: resp.status,
			headers,
		});
	} catch (err: any) {
		return c.json(
			{ message: err?.message || "proxy video failed" },
			500,
		);
	}
});
