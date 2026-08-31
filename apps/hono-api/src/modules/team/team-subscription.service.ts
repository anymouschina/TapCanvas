import type { PrismaClient } from "../../types";
import type { Prisma } from "@prisma/client";
import { execute, queryAll, queryOne } from "../../db/db";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	type SubscriptionPlanFeatures,
	type TeamPlanSubscriptionDto,
	type TeamSubscriptionPlanDto,
	type UpsertTeamSubscriptionPlanInput,
	TeamPlanSubscriptionSchema,
	TeamSubscriptionPlanSchema,
	SubscriptionPlanFeaturesSchema,
} from "./team-subscription.schemas";
import { isAdminRequest } from "./team.service";
import { getTeamMembershipForUserInTeam, topUpTeamCredits } from "./team.repo";
import { grantTeamCreditsInTransaction } from "./team-credit-batch.service";

type PlanRow = {
	id: string;
	name: string;
	tier: string;
	max_seats: number;
	min_seats: number;
	features_json: string | null;
	sort_weight: number;
	enabled: number;
	created_at: string;
	updated_at: string;
};

type SubscriptionRow = {
	id: string;
	team_id: string;
	plan_id: string;
	billing_cycle: string;
	seat_count: number;
	status: string;
	current_period_start: string;
	current_period_end: string;
	next_credit_renewal_at: string;
	last_renewed_at: string | null;
	credits_per_renewal: number;
	cancelled_at: string | null;
	created_at: string;
	updated_at: string;
};

type TeamSubscriptionActivationInput = {
	planId: string;
	billingCycle: "annual";
	seatCount: number;
	issueCreditsNow: boolean;
	actorUserId: string;
};

function assertAnnualTeamPlanConfiguration(input: UpsertTeamSubscriptionPlanInput): void {
	if (input.minSeats !== input.maxSeats) {
		throw new AppError("Team membership plans must use a fixed seat count", {
			status: 409,
			code: "team_plan_seat_configuration_invalid",
			details: { minSeats: input.minSeats, maxSeats: input.maxSeats },
		});
	}
}

function resolveFixedTeamPlanSeatCount(plan: TeamSubscriptionPlanDto): number {
	if (plan.minSeats !== plan.maxSeats) {
		throw new AppError("Team membership plan seat configuration is invalid", {
			status: 409,
			code: "team_plan_seat_configuration_invalid",
			details: { planId: plan.id, minSeats: plan.minSeats, maxSeats: plan.maxSeats },
		});
	}
	return plan.minSeats;
}

export function calculateTeamSubscriptionCredits(
	plan: TeamSubscriptionPlanDto,
	seatCount: number,
): number {
	return plan.features.creditGrants.annual.includedCreditsPerSeat * seatCount;
}

function parsePlanFeatures(json: string | null): SubscriptionPlanFeatures {
	const raw: unknown = json ? JSON.parse(json) : {};
	return SubscriptionPlanFeaturesSchema.parse(raw);
}

function mapPlan(row: PlanRow): TeamSubscriptionPlanDto {
	return TeamSubscriptionPlanSchema.parse({
		id: row.id,
		name: row.name,
		tier: row.tier,
		maxSeats: Number(row.max_seats ?? 20),
		minSeats: Number(row.min_seats ?? 1),
		features: parsePlanFeatures(row.features_json),
		sortWeight: Number(row.sort_weight ?? 0),
		enabled: row.enabled === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function mapSubscription(
	row: SubscriptionRow,
	plan?: TeamSubscriptionPlanDto,
): TeamPlanSubscriptionDto {
	return TeamPlanSubscriptionSchema.parse({
		id: row.id,
		teamId: row.team_id,
		planId: row.plan_id,
		plan,
		billingCycle: row.billing_cycle as "monthly" | "annual",
		seatCount: Number(row.seat_count ?? 1),
		status: row.status as "active" | "expired" | "cancelled",
		currentPeriodStart: row.current_period_start,
		currentPeriodEnd: row.current_period_end,
		nextCreditRenewalAt: row.next_credit_renewal_at,
		lastRenewedAt: row.last_renewed_at ?? null,
		creditsPerRenewal: Number(row.credits_per_renewal ?? 0),
		cancelledAt: row.cancelled_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

/** 推进一个月：同一日期 +1 月，clamp 到月末 */
function addOneMonth(isoStr: string): string {
	const d = new Date(isoStr);
	const targetMonth = d.getMonth() + 1;
	d.setMonth(targetMonth);
	// 如果 setMonth 跳到下个月（月末溢出），回退到当月最后一天
	if (d.getMonth() !== targetMonth % 12) {
		d.setDate(0);
	}
	return d.toISOString();
}

function addOneYear(date: Date): Date {
	const next = new Date(date.getTime());
	next.setUTCFullYear(next.getUTCFullYear() + 1);
	return next;
}

async function lockTeamMembership(
	tx: Prisma.TransactionClient,
	teamId: string,
): Promise<void> {
	await tx.$queryRawUnsafe(
		"SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
		"team-membership",
		teamId,
	);
}

async function applyTeamSubscriptionActivation(
	tx: Prisma.TransactionClient,
	teamId: string,
	input: TeamSubscriptionActivationInput,
	now: Date,
	creditTaskId: string,
): Promise<TeamPlanSubscriptionDto> {
	if (input.billingCycle !== "annual") {
		throw new AppError("Team membership only supports annual billing", {
			status: 409,
			code: "team_plan_billing_cycle_unavailable",
		});
	}

	await lockTeamMembership(tx, teamId);
	const planRow = await tx.team_subscription_plans.findUnique({ where: { id: input.planId } });
	if (!planRow || planRow.enabled !== 1) {
		throw new AppError("Plan not found", { status: 404, code: "not_found" });
	}
	const plan = mapPlan(planRow);
	const seatCount = resolveFixedTeamPlanSeatCount(plan);
	if (input.seatCount !== seatCount) {
		throw new AppError("Team membership seat count does not match the plan", {
			status: 409,
			code: "team_plan_seat_count_invalid",
			details: { planId: plan.id, expectedSeatCount: seatCount, receivedSeatCount: input.seatCount },
		});
	}
	const nowIso = now.toISOString();
	const activeSubscriptions = await tx.team_plan_subscriptions.findMany({
		where: { team_id: teamId, status: "active" },
		orderBy: { created_at: "desc" },
		take: 2,
	});
	if (activeSubscriptions.length > 1) {
		throw new AppError("Team has multiple active memberships", {
			status: 409,
			code: "team_membership_active_conflict",
			details: { teamId, subscriptionIds: activeSubscriptions.map((subscription) => subscription.id) },
		});
	}
	const activeSubscription = activeSubscriptions[0] ?? null;
	const totalCreditsToIssue = input.issueCreditsNow
		? calculateTeamSubscriptionCredits(plan, seatCount)
		: 0;
	const renewsCurrentPlan = activeSubscription?.plan_id === input.planId;
	const currentEnd = activeSubscription ? new Date(activeSubscription.current_period_end) : null;
	const renewalBase = renewsCurrentPlan && currentEnd && currentEnd > now ? currentEnd : now;
	const periodEnd = addOneYear(renewalBase).toISOString();
	const subscription = activeSubscription
		? await tx.team_plan_subscriptions.update({
			where: { id: activeSubscription.id },
			data: {
				plan_id: input.planId,
				billing_cycle: input.billingCycle,
				seat_count: seatCount,
				status: "active",
				current_period_start: renewsCurrentPlan ? activeSubscription.current_period_start : nowIso,
				current_period_end: periodEnd,
				next_credit_renewal_at: periodEnd,
				last_renewed_at: input.issueCreditsNow ? nowIso : activeSubscription.last_renewed_at,
				credits_per_renewal: 0,
				cancelled_at: null,
				updated_at: nowIso,
			},
		})
		: await tx.team_plan_subscriptions.create({
			data: {
				id: crypto.randomUUID(),
				team_id: teamId,
				plan_id: input.planId,
				billing_cycle: input.billingCycle,
				seat_count: seatCount,
				status: "active",
				current_period_start: nowIso,
				current_period_end: periodEnd,
				next_credit_renewal_at: periodEnd,
				last_renewed_at: input.issueCreditsNow ? nowIso : null,
				credits_per_renewal: 0,
				cancelled_at: null,
				created_at: nowIso,
				updated_at: nowIso,
			},
		});

	await tx.teams.update({
		where: { id: teamId },
		data: {
			max_members: seatCount,
			updated_at: nowIso,
		},
	});
	if (totalCreditsToIssue > 0) {
		await grantTeamCreditsInTransaction(tx, {
			teamId,
			entryType: "topup",
			amount: totalCreditsToIssue,
			taskId: creditTaskId,
				taskKind: "team_membership_allocation",
			actorUserId: input.actorUserId,
			note: `subscription:activate:${input.planId}:${input.billingCycle}:${seatCount}seats`,
			nowIso,
			sourceType: "team_membership",
			sourceKey: creditTaskId,
		});
	}

	return mapSubscription(subscription, plan);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listTeamSubscriptionPlans(db: PrismaClient): Promise<TeamSubscriptionPlanDto[]> {
	const rows = await queryAll<PlanRow>(
		db,
		`SELECT * FROM team_subscription_plans WHERE enabled = 1 ORDER BY sort_weight ASC, id ASC`,
		[],
	);
	return rows.map(mapPlan);
}

export async function getAllTeamSubscriptionPlans(db: PrismaClient): Promise<TeamSubscriptionPlanDto[]> {
	const rows = await queryAll<PlanRow>(
		db,
		`SELECT * FROM team_subscription_plans ORDER BY sort_weight ASC, id ASC`,
		[],
	);
	return rows.map(mapPlan);
}

export async function getPlanById(db: PrismaClient, planId: string): Promise<TeamSubscriptionPlanDto | null> {
	const row = await queryOne<PlanRow>(
		db,
		`SELECT * FROM team_subscription_plans WHERE id = ?`,
		[planId],
	);
	return row ? mapPlan(row) : null;
}

export async function upsertTeamSubscriptionPlan(
	c: AppContext,
	input: UpsertTeamSubscriptionPlanInput,
): Promise<TeamSubscriptionPlanDto> {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	assertAnnualTeamPlanConfiguration(input);
	const id = input.id ?? crypto.randomUUID();
	const existing = await getPlanById(c.env.DB, id);
	const nowIso = new Date().toISOString();
	const values = [
		input.name,
		input.tier,
		input.maxSeats,
		input.minSeats,
		JSON.stringify(input.features),
		input.sortWeight,
		input.enabled ? 1 : 0,
		nowIso,
	] as const;

	if (existing) {
		await execute(
			c.env.DB,
			`UPDATE team_subscription_plans
			 SET name = ?, tier = ?, max_seats = ?, min_seats = ?,
			     features_json = ?, sort_weight = ?, enabled = ?, updated_at = ?
			 WHERE id = ?`,
			[...values, id],
		);
	} else {
		await execute(
			c.env.DB,
			`INSERT INTO team_subscription_plans
			 (id, name, tier, max_seats, min_seats, features_json,
			  sort_weight, enabled, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, ...values.slice(0, 7), nowIso, nowIso],
		);
	}

	const saved = await getPlanById(c.env.DB, id);
	if (!saved) throw new AppError("Plan upsert failed", { status: 500, code: "team_plan_upsert_failed" });
	return saved;
}

export async function getActiveTeamSubscription(
	db: PrismaClient,
	teamId: string,
): Promise<TeamPlanSubscriptionDto | null> {
	const subscriptions = await getActiveTeamSubscriptions(db, teamId);
	return subscriptions[0] ?? null;
}

export async function getActiveTeamSubscriptions(
	db: PrismaClient,
	teamId: string,
): Promise<TeamPlanSubscriptionDto[]> {
	const rows = await queryAll<SubscriptionRow>(
		db,
		`SELECT * FROM team_plan_subscriptions WHERE team_id = ? AND status = 'active' ORDER BY created_at DESC`,
		[teamId],
	);
	if (rows.length > 1) {
		throw new AppError("Team has multiple active memberships", {
			status: 409,
			code: "team_membership_active_conflict",
			details: { teamId, subscriptionIds: rows.map((row) => row.id) },
		});
	}
	const plans = await Promise.all(rows.map(r => getPlanById(db, r.plan_id)));
	return rows.map((r, i) => mapSubscription(r, plans[i] ?? undefined));
}

/** 核心激活逻辑，无权限校验，仅供受控的管理员分配链路调用。 */
export async function activateTeamSubscriptionCore(
	db: PrismaClient,
	teamId: string,
	input: TeamSubscriptionActivationInput,
): Promise<TeamPlanSubscriptionDto> {
	const now = new Date();
	return db.$transaction((tx) => applyTeamSubscriptionActivation(
		tx,
		teamId,
		input,
		now,
		`direct:${teamId}:${now.toISOString()}:${crypto.randomUUID()}`,
	));
}

export async function activateTeamSubscription(
	c: AppContext,
	teamId: string,
	input: {
		planId: string;
		billingCycle: "annual";
		seatCount: number;
		issueCreditsNow: boolean;
		actorUserId: string;
	},
): Promise<TeamPlanSubscriptionDto> {
	// 开源版仅允许系统管理员分配团队套餐。
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	return activateTeamSubscriptionCore(c.env.DB, teamId, input);
}

export async function cancelTeamSubscription(
	c: AppContext,
	teamId: string,
	actorUserId: string,
	subId?: string,
): Promise<void> {
	if (!isAdminRequest(c)) {
		const membership = await getTeamMembershipForUserInTeam(c.env.DB, actorUserId, teamId);
		if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
			throw new AppError("Forbidden", { status: 403, code: "forbidden" });
		}
	}
	const nowIso = new Date().toISOString();
	if (subId) {
		// 取消指定订阅
		await execute(
			c.env.DB,
			`UPDATE team_plan_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND team_id = ? AND status = 'active'`,
			[nowIso, nowIso, subId, teamId],
		);
	} else {
		// 取消全部活跃订阅
		await execute(
			c.env.DB,
			`UPDATE team_plan_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE team_id = ? AND status = 'active'`,
			[nowIso, nowIso, teamId],
		);
	}
	// 单一会员取消后回到免费版 2 席；若指定 ID 未命中，则保留当前会员席位。
	await execute(
		c.env.DB,
		`UPDATE teams SET max_members = (
			SELECT COALESCE((SELECT seat_count FROM team_plan_subscriptions
			WHERE team_id = ? AND status = 'active' LIMIT 1), 2)
		), updated_at = ? WHERE id = ?`,
		[teamId, nowIso, teamId],
	);
}

/**
 * 批量处理到期续期 — 由定时任务调用。
 * 找出所有 status='active' 且 next_credit_renewal_at <= now 的订阅，发放本月积分并推进 next_credit_renewal_at。
 * 若推进后超过 current_period_end，则将订阅标记为 expired。
 */
export async function processTeamSubscriptionRenewals(
	db: PrismaClient,
): Promise<{ renewed: number; expired: number }> {
	const nowIso = new Date().toISOString();

	const due = await queryAll<SubscriptionRow>(
		db,
		`SELECT * FROM team_plan_subscriptions WHERE status = 'active' AND next_credit_renewal_at <= ? LIMIT 200`,
		[nowIso],
	);

	let renewed = 0;
	let expired = 0;

	for (const row of due) {
		const nextRenewal = addOneMonth(row.next_credit_renewal_at);
		const isExpired = nextRenewal > row.current_period_end;

		if (row.credits_per_renewal > 0) {
			await topUpTeamCredits(db, {
				teamId: row.team_id,
				amount: row.credits_per_renewal,
				actorUserId: "system",
				note: `subscription:renewal:${row.plan_id}:${row.id}`,
				nowIso,
				taskId: `team-membership-renewal:${row.id}:${row.next_credit_renewal_at}`,
				taskKind: "team_membership_renewal",
				sourceType: "team_membership",
				sourceKey: `${row.id}:${row.next_credit_renewal_at}`,
			});
		}

		if (isExpired) {
			await execute(
				db,
				`UPDATE team_plan_subscriptions SET status = 'expired', last_renewed_at = ?, updated_at = ? WHERE id = ?`,
				[nowIso, nowIso, row.id],
			);
			// 单一会员到期后回到免费版 2 席。
			await execute(
				db,
				`UPDATE teams SET max_members = (
					SELECT COALESCE((SELECT seat_count FROM team_plan_subscriptions
					WHERE team_id = ? AND status = 'active' LIMIT 1), 2)
				), updated_at = ? WHERE id = ?`,
				[row.team_id, nowIso, row.team_id],
			);
			expired += 1;
		} else {
			await execute(
				db,
				`UPDATE team_plan_subscriptions SET last_renewed_at = ?, next_credit_renewal_at = ?, updated_at = ? WHERE id = ?`,
				[nowIso, nextRenewal, nowIso, row.id],
			);
			renewed += 1;
		}
	}

	return { renewed, expired };
}
