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

function getPublicBase(env: AppEnv["Bindings"]): string {
	const rawBase =
		typeof (env as any).R2_PUBLIC_BASE_URL === "string"
			? ((env as any).R2_PUBLIC_BASE_URL as string)
			: "";
	return rawBase.trim().replace(/\/+$/, "");
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
		const buf = await resp.arrayBuffer();
		return new Response(buf, {
			status: resp.status,
			headers: {
				"Content-Type": ct,
				"Cache-Control": "public, max-age=60",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (err: any) {
		return c.json(
			{ message: err?.message || "proxy image failed" },
			500,
		);
	}
});
