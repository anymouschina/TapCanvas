import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
	chargeTeamCreditBatches,
	deductReservedTeamCreditBatches,
	releaseReservedTeamCreditBatches,
	reserveTeamCreditBatches,
	reserveTeamCreditBatchesUpToAvailable,
} from "./team-credit-batch.service";

type LedgerRow = {
	id: string;
	team_id: string;
	entry_type: string;
	amount: number;
	task_id: string | null;
	task_kind: string | null;
	actor_user_id: string | null;
};

type BatchRow = {
	id: string;
	team_id: string;
	source_type: string;
	source_key: string;
	original_amount: number;
	remaining_amount: number;
	reserved_amount: number;
	expires_at: string | null;
	granted_at: string;
};

type AllocationRow = {
	id: string;
	team_id: string;
	ledger_entry_id: string;
	batch_id: string;
	priority: number;
	amount: number;
	expired_amount: number;
	created_at: string;
};

function numericChange(value: unknown): number {
	if (!value || typeof value !== "object") return 0;
	if ("increment" in value && typeof value.increment === "number") return value.increment;
	if ("decrement" in value && typeof value.decrement === "number") return -value.decrement;
	return 0;
}

function createCreditHarness(input: {
	nowIso: string;
	temporaryExpiresAt: string;
}): {
	db: PrismaClient;
	team: { id: string; credits: number; credits_frozen: number };
	batches: BatchRow[];
	ledgers: LedgerRow[];
	allocations: AllocationRow[];
} {
	const team = { id: "team-1", credits: 200, credits_frozen: 0 };
	const batches: BatchRow[] = [
		{
			id: "temporary",
			team_id: team.id,
			source_type: "membership_daily",
			source_key: "daily-grant",
			original_amount: 100,
			remaining_amount: 100,
			reserved_amount: 0,
			expires_at: input.temporaryExpiresAt,
			granted_at: input.nowIso,
		},
		{
			id: "permanent",
			team_id: team.id,
			source_type: "purchased",
			source_key: "purchase-1",
			original_amount: 100,
			remaining_amount: 100,
			reserved_amount: 0,
			expires_at: null,
			granted_at: input.nowIso,
		},
	];
	const ledgers: LedgerRow[] = [];
	const allocations: AllocationRow[] = [];

	const tx = {
		$queryRawUnsafe: async (sql: string) => {
			if (sql.includes("FROM teams")) return [{ ...team }];
			if (sql.includes("FROM team_credit_batches")) return batches.map((batch) => ({ ...batch }));
			return [];
		},
		teams: {
			update: async ({ data }: { data: Record<string, unknown> }) => {
				team.credits += numericChange(data.credits);
				team.credits_frozen += numericChange(data.credits_frozen);
				return { ...team };
			},
		},
		team_credit_batches: {
			update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const batch = batches.find((candidate) => candidate.id === where.id);
				if (!batch) throw new Error(`batch missing: ${where.id}`);
				batch.remaining_amount += numericChange(data.remaining_amount);
				batch.reserved_amount += numericChange(data.reserved_amount);
				return { ...batch };
			},
		},
		team_credit_ledger: {
			findUnique: async ({ where }: { where: { team_id_entry_type_task_id: { team_id: string; entry_type: string; task_id: string } } }) => {
				const key = where.team_id_entry_type_task_id;
				return ledgers.find((ledger) => ledger.team_id === key.team_id && ledger.entry_type === key.entry_type && ledger.task_id === key.task_id) ?? null;
			},
			findMany: async ({ where }: { where: { team_id: string; task_id: string; entry_type: { in: string[] } } }) => ledgers.filter((ledger) => (
				ledger.team_id === where.team_id
				&& ledger.task_id === where.task_id
				&& where.entry_type.in.includes(ledger.entry_type)
			)),
			create: async ({ data }: { data: Record<string, unknown> }) => {
				const ledger: LedgerRow = {
					id: String(data.id),
					team_id: String(data.team_id),
					entry_type: String(data.entry_type),
					amount: Number(data.amount),
					task_id: typeof data.task_id === "string" ? data.task_id : null,
					task_kind: typeof data.task_kind === "string" ? data.task_kind : null,
					actor_user_id: typeof data.actor_user_id === "string" ? data.actor_user_id : null,
				};
				ledgers.push(ledger);
				return ledger;
			},
			upsert: async ({ where, create, update }: {
				where: { team_id_entry_type_task_id: { team_id: string; entry_type: string; task_id: string } };
				create: Record<string, unknown>;
				update: Record<string, unknown>;
			}) => {
				const key = where.team_id_entry_type_task_id;
				const existing = ledgers.find((ledger) => ledger.team_id === key.team_id && ledger.entry_type === key.entry_type && ledger.task_id === key.task_id);
				if (existing) {
					existing.amount += numericChange(update.amount);
					return existing;
				}
				return tx.team_credit_ledger.create({ data: create });
			},
			update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const ledger = ledgers.find((candidate) => candidate.id === where.id);
				if (!ledger) throw new Error(`ledger missing: ${where.id}`);
				ledger.amount += numericChange(data.amount);
				return ledger;
			},
		},
		team_credit_allocations: {
			upsert: async ({ where, create, update }: {
				where: { ledger_entry_id_batch_id: { ledger_entry_id: string; batch_id: string } };
				create: AllocationRow;
				update: Record<string, unknown>;
			}) => {
				const key = where.ledger_entry_id_batch_id;
				const existing = allocations.find((allocation) => allocation.ledger_entry_id === key.ledger_entry_id && allocation.batch_id === key.batch_id);
				if (existing) {
					existing.amount += numericChange(update.amount);
					existing.expired_amount += numericChange(update.expired_amount);
					return existing;
				}
				allocations.push({ ...create });
				return create;
			},
			findMany: async ({ where }: { where: { ledger_entry_id: string } }) => allocations
				.filter((allocation) => allocation.ledger_entry_id === where.ledger_entry_id)
				.sort((left, right) => left.priority - right.priority),
			groupBy: async ({ where }: { where: { ledger_entry_id: { in: string[] } } }) => {
				const totals = new Map<string, number>();
				for (const allocation of allocations) {
					if (!where.ledger_entry_id.in.includes(allocation.ledger_entry_id)) continue;
					totals.set(allocation.batch_id, (totals.get(allocation.batch_id) ?? 0) + allocation.amount);
				}
				return Array.from(totals, ([batch_id, amount]) => ({ batch_id, _sum: { amount } }));
			},
		},
		membership_credit_grants: { updateMany: async () => ({ count: 1 }) },
	};
	const db = {
		$transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx),
	} as unknown as PrismaClient;
	return { db, team, batches, ledgers, allocations };
}

describe("credit batch reservation and settlement", () => {
	it("reserves the remaining positive balance when it is below the target", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 197,
			taskId: "existing-task",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:10:00.000Z",
		});

		const result = await reserveTeamCreditBatchesUpToAvailable(harness.db, {
			teamId: "team-1",
			amount: 500,
			minimumAmount: 1,
			taskId: "small-balance-turn",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:20:00.000Z",
		});

		expect(result).toEqual({ status: "reserved", amount: 3 });
		expect(harness.team.credits_frozen).toBe(200);
		expect(harness.ledgers.find((ledger) => ledger.task_id === "small-balance-turn"))
			.toMatchObject({ entry_type: "reserve", amount: 3 });
	});

	it("distinguishes zero balance and an existing reservation from each other", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 200,
			taskId: "existing-task",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:10:00.000Z",
		});

		const conflict = await reserveTeamCreditBatchesUpToAvailable(harness.db, {
			teamId: "team-1",
			amount: 500,
			minimumAmount: 1,
			taskId: "existing-task",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:20:00.000Z",
		});
		const insufficient = await reserveTeamCreditBatchesUpToAvailable(harness.db, {
			teamId: "team-1",
			amount: 500,
			minimumAmount: 1,
			taskId: "new-task",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:30:00.000Z",
		});

		expect(conflict).toMatchObject({ status: "idempotency_conflict", available: 0 });
		expect(insufficient).toMatchObject({ status: "insufficient", available: 0 });
	});

	it("lets a fenced recovery adopt only its own still-pending reservation", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 120,
			taskId: "stale-physical-run",
			taskKind: "agents_chat",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:10:00.000Z",
		});

		const recovered = await reserveTeamCreditBatchesUpToAvailable(harness.db, {
			teamId: "team-1",
			amount: 500,
			minimumAmount: 1,
			taskId: "stale-physical-run",
			taskKind: "agents_chat",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:20:00.000Z",
			allowExistingReservation: true,
		});
		const wrongOwner = await reserveTeamCreditBatchesUpToAvailable(harness.db, {
			teamId: "team-1",
			amount: 500,
			minimumAmount: 1,
			taskId: "stale-physical-run",
			taskKind: "agents_chat",
			actorUserId: "user-2",
			nowIso: "2026-07-23T00:30:00.000Z",
			allowExistingReservation: true,
		});

		expect(recovered).toEqual({ status: "existing_reservation", amount: 120 });
		expect(wrongOwner).toMatchObject({ status: "idempotency_conflict" });
		expect(harness.ledgers.filter((ledger) => ledger.entry_type === "reserve")).toHaveLength(1);
		expect(harness.team.credits_frozen).toBe(120);
	});

	it("deducts an unreserved balance without changing frozen credits", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 40,
			taskId: "active-task",
			actorUserId: "user-1",
			nowIso: "2026-07-23T00:30:00.000Z",
		});

		const charged = await chargeTeamCreditBatches(harness.db, {
			teamId: "team-1",
			entryType: "deduct",
			amount: 100,
			actorUserId: "admin-1",
			nowIso: "2026-07-23T01:00:00.000Z",
		});

		expect(charged.charged).toBe(true);
		expect(harness.team).toMatchObject({ credits: 100, credits_frozen: 40 });
		expect(harness.batches.reduce((total, batch) => total + batch.reserved_amount, 0)).toBe(40);
		const directDeduct = harness.ledgers.find((ledger) => (
			ledger.entry_type === "deduct" && ledger.task_id === null
		));
		expect(directDeduct?.amount).toBe(100);
		expect(harness.allocations
			.filter((allocation) => allocation.ledger_entry_id === directDeduct?.id)
			.reduce((total, allocation) => total + allocation.amount, 0)).toBe(100);
	});

	it("reserves and deducts temporary credits before permanent purchased credits", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		const reserved = await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 150,
			taskId: "task-1",
			actorUserId: "user-1",
			nowIso: "2026-07-23T01:00:00.000Z",
		});
		expect(reserved).toBe(true);
		const reserveLedger = harness.ledgers.find((ledger) => ledger.entry_type === "reserve");
		expect(harness.allocations.filter((allocation) => allocation.ledger_entry_id === reserveLedger?.id)).toEqual([
			expect.objectContaining({ batch_id: "temporary", amount: 100, priority: 0 }),
			expect.objectContaining({ batch_id: "permanent", amount: 50, priority: 1 }),
		]);

		const deducted = await deductReservedTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 120,
			taskId: "task-1",
			actorUserId: "user-1",
			nowIso: "2026-07-23T02:00:00.000Z",
		});
		expect(deducted).toBe(true);
		const deductionLedger = harness.ledgers.find((ledger) => ledger.entry_type === "deduct");
		expect(harness.allocations.filter((allocation) => allocation.ledger_entry_id === deductionLedger?.id)).toEqual([
			expect.objectContaining({ batch_id: "temporary", amount: 100 }),
			expect.objectContaining({ batch_id: "permanent", amount: 20 }),
		]);
		expect(harness.team).toMatchObject({ credits: 80, credits_frozen: 30 });
	});

	it("does not resurrect a temporary reservation released after its expiry", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 100,
			taskId: "task-expired",
			actorUserId: "user-1",
			nowIso: "2026-07-23T01:00:00.000Z",
		});
		const released = await releaseReservedTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 100,
			taskId: "task-expired",
			actorUserId: "user-1",
			nowIso: "2026-07-24T01:00:00.000Z",
		});
		expect(released).toBe(true);
		expect(harness.team).toMatchObject({ credits: 100, credits_frozen: 0 });
		expect(harness.batches.find((batch) => batch.id === "temporary")).toMatchObject({
			remaining_amount: 0,
			reserved_amount: 0,
		});
		const releaseLedger = harness.ledgers.find((ledger) => ledger.entry_type === "release");
		expect(harness.allocations.find((allocation) => allocation.ledger_entry_id === releaseLedger?.id)).toMatchObject({
			batch_id: "temporary",
			amount: 100,
			expired_amount: 100,
		});
	});

	it("completes a release when an earlier pass already released part of a reservation", async () => {
		const harness = createCreditHarness({
			nowIso: "2026-07-23T00:00:00.000Z",
			temporaryExpiresAt: "2026-07-24T00:00:00.000Z",
		});
		await reserveTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 100,
			taskId: "task-partial-release",
			actorUserId: "user-1",
			nowIso: "2026-07-23T01:00:00.000Z",
		});
		await releaseReservedTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 40,
			taskId: "task-partial-release",
			actorUserId: "user-1",
			nowIso: "2026-07-23T02:00:00.000Z",
		});
		const completed = await releaseReservedTeamCreditBatches(harness.db, {
			teamId: "team-1",
			amount: 60,
			taskId: "task-partial-release",
			actorUserId: "user-1",
			nowIso: "2026-07-23T03:00:00.000Z",
		});

		expect(completed).toBe(true);
		expect(harness.team).toMatchObject({ credits: 200, credits_frozen: 0 });
		expect(harness.ledgers.filter((ledger) => ledger.entry_type === "release")).toHaveLength(1);
		expect(harness.ledgers.find((ledger) => ledger.entry_type === "release")?.amount).toBe(100);
	});
});
