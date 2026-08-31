import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";

const dbMocks = vi.hoisted(() => ({
	queryAll: vi.fn(async (_db: unknown, _sql: string): Promise<unknown[]> => []),
}));

vi.mock("../../db/db", () => dbMocks);

import { assertExecutionTraceSchemaReady } from "./execution-trace-schema";

const REQUIRED = {
	execution_traces: [
		"id", "user_id", "status", "started_at", "updated_at", "next_event_seq",
		"logical_task_id", "root_trace_id", "parent_trace_id",
	],
	execution_trace_events: [
		"id", "trace_id", "seq", "producer_event_id", "event_class", "payload_json",
		"payload_size_bytes", "payload_truncated", "root_trace_id", "workflow_run_id", "workflow_node_id", "tool_call_id",
	],
} as const;

const JOURNAL_MIGRATION_URLS = [
	new URL("../../../prisma/migrations/20260810130000_execution_trace_event_journal/migration.sql", import.meta.url),
	new URL("../../../prisma/migrations/20260810140000_execution_trace_payload_metadata/migration.sql", import.meta.url),
] as const;

function journalAddColumnRepairs(): Array<{ tableName: string; columnName: string }> {
	const migrationSql = JOURNAL_MIGRATION_URLS
		.map((url) => readFileSync(url, "utf8"))
		.join("\n");
	const repairs: Array<{ tableName: string; columnName: string }> = [];
	const addColumnPattern = /ALTER TABLE\s+"?(execution_traces|execution_trace_events)"?\s+ADD COLUMN IF NOT EXISTS\s+"?([a-z0-9_]+)"?/gi;
	for (const match of migrationSql.matchAll(addColumnPattern)) {
		const tableName = match[1];
		const columnName = match[2];
		if (!tableName || !columnName) throw new Error("invalid execution journal ADD COLUMN migration");
		repairs.push({ tableName, columnName });
	}
	return repairs;
}

function readyRows(): Array<{ table_name: string; column_name: string }> {
	return Object.entries(REQUIRED).flatMap(([table_name, columns]) => (
		columns.map((column_name) => ({ table_name, column_name }))
	));
}

describe("execution trace schema readiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("accepts the migrated event journal without issuing DDL", async () => {
		dbMocks.queryAll.mockResolvedValueOnce(readyRows());
		await assertExecutionTraceSchemaReady({} as unknown as PrismaClient);
		expect(dbMocks.queryAll).toHaveBeenCalledOnce();
		expect(String(dbMocks.queryAll.mock.calls[0]?.[1])).toContain("information_schema.columns");
		expect(String(dbMocks.queryAll.mock.calls[0]?.[1])).not.toMatch(/CREATE|ALTER/i);
	});

	it("fails explicitly when deploy migrations have not prepared the journal", async () => {
		dbMocks.queryAll.mockResolvedValueOnce(readyRows().filter((row) => row.column_name !== "producer_event_id"));
		await expect(assertExecutionTraceSchemaReady({} as unknown as PrismaClient)).rejects.toThrow(
			"execution_trace_events.producer_event_id",
		);
	});

	it("repairs runtime-era journal columns before creating indexes", () => {
		const schemaSql = readFileSync(new URL("../../../schema.sql", import.meta.url), "utf8")
			.replace(/\s+/g, " ")
			.toLowerCase();
		const repairs = journalAddColumnRepairs();
		expect(repairs.length).toBeGreaterThan(0);

		for (const { tableName, columnName } of repairs) {
			const createTablePosition = schemaSql.indexOf(`create table if not exists ${tableName}`);
			const firstIndexPosition = schemaSql.indexOf(" index if not exists", createTablePosition);
			expect(createTablePosition, `${tableName} create table statement`).toBeGreaterThanOrEqual(0);
			expect(firstIndexPosition, `${tableName} first index statement`).toBeGreaterThan(createTablePosition);

			const repairPosition = schemaSql.indexOf(
				`alter table ${tableName} add column if not exists ${columnName}`,
				createTablePosition,
			);
			expect(repairPosition, `${tableName}.${columnName} additive repair`).toBeGreaterThan(createTablePosition);
			expect(repairPosition, `${tableName}.${columnName} repair before indexes`).toBeLessThan(firstIndexPosition);
		}
	});
});
