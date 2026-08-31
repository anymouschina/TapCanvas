import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { apiKeyAuthMiddleware } from "../apiKey/apiKey.middleware";
import { subscribeToChapter, broadcastPatch, broadcastRunStatus } from "../chapter/canvas-sse.manager";
import {
	getProjectForUserAccess,
	isValidWorkflow,
	updateProjectWorkflow,
	VALID_WORKFLOWS,
} from "./project.repo";
import { getPrismaClient } from "../../platform/node/prisma";
const CANVAS_CONN_ID_HEADER = "X-Canvas-Conn-Id";
import {
	BootstrapProjectFlowSchema,
	CloneProjectSchema,
	ProjectSchema,
	TogglePublicSchema,
	UpdateProjectTemplateSchema,
	UpsertProjectSchema,
} from "./project.schemas";
import { ChapterListResponseSchema, ChapterSchema, CreateChapterSchema, ProjectDefaultEntrySchema } from "../chapter/chapter.schemas";
import {
	cloneProjectForUser,
	deleteProjectForUser,
	getPublicProjectChatSessions,
	getPublicProjectConversation,
	getPublicProjectFlow,
	getPublicProjectFlows,
	listPublicProjectDtos,
	listUserProjects,
	listUserProjectsPaginated,
	toggleProjectPublicForUser,
	updateProjectTemplateForUser,
	upsertProjectForUser,
} from "./project.service";
import { upsertUserFlow } from "../flow/flow.service";
import { createChapterForUser, getProjectDefaultEntryForUser, listProjectChaptersForUser } from "../chapter/chapter.service";
import {
	cancelActiveVideoRunsForProject,
	getChapterTitlesByIds,
	getAuthoringClipProgressByRunIds,
} from "../task/video-run.repo";
import {
	buildProjectVideoRunStatusSnapshot,
	readAuthoringTotalClips,
} from "../task/video-run.status-snapshot";
import { isAdminRequest } from "../team/team.service";
import { cancelProductionEffectsForRuns } from "../task/production-effect-ledger";

export const projectRouter = new Hono<AppEnv>();

// Public routes (no auth)
projectRouter.get("/public", async (c) => {
	const projects = await listPublicProjectDtos(c);
	return c.json(ProjectSchema.array().parse(projects));
});

projectRouter.get("/:id/flows", async (c) => {
	const id = c.req.param("id");
	const ownerType = c.req.query("ownerType")?.trim() || "";
	const ownerId = c.req.query("ownerId")?.trim() || "";
	if ((ownerType || ownerId) && (ownerType !== "chapter" || !ownerId)) {
		return c.json({
			error: "Public flow scope requires ownerType=chapter and a non-empty ownerId",
		}, 400);
	}
	const flows = ownerType === "chapter"
		? await getPublicProjectFlows(c, id, { ownerType, ownerId })
		: await getPublicProjectFlows(c, id);
	return c.json(flows);
});

projectRouter.get("/public/flows/:flowId", async (c) => {
	const flowId = c.req.param("flowId");
	const flow = await getPublicProjectFlow(c, flowId);
	return c.json(flow);
});

projectRouter.get("/:id/chat", async (c) => {
	const id = c.req.param("id");
	const items = await getPublicProjectChatSessions(c, id);
	return c.json({ items });
});

projectRouter.get("/:id/conversation", async (c) => {
	const id = c.req.param("id");
	const ownerType = c.req.query("ownerType")?.trim() || "";
	const ownerId = c.req.query("ownerId")?.trim() || "";
	if ((ownerType || ownerId) && (ownerType !== "chapter" || !ownerId)) {
		return c.json({
			error: "Public conversation scope requires ownerType=chapter and a non-empty ownerId",
		}, 400);
	}
	const sessions = ownerType === "chapter"
		? await getPublicProjectConversation(c, id, { ownerType, ownerId })
		: await getPublicProjectConversation(c, id);
	return c.json({ sessions });
});

// Protected routes
const authed = new Hono<AppEnv>();
authed.use("*", apiKeyAuthMiddleware);

authed.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const limitRaw = c.req.query("limit");
	const cursor = c.req.query("cursor") || undefined;
	const teamId = c.req.query("teamId") || undefined;
	if (limitRaw !== undefined || cursor !== undefined || teamId !== undefined) {
		const limit = Math.min(Math.max(1, Number(limitRaw) || 30), 100);
		const result = await listUserProjectsPaginated(c, userId, { limit, cursor, teamId });
		return c.json({ items: ProjectSchema.array().parse(result.items), nextCursor: result.nextCursor });
	}
	const projects = await listUserProjects(c, userId);
	return c.json(ProjectSchema.array().parse(projects));
});

authed.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProjectSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await upsertProjectForUser(c, userId, parsed.data);
	return c.json(ProjectSchema.parse(project));
});

authed.post("/bootstrap", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = BootstrapProjectFlowSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const project = await upsertProjectForUser(c, userId, {
		name: parsed.data.name,
		teamId: parsed.data.teamId,
	});
	try {
		const flow = await upsertUserFlow(c, userId, {
			name: parsed.data.flow.name,
			data: parsed.data.flow.data,
			projectId: project.id,
			ownerType: "project",
			ownerId: project.id,
			source: "user",
		});
		return c.json({
			status: "complete",
			project: ProjectSchema.parse(project),
			flow: {
				id: flow.id,
				name: flow.name,
				ownerType: flow.ownerType,
				ownerId: flow.ownerId,
				canvasRevision: flow.canvasRevision,
				createdAt: flow.createdAt,
				updatedAt: flow.updatedAt,
			},
		}, 201);
	} catch (error) {
		const message = error instanceof Error ? error.message : "提示词写入画布失败";
		console.error("[project-bootstrap] project created but flow creation failed", {
			projectId: project.id,
			error: message,
		});
		return c.json({
			status: "partial",
			project: ProjectSchema.parse(project),
			error: message,
		}, 207);
	}
});

authed.get("/:id/chapters", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const items = await listProjectChaptersForUser(c, userId, projectId);
	return c.json(
		ChapterListResponseSchema.parse({
			projectId,
			items,
		}),
	);
});

authed.post("/:id/chapters", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateChapterSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const chapter = await createChapterForUser(c, userId, projectId, parsed.data);
	return c.json(ChapterSchema.parse(chapter));
});

authed.get("/:id/default-entry", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const entry = await getProjectDefaultEntryForUser(c, userId, projectId);
	return c.json(ProjectDefaultEntrySchema.parse(entry));
});

authed.patch("/:id/public", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = TogglePublicSchema.safeParse(body);
	if (!parsed.success) {
	 return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await toggleProjectPublicForUser(
		c,
		userId,
		id,
		parsed.data.isPublic,
	);
	return c.json(ProjectSchema.parse(project));
});

authed.patch("/:id/template", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateProjectTemplateSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await updateProjectTemplateForUser(c, userId, id, parsed.data);
	return c.json(ProjectSchema.parse(project));
});

authed.post("/:id/clone", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CloneProjectSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await cloneProjectForUser(
		c,
		userId,
		id,
		parsed.data.name,
	);
	return c.json(ProjectSchema.parse(project));
});

authed.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	await deleteProjectForUser(c, userId, id);
	return c.body(null, 204);
});

// ── Real-time project canvas sync ────────────────────────────────────────────

authed.get("/:id/canvas-events", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");

	const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "Forbidden" }, 403);

	const enc = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			const { connId, unsubscribe } = subscribeToChapter(projectId, userId, controller, {
				canViewAdminWorkflow: isAdminRequest(c),
			});
			try {
				controller.enqueue(enc.encode(`event: conn-id\ndata: ${connId}\n\n`));
			} catch { /* already closed */ }
			// 建连握手只发送一份权威快照。前端必须原子替换当前作用域的 run store；
			// 快照中不存在的旧 run 即已不活跃，无需依赖补发历史终态清理。
			void (async () => {
				try {
					const snapshot = await buildProjectVideoRunStatusSnapshot(projectId);
					controller.enqueue(enc.encode(`event: run-status-snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
				} catch (error) {
					console.error("[project-canvas-events] required run-status snapshot failed", error);
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

// 终止本 project 或指定画布作用域内的视频生产 run（画布「终止视频生产」入口）。置 cancelled（终态）后，
// 当前同步驱动与断连恢复 worker 都会停止；广播 run-status:cancelled 让前端进度 chip 立即消失。
// 注：已提交到上游的单个 clip 可能仍渲染完（不强杀上游），但不再推进/生成后续段，画布停止churning。
authed.post("/:id/video-runs/cancel", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
	if (!project) return c.json({ error: "Forbidden" }, 403);
	const rawBody: unknown = await c.req.json().catch(() => null);
	const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
		? rawBody as Record<string, unknown>
		: {};
	const flowId = typeof body.flowId === "string" ? body.flowId.trim() : "";
	const chapterId = typeof body.chapterId === "string" ? body.chapterId.trim() : "";
	if (flowId && chapterId) {
		return c.json({ error: "flowId 与 chapterId 只能指定一个画布作用域" }, 400);
	}
	const nowIso = new Date().toISOString();
	const cancelled = await cancelActiveVideoRunsForProject({
		projectId,
		...(flowId ? { flowId } : {}),
		...(chapterId ? { chapterId } : {}),
		nowIso,
	});
	const effectCancellation = await cancelProductionEffectsForRuns({
		runIds: cancelled.map((run) => run.id),
		cancelledAt: nowIso,
	});
	const cancelledTitles = await getChapterTitlesByIds(cancelled.map((r) => r.chapter_id));
	const cancelledAuthoringProgress = await getAuthoringClipProgressByRunIds(cancelled.map((run) => run.id));
	for (const run of cancelled) {
		broadcastRunStatus(projectId, {
			runId: run.id,
			flowId: run.flow_id,
			state: "cancelled",
			totalClips: run.total_clips,
			clipsDone: run.clips_done,
			errorMessage: null,
			completedAt: nowIso,
			authoringState: run.authoring_state,
			authoringClipsReady: cancelledAuthoringProgress[run.id]?.ready ?? 0,
			authoringTotalClips: readAuthoringTotalClips(run),
			updatedAt: nowIso,
			chapterId: run.chapter_id,
			chapterTitle: run.chapter_id ? (cancelledTitles[run.chapter_id] ?? null) : null,
		});
	}
	return c.json({
		ok: true,
		cancelledCount: cancelled.length,
		effectCancellation,
	});
});

authed.patch("/:id/workflow", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const workflow = body?.workflow;
	if (!isValidWorkflow(workflow)) {
		return c.json({ error: "invalid_workflow", validValues: VALID_WORKFLOWS }, 400);
	}
	const existing = await getProjectForUserAccess(getPrismaClient(), projectId, userId);
	if (!existing) return c.json({ error: "not_found" }, 404);
	const updated = await updateProjectWorkflow(projectId, workflow);
	return c.json({ workflow: updated?.active_workflow ?? workflow });
});

authed.post("/:id/canvas-patches", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const senderConnId = c.req.header(CANVAS_CONN_ID_HEADER) ?? "";
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") {
		return c.json({ error: "Invalid patch" }, 400);
	}
	broadcastPatch(projectId, body, senderConnId);
	return c.body(null, 204);
});

projectRouter.route("/", authed);
