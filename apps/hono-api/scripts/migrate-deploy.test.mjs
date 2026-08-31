import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	parseManualOperationRecoveryContract,
	selectRecoverableManualOperationFailures,
} from "./migrate-deploy-contract.mjs";

describe("manual-operation Prisma migration recovery", () => {
	it("loads the recovery contract from the production migration", () => {
		const migrationName = "20260814130000_migrate_agent_session_events_v1";
		const migrationSql = readFileSync(
			new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url),
			"utf8",
		);
		assert.deepEqual(parseManualOperationRecoveryContract(migrationName, migrationSql), {
			migrationName,
			failedAssertionSignature: "AgentSessionEvent@1 hard cutover is incomplete",
		});
		assert.doesNotMatch(migrationSql, /RAISE\s+EXCEPTION/iu);
		assert.doesNotMatch(migrationSql, /FROM\s+"agent_session_messages"/iu);
	});

	it("selects only a failed assertion explicitly declared by the current migration", () => {
		const contract = parseManualOperationRecoveryContract(
			"20260814130000_migrate_agent_session_events_v1",
			[
				"-- tapcanvas:manual-operation",
				"-- tapcanvas:recover-failed-assertion=AgentSessionEvent@1 hard cutover is incomplete",
				"DO $$ BEGIN RAISE NOTICE 'manual'; END $$;",
			].join("\n"),
		);
		assert.notEqual(contract, null);
		const contracts = new Map([[contract.migrationName, contract]]);
		assert.deepEqual(
			selectRecoverableManualOperationFailures(
				[
					{
						migration_name: contract.migrationName,
						logs: "ERROR: AgentSessionEvent@1 hard cutover is incomplete",
					},
					{ migration_name: contract.migrationName, logs: "ERROR: connection terminated" },
					{ migration_name: "unrelated_failure", logs: contract.failedAssertionSignature },
				],
				contracts,
			),
			[
				{
					migration_name: contract.migrationName,
					logs: "ERROR: AgentSessionEvent@1 hard cutover is incomplete",
				},
			],
		);
	});

	it("rejects ambiguous manual-operation recovery metadata", () => {
		assert.throws(
			() =>
				parseManualOperationRecoveryContract(
					"ambiguous",
					[
						"-- tapcanvas:manual-operation",
						"-- tapcanvas:recover-failed-assertion=first",
						"-- tapcanvas:recover-failed-assertion=second",
					].join("\n"),
				),
			/exactly one failed assertion signature/u,
		);
	});

	it("does not create recovery authority without the manual-operation marker", () => {
		assert.equal(
			parseManualOperationRecoveryContract(
				"ordinary",
				"-- tapcanvas:recover-failed-assertion=ordinary failure",
			),
			null,
		);
	});
});
