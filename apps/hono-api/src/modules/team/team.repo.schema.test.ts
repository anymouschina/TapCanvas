import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
	executeSql: [] as string[],
	queryOneSql: [] as string[],
	queryAllSql: [] as string[],
	reservationMismatch: false,
	danglingRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../db/db", () => ({
	execute: vi.fn(async (_db: unknown, sql: string) => {
		captured.executeSql.push(sql);
	}),
	executeWithChanges: vi.fn(async () => 1),
	queryAll: vi.fn(async (_db: unknown, sql: string) => {
		captured.queryAllSql.push(sql);
		if (sql.startsWith("PRAGMA table_info(teams)")) {
			return [{ name: "credits_frozen" }, { name: "max_members" }];
		}
		if (sql.startsWith("PRAGMA table_info(team_invites)")) return [{ name: "phone" }];
		if (sql.startsWith("PRAGMA table_info(team_credit_ledger)")) return [{ name: "api_key_id" }];
		if (sql.includes("FROM (\n       SELECT r.team_id, r.task_id, r.task_kind")) return captured.danglingRows;
		return [];
	}),
	queryOne: vi.fn(async (_db: unknown, sql: string) => {
		captured.queryOneSql.push(sql);
		if (captured.reservationMismatch && sql.includes("credit_allocations allocation")) {
			return {
				team_id: "team-legacy",
				batch_reserved: 10995,
				allocated_reserved: 10997,
			};
		}
		return null;
	}),
}));

describe("ensureTeamSchema credit reservation invariant", () => {
	beforeEach(() => {
		captured.executeSql.length = 0;
		captured.queryOneSql.length = 0;
		captured.queryAllSql.length = 0;
		captured.reservationMismatch = false;
		captured.danglingRows = [];
		vi.resetModules();
	});

	it("only verifies migrated credit batches and never replays historical ledger rows", async () => {
		const { ensureTeamSchema } = await import("./team.repo");
		await ensureTeamSchema({} as never);

		expect(captured.executeSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS team_credit_batches"))).toBe(false);
		expect(captured.executeSql.some((sql) => sql.includes("INSERT INTO team_credit_batches"))).toBe(false);
		expect(captured.executeSql.some((sql) => sql.includes("INSERT INTO team_credit_allocations"))).toBe(false);

		const reservationQuery = captured.queryOneSql.find((sql) => (
			sql.includes("credit_allocations allocation")
		));
		expect(reservationQuery).toBeDefined();
		expect(reservationQuery).toContain("ledger.entry_type = 'reserve'");
		expect(reservationQuery).toContain("ledger.entry_type IN ('deduct', 'release')");
		expect(reservationQuery).toContain("JOIN team_credit_allocations reserve_allocation");
		expect(reservationQuery).toContain("reserve_allocation.batch_id = allocation.batch_id");
		expect(reservationQuery).toContain("reserve_ledger.task_id = ledger.task_id");
		expect(reservationQuery).toContain("GROUP BY b.id, b.team_id, b.reserved_amount");
		expect(reservationQuery).not.toContain("b.source_type = 'legacy_balance'");
		expect(reservationQuery).toContain("-allocation.amount");
	});

	it("reports a historical reservation mismatch without blocking project reads", async () => {
		captured.reservationMismatch = true;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { ensureTeamSchema } = await import("./team.repo");

		await expect(ensureTeamSchema({} as never)).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith(
			"[team-schema] credit reservation invariant mismatch",
			expect.objectContaining({
				teamId: "team-legacy",
				batchReserved: 10995,
				allocatedReserved: 10997,
			}),
		);
		errorSpy.mockRestore();
	});

	it("returns only the remaining allocation and includes legacy chat reservations", async () => {
		captured.danglingRows = [{
			team_id: "team-1",
			task_id: "task-partial",
			task_kind: "chat",
			amount: 1502,
			actor_user_id: "user-1",
		}];
		const { findDanglingChatReservations } = await import("./team.repo");

		await expect(findDanglingChatReservations({} as never, {
			olderThanIso: "2026-08-27T00:00:00.000Z",
			limit: 50,
		})).resolves.toEqual([{
			teamId: "team-1",
			taskId: "task-partial",
			taskKind: "chat",
			amount: 1502,
			actorUserId: "user-1",
		}]);

		const danglingQuery = captured.queryAllSql.find((sql) => sql.includes("pending_amount"));
		expect(danglingQuery).toContain("task_kind IN ('agents_chat', 'chat')");
		expect(danglingQuery).toContain("team_credit_allocations reserve_allocation");
		expect(danglingQuery).toContain("pending_amount > 0");
		expect(danglingQuery).not.toContain("NOT EXISTS (");
	});
});
