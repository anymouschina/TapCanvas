import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTINUATION_SETTLEMENT_PROTOCOL_VERSION } from "./agents-continuation-settlement";

describe("agent runtime operational contract", () => {
	it("pins the settlement protocol and deployment assertions", () => {
		expect(CONTINUATION_SETTLEMENT_PROTOCOL_VERSION).toBe(1);
		const migration = readFileSync(
			resolve(
				process.cwd(),
				"prisma/migrations/20260820183000_assert_agent_runtime_operational_contract/migration.sql",
			),
			"utf8",
		);
		expect(migration).toContain("task_statuses_task_id_provider_key");
		expect(migration).toContain("idx_task_statuses_provider_status_updated");
		expect(migration).toContain("RAISE EXCEPTION");
	});
});
