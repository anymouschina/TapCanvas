import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import type { TeamRole } from "./team.schemas";
import {
	addTeamMember,
	countTeamMembers,
	createTeam,
	createTeamInvite,
	deleteTeamById,
	findReservedTeamCreditsForTask,
	findUserIdByLogin,
	getTeamById,
	getTeamInviteByCode,
	getTeamMembershipByUserId,
	getTeamMembershipForUserInTeam,
	getTeamReservedCreditsForTask,
	getTeamDeductedCreditsForTask,
	listTeamCreditLedger,
	listTeamCreditLedgerByActorUserId,
	listTeamInvites,
	listTeamMembers,
	listTeamMembershipsByUserId,
	listTeamsWithCounts,
	markInviteAccepted,
	rebindTeamCreditReservationTaskId,
	removeTeamMember,
	revokeInvite,
	sumTeamTopupCredits,
	topUpTeamCredits,
	updateTeamMaxMembers,
	updateTeamName,
	tryIncreaseReservedTeamCreditsForTask,
	tryDeductTeamCreditsOnce,
	tryReleaseTeamCreditsOnce,
	tryReserveTeamCreditsUpToAvailableOnce,
} from "./team.repo";

type AuthContextValue = {
	email?: string;
	guest?: boolean;
	login?: string;
	phone?: string;
	role?: string;
};

function readAuthContext(c: AppContext): AuthContextValue {
	const auth = c.get("auth");
	if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
		return {};
	}
	return auth as AuthContextValue;
}

function isLocalDevRequest(c: AppContext): boolean {
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

function isGuestRequest(c: AppContext): boolean {
	try {
		const auth = readAuthContext(c);
		return Boolean(auth?.guest);
	} catch {
		return false;
	}
}

export function getPersonalBillingTeamId(userId: string): string {
	const safe = (userId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
	return `personal_${safe || "unknown"}`;
}

export function isPersonalTeamId(teamId: string): boolean {
	return String(teamId || "").trim().startsWith("personal_");
}

export function normalizeTeamMaxMembers(team: { id?: string | null; max_members?: number | null }): number {
	if (isPersonalTeamId(String(team.id || ""))) return 1;
	const raw = Number(team.max_members ?? 1);
	return Math.max(1, Math.floor(Number.isFinite(raw) ? raw : 1));
}

function resolveMaxMembersFromCumulativeCredits(totalCredits: number): number {
	const credits = Math.max(0, Math.floor(Number(totalCredits) || 0));
	if (credits >= 160_000) return 20;
	if (credits >= 80_000) return 10;
	if (credits >= 30_000) return 5;
	if (credits >= 10_000) return 4;
	return 2; // 协作团队最低 2 席
}

export async function upgradeTeamSeatsFromTopups(
	c: AppContext,
	teamId: string,
	nowIso: string,
) {
	if (isPersonalTeamId(teamId)) return;
	const totalTopups = await sumTeamTopupCredits(c.env.DB, teamId);
	const nextMaxMembers = resolveMaxMembersFromCumulativeCredits(totalTopups);
	await updateTeamMaxMembers(c.env.DB, { teamId, maxMembers: nextMaxMembers, nowIso });
}

function buildPersonalBillingTeamName(c: AppContext, userId: string): string {
	try {
		const auth = readAuthContext(c);
		const login = typeof auth?.login === "string" ? auth.login.trim() : "";
		if (login) return `${login} 的个人账户`;
	} catch {
		// ignore
	}
	const suffix = (userId || "").trim().slice(0, 8);
	return suffix ? `个人账户 ${suffix}` : "个人账户";
}

export function isAdminRequest(c: AppContext): boolean {
	const auth = readAuthContext(c);
	return auth?.role === "admin";
}

function normalizeTeamRole(role: unknown): TeamRole {
	const r = typeof role === "string" ? role.trim().toLowerCase() : "";
	if (r === "owner" || r === "admin" || r === "member") return r;
	return "member";
}

function normalizePhoneE164(raw: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	const cleaned = trimmed.replace(/[^\d+]/g, "");
	if (!cleaned) return "";
	if (cleaned.startsWith("+")) {
		const digits = cleaned.slice(1).replace(/\D/g, "");
		return digits ? `+${digits}` : "";
	}
	const digits = cleaned.replace(/\D/g, "");
	if (!digits) return "";
	if (digits.length === 11 && digits.startsWith("1")) return `+86${digits}`;
	return `+${digits}`;
}

export async function ensurePersonalBillingTeam(
	c: AppContext,
	userId: string,
): Promise<string | null> {
	const uid = (userId || "").trim();
	if (!uid) return null;
	const teamId = getPersonalBillingTeamId(uid);
	const nowIso = new Date().toISOString();

	try {
		const existing = await getTeamById(c.env.DB, teamId);
		if (existing) return teamId;
	} catch {
		// ignore and try to create
	}

	try {
		await createTeam(c.env.DB, {
			id: teamId,
			name: buildPersonalBillingTeamName(c, uid),
			nowIso,
			maxMembers: 1,
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err || "");
		// Race/duplicate: another request created it first.
		if (!/constraint|unique|already exists/i.test(msg)) {
			console.warn("[team] ensure personal billing team failed", err);
		}
	}

	const reread = await getTeamById(c.env.DB, teamId);
	return reread ? teamId : null;
}

/// 注册不再无条件赠送积分（2026-07-15 产品决策：只有带邀请码进来的用户赠送，
/// 由 referral.service 的 bindReferrerOnRegister 按 invitee_welcome_credits 发放）。
///
/// 但个人计费团队仍必须在注册/登录时建好，不能因为不送分就省掉这一步：邀请赠送走的是
/// `UPDATE teams SET credits = credits + ? WHERE id = 'personal_<uid>'`，团队不存在会
/// 静默命中 0 行——赠送悄悄丢掉且不报错。故本函数只保证团队存在，不发钱。
export async function ensurePersonalBillingTeamOnLogin(
	c: AppContext,
	userId: string,
): Promise<void> {
	const uid = (userId || "").trim();
	if (!uid) return;
	await ensurePersonalBillingTeam(c, uid);
}

export async function getMyTeam(c: AppContext, userId: string, selectedTeamId?: string | null) {
	// "personal" is a magic value meaning: return this user's personal billing team
	const wantsPersonal =
		selectedTeamId === "personal" || isPersonalTeamId(String(selectedTeamId ?? ""));
	if (wantsPersonal) {
		if (isGuestRequest(c)) return null;
		const personalTeamId = await ensurePersonalBillingTeam(c, userId);
		if (!personalTeamId) return null;
		const personalTeam = await getTeamById(c.env.DB, personalTeamId);
		if (!personalTeam) return null;
		return {
			team: personalTeam,
			role: "owner" as TeamRole,
			memberCount: 1,
		};
	}

	// If a specific collaboration team is requested, verify membership and return it
	if (selectedTeamId) {
		const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, selectedTeamId);
		if (membership) {
			const team = await getTeamById(c.env.DB, selectedTeamId);
			if (team) {
				return {
					team,
					role: normalizeTeamRole(membership.role),
					memberCount: await countTeamMembers(c.env.DB, team.id),
				};
			}
		}
	}

	// Default: return first non-personal team membership
	const membership = await getTeamMembershipByUserId(c.env.DB, userId);
	if (membership) {
		const team = await getTeamById(c.env.DB, membership.team_id);
		if (!team) return null;
		return {
			team,
			role: normalizeTeamRole(membership.role),
			memberCount: await countTeamMembers(c.env.DB, team.id),
		};
	}

	if (isGuestRequest(c)) return null;
	const personalTeamId = await ensurePersonalBillingTeam(c, userId);
	if (!personalTeamId) return null;
	const personalTeam = await getTeamById(c.env.DB, personalTeamId);
	if (!personalTeam) return null;
	return {
		team: personalTeam,
		role: "owner" as TeamRole,
		memberCount: 1,
	};
}

export async function listTeams(c: AppContext, userId: string) {
	if (isAdminRequest(c)) {
		return listTeamsWithCounts(c.env.DB);
	}
	// Return all teams the user is a member of
	const memberships = await listTeamMembershipsByUserId(c.env.DB, userId);
	const results = await Promise.all(
		memberships.map(async (m) => {
			const team = await getTeamById(c.env.DB, m.team_id);
			if (!team) return null;
			const memberCount = await countTeamMembers(c.env.DB, m.team_id);
			return { ...team, member_count: memberCount };
		}),
	);
	return results.filter((r): r is NonNullable<typeof r> => r !== null);
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

	const teamId = crypto.randomUUID();
	await createTeam(c.env.DB, { id: teamId, name, nowIso, maxMembers: 2 });
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
	const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, teamId);
	if (!membership) {
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
	if (!isAdminRequest(c)) {
		const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, teamId);
		if (!membership) {
			throw new AppError("Forbidden", { status: 403, code: "forbidden" });
		}
	}
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
	const team = await getTeamById(c.env.DB, teamId);
	if (!team) {
		throw new AppError("Team not found", { status: 404, code: "team_not_found" });
	}
	const memberCount = await countTeamMembers(c.env.DB, teamId);
	const maxMembers = normalizeTeamMaxMembers(team);
	if (memberCount >= maxMembers) {
		throw new AppError("团队席位已满，请联系管理员调整团队套餐", {
			status: 402,
			code: "team_seat_limit_reached",
			details: { teamId, memberCount, maxMembers },
		});
	}

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
	input: { email?: string; phone?: string; login?: string; expiresInDays?: number },
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
		phone:
			typeof input.phone === "string" && input.phone.trim()
				? normalizePhoneE164(input.phone)
				: null,
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

	const auth = readAuthContext(c);
	const myLogin = typeof auth?.login === "string" ? auth.login.trim() : "";
	const myEmail = typeof auth?.email === "string" ? auth.email.trim() : "";
	const myPhone = typeof auth?.phone === "string" ? auth.phone.trim() : "";
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
	if (invite.phone && myPhone) {
		if (normalizePhoneE164(invite.phone) !== normalizePhoneE164(myPhone)) {
			throw new AppError("该邀请码不匹配当前账号", {
				status: 403,
				code: "invite_phone_mismatch",
			});
		}
	}

	const alreadyIn = await getTeamMembershipForUserInTeam(c.env.DB, userId, invite.team_id);
	if (alreadyIn) {
		throw new AppError("已是该团队成员", {
			status: 400,
			code: "user_already_in_team",
			details: { teamId: invite.team_id },
		});
	}

	const team = await getTeamById(c.env.DB, invite.team_id);
	if (!team) {
		throw new AppError("Team not found", { status: 404, code: "team_not_found" });
	}
	const memberCount = await countTeamMembers(c.env.DB, invite.team_id);
	const maxMembers = normalizeTeamMaxMembers(team);
	if (memberCount >= maxMembers) {
		throw new AppError("团队席位已满，请联系管理员调整团队套餐", {
			status: 402,
			code: "team_seat_limit_reached",
			details: { teamId: invite.team_id, memberCount, maxMembers },
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
	const result = await topUpTeamCredits(c.env.DB, {
		teamId,
		amount: input.amount,
		actorUserId: userId,
		note: input.note ?? null,
		nowIso,
		sourceType: "admin_adjustment",
	});
	await upgradeTeamSeatsFromTopups(c, teamId, nowIso);
	const nextTeam = await getTeamById(c.env.DB, teamId);
	return nextTeam ?? result.team;
}

export async function listCreditsLedgerForTeam(
	c: AppContext,
	userId: string,
	teamId: string,
	options?: {
		limit?: number;
		before?: string | null;
		beforeId?: string | null;
	},
) {
	await requireTeamAdmin(c, userId, teamId);
	return listTeamCreditLedger(c.env.DB, teamId, options);
}

export async function listMyCreditsLedger(
	c: AppContext,
	userId: string,
	options?: {
		limit?: number;
		before?: string | null;
		beforeId?: string | null;
	},
) {
	if (isGuestRequest(c)) return [];
	const pageOptions = {
		limit: options?.limit,
		before: options?.before,
		beforeId: options?.beforeId,
	};

	// 「我的积分流水」= 我名下所有账户的消费汇总：个人账户全量 + 每个所在企业团队里
	// 由我（actor）产生的流水。每行自带 teamId，由前端按行标注扣款账户 —— 根治
	// 「钱扣在团队、切到个人视图却看不见」的困惑（计费主体由 X-Team-Id 决定，见 resolveBillingTeamId）。
	// 分页正确性：各源都按同一 (before, beforeId) 游标 + 同一 limit 查询，归并后再截断，
	// 游标语义与单源一致。
	const personalTeamId = await ensurePersonalBillingTeam(c, userId);
	const memberships = await listTeamMembershipsByUserId(c.env.DB, userId);
	const enterpriseTeamIds = [
		...new Set(
			memberships
				.map((m) => String(m.team_id || ""))
				.filter((id) => id && !isPersonalTeamId(id) && id !== personalTeamId),
		),
	];

	const lists = await Promise.all([
		personalTeamId
			? listTeamCreditLedger(c.env.DB, personalTeamId, pageOptions)
			: Promise.resolve([]),
		...enterpriseTeamIds.map((teamId) =>
			listTeamCreditLedgerByActorUserId(c.env.DB, teamId, userId, pageOptions),
		),
	]);
	const limit = Math.max(1, Math.min(51, Math.floor(options?.limit ?? 20)));
	return lists
		.flat()
		.sort(
			(a, b) =>
				b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
		)
		.slice(0, limit);
}

/**
 * Resolve the team that should be billed for the current request.
 *
 * Honors the explicitly selected team (c.get("activeTeamId"), populated from the
 * X-Team-Id header by the auth middleware) so that display, billing and project
 * visibility all flow through one consistent identifier:
 *  - "personal" sentinel OR a personal_<uid> id  => the caller's personal billing team
 *  - a concrete enterprise team the caller is a member of => that team (membership
 *    check prevents spoofing the header to bill an arbitrary team)
 *  - otherwise => the existing fallback chain (first membership team, else personal,
 *    else null for guests).
 */
export async function resolveBillingTeamId(
	c: AppContext,
	userId: string,
): Promise<string | null> {
	// tc_sk key 上显式配置的「计费归属团队」优先于一切：分配给谁就扣谁的积分。
	// 该值由 apiKeyAuthMiddleware 在认证后写入，且创建/编辑 key 时已校验操作者为该团队成员，
	// 因此此处直接信任（无需再查成员）。空则回落下方默认链路（维持现状）。
	const forced = c.get("apiKeyBillingTeamId");
	const forcedStr = typeof forced === "string" ? forced.trim() : "";
	if (forcedStr) return forcedStr;

	const selected = c.get("activeTeamId");
	const selectedStr = typeof selected === "string" ? selected.trim() : "";

	// Explicit personal selection (sentinel or personal_<uid>).
	if (selectedStr === "personal" || isPersonalTeamId(selectedStr)) {
		if (isGuestRequest(c)) return null;
		return await ensurePersonalBillingTeam(c, userId);
	}

	// Explicit enterprise selection: only honor it when the caller is a member.
	if (selectedStr) {
		const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, selectedStr);
		if (membership?.team_id) return membership.team_id;
		// Not a member (or spoofed): fall through to the default chain below.
	}

	// Fallback chain (guests / public API have no header and keep prior behavior).
	const membership = await getTeamMembershipByUserId(c.env.DB, userId);
	if (membership?.team_id) return membership.team_id;
	if (isGuestRequest(c)) return null;
	return await ensurePersonalBillingTeam(c, userId);
}

export async function requireSufficientTeamCredits(
	c: AppContext,
	userId: string,
	input: {
		required: number;
		minimumRequired?: number;
		taskKind: string;
		reservationTaskId?: string;
		vendor?: string;
		modelKey?: string | null;
		specKey?: string | null;
		allowExistingReservation?: boolean;
	},
): Promise<
	| {
			teamId: string;
			reservationTaskId: string;
			amount: number;
			taskKind: string;
			vendor?: string;
			modelKey?: string | null;
			specKey?: string | null;
	  }
	| null
> {
	const required = Number.isFinite(input.required)
		? Math.max(0, Math.floor(input.required))
		: 0;
	if (required <= 0) return null;
	const requestedMinimum = input.minimumRequired ?? required;
	const minimumRequired = Math.max(
		1,
		Math.min(
			required,
			Number.isFinite(requestedMinimum)
				? Math.floor(requestedMinimum)
				: required,
		),
	);

	// Public API supports either JWT or X-API-Key.
	// API key-only calls are billed to the API key owner because middleware
	// already normalizes c.get("userId") to that owner_id when JWT is absent.

	const billableTeamId = await resolveBillingTeamId(c, userId);

	if (!billableTeamId) {
		// Public endpoints should always be billable by credits.
		// Personal accounts are supported via personal credits; guest sessions must provide X-API-Key.
		if (c.get("publicApi") === true && !isLocalDevRequest(c)) {
			throw new AppError(
				"未加入企业/团队也可以使用：请确保账号已有管理员分配、兑换码或邀请活动发放的可用积分。游客模式不赠送积分，可配置 X-API-Key 或先注册登录。",
				{
					status: 402,
					code: "team_required",
				},
			);
		}
		return null;
	}

	const isAssetTask = (() => {
		const k = (input.taskKind || "").trim();
		return (
			k === "text_to_image" ||
			k === "image_edit" ||
			k === "text_to_video" ||
			k === "image_to_video" ||
			k === "video_edit"
		);
	})();

	// Charged generations must have a durable delivery target before credits are reserved.
	// Node deployments use the backend-proxied local asset directory when no object storage
	// contract is configured; runtimes without either target fail before billing.
	if (isAssetTask && !isLocalDevRequest(c)) {
		const publicAssetBase = resolvePublicAssetBaseUrl(c).trim();
		const hasAssetHostingTarget = publicAssetBase.length > 0;
		if (!hasAssetHostingTarget) {
			throw new AppError("扣积分任务缺少可用的资产托管后端", {
				status: 503,
				code: "asset_hosting_required",
				details: {
					storage: "missing",
					publicAssetBase: null,
				},
			});
		}
	}

	const note = (() => {
		const parts: string[] = [];
		if (typeof input.vendor === "string" && input.vendor.trim()) {
			parts.push(`vendor:${input.vendor.trim()}`);
		}
		if (typeof input.modelKey === "string" && input.modelKey.trim()) {
			parts.push(`model:${input.modelKey.trim()}`);
		}
		if (typeof input.specKey === "string" && input.specKey.trim()) {
			parts.push(`spec:${input.specKey.trim()}`);
		}
		return parts.length ? parts.join(" ") : null;
	})();

	const requestedReservationTaskId =
		typeof input.reservationTaskId === "string" ? input.reservationTaskId.trim() : "";
	const reservationTaskId = requestedReservationTaskId || crypto.randomUUID();
	const nowIso = new Date().toISOString();
	const reserveApiKeyId = (() => {
		const v = c.get("apiKeyId");
		return typeof v === "string" && v.trim() ? v.trim() : null;
	})();
	const reserveRes = await tryReserveTeamCreditsUpToAvailableOnce(c.env.DB, {
		teamId: billableTeamId,
		targetAmount: required,
		minimumAmount: minimumRequired,
		taskId: reservationTaskId,
		taskKind: input.taskKind,
		actorUserId: userId,
		note,
		nowIso,
		apiKeyId: reserveApiKeyId,
		allowExistingReservation: input.allowExistingReservation,
	});
	if (reserveRes.status === "insufficient") {
		throw new AppError("积分不足，无法调用三方生成，请联系管理员分配额度", {
			status: 402,
			code: "team_insufficient_credits",
			details: {
				teamId: billableTeamId,
				taskKind: input.taskKind,
				minimumRequired,
				reservationTarget: required,
				available: reserveRes.available,
				credits: reserveRes.credits,
				creditsFrozen: reserveRes.creditsFrozen,
			},
		});
	}
	if (reserveRes.status === "idempotency_conflict") {
		throw new AppError("积分冻结请求标识已存在，请使用新的回合标识", {
			status: 409,
			code: "team_credit_reservation_conflict",
			details: {
				teamId: billableTeamId,
				taskKind: input.taskKind,
				reservationTaskId,
				available: reserveRes.available,
				credits: reserveRes.credits,
				creditsFrozen: reserveRes.creditsFrozen,
			},
		});
	}

	return {
		teamId: billableTeamId,
		reservationTaskId,
		amount: reserveRes.amount,
		taskKind: input.taskKind,
		vendor: input.vendor,
		modelKey: input.modelKey ?? null,
		specKey: input.specKey ?? null,
	};
}

export async function bindTeamCreditsReservationToTaskId(
	c: AppContext,
	userId: string,
	input: {
		teamId: string;
		reservationTaskId: string;
		taskId: string;
	},
): Promise<void> {
	const taskId = (input.taskId || "").trim();
	const reservationTaskId = (input.reservationTaskId || "").trim();
	if (!taskId || !reservationTaskId) return;
	if (taskId === reservationTaskId) return;

	const res = await rebindTeamCreditReservationTaskId(c.env.DB, {
		teamId: input.teamId,
		fromTaskId: reservationTaskId,
		toTaskId: taskId,
	});
	if (!res.ok) {
		// Best-effort only: do not break task delivery.
		console.warn("[team-credits] bind reserve task_id failed", {
			teamId: input.teamId,
			fromTaskId: reservationTaskId,
			toTaskId: taskId,
		});
	}
}

export async function releaseTeamCreditsOnFailure(
	c: AppContext,
	userId: string,
	input: {
		taskId: string;
		taskKind: string;
		vendor?: string;
		modelKey?: string | null;
		specKey?: string | null;
	},
): Promise<void> {
	const taskId = (input.taskId || "").trim();
	if (!taskId) return;

	try {
		const note = (() => {
			const parts: string[] = [];
			if (typeof input.vendor === "string" && input.vendor.trim()) {
				parts.push(`vendor:${input.vendor.trim()}`);
			}
			if (typeof input.modelKey === "string" && input.modelKey.trim()) {
				parts.push(`model:${input.modelKey.trim()}`);
			}
			if (typeof input.specKey === "string" && input.specKey.trim()) {
				parts.push(`spec:${input.specKey.trim()}`);
			}
			return parts.length ? parts.join(" ") : null;
		})();

		const found = await findReservedTeamCreditsForTask(c.env.DB, {
			taskId,
			actorUserId: userId,
		});
		const membership = !found ? await getTeamMembershipByUserId(c.env.DB, userId) : null;
		const teamId = found?.teamId ?? membership?.team_id ?? null;
		if (!teamId) return;

		const reserved =
			typeof found?.reserved === "number" && Number.isFinite(found.reserved)
				? Math.max(0, Math.trunc(found.reserved))
				: await getTeamReservedCreditsForTask(c.env.DB, {
						teamId,
						taskId,
					});
		if (!reserved || reserved <= 0) return;

		await tryReleaseTeamCreditsOnce(c.env.DB, {
			teamId,
			amount: reserved,
			taskId,
			taskKind: input.taskKind,
			actorUserId: userId,
			note,
			nowIso: new Date().toISOString(),
		});
	} catch (err) {
		// Best-effort only: do not break task delivery.
		console.warn("[team-credits] release failed", err);
	}
}

export async function settleTeamCreditsOnSuccess(
	c: AppContext,
	userId: string,
	input: {
		taskId: string;
		taskKind: string;
		amount: number;
		vendor?: string;
		modelKey?: string | null;
		specKey?: string | null;
	},
): Promise<void> {
	const taskId = (input.taskId || "").trim();
	if (!taskId) return;
	const amount = Math.max(0, Math.floor(input.amount));

	try {
		const note = (() => {
			const parts: string[] = [];
			if (typeof input.vendor === "string" && input.vendor.trim()) {
				parts.push(`vendor:${input.vendor.trim()}`);
			}
			if (typeof input.modelKey === "string" && input.modelKey.trim()) {
				parts.push(`model:${input.modelKey.trim()}`);
			}
			if (typeof input.specKey === "string" && input.specKey.trim()) {
				parts.push(`spec:${input.specKey.trim()}`);
			}
			return parts.length ? parts.join(" ") : null;
		})();

		const found = await findReservedTeamCreditsForTask(c.env.DB, {
			taskId,
			actorUserId: userId,
		});
		const membership = !found ? await getTeamMembershipByUserId(c.env.DB, userId) : null;
		const teamId = found?.teamId ?? membership?.team_id ?? null;
		if (!teamId) return;
		const reserved = await getTeamReservedCreditsForTask(c.env.DB, {
			teamId,
			taskId,
		});

		// Backward-compatible: if no reserve exists (legacy tasks), do not block delivery.
		if (!reserved || reserved <= 0) {
			return;
		}

		const actual = Math.max(0, amount);
		let reservedAmount = reserved;
		let chargeAmount = actual;

		if (chargeAmount > reservedAmount) {
			const delta = chargeAmount - reservedAmount;
			const nowIso = new Date().toISOString();
			const increased = await tryIncreaseReservedTeamCreditsForTask(c.env.DB, {
				teamId,
				taskId,
				expectedReserved: reservedAmount,
				delta,
				nowIso,
			});
			if (increased.increased) {
				reservedAmount += delta;
			} else {
				const reread = await getTeamReservedCreditsForTask(c.env.DB, {
					teamId,
					taskId,
				});
				if (typeof reread === "number" && reread > reservedAmount) {
					reservedAmount = reread;
				}
				if (chargeAmount > reservedAmount) {
					console.warn("[team-credits] reserved < actual; charge capped", {
						teamId,
						taskId,
						reserved: reservedAmount,
						actual,
					});
					chargeAmount = reservedAmount;
				}
			}
		}

		if (chargeAmount === 0) {
			await tryReleaseTeamCreditsOnce(c.env.DB, {
				teamId,
				amount: reservedAmount,
				taskId,
				taskKind: input.taskKind,
				actorUserId: userId,
				note,
				nowIso: new Date().toISOString(),
			});
			return;
		}

		const apiKeyId = (() => {
			const v = c.get("apiKeyId");
			return typeof v === "string" && v.trim() ? v.trim() : null;
		})();

		const deductRes = await tryDeductTeamCreditsOnce(c.env.DB, {
			teamId,
			amount: chargeAmount,
			taskId,
			taskKind: input.taskKind,
			actorUserId: userId,
			note,
			nowIso: new Date().toISOString(),
			apiKeyId,
		});

		let deductedAmount = chargeAmount;
		if (!deductRes.deducted) {
			const existingDeducted = await getTeamDeductedCreditsForTask(c.env.DB, {
				teamId,
				taskId,
			});
			if (!existingDeducted || existingDeducted <= 0) return;
			deductedAmount = Math.min(existingDeducted, reservedAmount);
		}

		const releaseAmount = Math.max(0, reservedAmount - deductedAmount);
		if (releaseAmount > 0) {
			await tryReleaseTeamCreditsOnce(c.env.DB, {
				teamId,
				amount: releaseAmount,
				taskId,
				taskKind: input.taskKind,
				actorUserId: userId,
				note,
				nowIso: new Date().toISOString(),
			});
		}
	} catch (err) {
		// Best-effort only: do not break task delivery.
		console.warn("[team-credits] settle failed", err);
	}
}

export async function renameTeam(
	c: AppContext,
	userId: string,
	teamId: string,
	name: string,
): Promise<void> {
	await requireTeamAdmin(c, userId, teamId);
	if (isPersonalTeamId(teamId)) {
		throw new AppError("Cannot rename personal team", { status: 400, code: "invalid_request" });
	}
	await updateTeamName(c.env.DB, { teamId, name, nowIso: new Date().toISOString() });
}

export async function removeMemberFromTeam(
	c: AppContext,
	userId: string,
	teamId: string,
	targetUserId: string,
): Promise<void> {
	await requireTeamAdmin(c, userId, teamId);
	if (isPersonalTeamId(teamId)) {
		throw new AppError("Cannot remove member from personal team", { status: 400, code: "invalid_request" });
	}
	// Owner cannot be removed
	const membership = await getTeamMembershipForUserInTeam(c.env.DB, targetUserId, teamId);
	if (membership?.role === "owner") {
		throw new AppError("不能移除团队所有者", { status: 400, code: "cannot_remove_owner" });
	}
	await removeTeamMember(c.env.DB, { teamId, userId: targetUserId });
}

export async function disbandTeam(
	c: AppContext,
	userId: string,
	teamId: string,
): Promise<void> {
	if (isPersonalTeamId(teamId)) {
		throw new AppError("Cannot disband personal team", { status: 400, code: "invalid_request" });
	}
	const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, teamId);
	const isAdmin = isAdminRequest(c);
	if (!isAdmin && membership?.role !== "owner") {
		throw new AppError("只有团队所有者可以解散团队", { status: 403, code: "forbidden" });
	}
	await deleteTeamById(c.env.DB, teamId);
}
