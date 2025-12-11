import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
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

assetRouter.get("/", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const rows = await listAssetsForUser(c.env.DB, userId);
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
	return c.json(payload);
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

	const rawBase =
		typeof (c.env as any).R2_PUBLIC_BASE_URL === "string"
			? ((c.env as any).R2_PUBLIC_BASE_URL as string)
			: "";
	const publicBase = rawBase.trim().replace(/\/+$/, "");
	const isHosted = (url: string): boolean => {
		const trimmed = (url || "").trim();
		if (!trimmed) return false;
		if (publicBase) {
			return trimmed.startsWith(`${publicBase}/`);
		}
		// Fallback: default R2 key prefix
		return /^\/?gen\//.test(trimmed);
	};

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

			const thumbnailUrl =
				typeof data.thumbnailUrl === "string"
					? data.thumbnailUrl
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
		const resp = await fetch(target, {
			headers: {
				Origin: "https://tapcanvas.local",
			},
		});
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
