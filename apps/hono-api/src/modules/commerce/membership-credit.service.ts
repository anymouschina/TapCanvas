import type { Prisma, PrismaClient } from "@prisma/client";
import {
	expireTeamCreditBatches,
	grantTeamCreditsInTransaction,
} from "../team/team-credit-batch.service";

function addOneMonthClamped(date: Date): Date {
	const sourceDay = date.getUTCDate();
	const result = new Date(date.getTime());
	result.setUTCDate(1);
	result.setUTCMonth(result.getUTCMonth() + 1);
	const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
	result.setUTCDate(Math.min(sourceDay, lastDay));
	return result;
}

function localDateParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
	return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

function formatLocalDate(date: Date, timeZone: string): string {
	const parts = localDateParts(date, timeZone);
	return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localMidnightToUtc(localDate: string, timeZone: string): Date {
	const [year, month, day] = localDate.split("-").map(Number);
	const targetWallTime = Date.UTC(year, month - 1, day, 0, 0, 0);
	let guess = targetWallTime;
	for (let index = 0; index < 4; index += 1) {
		const observed = localDateParts(new Date(guess), timeZone);
		const observedWallTime = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
		guess += targetWallTime - observedWallTime;
	}
	return new Date(guess);
}

function nextLocalMidnight(date: Date, timeZone: string): Date {
	const current = formatLocalDate(date, timeZone);
	const nextDate = new Date(`${current}T00:00:00.000Z`);
	nextDate.setUTCDate(nextDate.getUTCDate() + 1);
	return localMidnightToUtc(nextDate.toISOString().slice(0, 10), timeZone);
}

async function createCreditGrant(
	tx: Prisma.TransactionClient,
	input: {
		subscriptionId: string;
		ownerId: string;
		teamId: string;
		grantType: "monthly" | "daily";
		grantKey: string;
		amount: number;
		grantedAt: Date;
		expiresAt: Date | null;
	},
): Promise<boolean> {
	const exists = await tx.membership_credit_grants.findUnique({
		where: {
			subscription_id_grant_type_grant_key: {
				subscription_id: input.subscriptionId,
				grant_type: input.grantType,
				grant_key: input.grantKey,
			},
		},
		select: { id: true },
	});
	if (exists) return false;
	const grantId = crypto.randomUUID();
	const grantedAtIso = input.grantedAt.toISOString();
	await tx.membership_credit_grants.create({
		data: {
			id: grantId,
			subscription_id: input.subscriptionId,
			owner_id: input.ownerId,
			team_id: input.teamId,
			grant_type: input.grantType,
			grant_key: input.grantKey,
			amount: input.amount,
			granted_at: grantedAtIso,
			expires_at: input.expiresAt?.toISOString() ?? null,
			expired_amount: 0,
			processed_at: null,
		},
	});
	await grantTeamCreditsInTransaction(tx, {
		teamId: input.teamId,
		entryType: "topup",
		amount: input.amount,
		taskId: grantId,
		taskKind: `membership_${input.grantType}_grant`,
		actorUserId: input.ownerId,
		note: `membership:${input.subscriptionId}:${input.grantType}:${input.grantKey}`,
		nowIso: grantedAtIso,
		sourceType: `membership_${input.grantType}`,
		sourceKey: grantId,
		expiresAt: input.expiresAt?.toISOString() ?? null,
	});
	return true;
}

export async function grantInitialMembershipCredits(
	tx: Prisma.TransactionClient,
	input: { subscriptionId: string; ownerId: string; teamId: string; monthlyCredits: number; dailyGiftCredits: number; timezone: string },
	now: Date,
): Promise<void> {
	await createCreditGrant(tx, {
		subscriptionId: input.subscriptionId,
		ownerId: input.ownerId,
		teamId: input.teamId,
		grantType: "monthly",
		grantKey: "1",
		amount: input.monthlyCredits,
		grantedAt: now,
		expiresAt: null,
	});
	await createCreditGrant(tx, {
		subscriptionId: input.subscriptionId,
		ownerId: input.ownerId,
		teamId: input.teamId,
		grantType: "daily",
		grantKey: formatLocalDate(now, input.timezone),
		amount: input.dailyGiftCredits,
		grantedAt: now,
		expiresAt: nextLocalMidnight(now, input.timezone),
	});
}

async function expireDailyGrant(db: PrismaClient, grantId: string, now: Date): Promise<boolean> {
	const grant = await db.membership_credit_grants.findUnique({ where: { id: grantId } });
	if (!grant || grant.grant_type !== "daily" || grant.processed_at || !grant.expires_at) return false;
	await expireTeamCreditBatches(db, { teamId: grant.team_id, nowIso: now.toISOString() });
	const processed = await db.membership_credit_grants.findUnique({
		where: { id: grantId },
		select: { processed_at: true },
	});
	if (!processed?.processed_at) {
		throw new Error(`membership daily credit batch missing or not expired: ${grantId}`);
	}
	return true;
}

export async function processMembershipCreditGrants(
	db: PrismaClient,
	options: { now?: Date; limit?: number; ownerId?: string } = {},
): Promise<{ expired: number; subscriptionsExpired: number; monthlyGranted: number; dailyGranted: number; errors: number }> {
	const now = options.now ?? new Date();
	const nowIso = now.toISOString();
	const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 200)));
	const ownerId = options.ownerId?.trim() || undefined;
	let expired = 0;
	let monthlyGranted = 0;
	let dailyGranted = 0;
	let errors = 0;

	const dueExpiries = await db.membership_credit_grants.findMany({
		where: {
			grant_type: "daily",
			processed_at: null,
			expires_at: { lte: nowIso },
			...(ownerId ? { owner_id: ownerId } : {}),
		},
		orderBy: { expires_at: "asc" },
		take: limit,
		select: { id: true },
	});
	for (const row of dueExpiries) {
		try {
			if (await expireDailyGrant(db, row.id, now)) expired += 1;
		} catch (error: unknown) {
			errors += 1;
			console.error("[membership-credit] daily expiry failed", { grantId: row.id, error });
		}
	}

	const expiredSubscriptions = await db.subscriptions.updateMany({
		where: {
			status: "active",
			...(ownerId ? { owner_id: ownerId } : {}),
			end_at: { lte: nowIso },
		},
		data: { status: "expired", next_credit_grant_at: null, updated_at: nowIso },
	});

	const dueMonthly = await db.subscriptions.findMany({
		where: {
			status: "active",
			...(ownerId ? { owner_id: ownerId } : {}),
			monthly_credits: { gt: 0 },
			next_credit_grant_at: { lte: nowIso },
			end_at: { gt: nowIso },
		},
		orderBy: { next_credit_grant_at: "asc" },
		take: limit,
	});
	for (const subscription of dueMonthly) {
		try {
			if (subscription.credit_grants_issued >= subscription.credit_grant_count) {
				throw new Error(`membership credit schedule exceeds configured grants: ${subscription.id}`);
			}
			if (!subscription.billing_team_id) throw new Error(`membership billing team missing: ${subscription.id}`);
			const issued = subscription.credit_grants_issued + 1;
			await db.$transaction(async (tx) => {
				const created = await createCreditGrant(tx, {
					subscriptionId: subscription.id,
					ownerId: subscription.owner_id,
					teamId: subscription.billing_team_id as string,
					grantType: "monthly",
					grantKey: String(issued),
					amount: subscription.monthly_credits,
					grantedAt: now,
					expiresAt: null,
				});
				if (!created) return;
				const next = issued < subscription.credit_grant_count && subscription.next_credit_grant_at
					? addOneMonthClamped(new Date(subscription.next_credit_grant_at)).toISOString()
					: null;
				await tx.subscriptions.update({
					where: { id: subscription.id },
					data: { credit_grants_issued: issued, next_credit_grant_at: next, updated_at: nowIso },
				});
				monthlyGranted += 1;
			});
		} catch (error: unknown) {
			errors += 1;
			console.error("[membership-credit] monthly grant failed", { subscriptionId: subscription.id, error });
		}
	}

	const activeMemberships = await db.subscriptions.findMany({
		where: {
			status: "active",
			...(ownerId ? { owner_id: ownerId } : {}),
			daily_gift_credits: { gt: 0 },
			start_at: { lte: nowIso },
			end_at: { gt: nowIso },
		},
		orderBy: { start_at: "asc" },
		take: limit,
	});
	for (const subscription of activeMemberships) {
		try {
			if (!subscription.billing_team_id) throw new Error(`membership billing team missing: ${subscription.id}`);
			const grantKey = formatLocalDate(now, subscription.timezone);
			const created = await db.$transaction((tx) => createCreditGrant(tx, {
				subscriptionId: subscription.id,
				ownerId: subscription.owner_id,
				teamId: subscription.billing_team_id as string,
				grantType: "daily",
				grantKey,
				amount: subscription.daily_gift_credits,
				grantedAt: now,
				expiresAt: nextLocalMidnight(now, subscription.timezone),
			}));
			if (created) dailyGranted += 1;
		} catch (error: unknown) {
			errors += 1;
			console.error("[membership-credit] daily grant failed", { subscriptionId: subscription.id, error });
		}
	}

	return { expired, subscriptionsExpired: expiredSubscriptions.count, monthlyGranted, dailyGranted, errors };
}
