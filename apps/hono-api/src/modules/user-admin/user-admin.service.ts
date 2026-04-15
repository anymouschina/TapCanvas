import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { isAdminRequest } from "../team/team.service";
import {
	createTeam,
	ensureTeamSchema,
	getTeamById,
	getTeamCreditsOverview,
	topUpTeamCredits,
	tryDeductTeamCreditsFromBalanceOnce,
} from "../team/team.repo";
import { getUserById, listUsers, softDeleteUser, updateUserAdminFields } from "./user-admin.repo";
import type {
	AdminUserDto,
	AdminUserListResponseDto,
} from "./user-admin.schemas";

async function ensureUserAdminSchema(c: AppContext): Promise<void> {
	void c;
}

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizeRole(role: unknown): string | null {
	const r = typeof role === "string" ? role.trim().toLowerCase() : "";
	if (!r) return null;
	if (r === "admin") return "admin";
	return null;
}

function normalizeDeletedAt(value: unknown): string | null {
	const s = typeof value === "string" ? value.trim() : "";
	return s ? s : null;
}

function normalizeDisabled(value: unknown): boolean {
	return Number(value ?? 0) !== 0;
}

function normalizeTeamRole(role: unknown): "owner" | "admin" | "member" | null {
	const r = typeof role === "string" ? role.trim().toLowerCase() : "";
	if (r === "owner" || r === "admin" || r === "member") return r;
	return null;
}

function normalizePersonalBillingTeamId(userId: string): string {
	const safe = (userId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
	return `personal_${safe || "unknown"}`;
}

function buildPersonalBillingTeamName(login: string, userId: string): string {
	const normalized = (login || "").trim();
	if (normalized) return `${normalized} 的个人账户`;
	const suffix = (userId || "").trim().slice(0, 8);
	return suffix ? `个人账户 ${suffix}` : "个人账户";
}

function mapUserRowToDto(row: any): AdminUserDto {
	const teamId =
		typeof row.team_id === "string" ? row.team_id : row.team_id ?? null;
	const teamCredits =
		teamId && typeof row.team_credits === "number" && Number.isFinite(row.team_credits)
			? Math.max(0, Math.trunc(row.team_credits))
			: teamId
				? Math.max(0, Math.trunc(Number(row.team_credits ?? 0) || 0))
				: null;
	const teamCreditsFrozen =
		teamId &&
		typeof row.team_credits_frozen === "number" &&
		Number.isFinite(row.team_credits_frozen)
			? Math.max(0, Math.trunc(row.team_credits_frozen))
			: teamId
				? Math.max(0, Math.trunc(Number(row.team_credits_frozen ?? 0) || 0))
				: null;
	const teamCreditsAvailable =
		teamId && teamCredits != null && teamCreditsFrozen != null
			? Math.max(0, teamCredits - teamCreditsFrozen)
			: null;

	return {
		id: String(row.id),
		login: String(row.login || ""),
		name: typeof row.name === "string" ? row.name : row.name ?? null,
		avatarUrl:
			typeof row.avatar_url === "string" ? row.avatar_url : row.avatar_url ?? null,
		email: typeof row.email === "string" ? row.email : row.email ?? null,
		phone: typeof row.phone === "string" ? row.phone : row.phone ?? null,
		role: normalizeRole(row.role),
		guest: Number(row.guest ?? 0) !== 0,
		disabled: normalizeDisabled(row.disabled),
		deletedAt: normalizeDeletedAt(row.deleted_at),
		lastSeenAt:
			typeof row.last_seen_at === "string"
				? row.last_seen_at
				: row.last_seen_at ?? null,
		createdAt: String(row.created_at || ""),
		updatedAt: String(row.updated_at || ""),
		teamId,
		teamName:
			typeof row.team_name === "string" ? row.team_name : row.team_name ?? null,
		teamRole: teamId ? normalizeTeamRole(row.team_role) : null,
		teamCredits,
		teamCreditsFrozen,
		teamCreditsAvailable,
	};
}

async function countActiveAdmins(c: AppContext): Promise<number> {
	void c;
	return getPrismaClient().users.count({
		where: {
			role: "admin",
			OR: [{ deleted_at: null }, { deleted_at: "" }],
			disabled: 0,
		},
	});
}

export async function listAdminUsers(
	c: AppContext,
	input: {
		q?: string | null;
		page?: number;
		pageSize?: number;
		includeDeleted?: boolean;
	},
): Promise<AdminUserListResponseDto> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);
	await ensureTeamSchema(c.env.DB);

	const page =
		typeof input.page === "number" && Number.isFinite(input.page)
			? Math.max(1, Math.floor(input.page))
			: 1;
	const pageSize =
		typeof input.pageSize === "number" && Number.isFinite(input.pageSize)
			? Math.max(1, Math.min(500, Math.floor(input.pageSize)))
			: 20;

	const result = await listUsers(c.env.DB, {
		q: input.q,
		page,
		pageSize,
		includeDeleted: Boolean(input.includeDeleted),
	});
	return {
		items: result.rows.map(mapUserRowToDto),
		total: result.total,
		page,
		pageSize,
	};
}

export async function updateAdminUser(
	c: AppContext,
	input: {
		actorUserId: string;
		userId: string;
		role?: string | null;
		disabled?: boolean;
	},
): Promise<AdminUserDto> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);
	await ensureTeamSchema(c.env.DB);

	if (!input.userId) {
		throw new AppError("userId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	if (
		input.actorUserId &&
		input.userId === input.actorUserId &&
		input.disabled === true
	) {
		throw new AppError("不能禁用自己", {
			status: 400,
			code: "cannot_disable_self",
		});
	}

	const existing = await getUserById(c.env.DB, input.userId);
	if (!existing) {
		throw new AppError("User not found", {
			status: 404,
			code: "user_not_found",
		});
	}

	const existingDeletedAt = normalizeDeletedAt((existing as any).deleted_at);
	if (existingDeletedAt) {
		throw new AppError("该用户已删除", {
			status: 400,
			code: "user_deleted",
		});
	}

	const existingRole = normalizeRole(existing.role);
	const existingDisabled = normalizeDisabled((existing as any).disabled);

	const nextRole =
		Object.prototype.hasOwnProperty.call(input, "role")
			? normalizeRole(input.role)
			: existingRole;
	const nextDisabled =
		typeof input.disabled === "boolean" ? input.disabled : existingDisabled;

	const isExistingActiveAdmin = existingRole === "admin" && !existingDisabled;
	const willLoseAdmin = isExistingActiveAdmin && nextRole !== "admin";
	const willBeDisabled = isExistingActiveAdmin && nextDisabled === true;

	if (willLoseAdmin || willBeDisabled) {
		const adminCount = await countActiveAdmins(c);
		if (adminCount <= 1) {
			throw new AppError("至少保留一个可用管理员账号", {
				status: 400,
				code: "cannot_remove_last_admin",
			});
		}
	}

	const nowIso = new Date().toISOString();
	await updateUserAdminFields(c.env.DB, {
		userId: input.userId,
		role: nextRole,
		disabled: nextDisabled ? 1 : 0,
		updatedAt: nowIso,
	});

	const updated = await getUserById(c.env.DB, input.userId);
	if (!updated) {
		throw new AppError("User not found", {
			status: 404,
			code: "user_not_found",
		});
	}
	return mapUserRowToDto(updated);
}

export async function adjustAdminUserTeamCredits(
	c: AppContext,
	input: {
		actorUserId: string;
		userId: string;
		delta: number;
		note?: string | null;
	},
): Promise<AdminUserDto> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);
	await ensureTeamSchema(c.env.DB);

	const userId = (input.userId || "").trim();
	if (!userId) {
		throw new AppError("userId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const delta = Math.trunc(Number(input.delta));
	if (!Number.isFinite(delta) || delta === 0) {
		throw new AppError("delta is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const existing = await getUserById(c.env.DB, userId);
	if (!existing) {
		throw new AppError("User not found", {
			status: 404,
			code: "user_not_found",
		});
	}

	const existingDeletedAt = normalizeDeletedAt((existing as any).deleted_at);
	if (existingDeletedAt) {
		throw new AppError("该用户已删除", {
			status: 400,
			code: "user_deleted",
		});
	}

	const membershipRole = normalizeTeamRole((existing as any).team_role);
	const isGuest = Number((existing as any).guest ?? 0) !== 0;
	if (isGuest && !membershipRole) {
		throw new AppError("游客账号没有可调整积分（请先注册/登录）", {
			status: 400,
			code: "guest_no_credits",
		});
	}

	const teamId = membershipRole
		? String((existing as any).team_id || "").trim()
		: normalizePersonalBillingTeamId(userId);
	if (!teamId) {
		throw new AppError("该用户暂无可调整的积分账户", {
			status: 400,
			code: "team_required",
		});
	}

	const nowIso = new Date().toISOString();

	if (!membershipRole) {
		const hasTeam = await getTeamById(c.env.DB, teamId);
		if (!hasTeam) {
			try {
				await createTeam(c.env.DB, {
					id: teamId,
					name: buildPersonalBillingTeamName(existing.login, userId),
					nowIso,
				});
			} catch (err: any) {
				const msg = String(err?.message || "");
				if (!/constraint|unique|already exists/i.test(msg)) {
					throw err;
				}
			}
			const reread = await getTeamById(c.env.DB, teamId);
			if (!reread) {
				throw new AppError("个人账户初始化失败", {
					status: 500,
					code: "personal_team_create_failed",
				});
			}
		}
	}

	if (delta > 0) {
		await topUpTeamCredits(c.env.DB, {
			teamId,
			amount: delta,
			actorUserId: input.actorUserId,
			note: input.note ?? null,
			nowIso,
		});
	} else {
		const amount = Math.abs(delta);
		const before = await getTeamCreditsOverview(c.env.DB, teamId);
		const res = await tryDeductTeamCreditsFromBalanceOnce(c.env.DB, {
			teamId,
			amount,
			actorUserId: input.actorUserId,
			note: input.note ?? null,
			nowIso,
		});
		if (!res.deducted) {
			const latest = await getTeamCreditsOverview(c.env.DB, teamId);
			throw new AppError("团队积分不足，无法扣减（需保证扣减后积分>=冻结额度）", {
				status: 402,
				code: "team_insufficient_credits",
				details: {
					teamId,
					delta,
					before,
					latest,
				},
			});
		}
	}

	const updated = await getUserById(c.env.DB, userId);
	if (!updated) {
		throw new AppError("User not found", {
			status: 404,
			code: "user_not_found",
		});
	}
	return mapUserRowToDto(updated);
}

export async function deleteAdminUser(
	c: AppContext,
	input: { actorUserId: string; userId: string },
): Promise<void> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);
	await ensureTeamSchema(c.env.DB);

	if (!input.userId) {
		throw new AppError("userId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	if (input.actorUserId && input.userId === input.actorUserId) {
		throw new AppError("不能删除自己", {
			status: 400,
			code: "cannot_delete_self",
		});
	}

	const existing = await getUserById(c.env.DB, input.userId);
	if (!existing) {
		// idempotent
		return;
	}

	const existingDeletedAt = normalizeDeletedAt((existing as any).deleted_at);
	if (existingDeletedAt) {
		// idempotent
		return;
	}

	const existingRole = normalizeRole(existing.role);
	const existingDisabled = normalizeDisabled((existing as any).disabled);
	const isExistingActiveAdmin = existingRole === "admin" && !existingDisabled;

	if (isExistingActiveAdmin) {
		const adminCount = await countActiveAdmins(c);
		if (adminCount <= 1) {
			throw new AppError("至少保留一个可用管理员账号", {
				status: 400,
				code: "cannot_remove_last_admin",
			});
		}
	}

	const nowIso = new Date().toISOString();
	await softDeleteUser(c.env.DB, { userId: input.userId, deletedAt: nowIso });
}
