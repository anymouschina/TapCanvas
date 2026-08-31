import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateMaterialAssetRequestSchema,
	CreateMaterialVersionRequestSchema,
	CreateTeamMaterialAssetRequestSchema,
	CreateMaterialFolderRequestSchema,
	MaterialAssetSchema,
	MaterialAssetVersionSchema,
	MaterialFolderSchema,
	MaterialImpactResponseSchema,
	MaterialShotRefSchema,
	UpdateMaterialAssetRequestSchema,
	UpsertShotMaterialRefsRequestSchema,
} from "./material.schemas";
import {
	createMaterialAssetForOwner,
	createMaterialVersionForOwner,
	createMaterialFolderForUser,
	createTeamMaterialAssetForMember,
	deleteMaterialAssetForOwner,
	deleteMaterialFolderForUser,
	deleteTeamMaterialAssetForMember,
	listImpactedShotsForOwner,
	listMaterialFoldersForUser,
	listShotMaterialRefsForOwner,
	listMaterialAssetsForOwner,
	listProjectNodeAssetsForOwner,
	listMaterialVersionsForOwner,
	listTeamMaterialAssetsForMember,
	updateMaterialAssetForOwner,
	upsertShotMaterialRefsForOwner,
	upsertCanvasIndexRefForOwner,
	getProjectStyleImagesForOwner,
	setProjectStyleImagesForOwner,
	getProjectStyleLockForOwner,
	setProjectStyleLockForOwner,
	getProjectCinematicCameraForOwner,
	setProjectCinematicCameraForOwner,
	getProjectDirectorPersonaForOwner,
	setProjectDirectorPersonaForOwner,
	getActiveProjectLookBibleForUser,
} from "./material.service";
import { listDirectorPersonas } from "../ai/director-persona-pool";
import { dryRunMaterialMigration } from "./material.repo";

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
	const kindRaw = (c.req.query("kind") || "").trim();
	const kind =
		kindRaw === "character" ||
		kindRaw === "scene" ||
		kindRaw === "prop" ||
		kindRaw === "style" ||
		kindRaw === "text"
			? kindRaw
			: undefined;
	const projectId = (c.req.query("projectId") || "").trim();
	const items = projectId
		? await listProjectNodeAssetsForOwner(c, userId, { projectId, ...(kind ? { kind } : {}) })
		: await listMaterialAssetsForOwner(c, userId, { kind });
	return c.json(items.map((item) => MaterialAssetSchema.parse(item)));
});

materialRouter.put("/assets/:assetId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assetId = c.req.param("assetId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateMaterialAssetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await updateMaterialAssetForOwner(c, userId, assetId, parsed.data);
	return c.json(MaterialAssetSchema.parse(result));
});

materialRouter.delete("/assets/:assetId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assetId = c.req.param("assetId");
	await deleteMaterialAssetForOwner(c, userId, assetId);
	return c.json({ ok: true });
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

// ── Team assets ───────────────────────────────────────────────────────────────

materialRouter.get("/team-assets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = (c.req.query("teamId") || "").trim();
	if (!teamId) return c.json({ error: "teamId is required" }, 400);
	const kindRaw = (c.req.query("kind") || "").trim();
	const kind =
		kindRaw === "character" ||
		kindRaw === "scene" ||
		kindRaw === "prop" ||
		kindRaw === "style" ||
		kindRaw === "text"
			? kindRaw
			: undefined;
	const items = await listTeamMaterialAssetsForMember(c, userId, { teamId, kind });
	return c.json(items.map((item) => MaterialAssetSchema.parse(item)));
});

materialRouter.post("/team-assets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateTeamMaterialAssetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await createTeamMaterialAssetForMember(c, userId, parsed.data);
	return c.json({
		asset: MaterialAssetSchema.parse(result.asset),
		version: MaterialAssetVersionSchema.parse(result.version),
	});
});

materialRouter.delete("/team-assets/:assetId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assetId = c.req.param("assetId");
	await deleteTeamMaterialAssetForMember(c, userId, assetId);
	return c.json({ ok: true });
});

// ── Folders ───────────────────────────────────────────────────────────────────

materialRouter.get("/folders", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = (c.req.query("teamId") || "").trim() || undefined;
	const items = await listMaterialFoldersForUser(c, userId, { teamId });
	return c.json(items.map((item) => MaterialFolderSchema.parse(item)));
});

materialRouter.post("/folders", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateMaterialFolderRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await createMaterialFolderForUser(c, userId, parsed.data);
	return c.json(MaterialFolderSchema.parse(result));
});

materialRouter.delete("/folders/:folderId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const folderId = c.req.param("folderId");
	await deleteMaterialFolderForUser(c, userId, folderId);
	return c.json({ ok: true });
});

const UpsertCanvasIndexRefSchema = z.object({
	projectId: z.string().min(1).max(200),
	nodeId: z.string().max(200).optional(),
	sourceNodeId: z.string().max(200).optional(),
	referenceType: z.enum(["character", "scene"]),
	name: z.string().min(1).max(200),
	imageUrl: z.string().min(1).max(2000),
	prompt: z.string().max(20000).optional(),
	modelKey: z.string().max(200).optional(),
	imageSize: z.string().max(40).optional(),
	creationStage: z.string().max(120).optional(),
});

// 画布参考图生成完成后回写 imageUrl 到 canvas-index.json，供下次 intent 复用
materialRouter.post("/canvas-index/upsert-ref", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertCanvasIndexRefSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	await upsertCanvasIndexRefForOwner(c, userId, parsed.data);
	return c.json({ ok: true });
});

// 项目级「全局风格图」（canvas-index.json styleImages）：前端 picker / agent set-style 工具 / 出图回退共享同一源。
// styleLock 为并列的「锁定风格」元数据（chip 渲染用），可选，向后兼容。
const StyleLockSchema = z.object({
	styleId: z.string().min(1).max(200),
	styleName: z.string().max(200).default(""),
	stylePrompt: z.string().max(4000).default(""),
	category: z.string().max(40).optional(),
});
const SetProjectStyleImagesSchema = z.object({
	projectId: z.string().min(1).max(200),
	styleImages: z.array(z.string().max(2048)).max(8),
	// null 显式清除锁定风格；undefined 表示本次不改 styleLock。
	styleLock: StyleLockSchema.nullable().optional(),
});

materialRouter.get("/canvas-index/style-images", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const styleImages = await getProjectStyleImagesForOwner(c, userId, projectId);
	const styleLock = await getProjectStyleLockForOwner(c, userId, projectId);
	return c.json({ styleImages, styleLock });
});

materialRouter.put("/canvas-index/style-images", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = SetProjectStyleImagesSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const styleImages = await setProjectStyleImagesForOwner(
		c,
		userId,
		parsed.data.projectId,
		parsed.data.styleImages,
	);
	let styleLock = await getProjectStyleLockForOwner(c, userId, parsed.data.projectId);
	if (parsed.data.styleLock !== undefined) {
		styleLock = await setProjectStyleLockForOwner(
			c,
			userId,
			parsed.data.projectId,
			parsed.data.styleLock,
		);
	}
	return c.json({ styleImages, styleLock });
});

// 项目级影调圣经：版本真源保存在项目 assets，画布节点只承载可见、可审计的完整文档。
// Web 只读当前激活版本；新版本必须由 agents-cli 依据用户上传文本编译并通过专用工具确认。
materialRouter.get("/project-look-bible", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const active = await getActiveProjectLookBibleForUser(c, userId, projectId);
	return c.json({
		active: active
			? {
					assetId: active.assetId,
					assetName: active.assetName,
					revision: active.revision,
					name: active.lookBible.name,
					summary: active.lookBible.summary,
					sectionCount: active.lookBible.sections.length,
					activatedAt: active.activatedAt,
					sourceNodeId: active.sourceNodeId,
					sourceFlowId: active.sourceFlowId,
					sourceChapterId: active.sourceChapterId,
				}
			: null,
	});
});

// 项目级「摄像机规格」（canvas-index.json cinematicCamera）：前端摄像机 chip 写、
// agent 出图（generate-image-to-canvas）读并自动拼进 prompt。与 styleImages 同构的项目级共享设置。
const CinematicCameraSchema = z.object({
	enabled: z.literal(true),
	cameraKey: z.string().max(60).default(""),
	lensKey: z.string().max(60).default(""),
	focalKey: z.string().max(60).default(""),
	apertureKey: z.string().max(60).default(""),
});
const SetProjectCinematicCameraSchema = z.object({
	projectId: z.string().min(1).max(200),
	// null = 显式清除
	cinematicCamera: CinematicCameraSchema.nullable(),
});

materialRouter.get("/canvas-index/cinematic-camera", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const cinematicCamera = await getProjectCinematicCameraForOwner(c, userId, projectId);
	return c.json({ cinematicCamera });
});

materialRouter.put("/canvas-index/cinematic-camera", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = SetProjectCinematicCameraSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const cinematicCamera = await setProjectCinematicCameraForOwner(
		c,
		userId,
		parsed.data.projectId,
		parsed.data.cinematicCamera,
	);
	return c.json({ cinematicCamera });
});

// 项目级「导演人格」（canvas-index.json directorPersona）：一键出片弹窗「选导演」picker 写、
// agents-bridge 每轮对话读并注入锁定块。personaId 指向 knowledge/作者导演美学/<id>.md 知识卡。
const SetProjectDirectorPersonaSchema = z.object({
	projectId: z.string().min(1).max(200),
	// null 显式清除（回到小T自选）
	persona: z
		.object({
			personaId: z.string().min(1).max(200),
			personaName: z.string().max(200).default(""),
		})
		.nullable(),
});

// 导演人格池目录（作者导演美学 知识卡 frontmatter 摘要，60s 缓存）
materialRouter.get("/director-personas", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const personas = await listDirectorPersonas();
	return c.json({ personas });
});

materialRouter.get("/canvas-index/director-persona", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const persona = await getProjectDirectorPersonaForOwner(c, userId, projectId);
	return c.json({ persona });
});

materialRouter.put("/canvas-index/director-persona", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = SetProjectDirectorPersonaSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const persona = await setProjectDirectorPersonaForOwner(
		c,
		userId,
		parsed.data.projectId,
		parsed.data.persona,
	);
	return c.json({ persona });
});

// 只读迁移预检：列出一个项目的所有素材资产，分析去重分组，不写入任何数据。
materialRouter.get("/migration-dry-run", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = String(c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId required" }, 400);
	const groups = await dryRunMaterialMigration(c.env.DB, { ownerId: userId, projectId, currentStyleLockId: null });
	return c.json({ projectId, groupCount: groups.length, groups });
});
