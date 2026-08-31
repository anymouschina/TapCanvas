import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { clearAuthCookies } from "../auth/auth.cookies";
import { isAdminRequest } from "../team/team.service";
import {
	AccountSettingsSchema,
	AdminNotificationCreateSchema,
	AdminSessionListQuerySchema,
	ListQuerySchema,
	NotificationFilterSchema,
	UpdateProfileSchema,
	UpdateWorkPublicationSchema,
} from "./account.schemas";
import { readAccountSettings, saveAccountSettings } from "./account.settings";
import {
	createAdminNotifications,
	getCheckIn,
	getOverview,
	getProfile,
	listAdminNotifications,
	listAdminSessions,
	listCredits,
	listLikes,
	listNotifications,
	listUserSessions,
	listWorks,
	logoutCurrentSession,
	markAllNotificationsRead,
	markNotificationRead,
	performCheckIn,
	revokeAdminSession,
	revokeUserSession,
	updateProfile,
	updateWorkPublication,
	deleteWork,
} from "./account.service";

export const accountRouter = new Hono<AppEnv>();
export const accountAdminRouter = new Hono<AppEnv>();

accountRouter.use("*", authMiddleware);
accountAdminRouter.use("*", authMiddleware);

function requireUserId(c: AppContext): string {
	const userId = c.get("userId");
	if (!userId) throw new Error("auth middleware did not provide userId");
	return userId;
}

function requireSessionId(c: AppContext): string {
	const sessionId = c.get("authSessionId");
	if (!sessionId) throw new Error("auth middleware did not provide authSessionId");
	return sessionId;
}

function assertAdmin(c: AppContext): Response | null {
	return isAdminRequest(c) ? null : c.json({ error: "Forbidden", code: "admin_required" }, 403);
}

accountRouter.get("/overview", async (c) => c.json(await getOverview(c, requireUserId(c), c.get("auth"))));
accountRouter.get("/profile", async (c) => c.json(await getProfile(requireUserId(c))));
accountRouter.patch("/profile", async (c) => {
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = UpdateProfileSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "资料格式不正确", issues: parsed.error.issues }, 400);
	return c.json(await updateProfile(requireUserId(c), parsed.data));
});

accountRouter.get("/works", async (c) => {
	const parsed = ListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	return c.json(await listWorks(requireUserId(c), parsed.data.cursor, parsed.data.limit));
});
accountRouter.post("/works/:id/publication", async (c) => {
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = UpdateWorkPublicationSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "作品上下架参数无效", issues: parsed.error.issues }, 400);
	return c.json(await updateWorkPublication(requireUserId(c), c.req.param("id").trim(), parsed.data.published));
});
accountRouter.delete("/works/:id", async (c) => c.json(await deleteWork(requireUserId(c), c.req.param("id").trim())));

accountRouter.get("/likes", async (c) => {
	const parsed = ListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	return c.json(await listLikes(requireUserId(c), parsed.data.cursor, parsed.data.limit));
});

accountRouter.get("/credits", async (c) => {
	const parsed = ListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	return c.json(await listCredits(c, requireUserId(c), parsed.data.cursor, parsed.data.limit));
});

accountRouter.get("/check-in", async (c) => c.json(await getCheckIn(c, requireUserId(c), c.get("auth"))));
accountRouter.post("/check-in", async (c) => c.json(await performCheckIn(c, requireUserId(c), c.get("auth"))));

accountRouter.get("/notifications", async (c) => {
	const list = ListQuerySchema.safeParse(c.req.query());
	const filter = NotificationFilterSchema.safeParse(c.req.query("filter") || "all");
	if (!list.success || !filter.success) return c.json({ error: "Invalid query" }, 400);
	return c.json(await listNotifications(requireUserId(c), filter.data, list.data.cursor, list.data.limit));
});
accountRouter.post("/notifications/read-all", async (c) => c.json(await markAllNotificationsRead(requireUserId(c))));
accountRouter.post("/notifications/:id/read", async (c) => c.json(await markNotificationRead(requireUserId(c), c.req.param("id"))));

accountRouter.get("/sessions", async (c) => c.json({ items: await listUserSessions(requireUserId(c), requireSessionId(c)) }));
accountRouter.delete("/sessions/:id", async (c) => c.json(await revokeUserSession(requireUserId(c), c.req.param("id"), requireSessionId(c))));
accountRouter.post("/logout", async (c) => {
	const result = await logoutCurrentSession(requireUserId(c), requireSessionId(c));
	clearAuthCookies(c);
	return c.json(result);
});

accountAdminRouter.get("/settings", async (c) => {
	const forbidden = assertAdmin(c);
	if (forbidden) return forbidden;
	return c.json(await readAccountSettings(c));
});
accountAdminRouter.put("/settings", async (c) => {
	const forbidden = assertAdmin(c);
	if (forbidden) return forbidden;
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = AccountSettingsSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "配置格式不正确", issues: parsed.error.issues }, 400);
	return c.json(await saveAccountSettings(c, parsed.data));
});
accountAdminRouter.get("/notifications", async (c) => {
	const forbidden = assertAdmin(c);
	if (forbidden) return forbidden;
	const parsed = ListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	return c.json(await listAdminNotifications(parsed.data.cursor, parsed.data.limit));
});
accountAdminRouter.post("/notifications", async (c) => {
	const forbidden = assertAdmin(c);
	if (forbidden) return forbidden;
	const body: unknown = await c.req.json().catch(() => null);
	const parsed = AdminNotificationCreateSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "消息格式不正确", issues: parsed.error.issues }, 400);
	return c.json(await createAdminNotifications(c, parsed.data));
});
accountAdminRouter.get("/sessions", async (c) => {
	const forbidden = assertAdmin(c);
	if (forbidden) return forbidden;
	const parsed = AdminSessionListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	return c.json(await listAdminSessions(parsed.data));
});
accountAdminRouter.delete("/sessions/:id", async (c) => {
	const forbidden = assertAdmin(c);
	if (forbidden) return forbidden;
	return c.json(await revokeAdminSession(c.req.param("id")));
});
