import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	AcceptTeamInviteRequestSchema,
	AddTeamMemberRequestSchema,
	CreateTeamInviteRequestSchema,
	CreateTeamRequestSchema,
	TeamCreditLedgerEntrySchema,
	TeamInviteSchema,
	TeamListItemSchema,
	TeamMemberSchema,
	TeamMembershipSchema,
	TeamSchema,
	TopUpTeamCreditsRequestSchema,
} from "./team.schemas";
import {
	acceptTeamInvite,
	addMemberToTeam,
	createInviteForTeam,
	createNewTeam,
	getMyTeam,
	isAdminRequest,
	listCreditsLedgerForTeam,
	listInvitesForTeam,
	listMembersForTeam,
	listTeams,
	topUpCreditsForTeam,
} from "./team.service";

export const teamRouter = new Hono<AppEnv>();

teamRouter.use("*", authMiddleware);

teamRouter.get("/me", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const res = await getMyTeam(c, userId);
	if (!res) return c.json({ team: null }, 200);
	return c.json(
		TeamMembershipSchema.parse({
			team: TeamSchema.parse({
				id: res.team.id,
				name: res.team.name,
				credits: Number(res.team.credits ?? 0) || 0,
				createdAt: res.team.created_at,
				updatedAt: res.team.updated_at,
			}),
			role: res.role,
		}),
	);
});

teamRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const rows = await listTeams(c, userId);
	const admin = isAdminRequest(c);

	const items = rows.map((r: any) =>
		TeamListItemSchema.parse({
			id: r.id,
			name: r.name,
			credits: Number(r.credits ?? 0) || 0,
			memberCount: admin ? Number(r.member_count ?? 0) || 0 : 0,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}),
	);
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
	return c.json(
		TeamSchema.parse({
			id: row.id,
			name: row.name,
			credits: Number(row.credits ?? 0) || 0,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}),
	);
});

teamRouter.get("/:teamId/ledger", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const teamId = c.req.param("teamId");
	const rows = await listCreditsLedgerForTeam(c, userId, teamId);
	return c.json(
		rows.map((r) =>
			TeamCreditLedgerEntrySchema.parse({
				id: r.id,
				teamId: r.team_id,
				entryType: r.entry_type,
				amount: Number(r.amount ?? 0) || 0,
				taskId: r.task_id ?? null,
				taskKind: r.task_kind ?? null,
				actorUserId: r.actor_user_id ?? null,
				note: r.note ?? null,
				createdAt: r.created_at,
			}),
		),
	);
});

