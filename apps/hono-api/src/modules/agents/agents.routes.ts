import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { apiKeyAuthMiddleware } from "../apiKey/apiKey.middleware";
import {
	AgentSkillSchema,
	AgentDiagnosticsResponseSchema,
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
	UpsertAgentSkillRequestSchema,
} from "./agents.schemas";
import {
	createUserAgentPipelineRun,
	deleteAdminAgentSkill,
	getAdminAgentDiagnostics,
	getAdminGlobalWorkspaceContextFileVersion,
	getAdminProjectWorkspaceContext,
	getUserProjectWorkspaceContext,
	getUserProjectWorkspaceContextFileVersion,
	verifyUserProjectWorkspaceContext,
	rollbackAdminGlobalWorkspaceContextFileVersion,
	rollbackUserProjectWorkspaceContextFileVersion,
	updateAdminGlobalWorkspaceContextFile,
	updateUserProjectWorkspaceContextFile,
	executeUserAgentPipelineRun,
	getUserAgentPipelineRunById,
	listAdminAgentSkills,
	listUserAgentPipelineRuns,
	getPublicAgentSkill,
	listPublicAgentSkills,
	updateUserAgentPipelineRunStatus,
	upsertAdminAgentSkill,
} from "./agents.service";

export const agentsRouter = new Hono<AppEnv>();
export const adminAgentsRouter = new Hono<AppEnv>();

// Public skill listing should work for both end-user JWT and external API keys.
agentsRouter.use("*", apiKeyAuthMiddleware);
adminAgentsRouter.use("*", authMiddleware);

agentsRouter.get("/skill", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skill = await getPublicAgentSkill(c as any);
	return c.json({ skill: skill ? AgentSkillSchema.parse(skill) : null });
});

agentsRouter.get("/skills", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const skills = await listPublicAgentSkills(c as any);
	return c.json(skills.map((s) => AgentSkillSchema.parse(s)));
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
	const isCanvasSource = ensureCanvasStoryboardRequest(c);
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


adminAgentsRouter.get("/diagnostics", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.query("projectId") || "").trim() || undefined;
	const bookId = (c.req.query("bookId") || "").trim() || undefined;
	const chapterId = (c.req.query("chapterId") || "").trim() || undefined;
	const label = (c.req.query("label") || "").trim() || undefined;
	const workflowKey = (c.req.query("workflowKey") || "").trim() || undefined;
	const turnVerdictRaw = (c.req.query("turnVerdict") || "").trim();
	const turnVerdict =
		turnVerdictRaw === "satisfied" || turnVerdictRaw === "partial" || turnVerdictRaw === "failed"
			? turnVerdictRaw
			: undefined;
	const runOutcomeRaw = (c.req.query("runOutcome") || "").trim();
	const runOutcome =
		runOutcomeRaw === "promote" || runOutcomeRaw === "hold" || runOutcomeRaw === "discard"
			? runOutcomeRaw
			: undefined;
	const limitRaw = Number(c.req.query("limit") || 50);
	const limit = Number.isFinite(limitRaw)
		? Math.max(1, Math.min(200, Math.floor(limitRaw)))
		: 50;
	const result = await getAdminAgentDiagnostics(c as any, userId, {
		projectId,
		bookId,
		chapterId,
		label,
		workflowKey,
		turnVerdict,
		runOutcome,
		limit,
	});
	return c.json(AgentDiagnosticsResponseSchema.parse(result));
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
