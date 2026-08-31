import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	AcceptTeamInviteRequestSchema,
	AddTeamMemberRequestSchema,
	CreateTeamInviteRequestSchema,
	CreateTeamRequestSchema,
	RenameTeamRequestSchema,
	ShareTeamProjectRequestSchema,
	TeamCreditLedgerEntrySchema,
	TeamCreditLedgerListResponseSchema,
	TeamInviteSchema,
	TeamListItemSchema,
	TeamMemberSchema,
	TeamMembershipSchema,
	TeamProjectShareSchema,
	TeamSchema,
	TopUpTeamCreditsRequestSchema,
} from "./team.schemas";
import {
	acceptTeamInvite,
	addMemberToTeam,
	createInviteForTeam,
	createNewTeam,
	disbandTeam,
	getMyTeam,
	isAdminRequest,
	listCreditsLedgerForTeam,
	listMyCreditsLedger,
	listInvitesForTeam,
	listMembersForTeam,
	listTeams,
	normalizeTeamMaxMembers,
	removeMemberFromTeam,
	renameTeam,
	topUpCreditsForTeam,
} from "./team.service";
import { shareProjectWithMyTeam } from "../project/project.service";
import { getTeamById } from "./team.repo";
import {
	ActivateTeamSubscriptionSchema,
	UpsertTeamSubscriptionPlanSchema,
} from "./team-subscription.schemas";
import {
	activateTeamSubscription,
	cancelTeamSubscription,
	getActiveTeamSubscription,
	getActiveTeamSubscriptions,
	getAllTeamSubscriptionPlans,
	listTeamSubscriptionPlans,
	upsertTeamSubscriptionPlan,
} from "./team-subscription.service";

export const teamRouter = new Hono<AppEnv>();

teamRouter.use("*", authMiddleware);

function parseLedgerLimit(raw: string | undefined): number {
	const parsed = Number(raw ?? 20);
	if (!Number.isFinite(parsed)) return 20;
	return Math.max(1, Math.min(50, Math.floor(parsed)));
}

function mapLedgerEntry(
	row: {
		id: string;
		team_id: string;
		entry_type: string;
		amount: number;
		task_id: string | null;
		task_kind: string | null;
		actor_user_id: string | null;
		note: string | null;
		created_at: string;
	},
	teamNames?: Map<string, string>,
) {
	return TeamCreditLedgerEntrySchema.parse({
		id: row.id,
		teamId: row.team_id,
		teamName: teamNames?.get(row.team_id) ?? null,
		entryType: row.entry_type,
		amount: Number(row.amount ?? 0) || 0,
		taskId: row.task_id ?? null,
		taskKind: row.task_kind ?? null,
		actorUserId: row.actor_user_id ?? null,
		note: row.note ?? null,
		createdAt: row.created_at,
	});
}

function mapTeam(row: {
	id: string;
	name: string;
	credits: number;
	credits_frozen?: number | null;
	max_members?: number | null;
	member_count?: number | null;
	created_at: string;
	updated_at: string;
}) {
	const credits = Number(row.credits ?? 0) || 0;
	const creditsFrozen = Number(row.credits_frozen ?? 0) || 0;
	const memberCount = row.id.startsWith("personal_")
		? 1
		: Number(row.member_count ?? 0) || 0;
	return TeamSchema.parse({
		id: row.id,
		name: row.name,
		credits,
		creditsFrozen,
		creditsAvailable: Math.max(0, credits - creditsFrozen),
		maxMembers: normalizeTeamMaxMembers(row),
		memberCount,
		personal: row.id.startsWith("personal_"),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

teamRouter.get("/me", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const selectedTeamId = c.req.header("X-Team-Id") || c.req.query("teamId") || null;
	const res = await getMyTeam(c, userId, selectedTeamId);
	if (!res) return c.json({ team: null }, 200);
	return c.json(
		TeamMembershipSchema.parse({
			team: mapTeam({ ...res.team, member_count: res.memberCount }),
			role: res.role,
		}),
	);
});

teamRouter.get("/me/ledger", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const limit = parseLedgerLimit(c.req.query("limit"));
	const before = c.req.query("before") || null;
	const beforeId = c.req.query("beforeId") || null;
	const rows = await listMyCreditsLedger(c, userId, {
		limit: limit + 1,
		before,
		beforeId,
	});
	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;
	// 聚合视图：逐行回填扣款账户展示名（个人账户显示「个人账户」，团队显示团队名）。
	const teamNames = new Map<string, string>();
	const distinctTeamIds = [...new Set(sliced.map((r) => r.team_id))];
	await Promise.all(
		distinctTeamIds.map(async (teamId) => {
			if (teamId.startsWith("personal_")) {
				teamNames.set(teamId, "个人账户");
				return;
			}
			const team = await getTeamById(c.env.DB, teamId).catch(() => null);
			if (team?.name) teamNames.set(teamId, team.name);
		}),
	);
	const items = sliced.map((row) => mapLedgerEntry(row, teamNames));
	const lastItem = items.length ? items[items.length - 1] : null;
	return c.json(
		TeamCreditLedgerListResponseSchema.parse({
			items,
			hasMore,
			nextBefore: lastItem?.createdAt ?? null,
			nextBeforeId: lastItem?.id ?? null,
		}),
	);
});

teamRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const rows = await listTeams(c, userId);
	const admin = isAdminRequest(c);

	const items = rows.map((r) => TeamListItemSchema.parse(mapTeam(r)));
	return c.json(items);
});

teamRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateTeamRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const out = await createNewTeam(c, userId, parsed.data);
	return c.json({ id: out.teamId });
});

/** 重命名团队 */
teamRouter.patch("/:teamId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RenameTeamRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	await renameTeam(c, userId, teamId, parsed.data.name);
	return c.body(null, 204);
});

/** 解散团队 */
teamRouter.delete("/:teamId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	await disbandTeam(c, userId, teamId);
	return c.body(null, 204);
});

teamRouter.get("/:teamId/members", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const rows = await listMembersForTeam(c, userId, teamId);
	return c.json(
		rows.map((r) =>
			TeamMemberSchema.parse({
				userId: r.user_id,
				login: r.login,
				name: r.name ?? null,
				avatarUrl: r.avatar_url ?? null,
				email: r.email ?? null,
				phone: r.phone ?? null,
				role: r.role,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			}),
		),
	);
});

teamRouter.post("/:teamId/members", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AddTeamMemberRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	await addMemberToTeam(c, userId, teamId, parsed.data);
	return c.body(null, 204);
});

/** 移除团队成员 */
teamRouter.delete("/:teamId/members/:memberId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const memberId = c.req.param("memberId");
	await removeMemberFromTeam(c, userId, teamId, memberId);
	return c.body(null, 204);
});

teamRouter.get("/:teamId/invites", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const rows = await listInvitesForTeam(c, userId, teamId);
	return c.json(
		rows.map((r) =>
			TeamInviteSchema.parse({
				id: r.id,
				teamId: r.team_id,
				code: r.code,
				email: r.email ?? null,
				phone: r.phone ?? null,
				login: r.login ?? null,
				status: r.status,
				expiresAt: r.expires_at ?? null,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			}),
		),
	);
});

teamRouter.post("/:teamId/invites", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateTeamInviteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const row = await createInviteForTeam(c, userId, teamId, parsed.data);
	return c.json(
		TeamInviteSchema.parse({
			id: row.id,
			teamId: row.team_id,
			code: row.code,
			email: row.email ?? null,
			phone: row.phone ?? null,
			login: row.login ?? null,
			status: row.status,
			expiresAt: row.expires_at ?? null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}),
	);
});

teamRouter.post("/invites/accept", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AcceptTeamInviteRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const out = await acceptTeamInvite(c, userId, parsed.data.code.trim());
	return c.json({ teamId: out.teamId });
});

teamRouter.post("/:teamId/topup", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = TopUpTeamCreditsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const row = await topUpCreditsForTeam(c, userId, teamId, parsed.data);
	return c.json(mapTeam(row));
});

teamRouter.post("/projects/:projectId/share", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("projectId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ShareTeamProjectRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const row = await shareProjectWithMyTeam(c, userId, {
		projectId,
		teamId: parsed.data.teamId,
		shared: parsed.data.shared,
	});
	if (!row) return c.body(null, 204);
	return c.json(
		TeamProjectShareSchema.parse({
			projectId: row.project_id,
			teamId: row.team_id,
			access: row.access,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}),
	);
});

teamRouter.get("/:teamId/ledger", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const limit = parseLedgerLimit(c.req.query("limit"));
	const before = c.req.query("before") || null;
	const beforeId = c.req.query("beforeId") || null;
	const rows = await listCreditsLedgerForTeam(c, userId, teamId, {
		limit: limit + 1,
		before,
		beforeId,
	});
	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;
	const items = sliced.map((row) => mapLedgerEntry(row));
	const lastItem = items.length ? items[items.length - 1] : null;
	return c.json(
		TeamCreditLedgerListResponseSchema.parse({
			items,
			hasMore,
			nextBefore: lastItem?.createdAt ?? null,
			nextBeforeId: lastItem?.id ?? null,
		}),
	);
});

// ---------------------------------------------------------------------------
// Team Subscription Plan routes
// ---------------------------------------------------------------------------

/** 获取所有启用套餐（任何登录用户可查） */
teamRouter.get("/subscription-plans", async (c) => {
	const plans = await listTeamSubscriptionPlans(c.env.DB);
	return c.json(plans);
});

teamRouter.get("/subscription-plans/admin/all", async (c) => {
	if (!isAdminRequest(c)) return c.json({ error: "Forbidden" }, 403);
	return c.json(await getAllTeamSubscriptionPlans(c.env.DB));
});

teamRouter.post("/subscription-plans/admin", async (c) => {
	if (!isAdminRequest(c)) return c.json({ error: "Forbidden" }, 403);
	const body: unknown = await c.req.json().catch(() => ({}));
	const parsed = UpsertTeamSubscriptionPlanSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await upsertTeamSubscriptionPlan(c, parsed.data));
});

teamRouter.put("/subscription-plans/admin/:planId", async (c) => {
	if (!isAdminRequest(c)) return c.json({ error: "Forbidden" }, 403);
	const body: unknown = await c.req.json().catch(() => ({}));
	const parsed = UpsertTeamSubscriptionPlanSchema.safeParse({
		...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
		id: c.req.param("planId"),
	});
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	return c.json(await upsertTeamSubscriptionPlan(c, parsed.data));
});

/** 获取团队当前订阅 */
teamRouter.get("/:teamId/subscription", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const sub = await getActiveTeamSubscription(c.env.DB, teamId);
	return c.json(sub ?? null);
});

/** 激活/切换套餐（仅管理员） */
teamRouter.post("/:teamId/subscription", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ActivateTeamSubscriptionSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const sub = await activateTeamSubscription(c, teamId, {
		...parsed.data,
		actorUserId: userId,
	});
	return c.json(sub);
});

/** 取消订阅（仅管理员） */
teamRouter.delete("/:teamId/subscription", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	await cancelTeamSubscription(c, teamId, userId);
	return c.body(null, 204);
});

/** 取消指定订阅（仅管理员） */
teamRouter.delete("/:teamId/subscriptions/:subId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const subId = c.req.param("subId");
	await cancelTeamSubscription(c, teamId, userId, subId);
	return c.body(null, 204);
});

/** 获取全部活跃订阅列表 */
teamRouter.get("/:teamId/subscriptions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const subs = await getActiveTeamSubscriptions(c.env.DB, teamId);
	return c.json(subs);
});
