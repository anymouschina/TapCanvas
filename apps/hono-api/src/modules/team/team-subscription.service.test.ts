import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	execute,
	queryOne,
	isAdminRequest,
	getTeamMembershipForUserInTeam,
	topUpTeamCredits,
	grantTeamCreditsInTransaction,
} = vi.hoisted(() => ({
	execute: vi.fn(),
	queryOne: vi.fn(),
	isAdminRequest: vi.fn(),
	getTeamMembershipForUserInTeam: vi.fn(),
	topUpTeamCredits: vi.fn(),
	grantTeamCreditsInTransaction: vi.fn().mockResolvedValue({ granted: true, ledgerEntryId: "ledger-1" }),
}));

vi.mock("../../db/db", () => ({
	execute,
	queryAll: vi.fn(),
	queryOne,
}));
vi.mock("./team.service", () => ({ isAdminRequest }));
vi.mock("./team.repo", () => ({
	getTeamMembershipForUserInTeam,
	topUpTeamCredits,
}));
vi.mock("./team-credit-batch.service", () => ({ grantTeamCreditsInTransaction }));

import {
	activateTeamSubscriptionCore,
	calculateTeamSubscriptionCredits,
	upsertTeamSubscriptionPlan,
} from "./team-subscription.service";

const features = {
	concurrent_tasks_per_seat: 2,
	unlimited_concurrent_tasks: false,
	canvas_collab: true,
	shared_asset_library: true,
	seat_management: true,
	credit_quota_control: true,
	fast_invoice: true,
	creditGrants: {
		annual: { includedCreditsPerSeat: 12000 },
	},
	presentation: {
		badge: "团队入门",
		variantOrder: 1,
		accent: "graphite" as const,
		featured: false,
		campaignBenefits: ["固定 5 个协作席位"],
		capabilities: ["多人实时协作画布"],
	},
};

const planRow = {
	id: "team-plus",
	name: "PLUS",
	tier: "plus",
	max_seats: 5,
	min_seats: 5,
	features_json: JSON.stringify(features),
	sort_weight: 1,
	enabled: 1,
	created_at: "2026-07-22T00:00:00.000Z",
	updated_at: "2026-07-22T00:00:00.000Z",
};

const subscriptionRow = {
	id: "subscription-1",
	team_id: "team-1",
	plan_id: planRow.id,
	billing_cycle: "annual",
	seat_count: 5,
	status: "active",
	current_period_start: "2026-07-22T00:00:00.000Z",
	current_period_end: "2027-07-22T00:00:00.000Z",
	next_credit_renewal_at: "2026-08-22T00:00:00.000Z",
	last_renewed_at: "2026-07-22T00:00:00.000Z",
	credits_per_renewal: 0,
	cancelled_at: null,
	created_at: "2026-07-22T00:00:00.000Z",
	updated_at: "2026-07-22T00:00:00.000Z",
};

const proPlanRow = {
	...planRow,
	id: "team-pro",
	name: "PRO",
	tier: "pro",
	max_seats: 10,
	min_seats: 10,
};

const planDto = {
	id: planRow.id,
	name: planRow.name,
	tier: planRow.tier,
	maxSeats: planRow.max_seats,
	minSeats: planRow.min_seats,
	features,
	sortWeight: planRow.sort_weight,
	enabled: true,
	createdAt: planRow.created_at,
	updatedAt: planRow.updated_at,
};

function createContext(): AppContext {
	return {
		env: { DB: {} } as AppContext["env"],
	} as unknown as AppContext;
}

function createActivationDb(input: {
	activeSubscription?: typeof subscriptionRow | null;
	plan?: typeof planRow;
	priorSubscriptionCount?: number;
	teamId?: string;
} = {}) {
	const plan = input.plan ?? planRow;
	const activeSubscription = input.activeSubscription ?? null;
	const teamId = input.teamId ?? activeSubscription?.team_id ?? "team-1";
	const persisted = activeSubscription
		? { ...activeSubscription, team_id: teamId, plan_id: plan.id, seat_count: plan.min_seats }
		: { ...subscriptionRow, team_id: teamId, plan_id: plan.id, seat_count: plan.min_seats };
	const tx = {
		$queryRawUnsafe: vi.fn().mockResolvedValue([]),
		team_subscription_plans: { findUnique: vi.fn().mockResolvedValue(plan) },
		team_plan_subscriptions: {
			findMany: vi.fn().mockResolvedValue(activeSubscription ? [activeSubscription] : []),
			findUnique: vi.fn().mockResolvedValue(persisted),
			count: vi.fn().mockResolvedValue(input.priorSubscriptionCount ?? 0),
			create: vi.fn().mockResolvedValue(persisted),
			update: vi.fn().mockResolvedValue(persisted),
		},
		teams: { update: vi.fn().mockResolvedValue({ id: teamId }) },
		team_credit_ledger: { create: vi.fn().mockResolvedValue({ id: "ledger-1" }) },
	};
	const db = {
		$transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
	};
	return { db: db as unknown as AppContext["env"]["DB"], tx };
}

describe("team subscription plan administration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isAdminRequest.mockReturnValue(false);
	});

	it("rejects a direct plan write from a non-admin", async () => {
		await expect(upsertTeamSubscriptionPlan(createContext(), {
			id: "team-plus",
			name: "PLUS",
			tier: "plus",
			minSeats: 5,
			maxSeats: 5,
			features,
			sortWeight: 1,
			enabled: true,
		})).rejects.toMatchObject({ status: 403, code: "forbidden" });
		expect(execute).not.toHaveBeenCalled();
	});

	it("inserts a validated plan and reads back the persisted row", async () => {
		isAdminRequest.mockReturnValue(true);
		queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(planRow);

		const saved = await upsertTeamSubscriptionPlan(createContext(), {
			id: "team-plus",
			name: "PLUS",
			tier: "plus",
			minSeats: 5,
			maxSeats: 5,
			features,
			sortWeight: 1,
			enabled: true,
		});

		expect(saved).toMatchObject({ id: "team-plus", minSeats: 5, maxSeats: 5 });
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0]?.[2]).toHaveLength(10);
	});

	it("rejects a draggable seat range before persistence", async () => {
		isAdminRequest.mockReturnValue(true);
		await expect(upsertTeamSubscriptionPlan(createContext(), {
			id: "team-plus",
			name: "PLUS",
			tier: "plus",
			minSeats: 5,
			maxSeats: 8,
			features,
			sortWeight: 1,
			enabled: true,
		})).rejects.toMatchObject({
			status: 409,
			code: "team_plan_seat_configuration_invalid",
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("calculates the exact annual administrator allocation", () => {
		expect(calculateTeamSubscriptionCredits(planDto, 5)).toBe(60000);
	});

	it("creates the first membership and credits only the targeted team", async () => {
		const { db, tx } = createActivationDb();
		await activateTeamSubscriptionCore(db, "team-1", {
			planId: planRow.id,
			billingCycle: "annual",
			seatCount: 5,
			issueCreditsNow: true,
			actorUserId: "user-1",
		});

		expect(tx.team_plan_subscriptions.create).toHaveBeenCalledOnce();
		expect(tx.teams.update).toHaveBeenCalledWith({
			where: { id: "team-1" },
			data: expect.objectContaining({ max_members: 5 }),
		});
		expect(grantTeamCreditsInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
			teamId: "team-1",
			amount: 60000,
			sourceType: "team_membership",
		}));
	});

	it("renews the existing membership instead of stacking another active row", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
		const { db, tx } = createActivationDb({ activeSubscription: subscriptionRow, priorSubscriptionCount: 1 });
		try {
			await activateTeamSubscriptionCore(db, "team-1", {
				planId: planRow.id,
				billingCycle: "annual",
				seatCount: 5,
				issueCreditsNow: true,
				actorUserId: "user-1",
			});
		} finally {
			vi.useRealTimers();
		}

		expect(tx.team_plan_subscriptions.create).not.toHaveBeenCalled();
		expect(tx.team_plan_subscriptions.update).toHaveBeenCalledWith({
			where: { id: "subscription-1" },
			data: expect.objectContaining({
				plan_id: planRow.id,
				seat_count: 5,
				current_period_end: "2028-07-22T00:00:00.000Z",
			}),
		});
		expect(tx.teams.update).toHaveBeenCalledWith({
			where: { id: "team-1" },
			data: expect.objectContaining({ max_members: 5 }),
		});
		expect(grantTeamCreditsInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ amount: 60000 }));
	});

	it("replaces the current plan without stacking seats or subscriptions", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
		const { db, tx } = createActivationDb({
			activeSubscription: subscriptionRow,
			plan: proPlanRow,
			priorSubscriptionCount: 1,
		});
		try {
			await activateTeamSubscriptionCore(db, "team-1", {
				planId: proPlanRow.id,
				billingCycle: "annual",
				seatCount: 10,
				issueCreditsNow: true,
				actorUserId: "user-1",
			});
		} finally {
			vi.useRealTimers();
		}

		expect(tx.team_plan_subscriptions.create).not.toHaveBeenCalled();
		expect(tx.team_plan_subscriptions.update).toHaveBeenCalledWith({
			where: { id: "subscription-1" },
			data: expect.objectContaining({
				plan_id: proPlanRow.id,
				seat_count: 10,
				current_period_start: "2026-07-22T00:00:00.000Z",
				current_period_end: "2027-07-22T00:00:00.000Z",
			}),
		});
		expect(tx.teams.update).toHaveBeenCalledWith({
			where: { id: "team-1" },
			data: expect.objectContaining({ max_members: 10 }),
		});
	});

});
