import type { PrismaClient } from "../../types";
import { queryAll } from "../../db/db";

const REQUIRED_COLUMNS = new Map<string, readonly string[]>([
	["execution_traces", [
		"id",
		"user_id",
		"status",
		"started_at",
		"updated_at",
		"next_event_seq",
		"logical_task_id",
		"root_trace_id",
		"parent_trace_id",
	]],
	["execution_trace_events", [
		"id",
		"trace_id",
		"seq",
		"producer_event_id",
		"event_class",
		"payload_json",
		"payload_size_bytes",
		"payload_truncated",
		"root_trace_id",
		"workflow_run_id",
		"workflow_node_id",
		"tool_call_id",
	]],
]);

type SchemaColumnRow = {
	table_name: string;
	column_name: string;
};

const readyClients = new WeakSet<object>();

/**
 * Fail-fast deploy readiness check for the durable execution journal.
 *
 * This deliberately performs SELECT-only introspection. Schema creation and
 * repair belong to Prisma deploy migrations, never to a public chat request.
 */
export async function assertExecutionTraceSchemaReady(db: PrismaClient): Promise<void> {
	if (readyClients.has(db)) return;
	const rows = await queryAll<SchemaColumnRow>(
		db,
		`SELECT table_name, column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'public'
		   AND table_name IN ('execution_traces', 'execution_trace_events')`,
	);
	const actual = new Map<string, Set<string>>();
	for (const row of rows) {
		const columns = actual.get(row.table_name) ?? new Set<string>();
		columns.add(row.column_name);
		actual.set(row.table_name, columns);
	}
	const missing: string[] = [];
	for (const [table, columns] of REQUIRED_COLUMNS) {
		for (const column of columns) {
			if (!actual.get(table)?.has(column)) missing.push(`${table}.${column}`);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`execution_trace_schema_not_ready:${missing.join(",")}; deploy Prisma migrations through 20260810140000_execution_trace_payload_metadata`,
		);
	}
	readyClients.add(db);
}
