import { Hono } from "hono";
import type { AppEnv } from "../../types";
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

function limitReadableStream(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): ReadableStream<Uint8Array> {
	if (!Number.isFinite(maxBytes) || maxBytes <= 0) return stream;
	let seen = 0;
	const limiter = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			seen += chunk.byteLength || 0;
			if (seen > maxBytes) {
				controller.error(new Error("file is too large"));
				return;
			}
			controller.enqueue(chunk);
		},
	});
	return stream.pipeThrough(limiter);
}

function getPublicBase(env: AppEnv["Bindings"]): string {
	const rawBase =
		typeof (env as any).R2_PUBLIC_BASE_URL === "string"
			? ((env as any).R2_PUBLIC_BASE_URL as string)
			: "";
	return rawBase.trim().replace(/\/+$/, "");
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
	let bodyStream: ReadableStream<Uint8Array> | null = null;
	let name = "";

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

		bodyStream =
			typeof (file as any).stream === "function"
				? (file as any).stream()
				: null;
		if (!bodyStream) {
			const buf = await file.arrayBuffer();
			bodyStream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(buf));
					controller.close();
				},
			});
		}
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
		if (Number.isFinite(parsedLen) && parsedLen > MAX_BYTES) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}
		size = Number.isFinite(parsedLen) ? parsedLen : null;
		if (size == null) {
			const declaredSizeHeader = c.req.header("x-file-size");
			const declaredSize =
				typeof declaredSizeHeader === "string" && declaredSizeHeader
					? Number(declaredSizeHeader)
					: NaN;
			size = Number.isFinite(declaredSize) ? declaredSize : null;
		}

		name = sanitizeUploadName(c.req.query("name") || "") || (kind === "video" ? "Video" : "Image");
		bodyStream = c.req.raw.body as ReadableStream<Uint8Array> | null;
		if (!bodyStream) {
			return c.json({ error: "request body is required" }, 400);
		}
	}

	const ext = detectUploadExtensionFromMeta({
		contentType,
		fileName: originalName || undefined,
	});
	const key = buildUserUploadKey(userId, ext);
	const limited = limitReadableStream(bodyStream, MAX_BYTES);
	try {
		await bucket.put(key, limited, {
			httpMetadata: {
				contentType,
				cacheControl: "public, max-age=31536000, immutable",
			},
		});
	} catch (err: any) {
		const msg = String(err?.message || "");
		if (/too large/i.test(msg)) {
			return c.json({ error: "file is too large (max 30MB)" }, 413);
		}
		throw err;
	}

	const publicBase = getPublicBase(c.env);
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

	const publicBase = getPublicBase(c.env);
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
	const publicBase = getPublicBase(c.env);
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
		const r2PublicBase = (c.env.R2_PUBLIC_BASE_URL || "").trim();
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
