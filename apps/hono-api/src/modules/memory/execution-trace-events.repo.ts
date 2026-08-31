import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../types";
import { execute, executeWithChanges, queryAll, queryOne } from "../../db/db";
import {
	sanitizeExecutionTraceEventPayload,
	sanitizeExecutionTraceEventPayloadWithMeta,
} from "./execution-trace-event-sanitizer";
import { assertExecutionTraceSchemaReady } from "./execution-trace-schema";

export type ExecutionTraceRunStatus =
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "waiting_async";

export type ExecutionTraceLifecycleSnapshot = Readonly<{
	traceId: string;
	status: ExecutionTraceRunStatus;
	logicalTaskId: string;
	rootTraceId: string;
	startedAt: string;
	updatedAt: string;
	finishedAt: string | null;
}>;

export type ExecutionTraceRunSweepResult = {
	scanned: number;
	succeeded: number;
	failed: number;
	cancelled: number;
	waitingAsync: number;
	errors: Array<{ traceId: string; message: string }>;
};

export type ExecutionTraceEventRow = {
	id: string;
	trace_id: string;
	user_id: string;
	seq: number;
	producer_event_id: string;
	event_type: string;
	event_class: string;
	event_key: string;
	phase: string | null;
	status: string | null;
	logical_task_id: string | null;
	root_trace_id: string | null;
	parent_trace_id: string | null;
	physical_run_id: string | null;
	workflow_run_id: string | null;
	workflow_node_id: string | null;
	agent_id: string | null;
	parent_agent_id: string | null;
	tool_call_id: string | null;
	effect_id: string | null;
	provider_task_id: string | null;
	span_id: string | null;
	parent_span_id: string | null;
	attempt: number | null;
	payload_json: string;
	payload_size_bytes: number;
	payload_truncated: boolean;
	created_at: string;
};

export type ExecutionTraceEvent = {
	id: string;
	traceId: string;
	seq: number;
	producerEventId: string;
	eventType: string;
	eventClass: string;
	eventKey: string;
	phase: string | null;
	status: string | null;
	logicalTaskId: string | null;
	rootTraceId: string | null;
	parentTraceId: string | null;
	physicalRunId: string | null;
	workflowRunId: string | null;
	workflowNodeId: string | null;
	agentId: string | null;
	parentAgentId: string | null;
	toolCallId: string | null;
	effectId: string | null;
	providerTaskId: string | null;
	spanId: string | null;
	parentSpanId: string | null;
	attempt: number | null;
	payload: Record<string, unknown>;
	payloadSizeBytes: number;
	payloadTruncated: boolean;
	createdAt: string;
};

export type ExecutionTraceEventCorrelation = {
	logicalTaskId?: string | null;
	rootTraceId?: string | null;
	parentTraceId?: string | null;
	physicalRunId?: string | null;
	workflowRunId?: string | null;
	workflowNodeId?: string | null;
	agentId?: string | null;
	parentAgentId?: string | null;
	toolCallId?: string | null;
	effectId?: string | null;
	providerTaskId?: string | null;
	spanId?: string | null;
	parentSpanId?: string | null;
	attempt?: number | null;
};

export type AppendExecutionTraceEventInput = ExecutionTraceEventCorrelation & {
	producerEventId: string;
	eventType: string;
	eventClass: string;
	eventKey: string;
	phase?: string | null;
	status?: string | null;
	payload: Record<string, unknown>;
};

export type ExecutionTraceIntegrityIssue = {
	code: string;
	severity: "warning" | "error";
	detail: string;
};

export type ExecutionTraceIntegrity = {
	status: "consistent" | "incomplete" | "inconsistent";
	requestAcceptedCount: number;
	terminalEventCount: number;
	persistedEventCount: number;
	latestPersistedSeq: number;
	issues: ExecutionTraceIntegrityIssue[];
};

export type ExecutionTraceHealth = {
	status: "healthy" | "degraded";
	staleAfterSeconds: number;
	totalTraceCount: number;
	runningTraceCount: number;
	waitingAsyncTraceCount: number;
	staleRunningTraceCount: number;
	sequenceMismatchCount: number;
	terminalIntegrityIssueCount: number;
	orphanParentTraceCount: number;
	persistenceDegradedTraceCount: number;
	totalEventCount: number;
	totalPayloadBytes: number;
	oldestActiveStartedAt: string | null;
	calculatedAt: string;
};

export type ExecutionTraceDiagnosticBundle = {
	schemaVersion: "tapcanvas.execution-diagnostic-bundle.v1";
	exportedAt: string;
	trace: {
		id: string;
		status: string;
		requestKind: string;
		scopeType: string;
		scopeId: string;
		logicalTaskId: string | null;
		rootTraceId: string | null;
		parentTraceId: string | null;
		physicalRunId: string | null;
		workflowRunId: string | null;
		startedAt: string;
		updatedAt: string;
		finishedAt: string | null;
		meta: Record<string, unknown> | null;
	};
	integrity: ExecutionTraceIntegrity;
	eventCount: number;
	includedEventCount: number;
	truncated: boolean;
	events: ExecutionTraceEvent[];
};

type ExecutionTraceDiagnosticRow = {
	id: string;
	status: string;
	request_kind: string;
	scope_type: string;
	scope_id: string;
	logical_task_id: string | null;
	root_trace_id: string | null;
	parent_trace_id: string | null;
	physical_run_id: string | null;
	workflow_run_id: string | null;
	started_at: string;
	updated_at: string;
	finished_at: string | null;
	meta_json: string | null;
};

type ExecutionTraceHealthRow = {
	total_trace_count: number;
	running_trace_count: number;
	waiting_async_trace_count: number;
	stale_running_trace_count: number;
	sequence_mismatch_count: number;
	terminal_integrity_issue_count: number;
	orphan_parent_trace_count: number;
	persistence_degraded_trace_count: number;
	total_event_count: number;
	total_payload_bytes: number;
	oldest_active_started_at: string | null;
};

type ExecutionTraceIntegrityFacts = {
	traceStatus: ExecutionTraceRunStatus;
	finishedAt: string | null;
	nextEventSeq: number;
	persistedEventCount: number;
	latestPersistedSeq: number;
	requestAcceptedCount: number;
	terminalEventCount: number;
};

export function evaluateExecutionTraceIntegrity(facts: ExecutionTraceIntegrityFacts): ExecutionTraceIntegrity {
	const issues: ExecutionTraceIntegrityIssue[] = [];
	if (facts.requestAcceptedCount !== 1) {
		issues.push({
			code: "request_accepted_count_invalid",
			severity: "error",
			detail: `expected exactly one request.accepted event, observed ${facts.requestAcceptedCount}`,
		});
	}
	if (facts.nextEventSeq !== facts.latestPersistedSeq || facts.persistedEventCount !== facts.latestPersistedSeq) {
		issues.push({
			code: "event_sequence_incomplete",
			severity: "error",
			detail: `trace next=${facts.nextEventSeq}, persisted=${facts.persistedEventCount}, latest=${facts.latestPersistedSeq}`,
		});
	}
	const traceIsRunning = facts.traceStatus === "running";
	if (traceIsRunning && facts.finishedAt !== null) {
		issues.push({
			code: "running_trace_has_finished_at",
			severity: "error",
			detail: "running trace has a terminal finished_at timestamp",
		});
	}
	if (!traceIsRunning && facts.finishedAt === null) {
		issues.push({
			code: "terminal_trace_missing_finished_at",
			severity: "error",
			detail: `trace status ${facts.traceStatus} has no finished_at timestamp`,
		});
	}
	if (!traceIsRunning && facts.terminalEventCount < 1) {
		issues.push({
			code: "terminal_trace_missing_terminal_event",
			severity: "error",
			detail: `trace status ${facts.traceStatus} has no persisted terminal event`,
		});
	}
	if (traceIsRunning && facts.terminalEventCount > 0) {
		issues.push({
			code: "running_trace_has_terminal_event",
			severity: "error",
			detail: `running trace already contains ${facts.terminalEventCount} terminal event(s)`,
		});
	}
	return {
		status: issues.some((issue) => issue.severity === "error")
			? (traceIsRunning ? "incomplete" : "inconsistent")
			: "consistent",
		requestAcceptedCount: facts.requestAcceptedCount,
		terminalEventCount: facts.terminalEventCount,
		persistedEventCount: facts.persistedEventCount,
		latestPersistedSeq: facts.latestPersistedSeq,
		issues,
	};
}

function parseEventPayload(row: ExecutionTraceEventRow): Record<string, unknown> {
	try {
		const parsed = JSON.parse(row.payload_json) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("payload_not_object");
		}
		return parsed as Record<string, unknown>;
	} catch (error: unknown) {
		throw new Error(
			`execution_trace_event_invalid_json:${row.trace_id}:${row.seq}:${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function normalizeEventRow(row: ExecutionTraceEventRow): ExecutionTraceEvent {
	return {
		id: row.id,
		traceId: row.trace_id,
		seq: Number(row.seq),
		producerEventId: row.producer_event_id,
		eventType: row.event_type,
		eventClass: row.event_class,
		eventKey: row.event_key,
		phase: row.phase,
		status: row.status,
		logicalTaskId: row.logical_task_id,
		rootTraceId: row.root_trace_id,
		parentTraceId: row.parent_trace_id,
		physicalRunId: row.physical_run_id,
		workflowRunId: row.workflow_run_id,
		workflowNodeId: row.workflow_node_id,
		agentId: row.agent_id,
		parentAgentId: row.parent_agent_id,
		toolCallId: row.tool_call_id,
		effectId: row.effect_id,
		providerTaskId: row.provider_task_id,
		spanId: row.span_id,
		parentSpanId: row.parent_span_id,
		attempt: row.attempt === null ? null : Number(row.attempt),
		payload: parseEventPayload(row),
		payloadSizeBytes: Number(row.payload_size_bytes),
		payloadTruncated: row.payload_truncated === true,
		createdAt: row.created_at,
	};
}

export async function queryExecutionTraceHealth(
	db: PrismaClient,
	input: { userId: string; staleAfterSeconds?: number },
): Promise<ExecutionTraceHealth> {
	await assertExecutionTraceSchemaReady(db);
	const staleAfterSeconds = Math.max(60, Math.min(86_400, Math.trunc(input.staleAfterSeconds ?? 900)));
	const calculatedAt = new Date();
	const staleBefore = new Date(calculatedAt.getTime() - staleAfterSeconds * 1_000).toISOString();
	const row = await queryOne<ExecutionTraceHealthRow>(
		db,
		`WITH event_stats AS (
		   SELECT
		     trace_id,
		     COUNT(*)::bigint AS event_count,
		     MAX(seq)::bigint AS latest_seq,
		     COALESCE(SUM(payload_size_bytes), 0)::bigint AS payload_bytes,
		     COUNT(*) FILTER (WHERE event_type IN (
		       'response.completed', 'execution.failed', 'execution.cancelled'
		     ))::bigint AS terminal_event_count
		   FROM execution_trace_events
		   WHERE user_id = ?
		   GROUP BY trace_id
		 )
		 SELECT
		   COUNT(*)::bigint AS total_trace_count,
		   COUNT(*) FILTER (WHERE trace.status = 'running')::bigint AS running_trace_count,
		   COUNT(*) FILTER (WHERE trace.status = 'waiting_async')::bigint AS waiting_async_trace_count,
		   COUNT(*) FILTER (
		     WHERE trace.status = 'running' AND trace.updated_at < ?
		   )::bigint AS stale_running_trace_count,
		   COUNT(*) FILTER (
		     WHERE trace.next_event_seq <> COALESCE(events.latest_seq, 0)
		        OR COALESCE(events.event_count, 0) <> COALESCE(events.latest_seq, 0)
		   )::bigint AS sequence_mismatch_count,
		   COUNT(*) FILTER (
		     WHERE (trace.status = 'running' AND (
		              trace.finished_at IS NOT NULL OR COALESCE(events.terminal_event_count, 0) > 0
		            ))
		        OR (trace.status <> 'running' AND (
		              trace.finished_at IS NULL OR COALESCE(events.terminal_event_count, 0) < 1
		            ))
		   )::bigint AS terminal_integrity_issue_count,
		   COUNT(*) FILTER (
		     WHERE trace.parent_trace_id IS NOT NULL AND parent.id IS NULL
		   )::bigint AS orphan_parent_trace_count,
		   COUNT(*) FILTER (
		     WHERE trace.meta_json IS NOT NULL
		       AND trace.meta_json::jsonb #>> '{executionEventPersistence,status}' = 'degraded'
		   )::bigint AS persistence_degraded_trace_count,
		   COALESCE(SUM(events.event_count), 0)::bigint AS total_event_count,
		   COALESCE(SUM(events.payload_bytes), 0)::bigint AS total_payload_bytes,
		   MIN(trace.started_at) FILTER (
		     WHERE trace.status IN ('running', 'waiting_async')
		   ) AS oldest_active_started_at
		 FROM execution_traces trace
		 LEFT JOIN event_stats events ON events.trace_id = trace.id
		 LEFT JOIN execution_traces parent
		   ON parent.id = trace.parent_trace_id AND parent.user_id = trace.user_id
		 WHERE trace.user_id = ?
		   AND (
		     events.event_count IS NOT NULL
		     OR trace.request_kind = 'agents_bridge:public_chat'
		   )`,
		[input.userId, staleBefore, input.userId],
	);
	const normalized = {
		staleRunningTraceCount: Number(row?.stale_running_trace_count ?? 0),
		sequenceMismatchCount: Number(row?.sequence_mismatch_count ?? 0),
		terminalIntegrityIssueCount: Number(row?.terminal_integrity_issue_count ?? 0),
		orphanParentTraceCount: Number(row?.orphan_parent_trace_count ?? 0),
		persistenceDegradedTraceCount: Number(row?.persistence_degraded_trace_count ?? 0),
	};
	return {
		status: Object.values(normalized).some((count) => count > 0) ? "degraded" : "healthy",
		staleAfterSeconds,
		totalTraceCount: Number(row?.total_trace_count ?? 0),
		runningTraceCount: Number(row?.running_trace_count ?? 0),
		waitingAsyncTraceCount: Number(row?.waiting_async_trace_count ?? 0),
		...normalized,
		totalEventCount: Number(row?.total_event_count ?? 0),
		totalPayloadBytes: Number(row?.total_payload_bytes ?? 0),
		oldestActiveStartedAt: row?.oldest_active_started_at ?? null,
		calculatedAt: calculatedAt.toISOString(),
	};
}

function parseDiagnosticMeta(traceId: string, raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("meta_not_object");
		return value as Record<string, unknown>;
	} catch (error: unknown) {
		throw new Error(
			`execution_trace_invalid_meta:${traceId}:${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function getExecutionTraceDiagnosticBundle(
	db: PrismaClient,
	input: { traceId: string; userId: string; maxEvents?: number },
): Promise<ExecutionTraceDiagnosticBundle> {
	await assertExecutionTraceSchemaReady(db);
	const maxEvents = Math.max(1, Math.min(5_000, Math.trunc(input.maxEvents ?? 5_000)));
	const trace = await queryOne<ExecutionTraceDiagnosticRow>(
		db,
		`SELECT id, status, request_kind, scope_type, scope_id,
		        logical_task_id, root_trace_id, parent_trace_id, physical_run_id, workflow_run_id,
		        started_at, updated_at, finished_at, meta_json
		 FROM execution_traces
		 WHERE id = ? AND user_id = ?`,
		[input.traceId, input.userId],
	);
	if (!trace) throw new Error(`execution_trace_not_found:${input.traceId}`);
	const page = await listExecutionTraceEvents(db, {
		traceId: input.traceId,
		userId: input.userId,
		limit: 1,
	});
	const rows = await queryAll<ExecutionTraceEventRow>(
		db,
		`SELECT * FROM execution_trace_events
		 WHERE trace_id = ? AND user_id = ?
		 ORDER BY seq ASC
		 LIMIT ?`,
		[input.traceId, input.userId, maxEvents + 1],
	);
	const truncated = rows.length > maxEvents;
	const events = rows.slice(0, maxEvents).map(normalizeEventRow);
	return {
		schemaVersion: "tapcanvas.execution-diagnostic-bundle.v1",
		exportedAt: new Date().toISOString(),
		trace: {
			id: trace.id,
			status: trace.status,
			requestKind: trace.request_kind,
			scopeType: trace.scope_type,
			scopeId: trace.scope_id,
			logicalTaskId: trace.logical_task_id,
			rootTraceId: trace.root_trace_id,
			parentTraceId: trace.parent_trace_id,
			physicalRunId: trace.physical_run_id,
			workflowRunId: trace.workflow_run_id,
			startedAt: trace.started_at,
			updatedAt: trace.updated_at,
			finishedAt: trace.finished_at,
			meta: parseDiagnosticMeta(trace.id, trace.meta_json),
		},
		integrity: page.integrity,
		eventCount: page.integrity.persistedEventCount,
		includedEventCount: events.length,
		truncated,
		events,
	};
}

export async function beginExecutionTraceRun(
	db: PrismaClient,
	input: {
		traceId: string;
		userId: string;
		scopeType: string;
		scopeId: string;
		requestKind: string;
		inputSummary: string;
		sessionKey: string | null;
		workflowKey: string | null;
		logicalTaskId?: string | null;
		rootTraceId?: string | null;
		parentTraceId?: string | null;
		physicalRunId?: string | null;
		workflowRunId?: string | null;
		meta?: Record<string, unknown>;
	},
): Promise<void> {
	await assertExecutionTraceSchemaReady(db);
	const nowIso = new Date().toISOString();
	const rootTraceId = input.rootTraceId?.trim() || input.traceId;
	const logicalTaskId = input.logicalTaskId?.trim() || rootTraceId;
	const inserted = await executeWithChanges(
		db,
		`INSERT INTO execution_traces (
      id, user_id, scope_type, scope_id, task_id, request_kind, input_summary,
      decision_log_json, tool_calls_json, meta_json, result_summary, error_code, error_detail,
      created_at, status, session_key, workflow_key, started_at, updated_at, finished_at, next_event_seq,
      logical_task_id, root_trace_id, parent_trace_id, physical_run_id, workflow_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
		[
			input.traceId,
			input.userId,
			input.scopeType,
			input.scopeId,
			null,
			input.requestKind,
			input.inputSummary,
			JSON.stringify([]),
			JSON.stringify([]),
			input.meta ? JSON.stringify(sanitizeExecutionTraceEventPayload(input.meta)) : null,
			null,
			null,
			null,
			nowIso,
			"running",
			input.sessionKey,
			input.workflowKey,
			nowIso,
			nowIso,
			null,
			0,
			logicalTaskId,
			rootTraceId,
			input.parentTraceId?.trim() || null,
			input.physicalRunId?.trim() || null,
			input.workflowRunId?.trim() || null,
		],
	);
	const row = await queryOne<{
		user_id: string;
		root_trace_id: string | null;
		logical_task_id: string | null;
		status: ExecutionTraceRunStatus;
	}>(
		db,
		"SELECT user_id, root_trace_id, logical_task_id, status FROM execution_traces WHERE id = ?",
		[input.traceId],
	);
	if (
		!row ||
		row.user_id !== input.userId ||
		row.root_trace_id !== rootTraceId ||
		row.logical_task_id !== logicalTaskId
	) {
		throw new Error(`execution_trace_identity_conflict:${input.traceId}`);
	}
	if (inserted !== 1) {
		throw new Error(`execution_trace_already_exists:${input.traceId}:${row.status}`);
	}
}

/**
 * Reads the exact durable admission/terminal state for one physical turn.
 * This row is committed before bridge lifecycle events and agents-cli session
 * projection, so it is the earliest authoritative fact available to a
 * concurrent reconciler.
 */
export async function getExecutionTraceLifecycleSnapshot(
	db: PrismaClient,
	input: { traceId: string; userId: string },
): Promise<ExecutionTraceLifecycleSnapshot | null> {
	await assertExecutionTraceSchemaReady(db);
	const row = await queryOne<{
		id: string;
		status: ExecutionTraceRunStatus;
		logical_task_id: string | null;
		root_trace_id: string | null;
		started_at: string;
		updated_at: string;
		finished_at: string | null;
	}>(
		db,
		`SELECT id, status, logical_task_id, root_trace_id, started_at, updated_at, finished_at
		 FROM execution_traces
		 WHERE id = ? AND user_id = ?`,
		[input.traceId, input.userId],
	);
	if (!row) return null;
	return {
		traceId: row.id,
		status: row.status,
		logicalTaskId: row.logical_task_id?.trim() || row.id,
		rootTraceId: row.root_trace_id?.trim() || row.id,
		startedAt: row.started_at,
		updatedAt: row.updated_at,
		finishedAt: row.finished_at,
	};
}

type RecoverableExecutionTraceRun = {
	id: string;
	user_id: string;
	terminal_event_type: string | null;
	terminal_payload_json: string | null;
};

function readCompletedTraceStatus(payloadJson: string | null): Exclude<ExecutionTraceRunStatus, "running"> | null {
	if (!payloadJson) return null;
	try {
		const parsed: unknown = JSON.parse(payloadJson);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const payload = parsed as Record<string, unknown>;
		const response = payload.response;
		if (!response || typeof response !== "object" || Array.isArray(response)) return null;
		const trace = (response as Record<string, unknown>).trace;
		const requestTerminal = trace && typeof trace === "object" && !Array.isArray(trace)
			? (trace as Record<string, unknown>).requestTerminal
			: null;
		const terminalStatus = requestTerminal && typeof requestTerminal === "object" && !Array.isArray(requestTerminal)
			? (requestTerminal as Record<string, unknown>).status
			: null;
		if (terminalStatus === "suspended" || terminalStatus === "needs_input") return "waiting_async";
		if (terminalStatus === "failed" || payload.status === "failed") return "failed";
		return "succeeded";
	} catch {
		return null;
	}
}

/**
 * Reconciles the append-only terminal journal with its trace projection and
 * expires physical runs whose event lease is older than the caller's bounded
 * runtime. Waiting-async traces are deliberately excluded: their external
 * evidence may remain valid for an unbounded provider queue duration.
 */
export async function sweepStaleExecutionTraceRuns(
	db: PrismaClient,
	input: { staleMs?: number; nowMs?: number; limit?: number } = {},
): Promise<ExecutionTraceRunSweepResult> {
	await assertExecutionTraceSchemaReady(db);
	const nowMs = input.nowMs ?? Date.now();
	const staleMs = Math.max(5 * 60_000, Math.trunc(input.staleMs ?? 35 * 60_000));
	const staleBeforeIso = new Date(nowMs - staleMs).toISOString();
	const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
	const rows = await queryAll<RecoverableExecutionTraceRun>(
		db,
		`SELECT trace.id, trace.user_id,
		   (
		     SELECT event.event_type
		     FROM execution_trace_events AS event
		     WHERE event.trace_id = trace.id
		       AND event.user_id = trace.user_id
		       AND event.event_type IN ('response.completed', 'execution.failed', 'execution.cancelled')
		     ORDER BY event.seq DESC
		     LIMIT 1
		   ) AS terminal_event_type,
		   (
		     SELECT event.payload_json
		     FROM execution_trace_events AS event
		     WHERE event.trace_id = trace.id
		       AND event.user_id = trace.user_id
		       AND event.event_type IN ('response.completed', 'execution.failed', 'execution.cancelled')
		     ORDER BY event.seq DESC
		     LIMIT 1
		   ) AS terminal_payload_json
		 FROM execution_traces AS trace
		 WHERE trace.status = 'running'
		   AND (
		     trace.updated_at <= ?
		     OR EXISTS (
		       SELECT 1
		       FROM execution_trace_events AS terminal_event
		       WHERE terminal_event.trace_id = trace.id
		         AND terminal_event.user_id = trace.user_id
		         AND terminal_event.event_type IN ('response.completed', 'execution.failed', 'execution.cancelled')
		     )
		   )
		 ORDER BY trace.updated_at ASC
		 LIMIT ?`,
		[staleBeforeIso, limit],
	);
	const result: ExecutionTraceRunSweepResult = {
		scanned: rows.length,
		succeeded: 0,
		failed: 0,
		cancelled: 0,
		waitingAsync: 0,
		errors: [],
	};
	for (const row of rows) {
		let status: Exclude<ExecutionTraceRunStatus, "running">;
		let errorCode: string | null = null;
		let errorDetail: string | null = null;
		if (row.terminal_event_type === "execution.cancelled") {
			status = "cancelled";
		} else if (row.terminal_event_type === "execution.failed") {
			status = "failed";
		} else if (row.terminal_event_type === "response.completed") {
			const completedStatus = readCompletedTraceStatus(row.terminal_payload_json);
			status = completedStatus ?? "failed";
			if (!completedStatus) {
				errorCode = "execution_trace_terminal_event_invalid";
				errorDetail = "response.completed payload cannot produce a structural terminal status";
			}
		} else {
			status = "failed";
			errorCode = "execution_trace_lease_expired";
			errorDetail = `running trace produced no event for ${staleMs}ms`;
		}
		try {
			await finalizeExecutionTraceRun(db, {
				traceId: row.id,
				userId: row.user_id,
				status,
				errorCode,
				errorDetail,
			});
			if (status === "succeeded") result.succeeded += 1;
			if (status === "failed") result.failed += 1;
			if (status === "cancelled") result.cancelled += 1;
			if (status === "waiting_async") result.waitingAsync += 1;
		} catch (error) {
			result.errors.push({
				traceId: row.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return result;
}

export async function appendExecutionTraceEvents(
	db: PrismaClient,
	input: {
		traceId: string;
		userId: string;
		events: readonly AppendExecutionTraceEventInput[];
	},
): Promise<ExecutionTraceEvent[]> {
	await assertExecutionTraceSchemaReady(db);
	if (input.events.length === 0) return [];
	const producerIds = input.events.map((event) => event.producerEventId.trim());
	if (producerIds.some((id) => !id) || new Set(producerIds).size !== producerIds.length) {
		throw new Error(`execution_trace_producer_event_identity_invalid:${input.traceId}`);
	}
	// 交互式事务默认 timeout=5000ms，在 DB 负载高时（advisory lock 排队 + FOR UPDATE
	// 行锁 + 去重查询 + 批量插入）会触发 "Transaction already closed" → 执行日志批量
	// 落库降级/失败 → 用户看到「AI 执行过程日志无法入库，本轮未启动」。这里显式放宽
	// 交互式事务的超时与取连接等待，与写入量级匹配，而非依赖 Prisma 默认值。
	return await db.$transaction(async (tx) => {
		await execute(tx, "SELECT pg_advisory_xact_lock(hashtext(?))", [input.traceId]);
		const trace = await queryOne<{ next_event_seq: number }>(
			tx,
			"SELECT next_event_seq FROM execution_traces WHERE id = ? AND user_id = ? FOR UPDATE",
			[input.traceId, input.userId],
		);
		if (!trace) throw new Error(`execution_trace_not_found:${input.traceId}`);
		const existingRows = await queryAll<{ producer_event_id: string }>(
			tx,
			`SELECT producer_event_id FROM execution_trace_events
			 WHERE trace_id = ? AND user_id = ?
			   AND producer_event_id IN (SELECT jsonb_array_elements_text(?::jsonb))`,
			[input.traceId, input.userId, JSON.stringify(producerIds)],
		);
		const existing = new Set(existingRows.map((row) => row.producer_event_id));
		const fresh = input.events.filter((event) => !existing.has(event.producerEventId));
		if (fresh.length === 0) return [];
		const nowIso = new Date().toISOString();
		const firstSeq = Number(trace.next_event_seq) + 1;
		const serialized = fresh.map((event, index) => {
			const sanitizedPayload = sanitizeExecutionTraceEventPayloadWithMeta(event.payload);
			const payloadJson = JSON.stringify(sanitizedPayload.payload);
			const attempt = typeof event.attempt === "number" && Number.isInteger(event.attempt) && event.attempt > 0
				? event.attempt
				: null;
			return {
				id: randomUUID(),
				trace_id: input.traceId,
				user_id: input.userId,
				seq: firstSeq + index,
				producer_event_id: event.producerEventId,
				event_type: event.eventType,
				event_class: event.eventClass,
				event_key: event.eventKey,
				phase: event.phase ?? null,
				status: event.status ?? null,
				logical_task_id: event.logicalTaskId ?? null,
				root_trace_id: event.rootTraceId ?? null,
				parent_trace_id: event.parentTraceId ?? null,
				physical_run_id: event.physicalRunId ?? null,
				workflow_run_id: event.workflowRunId ?? null,
				workflow_node_id: event.workflowNodeId ?? null,
				agent_id: event.agentId ?? null,
				parent_agent_id: event.parentAgentId ?? null,
				tool_call_id: event.toolCallId ?? null,
				effect_id: event.effectId ?? null,
				provider_task_id: event.providerTaskId ?? null,
				span_id: event.spanId ?? null,
				parent_span_id: event.parentSpanId ?? null,
				attempt,
				payload_json: payloadJson,
				payload_size_bytes: Buffer.byteLength(payloadJson, "utf8"),
				payload_truncated: sanitizedPayload.truncated,
				created_at: nowIso,
			};
		});
		await execute(
			tx,
			"UPDATE execution_traces SET next_event_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?",
			[firstSeq + serialized.length - 1, nowIso, input.traceId, input.userId],
		);
		const inserted = await queryAll<ExecutionTraceEventRow>(
			tx,
			`INSERT INTO execution_trace_events (
			   id, trace_id, user_id, seq, producer_event_id, event_type, event_class, event_key, phase, status,
			   logical_task_id, root_trace_id, parent_trace_id, physical_run_id, workflow_run_id, workflow_node_id,
			   agent_id, parent_agent_id, tool_call_id, effect_id, provider_task_id, span_id, parent_span_id, attempt,
			   payload_json, payload_size_bytes, payload_truncated, created_at
			 )
			 SELECT event.id, event.trace_id, event.user_id, event.seq, event.producer_event_id,
			   event.event_type, event.event_class, event.event_key, event.phase, event.status,
			   event.logical_task_id, event.root_trace_id, event.parent_trace_id, event.physical_run_id,
			   event.workflow_run_id, event.workflow_node_id, event.agent_id, event.parent_agent_id,
			   event.tool_call_id, event.effect_id, event.provider_task_id, event.span_id, event.parent_span_id,
			   event.attempt, event.payload_json, event.payload_size_bytes, event.payload_truncated, event.created_at
			 FROM jsonb_to_recordset(?::jsonb) AS event(
			   id text, trace_id text, user_id text, seq bigint, producer_event_id text,
			   event_type text, event_class text, event_key text, phase text, status text,
			   logical_task_id text, root_trace_id text, parent_trace_id text, physical_run_id text,
			   workflow_run_id text, workflow_node_id text, agent_id text, parent_agent_id text,
			   tool_call_id text, effect_id text, provider_task_id text, span_id text, parent_span_id text,
			   attempt integer, payload_json text, payload_size_bytes integer, payload_truncated boolean, created_at text
			 )
			 RETURNING *`,
			[JSON.stringify(serialized)],
		);
		if (inserted.length !== serialized.length) {
			throw new Error(`execution_trace_batch_insert_incomplete:${input.traceId}:${inserted.length}/${serialized.length}`);
		}
		return inserted.sort((left, right) => Number(left.seq) - Number(right.seq)).map(normalizeEventRow);
	}, {
		timeout: 20_000,
		maxWait: 10_000,
	});
}

export async function appendExecutionTraceEvent(
	db: PrismaClient,
	input: Omit<AppendExecutionTraceEventInput, "producerEventId" | "eventClass"> & {
		traceId: string;
		userId: string;
		producerEventId?: string;
		eventClass?: string;
	},
): Promise<ExecutionTraceEvent> {
	const [event] = await appendExecutionTraceEvents(db, {
		traceId: input.traceId,
		userId: input.userId,
		events: [{ ...input, producerEventId: input.producerEventId ?? randomUUID(), eventClass: input.eventClass ?? "diagnostic" }],
	});
	if (!event && input.producerEventId) {
		const existing = await queryOne<ExecutionTraceEventRow>(
			db,
			`SELECT * FROM execution_trace_events
			 WHERE trace_id = ? AND user_id = ? AND producer_event_id = ?`,
			[input.traceId, input.userId, input.producerEventId],
		);
		if (existing) return normalizeEventRow(existing);
	}
	if (!event) throw new Error(`execution_trace_event_persistence_missing:${input.traceId}:${input.producerEventId ?? "generated"}`);
	return event;
}

export async function finalizeExecutionTraceRun(
	db: PrismaClient,
	input: {
		traceId: string;
		userId: string;
		status: Exclude<ExecutionTraceRunStatus, "running">;
		/**
		 * The durable Agents checkpoint can prove that a host-projected failure was
		 * only a recoverable physical interruption. Callers may reopen that exact
		 * trace as waiting_async after atomically registering its continuation.
		 * All other terminal transitions remain monotonic.
		 */
		allowFailedToWaitingAsyncRecovery?: boolean;
		resultSummary?: string | null;
		errorCode?: string | null;
		errorDetail?: string | null;
		meta?: Record<string, unknown> | null;
		toolCalls?: Array<Record<string, unknown>>;
	},
): Promise<void> {
	await assertExecutionTraceSchemaReady(db);
	const nowIso = new Date().toISOString();
	const recoverFailedTrace = input.status === "waiting_async"
		&& input.allowFailedToWaitingAsyncRecovery === true;
	const eligibleStatuses = recoverFailedTrace
		? "('running', 'waiting_async', 'failed')"
		: "('running', 'waiting_async')";
	const changed = await executeWithChanges(
		db,
		`UPDATE execution_traces
     SET status = ?, result_summary = ?, error_code = ?, error_detail = ?,
         meta_json = COALESCE(?, meta_json), tool_calls_json = COALESCE(?, tool_calls_json),
         updated_at = ?, finished_at = ?
     WHERE id = ? AND user_id = ? AND status IN ${eligibleStatuses}`,
		[
			input.status,
			input.resultSummary ?? null,
			input.errorCode ?? null,
			input.errorDetail ?? null,
			input.meta ? JSON.stringify(sanitizeExecutionTraceEventPayload(input.meta)) : null,
			input.toolCalls ? JSON.stringify(sanitizeExecutionTraceEventPayload({ items: input.toolCalls }).items ?? []) : null,
			nowIso,
			nowIso,
			input.traceId,
			input.userId,
		],
	);
	if (changed === 1) return;
	const current = await queryOne<{ status: ExecutionTraceRunStatus }>(
		db,
		"SELECT status FROM execution_traces WHERE id = ? AND user_id = ?",
		[input.traceId, input.userId],
	);
	if (!current) throw new Error(`execution_trace_finalize_target_missing:${input.traceId}`);
	if (current.status === input.status) return;
	throw new Error(
		`execution_trace_terminal_conflict:${input.traceId}:${current.status}:${input.status}`,
	);
}

/**
 * Reads the immutable request snapshot that was persisted before an agents
 * bridge run started. Active traces are eligible. A failed host projection is
 * also eligible only when the persisted agents result proves that the logical
 * task was suspended for a recoverable physical reason and names its physical
 * run. Other terminal traces cannot be reconstructed into new work.
 */
export type ExecutionTraceAcceptedSnapshot = Readonly<{
	request: unknown;
	recoveryContext: unknown | null;
}>;

export async function getExecutionTraceAcceptedSnapshot(
	db: PrismaClient,
	input: {
		traceId: string;
		userId: string;
		/** Only after the caller verifies this exact turn's durable recovery checkpoint. */
		allowTerminalRecoverySnapshot?: boolean;
	},
): Promise<ExecutionTraceAcceptedSnapshot | null> {
	await assertExecutionTraceSchemaReady(db);
	const terminalRecoveryClause = input.allowTerminalRecoverySnapshot === true
		? "OR 1 = 1"
		: "";
	const row = await queryOne<ExecutionTraceEventRow>(
		db,
		`SELECT event.*
		 FROM execution_trace_events AS event
		 INNER JOIN execution_traces AS trace
		   ON trace.id = event.trace_id AND trace.user_id = event.user_id
		 WHERE event.trace_id = ?
		   AND event.user_id = ?
		   AND event.event_type = 'request.accepted'
		   AND (
		     trace.status IN ('running', 'waiting_async')
		     OR (
		       trace.status = 'failed'
		       AND EXISTS (
		         SELECT 1
		         FROM execution_trace_events AS result_event
		         WHERE result_event.trace_id = trace.id
		           AND result_event.user_id = trace.user_id
		           AND result_event.event_type = 'result'
		           AND result_event.payload_json::jsonb #>> '{response,trace,runOutcome,status}' = 'suspended'
		           AND result_event.payload_json::jsonb #>> '{response,trace,runOutcome,reason}' IN (
		             'root_physical_execution_budget_exhausted',
		             'provider_stream_interrupted'
		           )
		           AND COALESCE(
		             result_event.payload_json::jsonb #>> '{response,trace,runtime,suspension,physicalRunId}',
		             ''
		           ) <> ''
		       )
		     )
		     ${terminalRecoveryClause}
		   )
		 ORDER BY event.seq ASC
		 LIMIT 1`,
		[input.traceId, input.userId],
	);
	if (!row) return null;
	const payload = parseEventPayload(row);
	if (typeof payload.request === "undefined") return null;
	return {
		request: payload.request,
		recoveryContext: typeof payload.recoveryContext === "undefined"
			? null
			: payload.recoveryContext,
	};
}

export async function getExecutionTraceAcceptedRequest(
	db: PrismaClient,
	input: { traceId: string; userId: string },
): Promise<unknown | null> {
	const snapshot = await getExecutionTraceAcceptedSnapshot(db, input);
	return snapshot?.request ?? null;
}

export async function listExecutionTraceEvents(
	db: PrismaClient,
	input: {
		traceId: string;
		userId: string;
		afterSeq?: number;
		beforeSeq?: number;
		limit: number;
	},
): Promise<{
	events: ExecutionTraceEvent[];
	nextAfterSeq: number | null;
	latestSeq: number;
	traceStatus: ExecutionTraceRunStatus;
	serverObservedAt: string;
	hasMore: boolean;
	integrity: ExecutionTraceIntegrity;
}> {
	await assertExecutionTraceSchemaReady(db);
	const limit = Math.max(1, Math.min(200, Math.trunc(input.limit)));
	const trace = await queryOne<{ status: ExecutionTraceRunStatus; next_event_seq: number; finished_at: string | null }>(
		db,
		"SELECT status, next_event_seq, finished_at FROM execution_traces WHERE id = ? AND user_id = ?",
		[input.traceId, input.userId],
	);
	if (!trace) throw new Error(`execution_trace_not_found:${input.traceId}`);
	const clauses = ["trace_id = ?", "user_id = ?"];
	const params: Array<string | number> = [input.traceId, input.userId];
	if (typeof input.afterSeq === "number") {
		clauses.push("seq > ?");
		params.push(Math.max(0, Math.trunc(input.afterSeq)));
	}
	if (typeof input.beforeSeq === "number") {
		clauses.push("seq < ?");
		params.push(Math.max(1, Math.trunc(input.beforeSeq)));
	}
	params.push(limit + 1);
	const rows = await queryAll<ExecutionTraceEventRow>(
		db,
		`SELECT * FROM execution_trace_events
     WHERE ${clauses.join(" AND ")}
     ORDER BY seq ASC
     LIMIT ?`,
		params,
	);
	const aggregate = await queryOne<{
		persisted_event_count: number;
		latest_persisted_seq: number | null;
		request_accepted_count: number;
		terminal_event_count: number;
	}>(
		db,
		`SELECT
		   COUNT(*)::bigint AS persisted_event_count,
		   MAX(seq)::bigint AS latest_persisted_seq,
		   COUNT(*) FILTER (WHERE event_type = 'request.accepted')::bigint AS request_accepted_count,
		   COUNT(*) FILTER (WHERE event_type IN (
		     'response.completed', 'execution.failed', 'execution.cancelled'
		   ))::bigint AS terminal_event_count
		 FROM execution_trace_events
		 WHERE trace_id = ? AND user_id = ?`,
		[input.traceId, input.userId],
	);
	const hasMore = rows.length > limit;
	const pageRows = rows.slice(0, limit);
	const integrity = evaluateExecutionTraceIntegrity({
		traceStatus: trace.status,
		finishedAt: trace.finished_at,
		nextEventSeq: Number(trace.next_event_seq),
		persistedEventCount: Number(aggregate?.persisted_event_count ?? 0),
		latestPersistedSeq: Number(aggregate?.latest_persisted_seq ?? 0),
		requestAcceptedCount: Number(aggregate?.request_accepted_count ?? 0),
		terminalEventCount: Number(aggregate?.terminal_event_count ?? 0),
	});
	return {
		events: pageRows.map(normalizeEventRow),
		nextAfterSeq: hasMore && pageRows.length > 0 ? Number(pageRows[pageRows.length - 1].seq) : null,
		latestSeq: Number(trace.next_event_seq),
		traceStatus: trace.status,
		serverObservedAt: new Date().toISOString(),
		hasMore,
		integrity,
	};
}
