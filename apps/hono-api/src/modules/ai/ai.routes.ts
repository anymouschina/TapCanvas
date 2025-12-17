import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	PromptSampleSchema,
	PromptSampleInputSchema,
	PromptSampleParseRequestSchema,
} from "./ai.schemas";
import {
	createPromptSample,
	deletePromptSample,
	listPromptSamples,
	parsePromptSample,
} from "./ai.service";
import {
	clearLangGraphThreadForProject,
	getLangGraphThreadIdForProject,
	clearLangGraphSnapshotForProject,
	getLangGraphSnapshotForProject,
	setLangGraphThreadIdForProject,
	upsertLangGraphSnapshotForProject,
} from "./ai.langgraph";

export const aiRouter = new Hono<AppEnv>();

aiRouter.use("*", authMiddleware);

aiRouter.get("/prompt-samples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const q = c.req.query("q") || undefined;
	const nodeKind = c.req.query("nodeKind") || undefined;
	const source = c.req.query("source") || undefined;
	const result = await listPromptSamples(c, userId, { q, nodeKind, source });
	return c.json({
		samples: result.samples.map((s) => PromptSampleSchema.parse(s)),
	});
});

aiRouter.post("/prompt-samples/parse", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptSampleParseRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await parsePromptSample(c, userId, parsed.data);
	return c.json(PromptSampleInputSchema.parse(result));
});

aiRouter.post("/prompt-samples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const sample = await createPromptSample(c, userId, body);
	return c.json(PromptSampleSchema.parse(sample));
});

aiRouter.delete("/prompt-samples/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deletePromptSample(c, userId, id);
	return c.body(null, 204);
});

// ---- LangGraph research assistant (single thread per project) ----

aiRouter.get("/langgraph/projects/:projectId/thread", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const threadId = await getLangGraphThreadIdForProject(c, userId, projectId);
	return c.json({ threadId });
});

aiRouter.put("/langgraph/projects/:projectId/thread", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const threadId =
		typeof (body as any).threadId === "string" ? (body as any).threadId : "";
	const result = await setLangGraphThreadIdForProject(
		c,
		userId,
		projectId,
		threadId,
	);
	return c.json(result);
});

aiRouter.delete("/langgraph/projects/:projectId/thread", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	await clearLangGraphThreadForProject(c, userId, projectId);
	return c.body(null, 204);
});

// ---- LangGraph durable chat snapshot (per project) ----

aiRouter.get("/langgraph/projects/:projectId/snapshot", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const snapshot = await getLangGraphSnapshotForProject(c, userId, projectId);
	return c.json({ snapshot });
});

aiRouter.put("/langgraph/projects/:projectId/snapshot", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const messagesJson =
		typeof (body as any).messagesJson === "string"
			? (body as any).messagesJson
			: "";
	const threadId =
		typeof (body as any).threadId === "string" ? (body as any).threadId : null;
	const result = await upsertLangGraphSnapshotForProject(c, userId, projectId, {
		threadId,
		messagesJson,
	});
	return c.json({ snapshot: result });
});

aiRouter.delete("/langgraph/projects/:projectId/snapshot", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = (c.req.param("projectId") || "").trim();
	if (!projectId) {
		return c.json(
			{ error: "projectId is required", code: "project_id_required" },
			400,
		);
	}
	await clearLangGraphSnapshotForProject(c, userId, projectId);
	return c.body(null, 204);
});
