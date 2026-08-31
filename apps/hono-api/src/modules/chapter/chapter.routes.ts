import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateChapterShotSchema,
	ChapterSchema,
	ChapterWorkbenchSchema,
	MoveChapterShotSchema,
	UpdateChapterShotSchema,
	UpdateChapterSchema,
} from "./chapter.schemas";
import {
	createChapterShotForUser,
	deleteChapterForUser,
	deleteChapterShotForUser,
	getChapterForUser,
	getChapterWorkbenchForUser,
	moveChapterShotForUser,
	updateChapterShotForUser,
	updateChapterForUser,
} from "./chapter.service";
const CANVAS_CONN_ID_HEADER = "X-Canvas-Conn-Id";
import {
	GetCanvasFlowResponseSchema,
	PutCanvasFlowRequestSchema,
	PutCanvasFlowResponseSchema,
} from "./chapter.canvas-flow.schemas";
import {
	getChapterCanvasFlow,
	putChapterCanvasFlow,
	CanvasFlowNotFoundError,
	CanvasFlowRevisionConflictError,
} from "./chapter.canvas-flow.service";
import { subscribeToChapter, broadcastPatch } from "./canvas-sse.manager";

import { setChapterFilmSpec } from "../task/video-orchestrator.authoring.repo";
import { buildChapterVideoRunStatusSnapshot } from "../task/video-run.status-snapshot";
import { isAdminRequest } from "../team/team.service";

export const chapterRouter = new Hono<AppEnv>();

const authed = new Hono<AppEnv>();
authed.use("*", authMiddleware);

authed.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const chapter = await getChapterForUser(c, userId, c.req.param("id"));
	return c.json(ChapterSchema.parse(chapter));
});

authed.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const result = await deleteChapterForUser(c, userId, c.req.param("id"));
	return c.json(result);
});

authed.patch("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateChapterSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const chapter = await updateChapterForUser(
		c,
		userId,
		c.req.param("id"),
		parsed.data,
	);
	return c.json(ChapterSchema.parse(chapter));
});

authed.get("/:id/workbench", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const workbench = await getChapterWorkbenchForUser(c, userId, c.req.param("id"));
	return c.json(ChapterWorkbenchSchema.parse(workbench));
});

authed.post("/:id/shots", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateChapterShotSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const shot = await createChapterShotForUser(c, userId, c.req.param("id"));
	return c.json(shot);
});

authed.patch("/:id/shots/:shotId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateChapterShotSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const shot = await updateChapterShotForUser(
		c,
		userId,
		c.req.param("id"),
		c.req.param("shotId"),
		parsed.data,
	);
	return c.json(shot);
});

authed.post("/:id/shots/:shotId/move", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = MoveChapterShotSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const shot = await moveChapterShotForUser(
		c,
		userId,
		c.req.param("id"),
		c.req.param("shotId"),
		parsed.data.direction,
	);
	return c.json(shot);
});

authed.delete("/:id/shots/:shotId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const result = await deleteChapterShotForUser(
		c,
		userId,
		c.req.param("id"),
		c.req.param("shotId"),
	);
	return c.json(result);
});

authed.get("/:id/canvas-flow", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		const result = await getChapterCanvasFlow(c, userId, c.req.param("id"));
		return c.json(GetCanvasFlowResponseSchema.parse(result));
	} catch (err) {
		if (err instanceof CanvasFlowNotFoundError) {
			return c.json({ error: "Not found" }, 404);
		}
		throw err;
	}
});

authed.put("/:id/canvas-flow", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PutCanvasFlowRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	try {
		const result = await putChapterCanvasFlow(
			c,
			userId,
			c.req.param("id"),
			parsed.data,
		);
		return c.json(PutCanvasFlowResponseSchema.parse(result));
	} catch (err) {
		if (err instanceof CanvasFlowNotFoundError) {
			return c.json({ error: "Not found" }, 404);
		}
		if (err instanceof CanvasFlowRevisionConflictError) {
			return c.json(
				{
					error: "Revision conflict",
					expected: err.expected,
					actual: err.actual,
				},
				409,
			);
		}
		throw err;
	}
});

// ── Real-time canvas sync ────────────────────────────────────────────────────

authed.get("/:id/canvas-events", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const chapterId = c.req.param("id");

	// Verify access using team-aware check
	try {
		await getChapterForUser(c, userId, chapterId);
	} catch {
		return c.json({ error: "Forbidden" }, 403);
	}

	const enc = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			const { connId, unsubscribe } = subscribeToChapter(chapterId, userId, controller, {
				canViewAdminWorkflow: isAdminRequest(c),
			});
			// Send connId so client can identify itself when posting patches
			try {
				controller.enqueue(enc.encode(`event: conn-id\ndata: ${connId}\n\n`));
			} catch { /* already closed */ }
			// 章节页刷新或重连发送单一权威快照；前端原子替换作用域状态。
			void (async () => {
				try {
					const snapshot = await buildChapterVideoRunStatusSnapshot(chapterId);
					controller.enqueue(enc.encode(`event: run-status-snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
				} catch (error) {
					console.error("[chapter-canvas-events] required run-status snapshot failed", error);
					unsubscribe();
					try { controller.error(error); } catch { /* already closed */ }
				}
			})();
			c.req.raw.signal.addEventListener("abort", () => {
				unsubscribe();
				try { controller.close(); } catch { /* already closed */ }
			});
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-store",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
});

// 章级入口持久化交付范围与用户明确选择的改编模式。模型、画幅和分辨率来自 AI 对话生成偏好，分段由工作流决定。
authed.put("/:id/film-spec", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const chapterId = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return c.json({ error: "Invalid spec" }, 400);
	}
	const spec = body as Record<string, unknown>;
	if (spec.freeAdaptation !== undefined) {
		return c.json({ error: "freeAdaptation 已停用，请使用 adaptationMode=creative 或 faithful" }, 400);
	}
	if (spec.enableQa !== undefined) {
		return c.json({ error: "enableQa 已停用；创作复盘只在作者链内修订，不再作为出片前门禁" }, 400);
	}
	const adaptationMode = spec.adaptationMode;
	if (adaptationMode !== undefined && adaptationMode !== "faithful" && adaptationMode !== "creative") {
		return c.json({ error: "Invalid adaptationMode" }, 400);
	}
	const deliveryScope = spec.deliveryScope;
	const targetDurationSeconds = spec.targetDurationSeconds;
	if (deliveryScope !== undefined && deliveryScope !== "full_chapter" && deliveryScope !== "opening_duration") {
		return c.json({ error: "Invalid deliveryScope" }, 400);
	}
	if (deliveryScope === "opening_duration" && (!Number.isInteger(targetDurationSeconds) || Number(targetDurationSeconds) <= 0)) {
		return c.json({ error: "opening_duration requires a positive integer targetDurationSeconds" }, 400);
	}
	const ok = await setChapterFilmSpec({
		chapterId,
		ownerId: userId,
		spec: {
			...(adaptationMode === "faithful" || adaptationMode === "creative" ? { adaptationMode } : {}),
			...(deliveryScope === "full_chapter" || deliveryScope === "opening_duration" ? { deliveryScope } : {}),
			...(deliveryScope === "opening_duration" ? { targetDurationSeconds: Number(targetDurationSeconds) } : {}),
			...(typeof spec.notes === "string" ? { notes: spec.notes.slice(0, 2000) } : {}),
		},
		nowIso: new Date().toISOString(),
	});
	if (!ok) return c.json({ error: "chapter not found" }, 404);
	return c.json({ ok: true });
});

authed.post("/:id/canvas-patches", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const chapterId = c.req.param("id");
	const senderConnId = c.req.header(CANVAS_CONN_ID_HEADER) ?? "";
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") {
		return c.json({ error: "Invalid patch" }, 400);
	}
	broadcastPatch(chapterId, body, senderConnId);
	return c.body(null, 204);
});

chapterRouter.route("/", authed);
