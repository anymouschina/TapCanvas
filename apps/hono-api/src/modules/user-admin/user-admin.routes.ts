import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	AdminAdjustUserTeamCreditsRequestSchema,
	AdminUserListResponseSchema,
	AdminUpdateUserRequestSchema,
	AdminUserSchema,
	ListAdminUsersQuerySchema,
} from "./user-admin.schemas";
import {
	adjustAdminUserTeamCredits,
	deleteAdminUser,
	listAdminUsers,
	updateAdminUser,
} from "./user-admin.service";

export const userAdminRouter = new Hono<AppEnv>();

userAdminRouter.use("*", authMiddleware);

userAdminRouter.get("/", async (c) => {
	const parsed = ListAdminUsersQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid query", issues: parsed.error.issues },
			400,
		);
	}

	const includeDeleted = (() => {
		const raw = parsed.data.includeDeleted;
		if (!raw) return false;
		const v = raw.trim().toLowerCase();
		return v === "1" || v === "true" || v === "yes" || v === "on";
	})();

	const items = await listAdminUsers(c as any, {
		q: parsed.data.q,
		page: parsed.data.page,
		pageSize: parsed.data.pageSize,
		includeDeleted,
	});

	return c.json(AdminUserListResponseSchema.parse(items));
});

userAdminRouter.patch("/:userId", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);

	const userId = c.req.param("userId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AdminUpdateUserRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const updated = await updateAdminUser(c as any, {
		actorUserId,
		userId,
		...parsed.data,
	});
	return c.json(AdminUserSchema.parse(updated));
});

userAdminRouter.delete("/:userId", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);
	const userId = c.req.param("userId");
	await deleteAdminUser(c as any, { actorUserId, userId });
	return c.body(null, 204);
});

userAdminRouter.post("/:userId/team-credits", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);

	const userId = c.req.param("userId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AdminAdjustUserTeamCreditsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const updated = await adjustAdminUserTeamCredits(c as any, {
		actorUserId,
		userId,
		delta: (parsed.data as any).delta ?? 0,
		...((parsed.data as any).note ? { note: (parsed.data as any).note } : {}),
	});
	return c.json(AdminUserSchema.parse(updated));
});
