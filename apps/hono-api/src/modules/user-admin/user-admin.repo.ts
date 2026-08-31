import type { PrismaClient } from "../../types";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../platform/node/prisma";

export type UserRow = {
	id: string;
	login: string;
	name: string | null;
	avatar_url: string | null;
	email: string | null;
	phone: string | null;
	role: string | null;
	guest: number;
	disabled?: number | null;
	deleted_at?: string | null;
	last_seen_at?: string | null;
	created_at: string;
	updated_at: string;
	team_id?: string | null;
	team_role?: string | null;
	team_name?: string | null;
	team_credits?: number | null;
	team_credits_frozen?: number | null;
	subscription_id?: string | null;
	subscription_plan_code?: string | null;
	subscription_start_at?: string | null;
	subscription_end_at?: string | null;
	subscription_billing_cycle?: string | null;
	subscription_monthly_credits?: number | null;
	subscription_daily_gift_credits?: number | null;
	subscription_concurrency_limit?: number | null;
	subscription_capacity_label?: string | null;
	subscription_timezone?: string | null;
};

function toPersonalTeamId(userId: string): string {
	return `personal_${userId}`;
}

export async function listUsers(
	db: PrismaClient,
	input: {
		q?: string | null;
		page: number;
		pageSize: number;
		includeDeleted: boolean;
	},
): Promise<{ rows: UserRow[]; total: number }> {
	void db;
	const q = (input.q || "").trim();
	const where: Prisma.usersWhereInput = {
		...(!input.includeDeleted
			? { OR: [{ deleted_at: null }, { deleted_at: "" }] }
			: {}),
		...(q
			? {
					AND: [
						{
							OR: [
								{ login: { contains: q, mode: "insensitive" } },
								{ name: { contains: q, mode: "insensitive" } },
								{ email: { contains: q, mode: "insensitive" } },
								{ id: { contains: q, mode: "insensitive" } },
							],
						},
					],
				}
			: {}),
	};
	const safePage = Math.max(1, Math.floor(input.page));
	const safePageSize = Math.max(1, Math.floor(input.pageSize));
	const [total, users] = await Promise.all([
		getPrismaClient().users.count({ where }),
		getPrismaClient().users.findMany({
			where,
			orderBy: [{ created_at: "desc" }, { id: "desc" }],
			skip: (safePage - 1) * safePageSize,
			take: safePageSize,
		}),
	]);

	const userIds = users.map((user) => user.id);
	const teamIds = new Set(users.filter((user) => user.guest === 0).map((user) => toPersonalTeamId(user.id)));

	const teams = teamIds.size
		? await getPrismaClient().teams.findMany({
				where: { id: { in: Array.from(teamIds) } },
				select: { id: true, name: true, credits: true, credits_frozen: true },
			})
		: [];
	const teamById = new Map(teams.map((team) => [team.id, team]));
	const nowIso = new Date().toISOString();
	const subscriptions = userIds.length
		? await getPrismaClient().subscriptions.findMany({
				where: {
					owner_id: { in: userIds },
					status: "active",
					monthly_credits: { gt: 0 },
					start_at: { lte: nowIso },
					end_at: { gt: nowIso },
				},
				orderBy: [{ end_at: "desc" }, { created_at: "desc" }],
			})
		: [];
	const subscriptionByUserId = new Map<string, (typeof subscriptions)[number]>();
	for (const subscription of subscriptions) {
		if (!subscriptionByUserId.has(subscription.owner_id)) subscriptionByUserId.set(subscription.owner_id, subscription);
	}

	const rows = users.map((user) => {
		const teamId = user.guest === 0 ? toPersonalTeamId(user.id) : null;
		const team = teamId ? teamById.get(teamId) : null;
		const subscription = subscriptionByUserId.get(user.id);
		const fallbackPersonalName =
			user.login && user.login.trim()
				? `${user.login} 的个人账户`
				: "个人账户";

		return {
			id: user.id,
			login: user.login,
			name: user.name,
			avatar_url: user.avatar_url,
			email: user.email,
			phone: user.phone,
			role: user.role,
			guest: user.guest,
			disabled: user.disabled,
			deleted_at: user.deleted_at,
			last_seen_at: user.last_seen_at,
			created_at: user.created_at,
			updated_at: user.updated_at,
			team_id: teamId,
			team_role: null,
			team_name: team
				? team.name
				: teamId && user.guest === 0
					? fallbackPersonalName
					: null,
			team_credits: team?.credits ?? (teamId && user.guest === 0 ? 0 : null),
			team_credits_frozen:
				team?.credits_frozen ?? (teamId && user.guest === 0 ? 0 : null),
			subscription_id: subscription?.id ?? null,
			subscription_plan_code: subscription?.plan_code ?? null,
			subscription_start_at: subscription?.start_at ?? null,
			subscription_end_at: subscription?.end_at ?? null,
			subscription_billing_cycle: subscription?.billing_cycle ?? null,
			subscription_monthly_credits: subscription?.monthly_credits ?? null,
			subscription_daily_gift_credits: subscription?.daily_gift_credits ?? null,
			subscription_concurrency_limit: subscription?.concurrency_limit ?? null,
			subscription_capacity_label: subscription?.capacity_label ?? null,
			subscription_timezone: subscription?.timezone ?? null,
		};
	});
	return { rows, total };
}

export async function getUserById(
	db: PrismaClient,
	userId: string,
): Promise<UserRow | null> {
	void db;
	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
	});
	if (!user) return null;

	const teamId = user.guest === 0 ? toPersonalTeamId(user.id) : null;
	const team = teamId
		? await getPrismaClient().teams.findUnique({
				where: { id: teamId },
				select: { id: true, name: true, credits: true, credits_frozen: true },
			})
		: null;
	const fallbackPersonalName =
		user.login && user.login.trim() ? `${user.login} 的个人账户` : "个人账户";
	const nowIso = new Date().toISOString();
	const subscription = await getPrismaClient().subscriptions.findFirst({
		where: {
			owner_id: userId,
			status: "active",
			monthly_credits: { gt: 0 },
			start_at: { lte: nowIso },
			end_at: { gt: nowIso },
		},
		orderBy: [{ end_at: "desc" }, { created_at: "desc" }],
	});

	return {
		id: user.id,
		login: user.login,
		name: user.name,
		avatar_url: user.avatar_url,
		email: user.email,
		phone: user.phone,
		role: user.role,
		guest: user.guest,
		disabled: user.disabled,
		deleted_at: user.deleted_at,
		last_seen_at: user.last_seen_at,
		created_at: user.created_at,
		updated_at: user.updated_at,
		team_id: teamId,
		team_role: null,
		team_name: team
			? team.name
			: teamId && user.guest === 0
				? fallbackPersonalName
				: null,
		team_credits: team?.credits ?? (teamId && user.guest === 0 ? 0 : null),
		team_credits_frozen:
			team?.credits_frozen ?? (teamId && user.guest === 0 ? 0 : null),
		subscription_id: subscription?.id ?? null,
		subscription_plan_code: subscription?.plan_code ?? null,
		subscription_start_at: subscription?.start_at ?? null,
		subscription_end_at: subscription?.end_at ?? null,
		subscription_billing_cycle: subscription?.billing_cycle ?? null,
		subscription_monthly_credits: subscription?.monthly_credits ?? null,
		subscription_daily_gift_credits: subscription?.daily_gift_credits ?? null,
		subscription_concurrency_limit: subscription?.concurrency_limit ?? null,
		subscription_capacity_label: subscription?.capacity_label ?? null,
		subscription_timezone: subscription?.timezone ?? null,
	};
}

export async function updateUserAdminFields(
	db: PrismaClient,
	input: {
		userId: string;
		role: string | null;
		disabled: number;
		updatedAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().users.update({
		where: { id: input.userId },
		data: {
			role: input.role,
			disabled: input.disabled,
			updated_at: input.updatedAt,
		},
	});
}

export async function softDeleteUser(
	db: PrismaClient,
	input: {
		userId: string;
		deletedAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().users.update({
		where: { id: input.userId },
		data: {
			deleted_at: input.deletedAt,
			disabled: 1,
			role: null,
			updated_at: input.deletedAt,
		},
	});
}
