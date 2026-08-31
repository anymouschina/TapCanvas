import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import { apiKeyAuthMiddleware } from "../apiKey/apiKey.middleware";
import {
	AgentSkillSchema,
	AgentSkillMetadataSchema,
	CreateUserContextAssetRequestSchema,
	ListUserContextAssetMarketplaceRequestSchema,
	AgentDiagnosticsResponseSchema,
	AgentExecutionEventPageSchema,
	AgentDiagnosticsQuerySchema,
	ProjectWorkspaceContextFileVersionContentSchema,
	ProjectWorkspaceContextSchema,
	ProjectWorkspaceContextVerifyResponseSchema,
	UpdateGlobalWorkspaceContextFileRequestSchema,
	UpdateProjectWorkspaceContextFileRequestSchema,
	RollbackGlobalWorkspaceContextFileRequestSchema,
	RollbackProjectWorkspaceContextFileRequestSchema,
	AgentPipelineRunSchema,
	CreateAgentPipelineRunRequestSchema,
	ExecuteAgentPipelineRunRequestSchema,
	UpdateAgentPipelineRunStatusRequestSchema,
	UpdateUserContextAssetRequestSchema,
	UpsertAgentSkillRequestSchema,
	UserContextAssetContentSchema,
	UserContextAssetSchema,
} from "./agents.schemas";
import {
	createUserAgentPipelineRun,
	deleteAdminAgentSkill,
	getAdminAgentDiagnostics,
	getUserAgentDiagnostics,
	getAdminGlobalWorkspaceContextFileVersion,
	getAdminProjectWorkspaceContext,
	getUserProjectWorkspaceContext,
	getUserProjectWorkspaceContextFileVersion,
	verifyUserProjectWorkspaceContext,
	rollbackAdminGlobalWorkspaceContextFileVersion,
	rollbackUserProjectWorkspaceContextFileVersion,
	updateAdminGlobalWorkspaceContextFile,
	updateUserProjectWorkspaceContextFile,
	getUserAgentPipelineRunById,
	listAdminAgentSkills,
	listUserAgentPipelineRuns,
	getPublicAgentSkill,
	listPublicAgentSkills,
	updateUserAgentPipelineRunStatus,
	upsertAdminAgentSkill,
	submitAdminAgentHumanFeedback,
	submitUserAgentHumanFeedback,
	captureAdminAgentRegressionExample,
	captureUserAgentRegressionExample,
} from "./agents.service";
import { executeUserAgentPipelineRun } from "./agents-pipeline-agents-cli";
import {
	AgentHumanFeedbackSchema,
	AgentRegressionExampleSchema,
	CreateAgentHumanFeedbackRequestSchema,
	CreateAgentRegressionExampleRequestSchema,
} from "./agent-observability.schemas";
import { AgentObservabilityRequestError } from "./agent-observability.service";
import {
	handleAgentsLlmChatCompletions,
	handleAgentsLlmResponses,
	handleAgentsLlmVideoUnderstand,
} from "./agents-llm-proxy";
import { handleIntentClassifyVideo } from "./intent-classify";
import {
	createUserContextAsset,
	deleteUserContextAsset,
	getUserContextAssetContent,
	listUserContextAssets,
	updateUserContextAsset,
} from "./user-context-assets.service";
import {
	listUserContextAssetOnMarketplace,
	unlistUserContextAssetFromMarketplace,
} from "./skill-marketplace-listing.service";
import { skillMarketplaceRouter } from "./skill-marketplace.routes";
import { skillFavoritesRouter } from "./skill-favorites.routes";
import {
	listProductionWorkflowNodeEvents,
	parseProductionWorkflowEventPageQuery,
	ProductionWorkflowEventQueryError,
} from "../task/production-workflow-events-query";
import {
	getExecutionTraceDiagnosticBundle,
	listExecutionTraceEvents,
} from "../memory/execution-trace-events.repo";
import { getVideoAtomicNodeRunHistory } from "./async-execution-diagnostics";
import {
	AdoptAiWorkflowProjectRequestSchema,
	CapabilityBayQuerySchema,
	CreateAiWorkflowProjectRequestSchema,
	EquipCapabilityRequestSchema,
	GenerateWorkflowCapabilityDescriptionRequestSchema,
	InspectCapabilityRequestSchema,
	UpdateBuiltInCapabilityRequestSchema,
	UpdateSkillCapabilityRequestSchema,
	UpdateWorkflowCapabilityStateRequestSchema,
} from "./capability-bay.schemas";
import {
	adoptAiWorkflowProject,
	createAiWorkflowProject,
	equipWorkflowCapability,
	generateWorkflowCapabilityDescription,
	getCapabilityBay,
	inspectWorkflowCapability,
	updateBuiltInCapabilityState,
	updateSkillCapabilityState,
	updateWorkflowCapabilityState,
	unequipWorkflowCapability,
	deleteAiWorkflowProject,
} from "./capability-bay.service";
import {
	AdminBuiltInCapabilitySchema,
	UpdateAdminBuiltInCapabilityRequestSchema,
} from "./built-in-capability-settings.schemas";
import {
	listAdminBuiltInCapabilities,
	updateAdminBuiltInCapabilityState,
} from "./built-in-capability-settings.service";

export const agentsRouter = new Hono<AppEnv>();
export const adminAgentsRouter = new Hono<AppEnv>();

// Public skill listing should work for both end-user JWT and external API keys.
agentsRouter.use("*", apiKeyAuthMiddleware);
adminAgentsRouter.use("*", authMiddleware);

agentsRouter.route("/", skillMarketplaceRouter);
agentsRouter.route("/", skillFavoritesRouter);

// LLM proxy: agents-cli uses this endpoint with the user's API key so that
// each inference call goes through hono-api's credit-deduction layer.
agentsRouter.post("/llm/v1/chat/completions", (c) =>
	handleAgentsLlmChatCompletions(c as any),
);

// Native Responses transport for Harness providers that cannot be represented
// as Chat Completions without losing streaming lifecycle events.
agentsRouter.post("/llm/v1/responses", (c) =>
	handleAgentsLlmResponses(c as unknown as AppContext),
);

// Silent metadata work has its own endpoint and never enters /public/chat,
// active-turn ownership, conversation persistence, delivery verification or
// durable continuation scheduling.
agentsRouter.post("/llm/v1/auxiliary/chat/completions", (c) =>
	handleAgentsLlmChatCompletions(c as unknown as AppContext, { executionClass: "auxiliary" }),
);

agentsRouter.post("/llm/v1/video-understand", (c) =>
	handleAgentsLlmVideoUnderstand(c),
);

// 视频领域意图分类（C2）：服务端把组内文本+图喂给 tapcanvas-intent-classifier
// 的判据（SKILL.md 为真相源），返回 { profileId, confidence, signals, rationale }。
agentsRouter.post("/intent/classify-video", (c) =>
	handleIntentClassifyVideo(c as any),
);

agentsRouter.get("/skill", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skill = await getPublicAgentSkill(c as any);
	return c.json({ skill: skill ? AgentSkillMetadataSchema.parse(skill) : null });
});

agentsRouter.get("/skills", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skills = await listPublicAgentSkills(c as any);
	return c.json(skills.map((s) => AgentSkillMetadataSchema.parse(s)));
});

agentsRouter.get("/diagnostics", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = AgentDiagnosticsQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json({ error: "Invalid diagnostics query", issues: parsed.error.issues }, 400);
	}
	try {
		const result = await getUserAgentDiagnostics(c as unknown as AppContext, userId, parsed.data);
		return c.json(AgentDiagnosticsResponseSchema.parse(result));
	} catch (error: unknown) {
		const requestError = error instanceof AgentObservabilityRequestError ? error : null;
		return c.json({
			error: error instanceof Error ? error.message : "Agent diagnostics query failed",
			...(requestError ? { code: requestError.code } : {}),
		}, requestError ? 400 : 500);
	}
});

agentsRouter.post("/diagnostics/feedback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = CreateAgentHumanFeedbackRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid feedback payload", issues: parsed.error.issues }, 400);
	}
	try {
		const feedback = await submitUserAgentHumanFeedback(c as unknown as AppContext, userId, parsed.data);
		return c.json(AgentHumanFeedbackSchema.parse(feedback), 201);
	} catch (error: unknown) {
		const requestError = error instanceof AgentObservabilityRequestError ? error : null;
		return c.json({
			error: error instanceof Error ? error.message : "Feedback write failed",
			...(requestError ? { code: requestError.code } : {}),
		}, requestError ? 400 : 500);
	}
});

agentsRouter.post("/diagnostics/regression-examples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = CreateAgentRegressionExampleRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid regression example payload", issues: parsed.error.issues }, 400);
	}
	try {
		const example = await captureUserAgentRegressionExample(c as unknown as AppContext, userId, parsed.data);
		return c.json(AgentRegressionExampleSchema.parse(example), 201);
	} catch (error: unknown) {
		const requestError = error instanceof AgentObservabilityRequestError ? error : null;
		return c.json({
			error: error instanceof Error ? error.message : "Regression capture failed",
			...(requestError ? { code: requestError.code } : {}),
		}, requestError ? 400 : 500);
	}
});

agentsRouter.get("/capability-bay", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = CapabilityBayQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	return c.json(await getCapabilityBay(c as unknown as AppContext, userId, parsed.data.projectId));
});

agentsRouter.post("/capability-bay/projects", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = CreateAiWorkflowProjectRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await createAiWorkflowProject(c as unknown as AppContext, userId, parsed.data.name), 201);
});

agentsRouter.put("/capability-bay/projects/:projectId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = AdoptAiWorkflowProjectRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await adoptAiWorkflowProject(
		c as unknown as AppContext,
		userId,
		c.req.param("projectId").trim(),
	));
});

agentsRouter.post("/capability-bay/inspect", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = InspectCapabilityRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await inspectWorkflowCapability(c as unknown as AppContext, userId, parsed.data.flowId));
});

agentsRouter.post("/capability-bay/descriptions/generate", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = GenerateWorkflowCapabilityDescriptionRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await generateWorkflowCapabilityDescription(c as unknown as AppContext, parsed.data));
});

agentsRouter.put("/capability-bay/workflows/:flowId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = EquipCapabilityRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await equipWorkflowCapability(
		c as unknown as AppContext,
		userId,
		c.req.param("flowId").trim(),
		parsed.data,
	));
});

agentsRouter.delete("/capability-bay/workflows/:flowId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	return c.json(await unequipWorkflowCapability(c as unknown as AppContext, userId, c.req.param("flowId").trim()));
});

agentsRouter.delete("/capability-bay/projects/:projectId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	await deleteAiWorkflowProject(c as unknown as AppContext, userId, c.req.param("projectId"));
	return c.body(null, 204);
});

agentsRouter.put("/capability-bay/skills/:skillKey", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = UpdateSkillCapabilityRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await updateSkillCapabilityState(
		c as unknown as AppContext,
		userId,
		decodeURIComponent(c.req.param("skillKey")).trim(),
		parsed.data.enabled,
	));
});

agentsRouter.put("/capability-bay/built-ins/:capabilityKey", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = UpdateBuiltInCapabilityRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await updateBuiltInCapabilityState(
		c as unknown as AppContext,
		userId,
		decodeURIComponent(c.req.param("capabilityKey")).trim(),
		parsed.data.enabled,
	));
});

agentsRouter.put("/capability-bay/workflows/:flowId/state", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = UpdateWorkflowCapabilityStateRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await updateWorkflowCapabilityState(
		c as unknown as AppContext,
		userId,
		decodeURIComponent(c.req.param("flowId")).trim(),
		parsed.data.enabled,
	));
});

agentsRouter.get("/user-context-assets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assets = await listUserContextAssets(userId);
	return c.json({ assets: assets.map((asset) => UserContextAssetSchema.parse(asset)) });
});

agentsRouter.post("/user-context-assets", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateUserContextAssetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const asset = await createUserContextAsset(userId, parsed.data);
	return c.json(UserContextAssetSchema.parse(asset), 201);
});

agentsRouter.get("/user-context-assets/:assetId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const assetId = c.req.param("assetId").trim();
	const asset = await getUserContextAssetContent(userId, assetId);
	const internalApiKey = (c.req.header("x-api-key") || "").trim();
	if (asset.sourceMarketplaceProductId && !internalApiKey.startsWith("tc_internal:")) {
		throw new AppError("商城 Skill 正文仅允许 agents 运行时按需读取", {
			status: 403,
			code: "marketplace_skill_content_runtime_only",
			details: { assetId },
		});
	}
	return c.json(UserContextAssetContentSchema.parse(asset));
});

agentsRouter.patch("/user-context-assets/:assetId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateUserContextAssetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const asset = await updateUserContextAsset(userId, c.req.param("assetId").trim(), parsed.data);
	return c.json(UserContextAssetSchema.parse(asset));
});

agentsRouter.delete("/user-context-assets/:assetId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	return c.json(await deleteUserContextAsset(userId, c.req.param("assetId").trim()));
});

agentsRouter.post("/user-context-assets/:assetId/marketplace-listing", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = ListUserContextAssetMarketplaceRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const asset = await listUserContextAssetOnMarketplace(c as unknown as AppContext, userId, {
		assetId: c.req.param("assetId").trim(),
		...parsed.data,
	});
	return c.json(UserContextAssetSchema.parse(asset));
});

agentsRouter.delete("/user-context-assets/:assetId/marketplace-listing", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const asset = await unlistUserContextAssetFromMarketplace(
		c as unknown as AppContext,
		userId,
		c.req.param("assetId").trim(),
	);
	return c.json(UserContextAssetSchema.parse(asset));
});

agentsRouter.get("/project-context", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const bookId = (c.req.query("bookId") || "").trim() || undefined;
	const chapterRaw = Number(c.req.query("chapter") || "");
	const chapter = Number.isFinite(chapterRaw) ? Math.max(1, Math.floor(chapterRaw)) : undefined;
	const refresh = String(c.req.query("refresh") || "").trim().toLowerCase() === "true";
	const result = await getUserProjectWorkspaceContext(c as any, userId, {
		projectId,
		bookId,
		chapter: typeof chapter === "number" ? chapter : undefined,
		refresh,
	});
	return c.json(ProjectWorkspaceContextSchema.parse(result));
});

agentsRouter.get("/project-context/verify", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const result = await verifyUserProjectWorkspaceContext(c as any, userId, { projectId });
	return c.json(ProjectWorkspaceContextVerifyResponseSchema.parse(result));
});

agentsRouter.put("/project-context/file", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateProjectWorkspaceContextFileRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await updateUserProjectWorkspaceContextFile(c as any, userId, parsed.data);
	return c.json(ProjectWorkspaceContextSchema.parse(result));
});

agentsRouter.get("/project-context/version", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	const fileName = (c.req.query("fileName") || "").trim();
	const versionId = (c.req.query("versionId") || "").trim();
	if (!projectId || !fileName || !versionId) {
		return c.json({ error: "projectId, fileName, versionId are required" }, 400);
	}
	const result = await getUserProjectWorkspaceContextFileVersion(c as any, userId, {
		projectId,
		fileName,
		versionId,
	});
	return c.json(ProjectWorkspaceContextFileVersionContentSchema.parse(result));
});

agentsRouter.put("/project-context/rollback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RollbackProjectWorkspaceContextFileRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await rollbackUserProjectWorkspaceContextFileVersion(c as any, userId, parsed.data);
	return c.json(result);
});

agentsRouter.get("/pipeline/runs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim() || undefined;
	const limitRaw = Number(c.req.query("limit") || 50);
	const limit = Number.isFinite(limitRaw)
		? Math.max(1, Math.min(200, Math.trunc(limitRaw)))
		: 50;
	const runs = await listUserAgentPipelineRuns(c as any, userId, {
		projectId,
		limit,
	});
	return c.json(runs.map((x) => AgentPipelineRunSchema.parse(x)));
});

agentsRouter.post("/pipeline/runs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateAgentPipelineRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const run = await createUserAgentPipelineRun(c as any, userId, parsed.data);
	return c.json(AgentPipelineRunSchema.parse(run));
});

agentsRouter.get("/pipeline/runs/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const run = await getUserAgentPipelineRunById(c as any, userId, id);
	return c.json(AgentPipelineRunSchema.parse(run));
});

agentsRouter.patch("/pipeline/runs/:id/status", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateAgentPipelineRunStatusRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const run = await updateUserAgentPipelineRunStatus(c as any, userId, id, parsed.data);
	return c.json(AgentPipelineRunSchema.parse(run));
});

// 兼容画布现有的 pipeline run 资源协议；执行本身已硬切到
// agents-cli 单任务链，Hono 只负责认证、持久化状态和事实投影。
function isCanvasStoryboardRequest(c: { req: { header: (name: string) => string | undefined } }): boolean {
	return String(c.req.header("X-TapCanvas-Source") || "").trim().toLowerCase() === "canvas";
}

agentsRouter.post("/pipeline/runs/:id/execute", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ExecuteAgentPipelineRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const isCanvasSource = isCanvasStoryboardRequest(c);
	const run = await executeUserAgentPipelineRun(c as any, userId, id, {
		...parsed.data,
		skipMediaGeneration:
			typeof parsed.data.skipMediaGeneration === "boolean"
				? parsed.data.skipMediaGeneration
				: isCanvasSource,
	});
	return c.json(AgentPipelineRunSchema.parse(run));
});

// ---- Admin ----

adminAgentsRouter.get("/skills", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skills = await listAdminAgentSkills(c as any);
	return c.json(skills.map((s) => AgentSkillSchema.parse(s)));
});

adminAgentsRouter.post("/skills", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertAgentSkillRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const skill = await upsertAdminAgentSkill(c as any, parsed.data);
	return c.json(AgentSkillSchema.parse(skill));
});

adminAgentsRouter.get("/built-ins", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const capabilities = await listAdminBuiltInCapabilities(c as unknown as AppContext);
	return c.json(capabilities.map((capability) => AdminBuiltInCapabilitySchema.parse(capability)));
});

adminAgentsRouter.put("/built-ins/:capabilityKey", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = UpdateAdminBuiltInCapabilityRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const capability = await updateAdminBuiltInCapabilityState(
		c as unknown as AppContext,
		userId,
		c.req.param("capabilityKey"),
		parsed.data.enabled,
	);
	return c.json(AdminBuiltInCapabilitySchema.parse(capability));
});


adminAgentsRouter.get("/diagnostics", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = AgentDiagnosticsQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json({ error: "Invalid diagnostics query", issues: parsed.error.issues }, 400);
	}
	try {
		const result = await getAdminAgentDiagnostics(c as unknown as AppContext, userId, parsed.data);
		return c.json(AgentDiagnosticsResponseSchema.parse(result));
	} catch (error: unknown) {
		const requestError = error instanceof AgentObservabilityRequestError ? error : null;
		return c.json({
			error: error instanceof Error ? error.message : "Agent diagnostics query failed",
			...(requestError ? { code: requestError.code } : {}),
		}, requestError ? 400 : 500);
	}
});

adminAgentsRouter.get("/diagnostics/workflows/:runId/nodes/:nodeId/events", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		const query = parseProductionWorkflowEventPageQuery({
			beforeSeq: c.req.query("beforeSeq"),
			limit: c.req.query("limit"),
		});
		const page = await listProductionWorkflowNodeEvents({
			db: c.env.DB,
			runId: c.req.param("runId"),
			nodeId: c.req.param("nodeId"),
			...query,
		});
		return c.json(page);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Production workflow event query failed";
		const status = error instanceof ProductionWorkflowEventQueryError ? error.status : 500;
		return c.json({ error: message }, status);
	}
});

adminAgentsRouter.get("/diagnostics/video-runs/:runId/atomic-nodes/:nodeId/history", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		const history = await getVideoAtomicNodeRunHistory(
			c as unknown as AppContext,
			userId,
			c.req.param("runId"),
			c.req.param("nodeId"),
		);
		return c.json(history);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Video atomic node history query failed";
		const status = message === "video_atomic_history_node_id_invalid" || message === "video_atomic_history_run_id_required"
			? 400
			: 500;
		return c.json({ error: message }, status);
	}
});

adminAgentsRouter.get("/diagnostics/executions/:traceId/events", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const afterSeqRaw = c.req.query("afterSeq");
	const beforeSeqRaw = c.req.query("beforeSeq");
	const limitRaw = c.req.query("limit");
	const afterSeq = afterSeqRaw === undefined ? undefined : Number(afterSeqRaw);
	const beforeSeq = beforeSeqRaw === undefined ? undefined : Number(beforeSeqRaw);
	const limit = limitRaw === undefined ? 100 : Number(limitRaw);
	if (
		(afterSeq !== undefined && (!Number.isInteger(afterSeq) || afterSeq < 0)) ||
		(beforeSeq !== undefined && (!Number.isInteger(beforeSeq) || beforeSeq < 1)) ||
		!Number.isInteger(limit) || limit < 1 || limit > 200
	) {
		return c.json({ error: "Invalid execution event query" }, 400);
	}
	try {
		const page = await listExecutionTraceEvents(c.env.DB, {
			traceId: c.req.param("traceId"),
			userId,
			...(afterSeq !== undefined ? { afterSeq } : {}),
			...(beforeSeq !== undefined ? { beforeSeq } : {}),
			limit,
		});
		return c.json(AgentExecutionEventPageSchema.parse(page));
	} catch (error: unknown) {
		return c.json({
			error: error instanceof Error ? error.message : "Execution event query failed",
		}, 500);
	}
});

adminAgentsRouter.get("/diagnostics/executions/:traceId/export", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		const bundle = await getExecutionTraceDiagnosticBundle(c.env.DB, {
			traceId: c.req.param("traceId"),
			userId,
		});
		c.header("Content-Disposition", `attachment; filename="execution-${bundle.trace.id}.json"`);
		return c.json(bundle);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Execution diagnostic export failed";
		return c.json({ error: message }, message.startsWith("execution_trace_not_found:") ? 404 : 500);
	}
});

adminAgentsRouter.post("/diagnostics/feedback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = CreateAgentHumanFeedbackRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid feedback payload", issues: parsed.error.issues }, 400);
	}
	try {
		const feedback = await submitAdminAgentHumanFeedback(c as unknown as AppContext, userId, parsed.data);
		return c.json(AgentHumanFeedbackSchema.parse(feedback), 201);
	} catch (error: unknown) {
		const requestError = error instanceof AgentObservabilityRequestError ? error : null;
		return c.json({
			error: error instanceof Error ? error.message : "Feedback write failed",
			...(requestError ? { code: requestError.code } : {}),
		}, requestError ? 400 : 500);
	}
});

adminAgentsRouter.post("/diagnostics/regression-examples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = CreateAgentRegressionExampleRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid regression example payload", issues: parsed.error.issues }, 400);
	}
	try {
		const example = await captureAdminAgentRegressionExample(c as unknown as AppContext, userId, parsed.data);
		return c.json(AgentRegressionExampleSchema.parse(example), 201);
	} catch (error: unknown) {
		const requestError = error instanceof AgentObservabilityRequestError ? error : null;
		return c.json({
			error: error instanceof Error ? error.message : "Regression capture failed",
			...(requestError ? { code: requestError.code } : {}),
		}, requestError ? 400 : 500);
	}
});
adminAgentsRouter.get("/project-context", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim();
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	const bookId = (c.req.query("bookId") || "").trim() || undefined;
	const chapterRaw = Number(c.req.query("chapter") || "");
	const chapter = Number.isFinite(chapterRaw) ? Math.max(1, Math.floor(chapterRaw)) : undefined;
	const refresh = String(c.req.query("refresh") || "").trim().toLowerCase() === "true";
	const result = await getAdminProjectWorkspaceContext(c as any, userId, {
		projectId,
		bookId,
		chapter: typeof chapter === "number" ? chapter : undefined,
		refresh,
	});
	return c.json(ProjectWorkspaceContextSchema.parse(result));
});

adminAgentsRouter.put("/global-context/file", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateGlobalWorkspaceContextFileRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await updateAdminGlobalWorkspaceContextFile(c as any, parsed.data);
	return c.json(result);
});

adminAgentsRouter.get("/global-context/version", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const fileName = (c.req.query("fileName") || "").trim();
	const versionId = (c.req.query("versionId") || "").trim();
	if (!fileName || !versionId) {
		return c.json({ error: "fileName, versionId are required" }, 400);
	}
	const result = await getAdminGlobalWorkspaceContextFileVersion(c as any, { fileName, versionId });
	return c.json(ProjectWorkspaceContextFileVersionContentSchema.parse(result));
});

adminAgentsRouter.put("/global-context/rollback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RollbackGlobalWorkspaceContextFileRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const result = await rollbackAdminGlobalWorkspaceContextFileVersion(c as any, parsed.data);
	return c.json(result);
});

adminAgentsRouter.delete("/skills/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteAdminAgentSkill(c as any, id);
	return c.body(null, 204);
});
