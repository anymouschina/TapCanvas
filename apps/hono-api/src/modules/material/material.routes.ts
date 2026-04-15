import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateMaterialAssetRequestSchema,
	CreateMaterialVersionRequestSchema,
	MaterialAssetSchema,
	MaterialAssetVersionSchema,
	MaterialImpactResponseSchema,
	MaterialShotRefSchema,
	UpsertShotMaterialRefsRequestSchema,
} from "./material.schemas";
import {
	createMaterialAssetForOwner,
	createMaterialVersionForOwner,
	listImpactedShotsForOwner,
	listShotMaterialRefsForOwner,
	listMaterialAssetsForOwner,
	listMaterialVersionsForOwner,
	upsertShotMaterialRefsForOwner,
} from "./material.service";

export const materialRouter = new Hono<AppEnv>();

materialRouter.use("*", authMiddleware);

materialRouter.post("/assets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateMaterialAssetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await createMaterialAssetForOwner(c, userId, parsed.data);
	return c.json({
		asset: MaterialAssetSchema.parse(result.asset),
		version: MaterialAssetVersionSchema.parse(result.version),
	});
});

materialRouter.get("/assets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	if (!projectId) {
		return c.json({ error: "projectId is required" }, 400);
	}
	const kindRaw = (c.req.query("kind") || "").trim();
	const kind =
		kindRaw === "character" ||
		kindRaw === "scene" ||
		kindRaw === "prop" ||
		kindRaw === "style"
			? kindRaw
			: undefined;
	const items = await listMaterialAssetsForOwner(c, userId, {
		projectId,
		kind,
	});
	return c.json(items.map((item) => MaterialAssetSchema.parse(item)));
});

materialRouter.post("/assets/:assetId/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assetId = c.req.param("assetId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateMaterialVersionRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const version = await createMaterialVersionForOwner(
		c,
		userId,
		assetId,
		parsed.data,
	);
	return c.json(MaterialAssetVersionSchema.parse(version));
});

materialRouter.get("/assets/:assetId/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assetId = c.req.param("assetId");
	const limitRaw = Number(c.req.query("limit") || 20);
	const limit = Number.isFinite(limitRaw)
		? Math.max(1, Math.min(200, Math.floor(limitRaw)))
		: 20;
	const versions = await listMaterialVersionsForOwner(c, userId, { assetId, limit });
	return c.json(versions.map((item) => MaterialAssetVersionSchema.parse(item)));
});

materialRouter.post("/shot-refs/upsert", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertShotMaterialRefsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const rows = await upsertShotMaterialRefsForOwner(c, userId, parsed.data);
	return c.json(rows.map((item) => MaterialShotRefSchema.parse(item)));
});

materialRouter.get("/shot-refs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const shotId = (c.req.query("shotId") || "").trim();
	if (!projectId || !shotId) {
		return c.json({ error: "projectId and shotId are required" }, 400);
	}
	const rows = await listShotMaterialRefsForOwner(c, userId, { projectId, shotId });
	return c.json(rows.map((item) => MaterialShotRefSchema.parse(item)));
});

materialRouter.get("/projects/:projectId/impacted-shots", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("projectId");
	const assetId = (c.req.query("assetId") || "").trim() || undefined;
	const result = await listImpactedShotsForOwner(c, userId, { projectId, assetId });
	return c.json(MaterialImpactResponseSchema.parse(result));
});
