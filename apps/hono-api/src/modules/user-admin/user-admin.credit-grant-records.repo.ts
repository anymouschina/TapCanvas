import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AdminCreditGrantListResponseDto } from "./user-admin.schemas";

export type CreditGrantQueryInput = {
	q?: string | null;
	grantType?: "monthly" | "daily" | null;
	from?: string | null;
	to?: string | null;
	page: number;
	pageSize: number;
};

const CREDIT_GRANT_TASK_KINDS = {
	monthly: "membership_monthly_grant",
	daily: "membership_daily_grant",
} as const;

type CreditGrantTaskKind = typeof CREDIT_GRANT_TASK_KINDS[keyof typeof CREDIT_GRANT_TASK_KINDS];

function buildStringRange(from?: string | null, to?: string | null): Prisma.StringFilter | undefined {
	if (!from && !to) return undefined;
	return {
		...(from ? { gte: from } : {}),
		...(to ? { lte: to } : {}),
	};
}

function isCreditGrantTaskKind(value: string | null): value is CreditGrantTaskKind {
	return value === CREDIT_GRANT_TASK_KINDS.monthly
		|| value === CREDIT_GRANT_TASK_KINDS.daily;
}

function grantTypeFromTaskKind(taskKind: CreditGrantTaskKind): "monthly" | "daily" {
	return taskKind === CREDIT_GRANT_TASK_KINDS.monthly ? "monthly" : "daily";
}

export function buildCreditGrantWhere(
	input: CreditGrantQueryInput,
	relatedTaskIds: string[] = [],
): Prisma.team_credit_ledgerWhereInput {
	const q = input.q?.trim();
	const grantedAt = buildStringRange(input.from, input.to);
	return {
		entry_type: "topup",
		task_kind: input.grantType
			? CREDIT_GRANT_TASK_KINDS[input.grantType]
			: { in: Object.values(CREDIT_GRANT_TASK_KINDS) },
		...(grantedAt ? { created_at: grantedAt } : {}),
		...(q
			? {
					OR: [
						{ id: { contains: q, mode: "insensitive" } },
						{ team_id: { contains: q, mode: "insensitive" } },
						{ task_id: { contains: q, mode: "insensitive" } },
						{ note: { contains: q, mode: "insensitive" } },
						{ users: { login: { contains: q, mode: "insensitive" } } },
						{ users: { name: { contains: q, mode: "insensitive" } } },
						{ users: { email: { contains: q, mode: "insensitive" } } },
						...(relatedTaskIds.length ? [{ task_id: { in: relatedTaskIds } }] : []),
					],
				}
			: {}),
	};
}

async function resolveRelatedCreditGrantTaskIds(q: string | undefined): Promise<string[]> {
	if (!q) return [];
	const membershipGrants = await getPrismaClient().membership_credit_grants.findMany({
		where: {
			OR: [
				{ owner_id: { contains: q, mode: "insensitive" } },
				{ subscription_id: { contains: q, mode: "insensitive" } },
				{ grant_key: { contains: q, mode: "insensitive" } },
				{ users: { login: { contains: q, mode: "insensitive" } } },
				{ users: { name: { contains: q, mode: "insensitive" } } },
				{ users: { email: { contains: q, mode: "insensitive" } } },
				{ subscriptions: { plan_code: { contains: q, mode: "insensitive" } } },
			],
		},
		select: { id: true },
	});
	return membershipGrants.map((row) => row.id);
}

export async function listCreditGrantRecords(
	input: CreditGrantQueryInput,
): Promise<AdminCreditGrantListResponseDto> {
	const prisma = getPrismaClient();
	const q = input.q?.trim();
	const relatedTaskIds = await resolveRelatedCreditGrantTaskIds(q);
	const where = buildCreditGrantWhere(input, relatedTaskIds);
	const [total, rows] = await Promise.all([
		prisma.team_credit_ledger.count({ where }),
		prisma.team_credit_ledger.findMany({
			where,
			orderBy: [{ created_at: "desc" }, { id: "desc" }],
			skip: (input.page - 1) * input.pageSize,
			take: input.pageSize,
			select: {
				id: true,
				team_id: true,
				amount: true,
				task_id: true,
				task_kind: true,
				actor_user_id: true,
				created_at: true,
				users: { select: { login: true, name: true, email: true } },
			},
		}),
	]);
	const taskIds = rows.flatMap((row) => row.task_id ? [row.task_id] : []);
	const membershipDetails = await prisma.membership_credit_grants.findMany({
		where: { id: { in: taskIds } },
		include: { subscriptions: true },
	});
	const membershipById = new Map(membershipDetails.map((detail) => [detail.id, detail]));

	return {
		items: rows.map((row) => {
			if (!row.task_id || !isCreditGrantTaskKind(row.task_kind) || !row.actor_user_id || !row.users) {
				throw new Error(`Invalid credit grant ledger row: ${row.id}`);
			}
			const grantType = grantTypeFromTaskKind(row.task_kind);
			const membership = membershipById.get(row.task_id);
			if (!membership) throw new Error(`Membership grant detail missing: ${row.task_id}`);
			return {
				id: row.id,
				subscriptionId: membership?.subscription_id ?? null,
				ownerId: row.actor_user_id,
				teamId: row.team_id,
				userLogin: row.users.login,
				userName: row.users.name,
				userEmail: row.users.email,
				planCode: membership.subscriptions.plan_code,
				subscriptionStatus: membership.subscriptions.status,
				grantType,
				grantKey: membership.grant_key,
				amount: row.amount,
				grantedAt: row.created_at,
				expiresAt: membership.expires_at,
				expiredAmount: membership.expired_amount,
				processedAt: membership.processed_at,
			};
		}),
		total,
		page: input.page,
		pageSize: input.pageSize,
	};
}
