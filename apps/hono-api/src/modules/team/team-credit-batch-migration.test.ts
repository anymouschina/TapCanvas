import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
	new URL("../../../prisma/migrations/20260723000000_credit_batches_expiry_order/migration.sql", import.meta.url),
	"utf8",
);
const consistencyMigrationSql = readFileSync(
	new URL(
		"../../../prisma/migrations/20260803170000_enforce_credit_batch_consistency/migration.sql",
		import.meta.url,
	),
	"utf8",
);
const triggerKeyFixMigrationSql = readFileSync(
	new URL(
		"../../../prisma/migrations/20260803171000_fix_credit_consistency_trigger_keys/migration.sql",
		import.meta.url,
	),
	"utf8",
);
const netReservationMigrationSql = readFileSync(
	new URL(
		"../../../prisma/migrations/20260805113000_fix_credit_reservation_net_consistency/migration.sql",
		import.meta.url,
	),
	"utf8",
);
const directDeductionReservationMigrationSql = readFileSync(
	new URL(
		"../../../prisma/migrations/20260813120000_fix_direct_credit_deduction_reservation_consistency/migration.sql",
		import.meta.url,
	),
	"utf8",
);
const ledgerTaskLookupReindexMigrationSql = readFileSync(
	new URL(
		"../../../prisma/migrations/20260813190000_reindex_credit_ledger_task_lookup/migration.sql",
		import.meta.url,
	),
	"utf8",
);

describe("credit batch hard-cutover migration", () => {
	it("preserves aggregate frozen credit without assigning it to a historical task", () => {
		expect(migrationSql).toContain("legacy_frozen_balance");
		expect(migrationSql).toContain("Unattributed frozen balance preserved at credit-batch hard cutover");
		expect(migrationSql).not.toContain("ROW_NUMBER() OVER (PARTITION BY r.\"team_id\"");
		expect(migrationSql).not.toContain("r.\"amount\" - COALESCE(s.\"settled\", 0)");
	});

	it("reconciles only rows created by the superseded legacy backfill", () => {
		expect(migrationSql).toContain("allocation.\"id\" LIKE 'legacy_reserve:%'");
		expect(migrationSql).toContain("allocation.\"id\" LIKE 'legacy_frozen_allocation:%'");
		expect(migrationSql).toContain("credit batch cutover residual invalid");
	});
});

describe("credit batch commit-time consistency migration", () => {
	it("repairs only settlements backed by an open reserve allocation", () => {
		expect(consistencyMigrationSql).toContain("JOIN \"team_credit_ledger\" reserve_ledger");
		expect(consistencyMigrationSql).toContain("settlement_repair:");
		expect(consistencyMigrationSql).toContain("credit settlement allocation repair incomplete");
		expect(consistencyMigrationSql).not.toContain("personal_phone_");
	});

	it("defers aggregate and ledger allocation checks until transaction commit", () => {
		expect(consistencyMigrationSql).toContain("DEFERRABLE INITIALLY DEFERRED");
		expect(consistencyMigrationSql).toContain("credit batch commit mismatch");
		expect(consistencyMigrationSql).toContain("credit reservation commit mismatch");
		expect(consistencyMigrationSql).toContain("credit ledger allocation commit mismatch");
	});

	it("resolves trigger keys without referencing columns absent from another table", () => {
		expect(triggerKeyFixMigrationSql).toContain("to_jsonb(NEW)");
		expect(triggerKeyFixMigrationSql).toContain("new_row ->> 'team_id'");
		expect(triggerKeyFixMigrationSql).toContain("new_row ->> 'ledger_entry_id'");
		expect(triggerKeyFixMigrationSql).not.toContain('NEW."team_id"');
	});

	it("checks reservation counters against net batch allocations", () => {
		expect(netReservationMigrationSql).toContain("reserve adds, deduct/release removes");
		expect(netReservationMigrationSql).toContain("WHEN ledger.\"entry_type\" = 'reserve' THEN allocation.\"amount\"");
		expect(netReservationMigrationSql).toContain("WHEN ledger.\"entry_type\" IN ('deduct', 'release') THEN -allocation.\"amount\"");
		expect(netReservationMigrationSql).not.toContain("GREATEST(0, reserve_allocation");
	});

	it("excludes direct balance deductions while retaining matched reservation settlements", () => {
		expect(directDeductionReservationMigrationSql).toContain(
			'JOIN "team_credit_allocations" reserve_allocation',
		);
		expect(directDeductionReservationMigrationSql).toContain(
			'reserve_allocation."batch_id" = allocation."batch_id"',
		);
		expect(directDeductionReservationMigrationSql).toContain(
			'reserve_ledger."task_id" = ledger."task_id"',
		);
		expect(directDeductionReservationMigrationSql).not.toContain("personal_phone_");
	});

	it("rebuilds the corrupted task lookup without rewriting accounting data", () => {
		expect(ledgerTaskLookupReindexMigrationSql).toContain(
			'REINDEX INDEX "team_credit_ledger_team_id_entry_type_task_id_key"',
		);
		expect(ledgerTaskLookupReindexMigrationSql).toContain(
			"credit reservation mismatch remains after ledger task lookup reindex",
		);
		expect(ledgerTaskLookupReindexMigrationSql).not.toMatch(
			/UPDATE\s+"?(teams|team_credit_batches|team_credit_ledger|team_credit_allocations)"?/i,
		);
		expect(ledgerTaskLookupReindexMigrationSql).not.toContain("personal_phone_");
	});
});
