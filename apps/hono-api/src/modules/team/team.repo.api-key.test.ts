import { beforeEach, describe, expect, it, vi } from "vitest";

type CapturedInput = Record<string, unknown>;

const calls = vi.hoisted(() => ({
	charge: [] as CapturedInput[],
	deduct: [] as CapturedInput[],
	reserve: [] as CapturedInput[],
	reserveUpToAvailable: [] as CapturedInput[],
	rebindSql: [] as string[],
	rebindParams: [] as unknown[][],
}));

vi.mock("./team-credit-batch.service", () => ({
	chargeTeamCreditBatches: vi.fn(async (_db: unknown, input: CapturedInput) => {
		calls.charge.push(input);
		return { charged: true, ledgerEntryId: "ledger-charge" };
	}),
	deductReservedTeamCreditBatches: vi.fn(async (_db: unknown, input: CapturedInput) => {
		calls.deduct.push(input);
		return true;
	}),
	expireTeamCreditBatches: vi.fn(async () => 0),
	grantTeamCredits: vi.fn(),
	increaseReservedTeamCreditBatches: vi.fn(),
	releaseReservedTeamCreditBatches: vi.fn(),
	reserveTeamCreditBatches: vi.fn(async (_db: unknown, input: CapturedInput) => {
		calls.reserve.push(input);
		return true;
	}),
	reserveTeamCreditBatchesUpToAvailable: vi.fn(async (_db: unknown, input: CapturedInput) => {
		calls.reserveUpToAvailable.push(input);
		return { status: "reserved", amount: 3 };
	}),
}));

vi.mock("../../db/db", () => ({
	execute: vi.fn(async () => {}),
	executeWithChanges: vi.fn(async (_db: unknown, sql: string, params: unknown[]) => {
		calls.rebindSql.push(sql);
		calls.rebindParams.push(params);
		return 1;
	}),
	queryAll: vi.fn(async () => [
		{ name: "credits_frozen" },
		{ name: "max_members" },
		{ name: "phone" },
		{ name: "api_key_id" },
	]),
	queryOne: vi.fn(async () => null),
}));

describe("team credit ledger api_key_id", () => {
	beforeEach(() => {
		calls.charge.length = 0;
		calls.deduct.length = 0;
		calls.reserve.length = 0;
		calls.reserveUpToAvailable.length = 0;
		calls.rebindSql.length = 0;
		calls.rebindParams.length = 0;
	});

	it("forwards apiKeyId when settling a reserved deduction", async () => {
		const { tryDeductTeamCreditsOnce } = await import("./team.repo");
		await tryDeductTeamCreditsOnce({} as never, {
			teamId: "t1",
			amount: 5,
			taskId: "task-1",
			taskKind: "agents_chat",
			actorUserId: "u1",
			note: null,
			nowIso: "2026-06-17T00:00:00Z",
			apiKeyId: "key-1",
		});
		expect(calls.deduct).toHaveLength(1);
		expect(calls.deduct[0]).toMatchObject({ apiKeyId: "key-1", taskId: "task-1" });
	});

	it("forwards apiKeyId on a direct charge", async () => {
		const { tryChargeTeamCreditsOnce } = await import("./team.repo");
		await tryChargeTeamCreditsOnce({} as never, {
			teamId: "t1",
			amount: 5,
			taskId: "task-2",
			taskKind: "agents_chat",
			actorUserId: "u1",
			note: null,
			nowIso: "2026-06-17T00:00:00Z",
			apiKeyId: "key-2",
		});
		expect(calls.charge).toHaveLength(1);
		expect(calls.charge[0]).toMatchObject({ apiKeyId: "key-2", taskId: "task-2" });
	});

	it("forwards apiKeyId when reserving concrete credit batches", async () => {
		const { tryReserveTeamCreditsOnce } = await import("./team.repo");
		const result = await tryReserveTeamCreditsOnce({} as never, {
			teamId: "t1",
			amount: 5,
			taskId: "task-3",
			taskKind: "text_to_video",
			actorUserId: "u1",
			note: null,
			nowIso: "2026-06-25T00:00:00Z",
			apiKeyId: "key-3",
		});
		expect(result.reserved).toBe(true);
		expect(calls.reserve[0]).toMatchObject({ apiKeyId: "key-3", taskId: "task-3" });
	});

	it("keeps JWT reservations unattributed to an API key", async () => {
		const { tryReserveTeamCreditsOnce } = await import("./team.repo");
		await tryReserveTeamCreditsOnce({} as never, {
			teamId: "t1",
			amount: 5,
			taskId: "task-4",
			taskKind: "text_to_video",
			actorUserId: "u1",
			note: null,
			nowIso: "2026-06-25T00:00:00Z",
		});
		expect(calls.reserve[0]?.apiKeyId).toBeUndefined();
	});

	it("forwards partial reservation bounds and apiKeyId", async () => {
		const { tryReserveTeamCreditsUpToAvailableOnce } = await import("./team.repo");
		const result = await tryReserveTeamCreditsUpToAvailableOnce({} as never, {
			teamId: "t1",
			targetAmount: 500,
			minimumAmount: 1,
			taskId: "turn-1",
			taskKind: "agents_chat",
			actorUserId: "u1",
			nowIso: "2026-08-21T00:00:00Z",
			apiKeyId: "key-4",
		});
		expect(result).toEqual({ status: "reserved", amount: 3 });
		expect(calls.reserveUpToAvailable[0]).toMatchObject({
			amount: 500,
			minimumAmount: 1,
			taskId: "turn-1",
			apiKeyId: "key-4",
		});
	});

	it("rebinds the complete reservation lifecycle atomically", async () => {
		const { rebindTeamCreditReservationTaskId } = await import("./team.repo");
		await expect(rebindTeamCreditReservationTaskId({} as never, {
			teamId: "team-1",
			fromTaskId: "reservation-1",
			toTaskId: "provider-task-1",
		})).resolves.toEqual({ ok: true });

		const sql = calls.rebindSql.at(-1) ?? "";
		expect(sql).toContain("entry_type IN ('reserve', 'deduct', 'release')");
		expect(sql).not.toContain("entry_type = ?");
		expect(calls.rebindParams.at(-1)).toEqual([
			"provider-task-1",
			"team-1",
			"reservation-1",
		]);
	});
});
