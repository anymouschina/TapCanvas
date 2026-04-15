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

chapterRouter.route("/", authed);
