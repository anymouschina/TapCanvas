import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import type { TeamRole } from "./team.schemas";
import {
	addTeamMember,
	createTeam,
	createTeamInvite,
	findUserIdByLogin,
	getTeamById,
	getTeamCredits,
	getTeamInviteByCode,
	getTeamMembershipByUserId,
	listTeamCreditLedger,
	listTeamInvites,
	listTeamMembers,
	listTeamsWithCounts,
	markInviteAccepted,
	revokeInvite,
	topUpTeamCredits,
	tryChargeTeamCreditsOnce,
} from "./team.repo";

function isLocalDevRequest(c: any): boolean {
	try {
		const url = new URL(c.req.url);
		const host = url.hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

export function isAdminRequest(c: any): boolean {
	if (isLocalDevRequest(c)) return true;
	const auth = c.get("auth") as any;
	return auth?.role === "admin";
}

function normalizeTeamRole(role: unknown): TeamRole {
	const r = typeof role === "string" ? role.trim().toLowerCase() : "";
	if (r === "owner" || r === "admin" || r === "member") return r;
	return "member";
}

export async function getMyTeam(c: AppContext, userId: string) {
	const membership = await getTeamMembershipByUserId(c.env.DB, userId);
	if (!membership) return null;
	const team = await getTeamById(c.env.DB, membership.team_id);
	if (!team) return null;
	return {
		team,
		role: normalizeTeamRole(membership.role),
	};
}

export async function listTeams(c: AppContext, userId: string) {
	if (isAdminRequest(c)) {
		return listTeamsWithCounts(c.env.DB);
	}
	const my = await getMyTeam(c, userId);
	if (!my) return [];
	return [
		{
			...my.team,
			member_count: 0, // placeholder for non-admin list
		},
	];
}

export async function createNewTeam(
	c: AppContext,
	userId: string,
	input: { name?: string; ownerUserId?: string; ownerLogin?: string },
): Promise<{ teamId: string }> {
	const nowIso = new Date().toISOString();
	const name = (input.name || "").trim();
	if (!name) {
		throw new AppError("name is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const ownerUserId = await (async () => {
		if (!isAdminRequest(c)) return userId;

		if (typeof input.ownerUserId === "string" && input.ownerUserId.trim()) {
			return input.ownerUserId.trim();
		}

		if (typeof input.ownerLogin === "string" && input.ownerLogin.trim()) {
			const found = await findUserIdByLogin(c.env.DB, input.ownerLogin);
			if (!found) {
				throw new AppError("找不到该用户（需要先登录一次）", {
					status: 400,
					code: "user_not_found",
					details: { ownerLogin: input.ownerLogin },
				});
			}
			return found;
		}

		return userId;
	})();

	const existing = await getTeamMembershipByUserId(c.env.DB, ownerUserId);
	if (existing) {
		throw new AppError("该用户已加入团队（暂不支持多团队）", {
			status: 400,
			code: "user_already_in_team",
			details: { ownerUserId, teamId: existing.team_id },
		});
	}

	const teamId = crypto.randomUUID();
	await createTeam(c.env.DB, { id: teamId, name, nowIso });
	await addTeamMember(c.env.DB, {
		teamId,
		userId: ownerUserId,
		role: "owner",
		nowIso,
	});

	return { teamId };
}

async function requireTeamAdmin(
	c: AppContext,
	userId: string,
	teamId: string,
): Promise<{ role: TeamRole }> {
	if (isAdminRequest(c)) return { role: "admin" };
	const membership = await getTeamMembershipByUserId(c.env.DB, userId);
	if (!membership || membership.team_id !== teamId) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	const role = normalizeTeamRole(membership.role);
	if (role !== "owner" && role !== "admin") {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	return { role };
}

export async function listMembersForTeam(
	c: AppContext,
	userId: string,
	teamId: string,
) {
	await requireTeamAdmin(c, userId, teamId);
	return listTeamMembers(c.env.DB, teamId);
}

export async function addMemberToTeam(
	c: AppContext,
	userId: string,
	teamId: string,
	input: { userId?: string; login?: string; role?: TeamRole },
): Promise<void> {
	await requireTeamAdmin(c, userId, teamId);
	const nowIso = new Date().toISOString();

	const targetUserId = await (async () => {
		if (typeof input.userId === "string" && input.userId.trim()) {
			return input.userId.trim();
		}
		if (typeof input.login === "string" && input.login.trim()) {
			const found = await findUserIdByLogin(c.env.DB, input.login);
			if (!found) {
				throw new AppError("找不到该用户（需要先登录一次）", {
					status: 400,
					code: "user_not_found",
					details: { login: input.login },
				});
			}
			return found;
		}
		throw new AppError("userId/login is required", {
			status: 400,
			code: "invalid_request",
		});
	})();

	const existing = await getTeamMembershipByUserId(c.env.DB, targetUserId);
	if (existing) {
		throw new AppError("该用户已加入团队（暂不支持多团队）", {
			status: 400,
			code: "user_already_in_team",
			details: { userId: targetUserId, teamId: existing.team_id },
		});
	}

	await addTeamMember(c.env.DB, {
		teamId,
		userId: targetUserId,
		role: input.role ?? "member",
		nowIso,
	});
}

export async function createInviteForTeam(
	c: AppContext,
	userId: string,
	teamId: string,
	input: { email?: string; login?: string; expiresInDays?: number },
) {
	await requireTeamAdmin(c, userId, teamId);
	const nowIso = new Date().toISOString();

	const code = `tc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
	const expiresAt =
		typeof input.expiresInDays === "number" &&
		Number.isFinite(input.expiresInDays) &&
		input.expiresInDays > 0
			? new Date(
					Date.now() + Math.floor(input.expiresInDays) * 24 * 60 * 60 * 1000,
				).toISOString()
			: null;

	return createTeamInvite(c.env.DB, {
		id: crypto.randomUUID(),
		teamId,
		code,
		email: input.email ?? null,
		login: input.login ?? null,
		expiresAt,
		inviterUserId: userId,
		nowIso,
	});
}

export async function listInvitesForTeam(
	c: AppContext,
	userId: string,
	teamId: string,
) {
	await requireTeamAdmin(c, userId, teamId);
	return listTeamInvites(c.env.DB, teamId);
}

export async function revokeTeamInvite(
	c: AppContext,
	userId: string,
	inviteId: string,
): Promise<void> {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	const nowIso = new Date().toISOString();
	await revokeInvite(c.env.DB, { inviteId, nowIso });
}

export async function acceptTeamInvite(
	c: AppContext,
	userId: string,
	code: string,
): Promise<{ teamId: string }> {
	const nowIso = new Date().toISOString();
	const invite = await getTeamInviteByCode(c.env.DB, code);
	if (!invite) {
		throw new AppError("邀请码不存在", { status: 404, code: "invite_not_found" });
	}
	const status = (invite.status || "").trim().toLowerCase();
	if (status !== "pending") {
		throw new AppError("邀请码已失效", { status: 400, code: "invite_not_pending" });
	}
	if (invite.expires_at) {
		const exp = Date.parse(invite.expires_at);
		if (Number.isFinite(exp) && Date.now() > exp) {
			throw new AppError("邀请码已过期", { status: 400, code: "invite_expired" });
		}
	}

	const auth = c.get("auth") as any;
	const myLogin = typeof auth?.login === "string" ? auth.login.trim() : "";
	const myEmail = typeof auth?.email === "string" ? auth.email.trim() : "";
	if (invite.login && myLogin) {
		if (invite.login.trim().toLowerCase() !== myLogin.toLowerCase()) {
			throw new AppError("该邀请码不匹配当前账号", {
				status: 403,
				code: "invite_login_mismatch",
			});
		}
	}
	if (invite.email && myEmail) {
		if (invite.email.trim().toLowerCase() !== myEmail.toLowerCase()) {
			throw new AppError("该邀请码不匹配当前账号", {
				status: 403,
				code: "invite_email_mismatch",
			});
		}
	}

	const existing = await getTeamMembershipByUserId(c.env.DB, userId);
	if (existing) {
		throw new AppError("已加入团队（暂不支持多团队）", {
			status: 400,
			code: "user_already_in_team",
			details: { teamId: existing.team_id },
		});
	}

	await addTeamMember(c.env.DB, {
		teamId: invite.team_id,
		userId,
		role: "member",
		nowIso,
	});
	await markInviteAccepted(c.env.DB, {
		inviteId: invite.id,
		acceptedUserId: userId,
		nowIso,
	});

	return { teamId: invite.team_id };
}

export async function topUpCreditsForTeam(
	c: AppContext,
	userId: string,
	teamId: string,
	input: { amount?: number; note?: string },
) {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	if (typeof input.amount !== "number" || !Number.isFinite(input.amount)) {
		throw new AppError("amount is required", {
			status: 400,
			code: "invalid_request",
		});
	}
	const nowIso = new Date().toISOString();
	return topUpTeamCredits(c.env.DB, {
		teamId,
		amount: input.amount,
		actorUserId: userId,
		note: input.note ?? null,
		nowIso,
	});
}

export async function listCreditsLedgerForTeam(
	c: AppContext,
	userId: string,
	teamId: string,
) {
	await requireTeamAdmin(c, userId, teamId);
	return listTeamCreditLedger(c.env.DB, teamId);
}

export async function requireSufficientTeamCredits(
	c: AppContext,
	userId: string,
	input: { required: number; taskKind: string; vendor?: string },
): Promise<void> {
	const membership = await getTeamMembershipByUserId(c.env.DB, userId);
	if (!membership) return;
	const required = Math.max(0, Math.floor(input.required));
	if (required <= 0) return;

	const credits = await getTeamCredits(c.env.DB, membership.team_id);
	const available = typeof credits === "number" && Number.isFinite(credits) ? credits : 0;

	if (available < required) {
		throw new AppError("团队积分不足，无法调用三方生成，请先充值", {
			status: 402,
			code: "team_insufficient_credits",
			details: {
				teamId: membership.team_id,
				taskKind: input.taskKind,
				vendor: input.vendor,
				required,
				available,
			},
		});
	}
}

export async function chargeTeamCreditsOnSuccess(
	c: AppContext,
	userId: string,
	input: { taskId: string; taskKind: string; amount: number; vendor?: string },
): Promise<void> {
	const membership = await getTeamMembershipByUserId(c.env.DB, userId);
	if (!membership) return;
	const amount = Math.max(0, Math.floor(input.amount));
	if (amount <= 0) return;
	const taskId = (input.taskId || "").trim();
	if (!taskId) return;

	try {
		await tryChargeTeamCreditsOnce(c.env.DB, {
			teamId: membership.team_id,
			amount,
			taskId,
			taskKind: input.taskKind,
			actorUserId: userId,
			note:
				typeof input.vendor === "string" && input.vendor.trim()
					? `vendor:${input.vendor.trim()}`
					: null,
			nowIso: new Date().toISOString(),
		});
	} catch (err) {
		// Best-effort only: do not break task delivery.
		console.warn("[team-credits] charge failed", err);
	}
}
