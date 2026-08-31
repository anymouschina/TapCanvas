import { randomUUID } from "node:crypto";

import type {
	AgentAnnotationQueueItemV1,
	AgentDiagnosticsMetricsV1,
	AgentEvaluationResultV1,
	AgentHumanFeedbackV1,
	AgentRegressionExampleV1,
	AgentTraceSpanV1,
} from "@tapcanvas/agent-observability";
import type { PrismaClient } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";

type AgentTraceSpanRow = {
	id: string;
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	linked_span_ids_json: string;
	request_id: string | null;
	thread_id: string | null;
	turn_id: string | null;
	service: AgentTraceSpanV1["service"];
	span_kind: AgentTraceSpanV1["kind"];
	span_name: string;
	status: AgentTraceSpanV1["status"];
	started_at: string;
	finished_at: string | null;
	duration_ms: number | null;
	project_id: string | null;
	book_id: string | null;
	chapter_id: string | null;
	flow_id: string | null;
	node_id: string | null;
	async_task_id: string | null;
	async_run_id: string | null;
	async_node_id: string | null;
	label: string | null;
	workflow_key: string | null;
	model_key: string | null;
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	cache_read_input_tokens: number;
	cache_creation_input_tokens: number;
	cost_credits: number | null;
	capture_policy: AgentTraceSpanV1["capturePolicy"];
	persistence_status: AgentTraceSpanV1["persistenceStatus"];
	error_code: string | null;
	attributes_json: string;
	created_at: string;
};

type EvaluationResultRow = {
	id: string;
	trace_id: string;
	span_id: string | null;
	thread_id: string | null;
	artifact_id: string | null;
	evaluator_key: string;
	evaluator_version: string;
	source: AgentEvaluationResultV1["source"];
	target: AgentEvaluationResultV1["target"];
	status: AgentEvaluationResultV1["status"];
	score: number | null;
	value: string | null;
	rationale: string;
	evidence_json: string;
	created_at: string;
};

type HumanFeedbackRow = {
	id: string;
	trace_id: string;
	span_id: string | null;
	thread_id: string | null;
	feedback_key: string;
	value: AgentHumanFeedbackV1["value"];
	comment: string | null;
	created_at: string;
};

type AnnotationQueueItemRow = {
	id: string;
	trace_id: string;
	reason_code: string;
	status: AgentAnnotationQueueItemV1["status"];
	priority: number;
	created_at: string;
	reviewed_at: string | null;
};

type RegressionExampleRow = {
	id: string;
	dataset_key: string;
	dataset_version: number;
	trace_id: string;
	expected_delivery_json: string;
	delivery_evidence_json: string;
	delivery_verification_json: string;
	metadata_json: string;
	created_at: string;
};

type RegressionDatasetVersionRow = {
	next_version: number;
};

function mapRegressionExampleRow(row: RegressionExampleRow): AgentRegressionExampleV1 {
	return {
		version: 1,
		id: row.id,
		datasetKey: row.dataset_key,
		datasetVersion: row.dataset_version,
		traceId: row.trace_id,
		expectedDelivery: parseRecord(row.expected_delivery_json, "expected_delivery_json"),
		deliveryEvidence: parseRecord(row.delivery_evidence_json, "delivery_evidence_json"),
		deliveryVerification: parseRecord(row.delivery_verification_json, "delivery_verification_json"),
		metadata: parseRecord(row.metadata_json, "metadata_json"),
		createdAt: row.created_at,
	};
}

type RootMetricRow = {
	trace_count: number;
	succeeded_count: number;
	failed_count: number;
	partial_count: number;
	needs_input_count: number;
	persisted_count: number;
	degraded_count: number;
	total_tokens: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_input_tokens: number;
	total_duration_ms: number;
	average_duration_ms: number | null;
	p50_duration_ms: number | null;
	p95_duration_ms: number | null;
};

type AsyncMetricRow = {
	accepted_async_count: number;
	materialized_async_count: number;
	stale_async_count: number;
};

const schemaEnsured = new WeakSet<PrismaClient>();
const schemaEnsurePromises = new WeakMap<PrismaClient, Promise<void>>();

function serialize(value: unknown): string {
	return JSON.stringify(value ?? null);
}

function resolveAsyncIdentities(span: AgentTraceSpanV1): {
	taskId: string | null;
	runId: string | null;
	nodeId: string | null;
} {
	if (span.kind !== "async_task" && span.kind !== "asset_materialization") {
		return { taskId: null, runId: null, nodeId: null };
	}
	const readIdentity = (key: "taskId" | "runId" | "nodeId"): string | null => {
		const value = span.attributes[key];
		return typeof value === "string" && value.trim() ? value.trim() : null;
	};
	return {
		taskId: readIdentity("taskId"),
		runId: readIdentity("runId"),
		nodeId: readIdentity("nodeId"),
	};
}

function parseRecord(raw: string, field: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(raw);
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
		throw new Error(`${field} must contain a JSON object`);
	} catch (error: unknown) {
		throw new Error(
			`agent_observability_invalid_json:${field}:${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function parseStringArray(raw: string, field: string): string[] {
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
			throw new Error(`${field} must contain a JSON string array`);
		}
		return value as string[];
	} catch (error: unknown) {
		throw new Error(
			`agent_observability_invalid_json:${field}:${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function ensureAgentObservabilitySchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured.has(db)) return;
	const existingPromise = schemaEnsurePromises.get(db);
	if (existingPromise) {
		await existingPromise;
		return;
	}
	const ensurePromise = (async () => {
		await execute(db, `CREATE TABLE IF NOT EXISTS agent_trace_spans (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			trace_id TEXT NOT NULL,
			span_id TEXT NOT NULL,
			parent_span_id TEXT,
			linked_span_ids_json TEXT NOT NULL,
			request_id TEXT,
			thread_id TEXT,
			turn_id TEXT,
			service TEXT NOT NULL,
			span_kind TEXT NOT NULL,
			span_name TEXT NOT NULL,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			finished_at TEXT,
			duration_ms BIGINT,
			project_id TEXT,
			book_id TEXT,
			chapter_id TEXT,
			flow_id TEXT,
			node_id TEXT,
			async_task_id TEXT,
			async_run_id TEXT,
			async_node_id TEXT,
			label TEXT,
			workflow_key TEXT,
			model_key TEXT,
			input_tokens BIGINT NOT NULL DEFAULT 0,
			output_tokens BIGINT NOT NULL DEFAULT 0,
			total_tokens BIGINT NOT NULL DEFAULT 0,
			cache_read_input_tokens BIGINT NOT NULL DEFAULT 0,
			cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
			cost_credits REAL,
			capture_policy TEXT NOT NULL,
			persistence_status TEXT NOT NULL,
			error_code TEXT,
			attributes_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			UNIQUE(user_id, trace_id, span_id)
		)`);
		await execute(db, `ALTER TABLE agent_trace_spans
			ADD COLUMN IF NOT EXISTS async_task_id TEXT`);
		await execute(db, `ALTER TABLE agent_trace_spans
			ADD COLUMN IF NOT EXISTS async_run_id TEXT`);
		await execute(db, `ALTER TABLE agent_trace_spans
			ADD COLUMN IF NOT EXISTS async_node_id TEXT`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_user_time
			ON agent_trace_spans(user_id, started_at DESC, id DESC)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_trace
			ON agent_trace_spans(user_id, trace_id, started_at ASC)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_scope
			ON agent_trace_spans(user_id, project_id, book_id, chapter_id, started_at DESC)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_dimensions
			ON agent_trace_spans(user_id, workflow_key, model_key, span_kind, status, started_at DESC)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_async_task
			ON agent_trace_spans(user_id, async_task_id, span_kind, status, started_at DESC)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_async_run
			ON agent_trace_spans(user_id, async_run_id, span_kind, status, started_at DESC)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_async_node
			ON agent_trace_spans(user_id, async_node_id, project_id, flow_id, book_id, chapter_id, span_kind, status, started_at DESC)`);

		await execute(db, `CREATE TABLE IF NOT EXISTS agent_evaluation_results (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			trace_id TEXT NOT NULL,
			span_id TEXT,
			thread_id TEXT,
			artifact_id TEXT,
			evaluator_key TEXT NOT NULL,
			evaluator_version TEXT NOT NULL,
			source TEXT NOT NULL,
			target TEXT NOT NULL,
			status TEXT NOT NULL,
			score REAL,
			value TEXT,
			rationale TEXT NOT NULL,
			evidence_json TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_evaluation_results_trace
			ON agent_evaluation_results(user_id, trace_id, created_at DESC)`);

		await execute(db, `CREATE TABLE IF NOT EXISTS agent_human_feedback (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			trace_id TEXT NOT NULL,
			span_id TEXT,
			thread_id TEXT,
			feedback_key TEXT NOT NULL,
			value TEXT NOT NULL,
			comment TEXT,
			created_at TEXT NOT NULL
		)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_human_feedback_trace
			ON agent_human_feedback(user_id, trace_id, created_at DESC)`);

		await execute(db, `CREATE TABLE IF NOT EXISTS agent_annotation_queue_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			trace_id TEXT NOT NULL,
			reason_code TEXT NOT NULL,
			status TEXT NOT NULL,
			priority INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			reviewed_at TEXT
		)`);
		await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_annotation_queue_unique
			ON agent_annotation_queue_items(user_id, trace_id, reason_code)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_annotation_queue_pending
			ON agent_annotation_queue_items(user_id, status, priority DESC, created_at ASC)`);

		await execute(db, `CREATE TABLE IF NOT EXISTS agent_regression_examples (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			dataset_key TEXT NOT NULL,
			dataset_version INTEGER NOT NULL,
			trace_id TEXT NOT NULL,
			expected_delivery_json TEXT NOT NULL,
			delivery_evidence_json TEXT NOT NULL,
			delivery_verification_json TEXT NOT NULL,
			metadata_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			UNIQUE(user_id, dataset_key, dataset_version),
			UNIQUE(user_id, dataset_key, trace_id)
		)`);
		await execute(db, `CREATE INDEX IF NOT EXISTS idx_agent_regression_examples_dataset
			ON agent_regression_examples(user_id, dataset_key, dataset_version DESC)`);
		await execute(db, `CREATE TABLE IF NOT EXISTS agent_regression_datasets (
			user_id TEXT NOT NULL,
			dataset_key TEXT NOT NULL,
			next_version INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(user_id, dataset_key)
		)`);
		schemaEnsured.add(db);
	})();
	schemaEnsurePromises.set(db, ensurePromise);
	try {
		await ensurePromise;
	} finally {
		schemaEnsurePromises.delete(db);
	}
}

export async function writeAgentTraceSpans(
	db: PrismaClient,
	userId: string,
	spans: AgentTraceSpanV1[],
): Promise<void> {
	await ensureAgentObservabilitySchema(db);
	for (const span of spans) {
		const asyncIdentities = resolveAsyncIdentities(span);
		await execute(db, `INSERT INTO agent_trace_spans (
			id, user_id, trace_id, span_id, parent_span_id, linked_span_ids_json,
			request_id, thread_id, turn_id, service, span_kind, span_name, status,
			started_at, finished_at, duration_ms, project_id, book_id, chapter_id,
			flow_id, node_id, async_task_id, async_run_id, async_node_id, label, workflow_key, model_key, input_tokens,
			output_tokens, total_tokens, cache_read_input_tokens,
			cache_creation_input_tokens, cost_credits, capture_policy,
			persistence_status, error_code, attributes_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, trace_id, span_id) DO UPDATE SET
			status = EXCLUDED.status,
			finished_at = EXCLUDED.finished_at,
			duration_ms = EXCLUDED.duration_ms,
			input_tokens = EXCLUDED.input_tokens,
			output_tokens = EXCLUDED.output_tokens,
			total_tokens = EXCLUDED.total_tokens,
			cache_read_input_tokens = EXCLUDED.cache_read_input_tokens,
			cache_creation_input_tokens = EXCLUDED.cache_creation_input_tokens,
			async_task_id = EXCLUDED.async_task_id,
			async_run_id = EXCLUDED.async_run_id,
			async_node_id = EXCLUDED.async_node_id,
			persistence_status = EXCLUDED.persistence_status,
			error_code = EXCLUDED.error_code,
			attributes_json = EXCLUDED.attributes_json`, [
			span.id,
			userId,
			span.traceId,
			span.spanId,
			span.parentSpanId,
			serialize(span.linkedSpanIds),
			span.requestId,
			span.threadId,
			span.turnId,
			span.service,
			span.kind,
			span.name,
			span.status,
			span.startedAt,
			span.finishedAt,
			span.durationMs,
			span.scope.projectId,
			span.scope.bookId,
			span.scope.chapterId,
			span.scope.flowId,
			span.scope.nodeId,
			asyncIdentities.taskId,
			asyncIdentities.runId,
			asyncIdentities.nodeId,
			span.scope.label,
			span.scope.workflowKey,
			span.modelKey,
			span.inputTokens,
			span.outputTokens,
			span.totalTokens,
			span.cacheReadInputTokens,
			span.cacheCreationInputTokens,
			span.costCredits,
			span.capturePolicy,
			span.persistenceStatus,
			span.errorCode,
			serialize(span.attributes),
			span.createdAt,
		]);
	}
}

export type AgentTraceListFilters = {
	projectId?: string;
	bookId?: string;
	chapterId?: string;
	flowId?: string;
	nodeId?: string;
	label?: string;
	workflowKey?: string;
	modelKey?: string;
	status?: AgentTraceSpanV1["status"];
	kind?: AgentTraceSpanV1["kind"];
	traceId?: string;
	from?: string;
	to?: string;
	cursor?: { startedAt: string; id: string };
	limit: number;
};

function buildSpanWhere(userId: string, input: Omit<AgentTraceListFilters, "limit" | "cursor">): {
	clauses: string[];
	params: Array<string | number>;
} {
	const clauses = ["user_id = ?"];
	const params: Array<string | number> = [userId];
	const filters: Array<[string, string | undefined]> = [
		["project_id", input.projectId],
		["book_id", input.bookId],
		["chapter_id", input.chapterId],
		["flow_id", input.flowId],
		["node_id", input.nodeId],
		["label", input.label],
		["workflow_key", input.workflowKey],
		["model_key", input.modelKey],
		["status", input.status],
		["span_kind", input.kind],
		["trace_id", input.traceId],
	];
	for (const [column, value] of filters) {
		if (!value) continue;
		clauses.push(`${column} = ?`);
		params.push(value);
	}
	if (input.from) {
		clauses.push("started_at >= ?");
		params.push(input.from);
	}
	if (input.to) {
		clauses.push("started_at <= ?");
		params.push(input.to);
	}
	return { clauses, params };
}

function buildRootSpanWhere(
	userId: string,
	input: Omit<AgentTraceListFilters, "limit" | "cursor">,
): { clauses: string[]; params: Array<string | number> } {
	const { kind, ...rootFilters } = input;
	const where = buildSpanWhere(userId, { ...rootFilters, kind: "request" });
	if (kind && kind !== "request") {
		where.clauses.push(`EXISTS (
			SELECT 1 FROM agent_trace_spans child_span
			WHERE child_span.user_id = agent_trace_spans.user_id
			AND child_span.trace_id = agent_trace_spans.trace_id
			AND child_span.span_kind = ?
		)`);
		where.params.push(kind);
	}
	return where;
}

export async function setAgentTracePersistenceHealth(
	db: PrismaClient,
	userId: string,
	traceId: string,
	input: {
		status: "persisted" | "degraded";
		errorCode: string | null;
	},
): Promise<void> {
	await ensureAgentObservabilitySchema(db);
	await execute(db, `UPDATE agent_trace_spans
		SET persistence_status = ?,
			error_code = CASE
				WHEN ? = 'degraded' THEN COALESCE(error_code, ?)
				ELSE error_code
			END
		WHERE user_id = ? AND trace_id = ?`, [
		input.status,
		input.status,
		input.errorCode,
		userId,
		traceId,
	]);
}

function mapSpanRow(row: AgentTraceSpanRow): AgentTraceSpanV1 {
	return {
		version: 1,
		id: row.id,
		traceId: row.trace_id,
		spanId: row.span_id,
		parentSpanId: row.parent_span_id,
		linkedSpanIds: parseStringArray(row.linked_span_ids_json, "linked_span_ids_json"),
		requestId: row.request_id,
		threadId: row.thread_id,
		turnId: row.turn_id,
		service: row.service,
		kind: row.span_kind,
		name: row.span_name,
		status: row.status,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		durationMs: row.duration_ms,
		scope: {
			projectId: row.project_id,
			bookId: row.book_id,
			chapterId: row.chapter_id,
			flowId: row.flow_id,
			nodeId: row.node_id,
			label: row.label,
			workflowKey: row.workflow_key,
		},
		modelKey: row.model_key,
		inputTokens: row.input_tokens,
		outputTokens: row.output_tokens,
		totalTokens: row.total_tokens,
		cacheReadInputTokens: row.cache_read_input_tokens,
		cacheCreationInputTokens: row.cache_creation_input_tokens,
		costCredits: row.cost_credits,
		capturePolicy: row.capture_policy,
		persistenceStatus: row.persistence_status,
		errorCode: row.error_code,
		attributes: parseRecord(row.attributes_json, "attributes_json"),
		createdAt: row.created_at,
	};
}

export async function listAgentTraceSpans(
	db: PrismaClient,
	userId: string,
	input: AgentTraceListFilters,
): Promise<AgentTraceSpanV1[]> {
	await ensureAgentObservabilitySchema(db);
	const { clauses, params } = buildSpanWhere(userId, input);
	if (input.cursor) {
		clauses.push("(started_at < ? OR (started_at = ? AND id < ?))");
		params.push(input.cursor.startedAt, input.cursor.startedAt, input.cursor.id);
	}
	params.push(Math.max(1, Math.min(1_000, Math.trunc(input.limit))));
	const rows = await queryAll<AgentTraceSpanRow>(db,
		`SELECT * FROM agent_trace_spans WHERE ${clauses.join(" AND ")}
		 ORDER BY started_at DESC, id DESC LIMIT ?`,
		params,
	);
	return rows.map(mapSpanRow);
}

export async function listAgentTraceRoots(
	db: PrismaClient,
	userId: string,
	input: AgentTraceListFilters,
): Promise<AgentTraceSpanV1[]> {
	await ensureAgentObservabilitySchema(db);
	const { clauses, params } = buildRootSpanWhere(userId, input);
	if (input.cursor) {
		clauses.push("(started_at < ? OR (started_at = ? AND id < ?))");
		params.push(input.cursor.startedAt, input.cursor.startedAt, input.cursor.id);
	}
	params.push(Math.max(1, Math.min(201, Math.trunc(input.limit))));
	const rows = await queryAll<AgentTraceSpanRow>(db,
		`SELECT * FROM agent_trace_spans WHERE ${clauses.join(" AND ")}
		 ORDER BY started_at DESC, id DESC LIMIT ?`,
		params,
	);
	return rows.map(mapSpanRow);
}

export async function listAgentTraceSpansByTraceIds(
	db: PrismaClient,
	userId: string,
	traceIds: string[],
): Promise<AgentTraceSpanV1[]> {
	await ensureAgentObservabilitySchema(db);
	const ids = [...new Set(traceIds.map((id) => id.trim()).filter(Boolean))].slice(0, 200);
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await queryAll<AgentTraceSpanRow>(db,
		`SELECT * FROM agent_trace_spans
		 WHERE user_id = ? AND trace_id IN (${placeholders})
		 ORDER BY started_at DESC, id DESC`,
		[userId, ...ids],
	);
	return rows.map(mapSpanRow);
}

export async function queryAgentDiagnosticsMetrics(
	db: PrismaClient,
	userId: string,
	input: Omit<AgentTraceListFilters, "limit" | "cursor">,
): Promise<AgentDiagnosticsMetricsV1> {
	await ensureAgentObservabilitySchema(db);
	const rootWhere = buildRootSpanWhere(userId, input);
	const root = await queryOne<RootMetricRow>(db, `SELECT
		COUNT(DISTINCT trace_id)::bigint AS trace_count,
		COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded_count,
		COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
		COUNT(*) FILTER (
			WHERE attributes_json::jsonb #>> '{turnVerdict,status}' = 'partial'
		)::bigint AS partial_count,
		COUNT(*) FILTER (WHERE status = 'needs_input')::bigint AS needs_input_count,
		COUNT(*) FILTER (WHERE persistence_status = 'persisted')::bigint AS persisted_count,
		COUNT(*) FILTER (WHERE persistence_status = 'degraded')::bigint AS degraded_count,
		COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
		COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
		COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
		COALESCE(SUM(cache_read_input_tokens), 0)::bigint AS cache_read_input_tokens,
		COALESCE(SUM(duration_ms), 0)::bigint AS total_duration_ms,
		(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::double precision AS average_duration_ms,
		(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::double precision AS p50_duration_ms,
		(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::double precision AS p95_duration_ms
	FROM agent_trace_spans WHERE ${rootWhere.clauses.join(" AND ")}`, rootWhere.params);

	const asyncMetrics = await queryOne<AsyncMetricRow>(db, `WITH filtered_traces AS (
		SELECT trace_id FROM agent_trace_spans WHERE ${rootWhere.clauses.join(" AND ")}
	) SELECT
		COUNT(*) FILTER (WHERE lifecycle_span.span_kind = 'async_task' AND lifecycle_span.status = 'accepted_async')::bigint AS accepted_async_count,
		COUNT(*) FILTER (WHERE lifecycle_span.span_kind = 'asset_materialization' AND lifecycle_span.status = 'succeeded')::bigint AS materialized_async_count,
		COUNT(*) FILTER (
			WHERE lifecycle_span.span_kind = 'async_task'
			AND lifecycle_span.status = 'accepted_async'
			AND lifecycle_span.started_at::timestamptz < NOW() - INTERVAL '30 minutes'
			AND (
				lifecycle_span.async_task_id IS NOT NULL
				OR lifecycle_span.async_run_id IS NOT NULL
				OR lifecycle_span.async_node_id IS NOT NULL
			)
			AND NOT EXISTS (
				SELECT 1 FROM agent_trace_spans materialized_span
				WHERE materialized_span.user_id = lifecycle_span.user_id
				AND materialized_span.span_kind = 'asset_materialization'
				AND materialized_span.status = 'succeeded'
				AND materialized_span.started_at >= lifecycle_span.started_at
				AND CASE
					WHEN lifecycle_span.async_task_id IS NOT NULL
						AND materialized_span.async_task_id IS NOT NULL
						THEN materialized_span.async_task_id = lifecycle_span.async_task_id
					WHEN lifecycle_span.async_run_id IS NOT NULL
						AND materialized_span.async_run_id IS NOT NULL
						THEN materialized_span.async_run_id = lifecycle_span.async_run_id
					WHEN lifecycle_span.async_node_id IS NOT NULL
						AND materialized_span.async_node_id IS NOT NULL
						THEN materialized_span.async_node_id = lifecycle_span.async_node_id
						AND (
						materialized_span.project_id IS NOT DISTINCT FROM lifecycle_span.project_id
						AND materialized_span.flow_id IS NOT DISTINCT FROM lifecycle_span.flow_id
						AND materialized_span.book_id IS NOT DISTINCT FROM lifecycle_span.book_id
						AND materialized_span.chapter_id IS NOT DISTINCT FROM lifecycle_span.chapter_id
					)
					ELSE FALSE
				END
			)
		)::bigint AS stale_async_count
	FROM agent_trace_spans lifecycle_span
	WHERE lifecycle_span.user_id = ?
	AND lifecycle_span.trace_id IN (SELECT trace_id FROM filtered_traces)
	AND lifecycle_span.span_kind IN ('async_task', 'asset_materialization')`, [...rootWhere.params, userId]);

	return {
		traceCount: root?.trace_count ?? 0,
		succeededCount: root?.succeeded_count ?? 0,
		failedCount: root?.failed_count ?? 0,
		partialCount: root?.partial_count ?? 0,
		needsInputCount: root?.needs_input_count ?? 0,
		persistedCount: root?.persisted_count ?? 0,
		degradedCount: root?.degraded_count ?? 0,
		totalTokens: root?.total_tokens ?? 0,
		inputTokens: root?.input_tokens ?? 0,
		outputTokens: root?.output_tokens ?? 0,
		cacheReadInputTokens: root?.cache_read_input_tokens ?? 0,
		totalDurationMs: root?.total_duration_ms ?? 0,
		averageDurationMs: root?.average_duration_ms ?? null,
		p50DurationMs: root?.p50_duration_ms ?? null,
		p95DurationMs: root?.p95_duration_ms ?? null,
		acceptedAsyncCount: asyncMetrics?.accepted_async_count ?? 0,
		materializedAsyncCount: asyncMetrics?.materialized_async_count ?? 0,
		staleAsyncCount: asyncMetrics?.stale_async_count ?? 0,
	};
}

export async function writeAgentEvaluationResult(
	db: PrismaClient,
	userId: string,
	result: AgentEvaluationResultV1,
): Promise<void> {
	await ensureAgentObservabilitySchema(db);
	await execute(db, `INSERT INTO agent_evaluation_results (
		id, user_id, trace_id, span_id, thread_id, artifact_id, evaluator_key,
		evaluator_version, source, target, status, score, value, rationale,
		evidence_json, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (id) DO UPDATE SET
		span_id = EXCLUDED.span_id,
		thread_id = EXCLUDED.thread_id,
		artifact_id = EXCLUDED.artifact_id,
		status = EXCLUDED.status,
		score = EXCLUDED.score,
		value = EXCLUDED.value,
		rationale = EXCLUDED.rationale,
		evidence_json = EXCLUDED.evidence_json,
		created_at = EXCLUDED.created_at`, [
		result.id, userId, result.traceId, result.spanId, result.threadId,
		result.artifactId, result.evaluatorKey, result.evaluatorVersion,
		result.source, result.target, result.status, result.score, result.value,
		result.rationale, serialize(result.evidence), result.createdAt,
	]);
}

function mapEvaluationRow(row: EvaluationResultRow): AgentEvaluationResultV1 {
	return {
		version: 1,
		id: row.id,
		traceId: row.trace_id,
		spanId: row.span_id,
		threadId: row.thread_id,
		artifactId: row.artifact_id,
		evaluatorKey: row.evaluator_key,
		evaluatorVersion: row.evaluator_version,
		source: row.source,
		target: row.target,
		status: row.status,
		score: row.score,
		value: row.value,
		rationale: row.rationale,
		evidence: parseRecord(row.evidence_json, "evidence_json"),
		createdAt: row.created_at,
	};
}

export async function listAgentEvaluationResults(
	db: PrismaClient,
	userId: string,
	traceIds: string[],
): Promise<AgentEvaluationResultV1[]> {
	await ensureAgentObservabilitySchema(db);
	const ids = [...new Set(traceIds.map((id) => id.trim()).filter(Boolean))].slice(0, 200);
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await queryAll<EvaluationResultRow>(db,
		`SELECT * FROM agent_evaluation_results
		 WHERE user_id = ? AND trace_id IN (${placeholders})
		 ORDER BY created_at DESC`,
		[userId, ...ids],
	);
	return rows.map(mapEvaluationRow);
}

export async function createAgentHumanFeedback(
	db: PrismaClient,
	userId: string,
	input: Omit<AgentHumanFeedbackV1, "version" | "id" | "createdAt">,
): Promise<AgentHumanFeedbackV1> {
	await ensureAgentObservabilitySchema(db);
	const feedback: AgentHumanFeedbackV1 = {
		version: 1,
		id: randomUUID(),
		...input,
		createdAt: new Date().toISOString(),
	};
	await execute(db, `INSERT INTO agent_human_feedback (
		id, user_id, trace_id, span_id, thread_id, feedback_key, value, comment, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
		feedback.id, userId, feedback.traceId, feedback.spanId, feedback.threadId,
		feedback.feedbackKey, feedback.value, feedback.comment, feedback.createdAt,
	]);
	return feedback;
}

function mapFeedbackRow(row: HumanFeedbackRow): AgentHumanFeedbackV1 {
	return {
		version: 1,
		id: row.id,
		traceId: row.trace_id,
		spanId: row.span_id,
		threadId: row.thread_id,
		feedbackKey: row.feedback_key,
		value: row.value,
		comment: row.comment,
		createdAt: row.created_at,
	};
}

export async function listAgentHumanFeedback(
	db: PrismaClient,
	userId: string,
	traceIds: string[],
): Promise<AgentHumanFeedbackV1[]> {
	await ensureAgentObservabilitySchema(db);
	const ids = [...new Set(traceIds.map((id) => id.trim()).filter(Boolean))].slice(0, 200);
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await queryAll<HumanFeedbackRow>(db,
		`SELECT * FROM agent_human_feedback
		 WHERE user_id = ? AND trace_id IN (${placeholders})
		 ORDER BY created_at DESC`,
		[userId, ...ids],
	);
	return rows.map(mapFeedbackRow);
}

export async function enqueueAgentAnnotation(
	db: PrismaClient,
	userId: string,
	input: { traceId: string; reasonCode: string; priority: number },
): Promise<void> {
	await ensureAgentObservabilitySchema(db);
	await execute(db, `INSERT INTO agent_annotation_queue_items (
		id, user_id, trace_id, reason_code, status, priority, created_at, reviewed_at
	) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)
	ON CONFLICT (user_id, trace_id, reason_code) DO UPDATE SET
		priority = GREATEST(agent_annotation_queue_items.priority, EXCLUDED.priority)`, [
		randomUUID(), userId, input.traceId, input.reasonCode,
		Math.max(0, Math.min(100, Math.trunc(input.priority))), new Date().toISOString(),
	]);
}

function mapAnnotationQueueItemRow(row: AnnotationQueueItemRow): AgentAnnotationQueueItemV1 {
	return {
		version: 1,
		id: row.id,
		traceId: row.trace_id,
		reasonCode: row.reason_code,
		status: row.status,
		priority: row.priority,
		createdAt: row.created_at,
		reviewedAt: row.reviewed_at,
	};
}

export async function listAgentAnnotationQueueItems(
	db: PrismaClient,
	userId: string,
	traceIds: string[],
): Promise<AgentAnnotationQueueItemV1[]> {
	await ensureAgentObservabilitySchema(db);
	const ids = [...new Set(traceIds.map((id) => id.trim()).filter(Boolean))].slice(0, 200);
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await queryAll<AnnotationQueueItemRow>(db,
		`SELECT * FROM agent_annotation_queue_items
		 WHERE user_id = ? AND trace_id IN (${placeholders})
		 ORDER BY priority DESC, created_at ASC`,
		[userId, ...ids],
	);
	return rows.map(mapAnnotationQueueItemRow);
}

export async function markAgentAnnotationQueueReviewed(
	db: PrismaClient,
	userId: string,
	traceId: string,
): Promise<void> {
	await ensureAgentObservabilitySchema(db);
	await execute(db, `UPDATE agent_annotation_queue_items
		SET status = 'reviewed', reviewed_at = COALESCE(reviewed_at, ?)
		WHERE user_id = ? AND trace_id = ? AND status = 'pending'`, [
		new Date().toISOString(),
		userId,
		traceId,
	]);
}

export async function createAgentRegressionExample(
	db: PrismaClient,
	userId: string,
	input: {
		datasetKey: string;
		traceId: string;
		expectedDelivery: Record<string, unknown>;
		deliveryEvidence: Record<string, unknown>;
		deliveryVerification: Record<string, unknown>;
		metadata: Record<string, unknown>;
	},
): Promise<AgentRegressionExampleV1> {
	await ensureAgentObservabilitySchema(db);
	const existing = await queryOne<RegressionExampleRow>(db, `SELECT * FROM agent_regression_examples
		WHERE user_id = ? AND dataset_key = ? AND trace_id = ?
		LIMIT 1`, [userId, input.datasetKey, input.traceId]);
	if (existing) return mapRegressionExampleRow(existing);
	const id = randomUUID();
	const createdAt = new Date().toISOString();
	const versionRow = await queryOne<RegressionDatasetVersionRow>(db, `INSERT INTO agent_regression_datasets (
		user_id, dataset_key, next_version, created_at, updated_at
	) VALUES (?, ?, 1, ?, ?)
	ON CONFLICT (user_id, dataset_key) DO UPDATE SET
		next_version = agent_regression_datasets.next_version + 1,
		updated_at = EXCLUDED.updated_at
	RETURNING next_version`, [userId, input.datasetKey, createdAt, createdAt]);
	if (!versionRow) throw new Error("agent regression dataset version allocation returned no row");
	const row = await queryOne<RegressionExampleRow>(db, `INSERT INTO agent_regression_examples (
		id, user_id, dataset_key, dataset_version, trace_id, expected_delivery_json,
		delivery_evidence_json, delivery_verification_json, metadata_json, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (user_id, dataset_key, trace_id) DO UPDATE SET
		trace_id = EXCLUDED.trace_id
	RETURNING *`, [
		id, userId, input.datasetKey, versionRow.next_version, input.traceId,
		serialize(input.expectedDelivery), serialize(input.deliveryEvidence),
		serialize(input.deliveryVerification), serialize(input.metadata), createdAt,
	]);
	if (!row) throw new Error("agent regression example insert returned no row");
	return mapRegressionExampleRow(row);
}

export async function listAgentRegressionExamples(
	db: PrismaClient,
	userId: string,
	input: { datasetKey?: string; limit: number },
): Promise<AgentRegressionExampleV1[]> {
	await ensureAgentObservabilitySchema(db);
	const limit = Math.max(1, Math.min(200, Math.trunc(input.limit)));
	const datasetKey = input.datasetKey?.trim();
	const rows = datasetKey
		? await queryAll<RegressionExampleRow>(db, `SELECT * FROM agent_regression_examples
			WHERE user_id = ? AND dataset_key = ?
			ORDER BY created_at DESC, dataset_version DESC
			LIMIT ?`, [userId, datasetKey, limit])
		: await queryAll<RegressionExampleRow>(db, `SELECT * FROM agent_regression_examples
			WHERE user_id = ?
			ORDER BY created_at DESC, dataset_version DESC
			LIMIT ?`, [userId, limit]);
	return rows.map(mapRegressionExampleRow);
}
