import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { authMiddleware, optionalAuthMiddleware } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import {
	CreateCommentSchema,
	ExploreQuerySchema,
	PublishProjectSchema,
	UpdateProfileSchema,
} from "./community.schemas";
import * as svc from "./community.service";
import * as repo from "./community.repo";

export const communityRouter = new Hono<AppEnv>();

function requireUserId(c: AppContext): string {
	const id = c.get("userId");
	if (!id) throw new AppError("unauthorized", { status: 401, code: "unauthorized" });
	return id;
}

// ---------- public (read-only) ----------

communityRouter.get("/channels", async (c) => c.json(await svc.listChannels()));

communityRouter.get("/explore", async (c) => {
	const parsed = ExploreQuerySchema.safeParse(c.req.query());
	if (!parsed.success) throw new AppError("invalid query", { status: 400, code: "invalid_query" });
	return c.json(await svc.buildExplorePage(parsed.data));
});

communityRouter.get("/featured", async (c) => {
	const raw = Number(c.req.query("limit") ?? 8);
	const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 12) : 8;
	return c.json(await svc.listFeatured(limit));
});

communityRouter.get("/projects/:id", optionalAuthMiddleware, async (c) => c.json(await svc.getProjectDetail(c, c.req.param("id"))));

communityRouter.get("/projects/:id/comments", async (c) =>
	c.json(await svc.getComments(c.req.param("id"), c.req.query("cursor") ?? null)),
);

communityRouter.get("/users/:login", optionalAuthMiddleware, async (c) => c.json(await svc.getAuthorPage(c, c.req.param("login"))));

communityRouter.post("/projects/:id/view", async (c) => {
	await repo.incrementView(c.req.param("id"));
	return c.json({ ok: true });
});

// ---------- authenticated ----------

communityRouter.post("/projects/:id/like", authMiddleware, async (c) => {
	await svc.likeAndRehot(c.req.param("id"), requireUserId(c));
	return c.json({ ok: true });
});
communityRouter.delete("/projects/:id/like", authMiddleware, async (c) => {
	await svc.unlikeAndRehot(c.req.param("id"), requireUserId(c));
	return c.json({ ok: true });
});

communityRouter.post("/projects/:id/favorite", authMiddleware, async (c) => {
	await svc.favoriteAndRehot(c.req.param("id"), requireUserId(c));
	return c.json({ ok: true });
});
communityRouter.delete("/projects/:id/favorite", authMiddleware, async (c) => {
	await svc.unfavoriteAndRehot(c.req.param("id"), requireUserId(c));
	return c.json({ ok: true });
});

communityRouter.post("/projects/:id/comments", authMiddleware, async (c) => {
	const parsed = CreateCommentSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) throw new AppError("invalid body", { status: 400, code: "invalid_body" });
	return c.json(await svc.comment(c.req.param("id"), requireUserId(c), parsed.data.body, parsed.data.parentId));
});

communityRouter.delete("/comments/:id", authMiddleware, async (c) => {
	const ok = await repo.softDeleteComment(c.req.param("id"), requireUserId(c));
	return c.json({ ok });
});

communityRouter.patch("/projects/:id/publish", authMiddleware, async (c) => {
	const parsed = PublishProjectSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) throw new AppError("invalid body", { status: 400, code: "invalid_body" });
	return c.json(await svc.publishProject(c, c.req.param("id"), requireUserId(c), parsed.data));
});

communityRouter.post("/users/:login/follow", authMiddleware, async (c) => {
	await svc.follow(c.req.param("login"), requireUserId(c));
	return c.json({ ok: true });
});
communityRouter.delete("/users/:login/follow", authMiddleware, async (c) => {
	await svc.unfollow(c.req.param("login"), requireUserId(c));
	return c.json({ ok: true });
});

communityRouter.put("/me/profile", authMiddleware, async (c) => {
	const parsed = UpdateProfileSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) throw new AppError("invalid body", { status: 400, code: "invalid_body" });
	return c.json(await svc.updateProfile(requireUserId(c), parsed.data));
});
