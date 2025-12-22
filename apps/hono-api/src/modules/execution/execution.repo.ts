import type { D1Database } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";
import type {
	WorkflowExecutionDto,
	WorkflowExecutionEventDto,
	WorkflowNodeRunDto,
} from "./execution.schemas";

export type ExecutionRow = {
	id: string;
	flow_id: string;
	flow_version_id: string;
	owner_id: string;
	status: string;
	concurrency: number;
	trigger: string | null;
	error_message: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type NodeRunRow = {
	id: string;
	execution_id: string;
	node_id: string;
	status: string;
	attempt: number;
	error_message: string | null;
	output_refs: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type ExecutionEventRow = {
	id: string;
	execution_id: string;
	seq: number;
	event_type: string;
	level: string;
	node_id: string | null;
	message: string | null;
	data: string | null;
	created_at: string;
};

export function mapExecutionRow(row: ExecutionRow): WorkflowExecutionDto {
	return {
		id: row.id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		ownerId: row.owner_id,
		status: row.status as any,
		concurrency: Number(row.concurrency || 1),
		trigger: row.trigger,
		errorMessage: row.error_message,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function mapNodeRunRow(row: NodeRunRow): WorkflowNodeRunDto {
	let outputRefs: unknown = undefined;
	if (row.output_refs) {
		try {
			outputRefs = JSON.parse(row.output_refs);
		} catch {
			outputRefs = row.output_refs;
		}
	}
	return {
		id: row.id,
		executionId: row.execution_id,
		nodeId: row.node_id,
		status: row.status as any,
		attempt: Number(row.attempt || 1),
		errorMessage: row.error_message,
		outputRefs,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function mapExecutionEventRow(
	row: ExecutionEventRow,
): WorkflowExecutionEventDto {
	let data: unknown = undefined;
	if (row.data) {
		try {
			data = JSON.parse(row.data);
		} catch {
			data = row.data;
		}
	}
	return {
		id: row.id,
		executionId: row.execution_id,
		seq: Number(row.seq),
		eventType: row.event_type as any,
		level: row.level as any,
		nodeId: row.node_id,
		message: row.message,
		data,
		createdAt: row.created_at,
	};
}

export async function createExecution(
	db: D1Database,
	params: {
		id: string;
		flowId: string;
		flowVersionId: string;
		ownerId: string;
		concurrency: number;
		trigger?: string | null;
		nowIso: string;
	},
): Promise<void> {
	const { id, flowId, flowVersionId, ownerId, concurrency, trigger, nowIso } =
		params;
	await execute(
		db,
		`INSERT INTO workflow_executions
     (id, flow_id, flow_version_id, owner_id, status, concurrency, trigger, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
		[id, flowId, flowVersionId, ownerId, concurrency, trigger ?? null, nowIso],
	);
}

export async function getExecutionForOwner(
	db: D1Database,
	executionId: string,
	ownerId: string,
): Promise<ExecutionRow | null> {
	return queryOne<ExecutionRow>(
		db,
		`SELECT id, flow_id, flow_version_id, owner_id, status, concurrency, trigger, error_message, created_at, started_at, finished_at
     FROM workflow_executions
     WHERE id = ? AND owner_id = ?`,
		[executionId, ownerId],
	);
}

export async function getExecutionById(
	db: D1Database,
	executionId: string,
): Promise<ExecutionRow | null> {
	return queryOne<ExecutionRow>(
		db,
		`SELECT id, flow_id, flow_version_id, owner_id, status, concurrency, trigger, error_message, created_at, started_at, finished_at
     FROM workflow_executions
     WHERE id = ?`,
		[executionId],
	);
}

export async function listExecutionsForOwnerFlow(
	db: D1Database,
	params: { ownerId: string; flowId: string; limit?: number },
): Promise<ExecutionRow[]> {
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 30)));
	return queryAll<ExecutionRow>(
		db,
		`SELECT id, flow_id, flow_version_id, owner_id, status, concurrency, trigger, error_message, created_at, started_at, finished_at
     FROM workflow_executions
     WHERE owner_id = ? AND flow_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
		[params.ownerId, params.flowId, limit],
	);
}

export async function listNodeRunsForExecutionOwner(
	db: D1Database,
	params: { ownerId: string; executionId: string },
): Promise<NodeRunRow[]> {
	return queryAll<NodeRunRow>(
		db,
		`SELECT nr.id, nr.execution_id, nr.node_id, nr.status, nr.attempt, nr.error_message, nr.output_refs, nr.created_at, nr.started_at, nr.finished_at
     FROM workflow_node_runs nr
     JOIN workflow_executions e ON e.id = nr.execution_id
     WHERE nr.execution_id = ? AND e.owner_id = ?
     ORDER BY nr.created_at ASC`,
		[params.executionId, params.ownerId],
	);
}

export async function updateExecutionStatus(
	db: D1Database,
	params: {
		executionId: string;
		status: string;
		errorMessage?: string | null;
		startedAt?: string | null;
		finishedAt?: string | null;
	},
): Promise<void> {
	const { executionId, status, errorMessage, startedAt, finishedAt } = params;
	await execute(
		db,
		`UPDATE workflow_executions
     SET status = ?,
         error_message = COALESCE(?, error_message),
         started_at = COALESCE(?, started_at),
         finished_at = COALESCE(?, finished_at)
     WHERE id = ?`,
		[status, errorMessage ?? null, startedAt ?? null, finishedAt ?? null, executionId],
	);
}

export async function ensureNodeRuns(
	db: D1Database,
	params: { executionId: string; nodeIds: string[]; nowIso: string },
): Promise<void> {
	const { executionId, nodeIds, nowIso } = params;
	for (const nodeId of nodeIds) {
		const id = crypto.randomUUID();
		await execute(
			db,
			`INSERT OR IGNORE INTO workflow_node_runs
       (id, execution_id, node_id, status, attempt, created_at)
       VALUES (?, ?, ?, 'queued', 1, ?)`,
			[id, executionId, nodeId, nowIso],
		);
	}
}

export async function updateNodeRun(
	db: D1Database,
	params: {
		executionId: string;
		nodeId: string;
		status: string;
		errorMessage?: string | null;
		outputRefs?: unknown;
		startedAt?: string | null;
		finishedAt?: string | null;
	},
): Promise<void> {
	const output = params.outputRefs
		? (() => {
				try {
					return JSON.stringify(params.outputRefs);
				} catch {
					return String(params.outputRefs);
				}
			})()
		: null;
	await execute(
		db,
		`UPDATE workflow_node_runs
     SET status = ?,
         error_message = COALESCE(?, error_message),
         output_refs = COALESCE(?, output_refs),
         started_at = COALESCE(?, started_at),
         finished_at = COALESCE(?, finished_at)
     WHERE execution_id = ? AND node_id = ?`,
		[
			params.status,
			params.errorMessage ?? null,
			output,
			params.startedAt ?? null,
			params.finishedAt ?? null,
			params.executionId,
			params.nodeId,
		],
	);
}

export async function insertExecutionEvent(
	db: D1Database,
	params: {
		id: string;
		executionId: string;
		seq: number;
		eventType: string;
		level?: string;
		nodeId?: string | null;
		message?: string | null;
		data?: unknown;
		nowIso: string;
	},
): Promise<void> {
	const payload =
		params.data != null
			? (() => {
					try {
						return JSON.stringify(params.data);
					} catch {
						return String(params.data);
					}
				})()
			: null;
	await execute(
		db,
		`INSERT INTO workflow_execution_events
     (id, execution_id, seq, event_type, level, node_id, message, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			params.id,
			params.executionId,
			params.seq,
			params.eventType,
			params.level || "info",
			params.nodeId ?? null,
			params.message ?? null,
			payload,
			params.nowIso,
		],
	);
}

export async function listExecutionEvents(
	db: D1Database,
	params: { executionId: string; afterSeq: number; limit: number },
): Promise<ExecutionEventRow[]> {
	const limit = Math.max(1, Math.min(200, Math.floor(params.limit || 50)));
	return queryAll<ExecutionEventRow>(
		db,
		`SELECT id, execution_id, seq, event_type, level, node_id, message, data, created_at
     FROM workflow_execution_events
     WHERE execution_id = ? AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`,
		[params.executionId, params.afterSeq, limit],
	);
}
