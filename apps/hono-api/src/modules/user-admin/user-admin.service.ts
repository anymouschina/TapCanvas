import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { ensurePersonalBillingTeam, isAdminRequest } from "../team/team.service";
import {
	ensureTeamSchema,
	getTeamById,
	getTeamCreditsOverview,
	topUpTeamCredits,
	tryDeductTeamCreditsFromBalanceOnce,
} from "../team/team.repo";
import { getUserById, listUsers, softDeleteUser, updateUserAdminFields, type UserRow } from "./user-admin.repo";
import { MembershipConfigSchema } from "../commerce/commerce.schemas";
import { grantInitialMembershipCredits } from "../commerce/membership-credit.service";
import {
	fetchUserCreditsOverview,
	listUserCreditsLedger,
} from "./user-admin.credits.repo";
import { fetchTaskLogBundle } from "./user-admin.task-log.repo";
import type {
	AdminCreditGrantListResponseDto,
	AdminUserDto,
	AdminUserListResponseDto,
	LedgerListResponseDto,
	TaskLogBundleDto,
	UserCreditsOverviewDto,
} from "./user-admin.schemas";
import {
	listCreditGrantRecords,
} from "./user-admin.records.repo";

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

function mapUserRowToDto(row: UserRow): AdminUserDto {
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
		accountId: teamId,
		accountName:
			typeof row.team_name === "string" ? row.team_name : row.team_name ?? null,
		credits: teamCredits,
		creditsFrozen: teamCreditsFrozen,
		creditsAvailable: teamCreditsAvailable,
		membership: row.subscription_id && row.subscription_plan_code && row.subscription_start_at && row.subscription_end_at && row.subscription_timezone
			? {
				subscriptionId: row.subscription_id,
				planCode: row.subscription_plan_code,
				startAt: row.subscription_start_at,
				endAt: row.subscription_end_at,
				billingCycle: row.subscription_billing_cycle === "annual" ? "annual" : "monthly",
				monthlyCredits: Math.max(1, Math.trunc(Number(row.subscription_monthly_credits ?? 1))),
				dailyGiftCredits: Math.max(1, Math.trunc(Number(row.subscription_daily_gift_credits ?? 1))),
				concurrencyLimit: Math.max(1, Math.trunc(Number(row.subscription_concurrency_limit ?? 1))),
				capacityLabel: row.subscription_capacity_label ?? "",
				timezone: row.subscription_timezone,
			}
			: null,
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

function normalizeAdminRecordRange(from?: string | null, to?: string | null): void {
	if (from && to && from > to) {
		throw new AppError("开始时间不能晚于结束时间", {
			status: 400,
			code: "invalid_time_range",
		});
	}
}

export async function listAdminCreditGrants(
	c: AppContext,
	input: {
		q?: string | null;
		grantType?: "monthly" | "daily" | null;
		from?: string | null;
		to?: string | null;
		page: number;
		pageSize: number;
	},
): Promise<AdminCreditGrantListResponseDto> {
	requireAdmin(c);
	normalizeAdminRecordRange(input.from, input.to);
	return listCreditGrantRecords(input);
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

	const existingDeletedAt = normalizeDeletedAt(existing.deleted_at);
	if (existingDeletedAt) {
		throw new AppError("该用户已删除", {
			status: 400,
			code: "user_deleted",
		});
	}

	const existingRole = normalizeRole(existing.role);
	const existingDisabled = normalizeDisabled(existing.disabled);

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

export async function adjustAdminUserCredits(
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

	const existingDeletedAt = normalizeDeletedAt(existing.deleted_at);
	if (existingDeletedAt) {
		throw new AppError("该用户已删除", {
			status: 400,
			code: "user_deleted",
		});
	}

	const isGuest = Number(existing.guest ?? 0) !== 0;
	if (isGuest) {
		throw new AppError("游客账号没有可调整积分（请先注册/登录）", {
			status: 400,
			code: "guest_no_credits",
		});
	}

	const accountId = normalizePersonalBillingTeamId(userId);
	if (!accountId) {
		throw new AppError("该用户暂无可调整的积分账户", {
			status: 400,
			code: "personal_account_required",
		});
	}

	const nowIso = new Date().toISOString();

	const hasAccount = await getTeamById(c.env.DB, accountId);
	if (!hasAccount) {
		await getPrismaClient().teams.upsert({
			where: { id: accountId },
			create: {
				id: accountId,
				name: buildPersonalBillingTeamName(existing.login, userId),
				credits: 0,
				credits_frozen: 0,
				max_members: 1,
				created_at: nowIso,
				updated_at: nowIso,
			},
			update: {},
		});
	}

	if (delta > 0) {
		await topUpTeamCredits(c.env.DB, {
			teamId: accountId,
			amount: delta,
			actorUserId: input.actorUserId,
			note: input.note ?? null,
			nowIso,
			sourceType: "admin_adjustment",
		});
	} else {
		const amount = Math.abs(delta);
		const before = await getTeamCreditsOverview(c.env.DB, accountId);
		const res = await tryDeductTeamCreditsFromBalanceOnce(c.env.DB, {
			teamId: accountId,
			amount,
			actorUserId: input.actorUserId,
			note: input.note ?? null,
			nowIso,
		});
		if (!res.deducted) {
			const latest = await getTeamCreditsOverview(c.env.DB, accountId);
			throw new AppError("个人账户积分不足，无法扣减（需保证扣减后积分 >= 冻结额度）", {
				status: 402,
				code: "personal_account_insufficient_credits",
				details: {
					accountId,
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

function parseMembershipPlanCode(productId: string, skuId: string | null): string {
	return `membership:${productId}:${skuId ?? "default"}`;
}

export async function setAdminUserMembership(
	c: AppContext,
	input: {
		actorUserId: string;
		userId: string;
		productId: string | null;
		skuId?: string | null;
		endAt?: string | null;
	},
): Promise<AdminUserDto> {
	requireAdmin(c);
	void input.actorUserId;
	const existing = await getUserById(c.env.DB, input.userId);
	if (!existing) throw new AppError("User not found", { status: 404, code: "user_not_found" });
	if (normalizeDeletedAt(existing.deleted_at)) {
		throw new AppError("该用户已删除", { status: 400, code: "user_deleted" });
	}
	if (Number(existing.guest ?? 0) !== 0) {
		throw new AppError("游客账号不能设置个人套餐", { status: 400, code: "guest_membership_restricted" });
	}

	const now = new Date();
	const nowIso = now.toISOString();
	if (!input.productId) {
		await getPrismaClient().subscriptions.updateMany({
			where: { owner_id: input.userId, status: "active", monthly_credits: { gt: 0 } },
			data: { status: "canceled", canceled_at: nowIso, updated_at: nowIso, next_credit_grant_at: null },
		});
		const updated = await getUserById(c.env.DB, input.userId);
		if (!updated) throw new AppError("User not found", { status: 404, code: "user_not_found" });
		return mapUserRowToDto(updated);
	}

	const endAt = new Date(input.endAt ?? "");
	if (!Number.isFinite(endAt.getTime()) || endAt <= now) {
		throw new AppError("套餐有效期必须晚于当前时间", { status: 400, code: "membership_end_at_invalid" });
	}
	const durationDays = Math.ceil((endAt.getTime() - now.getTime()) / 86_400_000);
	if (durationDays > 365) {
		throw new AppError("个人套餐有效期不能超过 365 天", { status: 400, code: "membership_duration_exceeded" });
	}

	const product = await getPrismaClient().products.findUnique({ where: { id: input.productId } });
	const entitlement = await getPrismaClient().product_entitlements.findFirst({
		where: { product_id: input.productId, entitlement_type: "membership" },
	});
	if (!product || product.status !== "active" || !entitlement) {
		throw new AppError("所选商品不是个人套餐", { status: 400, code: "personal_membership_plan_required" });
	}
	let rawConfig: unknown;
	try {
		rawConfig = entitlement.config_json ? JSON.parse(entitlement.config_json) : {};
	} catch {
		throw new AppError("个人套餐配置不是有效 JSON", {
			status: 400,
			code: "membership_config_json_invalid",
		});
	}
	const parsedConfig = MembershipConfigSchema.safeParse(rawConfig);
	if (!parsedConfig.success) {
		throw new AppError("个人套餐配置不正确", {
			status: 400,
			code: "membership_config_invalid",
			details: parsedConfig.error.issues,
		});
	}
	const skuId = input.skuId ?? null;
	if (skuId) {
		const sku = await getPrismaClient().product_skus.findFirst({ where: { id: skuId, product_id: product.id, status: "active" } });
		if (!sku) throw new AppError("套餐规格不存在", { status: 400, code: "membership_sku_invalid" });
	}
	const selectedConfig = skuId ? parsedConfig.data.skuConfigs?.[skuId] : parsedConfig.data;
	if (!selectedConfig) {
		throw new AppError("会员 SKU 缺少权益配置", {
			status: 400,
			code: "membership_sku_config_missing",
			details: { productId: product.id, skuId },
		});
	}
	const teamId = await ensurePersonalBillingTeam(c, input.userId);
	if (!teamId) throw new AppError("个人积分钱包不存在", { status: 500, code: "personal_billing_team_missing" });
	const subscriptionId = crypto.randomUUID();
	const creditGrantCount = selectedConfig.billingCycle === "annual" ? 12 : 1;
	const nextGrantDate = new Date(now.getTime());
	nextGrantDate.setUTCMonth(nextGrantDate.getUTCMonth() + 1);
	const nextCreditGrantAt = creditGrantCount > 1 && nextGrantDate < endAt ? nextGrantDate.toISOString() : null;

	await getPrismaClient().$transaction(async (transaction) => {
		await transaction.subscriptions.updateMany({
			where: { owner_id: input.userId, status: "active", monthly_credits: { gt: 0 } },
			data: { status: "canceled", canceled_at: nowIso, updated_at: nowIso, next_credit_grant_at: null },
		});
		await transaction.subscriptions.create({
			data: {
				id: subscriptionId,
				owner_id: input.userId,
				plan_code: parseMembershipPlanCode(product.id, skuId),
				status: "active",
				start_at: nowIso,
				end_at: endAt.toISOString(),
				duration_days: durationDays,
				daily_limit: selectedConfig.dailyGiftCredits,
				billing_team_id: teamId,
				billing_cycle: selectedConfig.billingCycle,
				monthly_credits: selectedConfig.monthlyCredits,
				daily_gift_credits: selectedConfig.dailyGiftCredits,
				concurrency_limit: selectedConfig.concurrencyLimit,
				capacity_label: selectedConfig.capacityLabel,
				credit_grant_count: creditGrantCount,
				credit_grants_issued: 1,
				next_credit_grant_at: nextCreditGrantAt,
				timezone: selectedConfig.timezone,
				created_at: nowIso,
				updated_at: nowIso,
				canceled_at: null,
			},
		});
		await grantInitialMembershipCredits(transaction, {
			subscriptionId,
			ownerId: input.userId,
			teamId,
			monthlyCredits: selectedConfig.monthlyCredits,
			dailyGiftCredits: selectedConfig.dailyGiftCredits,
			timezone: selectedConfig.timezone,
		}, now);
	});

	const updated = await getUserById(c.env.DB, input.userId);
	if (!updated) throw new AppError("User not found", { status: 404, code: "user_not_found" });
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

	const existingDeletedAt = normalizeDeletedAt(existing.deleted_at);
	if (existingDeletedAt) {
		// idempotent
		return;
	}

	const existingRole = normalizeRole(existing.role);
	const existingDisabled = normalizeDisabled(existing.disabled);
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

export async function getUserCreditsOverview(
	c: AppContext,
	input: { userId: string },
): Promise<UserCreditsOverviewDto> {
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
	return fetchUserCreditsOverview(userId);
}

export async function getUserCreditsLedger(
	c: AppContext,
	input: {
		userId: string;
		entryTypes?: string[] | null;
		taskIdLike?: string | null;
		since?: string | null;
		until?: string | null;
		cursor?: string | null;
		cursorAt?: string | null;
		limit?: number;
	},
): Promise<LedgerListResponseDto> {
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
	return listUserCreditsLedger(userId, {
		entryTypes: input.entryTypes ?? null,
		taskIdLike: input.taskIdLike ?? null,
		since: input.since ?? null,
		until: input.until ?? null,
		cursor: input.cursor ?? null,
		cursorAt: input.cursorAt ?? null,
		limit: input.limit,
	});
}

export async function getUserTaskLog(
	c: AppContext,
	input: { userId: string; taskId: string },
): Promise<TaskLogBundleDto> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);
	await ensureTeamSchema(c.env.DB);
	const userId = (input.userId || "").trim();
	const taskId = (input.taskId || "").trim();
	if (!userId || !taskId) {
		throw new AppError("userId and taskId are required", {
			status: 400,
			code: "invalid_request",
		});
	}
	return fetchTaskLogBundle(userId, taskId);
}
