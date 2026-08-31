import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, resolveAuth } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import type { AppContext, AppEnv } from "../../types";
import { isAdminRequest } from "../team/team.service";
import { createPromptLibraryCrawl, kickPromptLibraryCrawl, resumePromptLibraryCrawl } from "./prompt-library.crawler";
import { createPromptLibraryComment, deletePromptLibraryComment, getCrawlRun, getPromptLibraryDetail, listPromptLibraryComments, getPromptLibrarySummary, listCrawlRuns, listPromptLibrary, togglePromptLibraryLike } from "./prompt-library.repo";

const ListQuerySchema = z.object({
	query: z.string().trim().max(200).optional(),
	model: z.string().trim().max(80).optional(),
	mediaType: z.enum(["image", "video"]).optional(),
	sort: z.enum(["likes_desc", "name_asc", "time_asc", "time_desc"]).default("likes_desc"),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

export const promptLibraryRouter = new Hono<AppEnv>();
export const promptLibraryAdminRouter = new Hono<AppEnv>();

promptLibraryRouter.get("/", async (c) => {
	const parsed = ListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "提示词查询参数不合法", issues: parsed.error.issues }, 400);
	return c.json(await listPromptLibrary(c.env.DB, parsed.data));
});

promptLibraryRouter.get("/:id", async (c) => {
	const viewer = await resolveAuth(c as AppContext);
	const detail = await getPromptLibraryDetail(c.env.DB, c.req.param("id"), viewer?.payload.sub);
	return detail ? c.json(detail) : c.json({ error: "提示词不存在" }, 404);
});

promptLibraryRouter.get("/:id/comments", async (c) => {
	const viewer = await resolveAuth(c as AppContext);
	return c.json(await listPromptLibraryComments(c.env.DB, c.req.param("id"), viewer?.payload.sub));
});

promptLibraryRouter.post("/:id/like", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		return c.json(await togglePromptLibraryLike(c.env.DB, c.req.param("id"), userId));
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : "点赞失败" }, 404);
	}
});

promptLibraryRouter.post("/:id/comments", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => ({}));
	const content = body && typeof body === "object" && !Array.isArray(body) && typeof Reflect.get(body, "content") === "string" ? String(Reflect.get(body, "content")) : "";
	try {
		return c.json(await createPromptLibraryComment(c.env.DB, c.req.param("id"), userId, content), 201);
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : "评论失败" }, 400);
	}
});

promptLibraryRouter.delete("/comments/:commentId", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		await deletePromptLibraryComment(c.env.DB, c.req.param("commentId"), userId);
		return c.body(null, 204);
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : "删除评论失败" }, 404);
	}
});

promptLibraryAdminRouter.use("*", authMiddleware);
promptLibraryAdminRouter.use("*", async (c, next) => {
	if (!isAdminRequest(c as AppContext)) throw new AppError("仅管理员可管理提示词采集", { status: 403, code: "forbidden" });
	await next();
});

promptLibraryAdminRouter.get("/summary", async (c) => c.json(await getPromptLibrarySummary(c.env.DB)));
promptLibraryAdminRouter.get("/crawls", async (c) => c.json(await listCrawlRuns(c.env.DB)));
promptLibraryAdminRouter.get("/crawls/:id", async (c) => {
	const run = await getCrawlRun(c.env.DB, c.req.param("id"));
	return run ? c.json(run) : c.json({ error: "采集任务不存在" }, 404);
});

function keepRunning(c: AppContext, work: Promise<void>): void {
	c.executionCtx.waitUntil(work.catch((error: unknown) => {
		console.error("[prompt-library] crawl failed", error);
	}));
}

promptLibraryAdminRouter.post("/crawls", async (c) => {
	const run = await createPromptLibraryCrawl(c.env.DB, c.get("userId") ?? null);
	keepRunning(c as AppContext, kickPromptLibraryCrawl(c.env, run.id));
	return c.json(run, 202);
});

promptLibraryAdminRouter.post("/crawls/:id/resume", async (c) => {
	const run = await resumePromptLibraryCrawl(c.env.DB, c.req.param("id"));
	if (!run) return c.json({ error: "采集任务不存在" }, 404);
	keepRunning(c as AppContext, kickPromptLibraryCrawl(c.env, run.id));
	return c.json(run, 202);
});
