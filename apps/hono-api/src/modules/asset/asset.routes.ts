import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateAssetSchema,
	RenameAssetSchema,
	ServerAssetSchema,
} from "./asset.schemas";
import {
	createAssetRow,
	deleteAssetRow,
	listAssetsForUser,
	renameAssetRow,
} from "./asset.repo";

export const assetRouter = new Hono<AppEnv>();

assetRouter.use("*", authMiddleware);

assetRouter.get("/", async (c) => {
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

assetRouter.post("/", async (c) => {
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

assetRouter.put("/:id", async (c) => {
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

assetRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteAssetRow(c.env.DB, userId, id);
	return c.body(null, 204);
});

// Proxy image: /assets/proxy-image?url=...
assetRouter.get("/proxy-image", async (c) => {
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

