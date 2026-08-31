import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type {
	WorkflowExecutionDto,
	WorkflowExecutionEventDto,
	WorkflowExecutionSnapshotDto,
	WorkflowNodeRunHistoryDto,
	WorkflowNodeRunDto,
} from "./execution.schemas";
export {
	ensureNodeRuns,
	incrementNodeRunAttempt,
	updateNodeRun,
	updateNodeRuns,
} from "./execution.node-run-store";

export type ExecutionRow = {
	id: string;
	flow_id: string;
	flow_version_id: string;
	owner_id: string;
	status: string;
	concurrency: number;
	trigger: string | null;
	error_message: string | null;
	error_code?: string | null;
	failure_stage?: string | null;
	project_id?: string | null;
	canvas_id?: string | null;
	user_input?: string | null;
	project_context?: string | null;
	asset_snapshot?: string | null;
	retry_count?: number;
	recovery_of_execution_id?: string | null;
	execution_family_id: string;
	uses_project_assets?: boolean;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	flows?: {
		name: string;
	};
};

export type NodeRunRow = {
	id: string;
	execution_id: string;
	node_id: string;
	status: string;
	attempt: number;
	error_message: string | null;
	error_code?: string | null;
	failure_stage?: string | null;
	input_refs?: string | null;
	output_refs: string | null;
	tool_calls?: string | null;
	retry_count?: number;
	node_type?: string | null;
	tool_name?: string | null;
	model_key?: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type ExecutionHistoryNodeRow = Pick<
	NodeRunRow,
	"node_id" | "status" | "error_message" | "created_at"
>;

export class WorkflowRecoveryAdmissionError extends Error {
	constructor(
		message: string,
		public readonly reason:
			| "recovery_source_missing"
			| "recovery_source_owner_mismatch"
			| "recovery_source_status_changed"
			| "recovery_family_canceled",
	) {
		super(message);
		this.name = "WorkflowRecoveryAdmissionError";
	}
}

export type ExecutionHistoryRow = ExecutionRow & {
	workflow_node_runs: ExecutionHistoryNodeRow[];
	flow_versions: {
		data: string;
	};
};

export type ExecutionSnapshotRow = {
	id: string;
	flow_id: string;
	flow_version_id: string;
	flow_versions: {
		name: string;
		data: string;
		created_at: string;
	};
};

export type NodeRunHistoryRow = NodeRunRow & {
	workflow_executions: {
		status: string;
		created_at: string;
		finished_at: string | null;
	};
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
	const projectContext = parseStoredJson(row.project_context ?? null);
	const assetSnapshot = parseStoredJson(row.asset_snapshot ?? null);
	return {
		id: row.id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		workflowVersion: row.flow_version_id,
		...(row.flows ? { flowName: row.flows.name } : {}),
		ownerId: row.owner_id,
		status: row.status as WorkflowExecutionDto["status"],
		concurrency: Number(row.concurrency || 1),
		trigger: row.trigger,
		errorMessage: row.error_message,
		errorCode: row.error_code ?? null,
		failureStage: row.failure_stage ?? null,
		projectId: row.project_id ?? null,
		canvasId: row.canvas_id ?? null,
		userInput: row.user_input ?? null,
		...(projectContext !== undefined ? { projectContext } : {}),
		...(assetSnapshot !== undefined ? { assetSnapshot } : {}),
		durationMs: durationMs(row.started_at ?? row.created_at, row.finished_at),
		retryCount: Number(row.retry_count || 0),
		recoveryOfExecutionId: row.recovery_of_execution_id ?? null,
		executionFamilyId: row.execution_family_id,
		usesProjectAssets: row.uses_project_assets === true,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

function parseStoredJson(value: string | null): unknown | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function durationMs(startedAt: string | null, finishedAt: string | null): number | null {
	if (!startedAt || !finishedAt) return null;
	const duration = Date.parse(finishedAt) - Date.parse(startedAt);
	return Number.isFinite(duration) && duration >= 0 ? Math.trunc(duration) : null;
}

const NODE_FOCUS_PRIORITY: Readonly<Record<WorkflowNodeRunDto["status"], number>> = {
	failed: 0,
	waiting_external: 1,
	running: 2,
	queued: 3,
	canceled: 4,
	success: 5,
	skipped: 6,
	not_selected: 7,
};

function frozenNodeLabel(snapshotData: string, nodeId: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(snapshotData) as unknown;
	} catch (error: unknown) {
		throw new Error(`Workflow execution history has an invalid immutable flow snapshot: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Workflow execution history immutable flow snapshot must be an object");
	}
	const nodes = (parsed as Record<string, unknown>).nodes;
	if (!Array.isArray(nodes)) throw new Error("Workflow execution history immutable flow snapshot must contain nodes");
	const node = nodes.find((value) => (
		Boolean(value)
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& (value as Record<string, unknown>).id === nodeId
	));
	if (!node || typeof node !== "object" || Array.isArray(node)) return nodeId;
	const data = (node as Record<string, unknown>).data;
	if (!data || typeof data !== "object" || Array.isArray(data)) return nodeId;
	const record = data as Record<string, unknown>;
	const label = typeof record.label === "string" ? record.label.trim() : "";
	const workflowNodeId = typeof record.workflowNodeId === "string" ? record.workflowNodeId.trim() : "";
	return label || workflowNodeId || nodeId;
}

export function mapExecutionHistoryRow(row: ExecutionHistoryRow): WorkflowExecutionDto {
	const { projectContext: _projectContext, assetSnapshot: _assetSnapshot, ...execution } = mapExecutionRow(row);
	const summary = {
		total: row.workflow_node_runs.length,
		queued: 0,
		running: 0,
		waitingExternal: 0,
		success: 0,
		failed: 0,
		canceled: 0,
		skipped: 0,
		notSelected: 0,
	};
	for (const nodeRun of row.workflow_node_runs) {
		if (nodeRun.status === "pending" || nodeRun.status === "queued") summary.queued += 1;
		else if (nodeRun.status === "running") summary.running += 1;
		else if (nodeRun.status === "waiting_external") summary.waitingExternal += 1;
		else if (nodeRun.status === "success") summary.success += 1;
		else if (nodeRun.status === "failed") summary.failed += 1;
		else if (nodeRun.status === "canceled") summary.canceled += 1;
		else if (nodeRun.status === "skipped") summary.skipped += 1;
		else if (nodeRun.status === "not_selected") summary.notSelected += 1;
	}
	const focus = [...row.workflow_node_runs].sort((left, right) => {
		const statusDelta = (NODE_FOCUS_PRIORITY[left.status as WorkflowNodeRunDto["status"]] ?? 99)
			- (NODE_FOCUS_PRIORITY[right.status as WorkflowNodeRunDto["status"]] ?? 99);
		if (statusDelta !== 0) return statusDelta;
		return left.created_at.localeCompare(right.created_at);
	})[0];
	return {
		...execution,
		nodeSummary: summary,
		focusNode: focus && NODE_FOCUS_PRIORITY[focus.status as WorkflowNodeRunDto["status"]] <= 3
			? {
				nodeId: focus.node_id,
				nodeLabel: frozenNodeLabel(row.flow_versions.data, focus.node_id),
				status: (focus.status === "pending" ? "queued" : focus.status) as WorkflowNodeRunDto["status"],
				errorMessage: focus.error_message,
			}
			: null,
	};
}

export function mapExecutionSnapshotRow(row: ExecutionSnapshotRow): WorkflowExecutionSnapshotDto {
	let data: unknown;
	try {
		data = JSON.parse(row.flow_versions.data) as unknown;
	} catch (error: unknown) {
		throw new Error(
			`Workflow execution ${row.id} has an invalid immutable flow snapshot: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return {
		executionId: row.id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		name: row.flow_versions.name,
		createdAt: row.flow_versions.created_at,
		data,
	};
}

export function mapNodeRunRow(row: NodeRunRow): WorkflowNodeRunDto {
	const inputRefs = parseStoredJson(row.input_refs ?? null);
	const outputRefs = parseStoredJson(row.output_refs);
	const toolCalls = parseStoredJson(row.tool_calls ?? null);
	return {
		id: row.id,
		executionId: row.execution_id,
		nodeId: row.node_id,
		status: (row.status === "pending" ? "queued" : row.status) as WorkflowNodeRunDto["status"],
		attempt: Number(row.attempt || 1),
		errorMessage: row.error_message,
		errorCode: row.error_code ?? null,
		failureStage: row.failure_stage ?? null,
		...(inputRefs !== undefined ? { inputRefs } : {}),
		...(outputRefs !== undefined ? { outputRefs } : {}),
		...(toolCalls !== undefined ? { toolCalls } : {}),
		retryCount: Number(row.retry_count || 0),
		nodeType: row.node_type ?? null,
		toolName: row.tool_name ?? null,
		modelKey: row.model_key ?? null,
		durationMs: durationMs(row.started_at, row.finished_at),
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function mapNodeRunHistoryRow(
	row: NodeRunHistoryRow,
): WorkflowNodeRunHistoryDto {
	return {
		...mapNodeRunRow(row),
		executionStatus: row.workflow_executions
			.status as WorkflowNodeRunHistoryDto["executionStatus"],
		executionCreatedAt: row.workflow_executions.created_at,
		executionFinishedAt: row.workflow_executions.finished_at,
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
		eventType: row.event_type as WorkflowExecutionEventDto["eventType"],
		level: row.level as WorkflowExecutionEventDto["level"],
		nodeId: row.node_id,
		message: row.message,
		data,
		createdAt: row.created_at,
	};
}

export async function createExecution(
	db: PrismaClient,
	params: {
		id: string;
		flowId: string;
		flowVersionId: string;
		ownerId: string;
		concurrency: number;
		trigger?: string | null;
		projectId?: string | null;
		canvasId?: string | null;
		userInput?: string | null;
		projectContext?: unknown;
		assetSnapshot?: unknown;
		recoveryOfExecutionId?: string | null;
		recoveryAdmission?: "failed_source" | "cancellation_revocation";
		executionFamilyId: string;
		usesProjectAssets?: boolean;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const { id, flowId, flowVersionId, ownerId, concurrency, trigger, nowIso } =
		params;
	const data = {
			id,
			flow_id: flowId,
			flow_version_id: flowVersionId,
			owner_id: ownerId,
			status: "queued",
			concurrency,
			trigger: trigger ?? null,
			project_id: params.projectId ?? null,
			canvas_id: params.canvasId ?? null,
			user_input: params.userInput ?? null,
			project_context: params.projectContext === undefined ? null : JSON.stringify(params.projectContext),
			asset_snapshot: params.assetSnapshot === undefined ? null : JSON.stringify(params.assetSnapshot),
			recovery_of_execution_id: params.recoveryOfExecutionId ?? null,
			execution_family_id: params.executionFamilyId,
			uses_project_assets: params.usesProjectAssets === true,
			created_at: nowIso,
	};
	if (!params.recoveryOfExecutionId) {
		await getPrismaClient().workflow_executions.create({ data });
		return;
	}

	const sourceExecutionId = params.recoveryOfExecutionId;
	const admission = params.recoveryAdmission ?? "failed_source";
	await getPrismaClient().$transaction(async (transaction) => {
		// The same source-row lock is contended by cancellation's status UPDATE.
		// Whichever operation wins becomes observable to the loser before a child
		// execution can be inserted, closing the cancel-vs-resume admission race.
		const sources = await transaction.$queryRawUnsafe<Array<{
			id: string;
			owner_id: string;
			status: string;
			execution_family_id: string;
		}>>(
			'SELECT "id", "owner_id", "status", "execution_family_id" FROM "workflow_executions" WHERE "id" = $1 FOR UPDATE',
			sourceExecutionId,
		);
		const source = sources[0];
		if (!source) {
			throw new WorkflowRecoveryAdmissionError(
				"Workflow recovery source no longer exists",
				"recovery_source_missing",
			);
		}
		if (source.owner_id !== ownerId || source.execution_family_id !== params.executionFamilyId) {
			throw new WorkflowRecoveryAdmissionError(
				"Workflow recovery source left the authorized execution family",
				"recovery_source_owner_mismatch",
			);
		}
		const requiredStatus = admission === "cancellation_revocation" ? "canceled" : "failed";
		if (source.status !== requiredStatus) {
			throw new WorkflowRecoveryAdmissionError(
				`Workflow recovery source status changed from ${requiredStatus} to ${source.status}`,
				"recovery_source_status_changed",
			);
		}
		if (admission === "failed_source") {
			const canceledFamilyMember = await transaction.workflow_execution_events.findFirst({
				where: {
					event_type: "execution_canceled",
					workflow_executions: {
						execution_family_id: source.execution_family_id,
						owner_id: ownerId,
					},
				},
				select: { id: true },
			});
			if (canceledFamilyMember) {
				throw new WorkflowRecoveryAdmissionError(
					"Workflow execution family has a persisted cancellation fence",
					"recovery_family_canceled",
				);
			}
		}
		await transaction.workflow_executions.create({ data });
	}, {
		isolationLevel: "Serializable",
		timeout: 20_000,
		maxWait: 10_000,
	});
}

export async function getExecutionForOwner(
	db: PrismaClient,
	executionId: string,
	ownerId: string,
): Promise<ExecutionRow | null> {
	void db;
	return getPrismaClient().workflow_executions.findFirst({
		where: { id: executionId, owner_id: ownerId },
	});
}

export async function getExecutionById(
	db: PrismaClient,
	executionId: string,
): Promise<ExecutionRow | null> {
	void db;
	return getPrismaClient().workflow_executions.findUnique({
		where: { id: executionId },
	});
}

export async function claimQueuedExecutionStart(
	db: PrismaClient,
	params: Readonly<{ executionId: string; startedAt: string }>,
): Promise<boolean> {
	void db;
	const result = await getPrismaClient().workflow_executions.updateMany({
		where: { id: params.executionId, status: "queued" },
		data: { status: "running", started_at: params.startedAt },
	});
	return result.count === 1;
}

export async function listExecutionsForOwnerFlow(
	db: PrismaClient,
	params: { ownerId: string; flowId: string; limit?: number },
): Promise<ExecutionRow[]> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 30)));
	return getPrismaClient().workflow_executions.findMany({
		where: {
			owner_id: params.ownerId,
			OR: [{ flow_id: params.flowId }, { canvas_id: params.flowId }],
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function listExecutionHistoryForOwnerFlow(
	db: PrismaClient,
	params: { ownerId: string; flowId: string; limit?: number; activeOnly?: boolean },
): Promise<ExecutionHistoryRow[]> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 30)));
	return getPrismaClient().workflow_executions.findMany({
		where: {
			owner_id: params.ownerId,
			OR: [{ flow_id: params.flowId }, { canvas_id: params.flowId }],
			...(params.activeOnly === true ? { status: { in: ["queued", "running"] } } : {}),
		},
		include: {
			flow_versions: {
				select: { data: true },
			},
			workflow_node_runs: {
				select: {
					node_id: true,
					status: true,
					error_message: true,
					created_at: true,
				},
			},
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function listExecutionHistoryPageForOwner(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; flowId?: string; limit?: number; cursor?: string }>,
): Promise<Readonly<{ items: ExecutionHistoryRow[]; nextCursor: string | null }>> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 40)));
	const rows = await getPrismaClient().workflow_executions.findMany({
		where: {
			owner_id: params.ownerId,
			...(params.flowId
				? { OR: [{ flow_id: params.flowId }, { canvas_id: params.flowId }] }
				: {}),
		},
		include: {
			flows: { select: { name: true } },
			flow_versions: { select: { data: true } },
			workflow_node_runs: {
				select: {
					node_id: true,
					status: true,
					error_message: true,
					created_at: true,
				},
			},
		},
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
		take: limit + 1,
	});
	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	return {
		items,
		nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
	};
}

export async function getExecutionSnapshotForOwner(
	db: PrismaClient,
	params: { ownerId: string; executionId: string },
): Promise<ExecutionSnapshotRow | null> {
	void db;
	return getPrismaClient().workflow_executions.findFirst({
		where: { id: params.executionId, owner_id: params.ownerId },
		select: {
			id: true,
			flow_id: true,
			flow_version_id: true,
			flow_versions: {
				select: {
					name: true,
					data: true,
					created_at: true,
				},
			},
		},
	});
}

export async function listNodeRunsForExecutionOwner(
	db: PrismaClient,
	params: { ownerId: string; executionId: string },
): Promise<NodeRunRow[]> {
	void db;
	return getPrismaClient().workflow_node_runs.findMany({
		where: {
			execution_id: params.executionId,
			workflow_executions: {
				owner_id: params.ownerId,
			},
		},
		orderBy: { created_at: "asc" },
	});
}

/**
 * Reads only the successful, authored workflow output boundary for one owned
 * execution. Callers use this as the canonical user-delivery surface instead
 * of scanning arbitrary intermediate node output.
 */
export async function listSuccessfulWorkflowOutputNodeRunsForExecutionOwner(
	db: PrismaClient,
	params: { ownerId: string; executionId: string },
): Promise<NodeRunRow[]> {
	void db;
	return getPrismaClient().workflow_node_runs.findMany({
		where: {
			execution_id: params.executionId,
			status: "success",
			node_type: "workflow.output/v1",
			workflow_executions: {
				owner_id: params.ownerId,
			},
		},
		orderBy: [{ created_at: "asc" }, { id: "asc" }],
	});
}

export async function listNodeRunHistoryForOwnerFlow(
	db: PrismaClient,
	params: { ownerId: string; flowId: string; nodeId: string; limit?: number },
): Promise<NodeRunHistoryRow[]> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 20)));
	return getPrismaClient().workflow_node_runs.findMany({
		where: {
			node_id: params.nodeId,
			workflow_executions: {
				owner_id: params.ownerId,
				flow_id: params.flowId,
			},
		},
		select: {
			id: true,
			execution_id: true,
			node_id: true,
			status: true,
			attempt: true,
			error_message: true,
			output_refs: true,
			created_at: true,
			started_at: true,
			finished_at: true,
			workflow_executions: {
				select: {
					status: true,
					created_at: true,
					finished_at: true,
				},
			},
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function updateExecutionStatus(
	db: PrismaClient,
	params: {
		executionId: string;
		status: string;
		errorMessage?: string | null;
		errorCode?: string | null;
		failureStage?: string | null;
		startedAt?: string | null;
		finishedAt?: string | null;
	},
): Promise<void> {
	void db;
	const data: {
		status: string;
		error_message?: string;
		error_code?: string;
		failure_stage?: string;
		started_at?: string;
		finished_at?: string;
	} = { status: params.status };
	if (params.errorMessage != null) data.error_message = params.errorMessage;
	if (params.errorCode != null) data.error_code = params.errorCode;
	if (params.failureStage != null) data.failure_stage = params.failureStage;
	if (params.startedAt != null) data.started_at = params.startedAt;
	if (params.finishedAt != null) data.finished_at = params.finishedAt;

	await getPrismaClient().workflow_executions.update({
		where: { id: params.executionId },
		data,
	});
}

export async function insertExecutionEvent(
	db: PrismaClient,
	params: {
		id: string;
		executionId: string;
		eventType: string;
		level?: string;
		nodeId?: string | null;
		message?: string | null;
		data?: unknown;
		nowIso: string;
	},
): Promise<number> {
	void db;
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
	return getPrismaClient().$transaction(async (transaction) => {
		const lockedExecution = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
			'SELECT "id" FROM "workflow_executions" WHERE "id" = $1 FOR UPDATE',
			params.executionId,
		);
		if (lockedExecution.length !== 1) {
			throw new Error(`workflow execution not found while appending event: ${params.executionId}`);
		}
		const latest = await transaction.workflow_execution_events.findFirst({
			where: { execution_id: params.executionId },
			select: { seq: true },
			orderBy: { seq: "desc" },
		});
		const seq = (latest?.seq ?? 0) + 1;
		await transaction.workflow_execution_events.create({
			data: {
				id: params.id,
				execution_id: params.executionId,
				seq,
				event_type: params.eventType,
				level: params.level || "info",
				node_id: params.nodeId ?? null,
				message: params.message ?? null,
				data: payload,
				created_at: params.nowIso,
			},
		});
		return seq;
	}, {
		// 交互式事务默认 5s 超时；媒体/工作流事件追加在 DB 负载高时会超时（与
		// execution_trace_events 同款 "Transaction already closed" 症状），显式放宽。
		timeout: 20_000,
		maxWait: 10_000,
	});
}

export async function listExecutionEvents(
	db: PrismaClient,
	params: { executionId: string; afterSeq: number; limit: number },
): Promise<ExecutionEventRow[]> {
	void db;
	const limit = Math.max(1, Math.min(200, Math.floor(params.limit || 50)));
	return getPrismaClient().workflow_execution_events.findMany({
		where: {
			execution_id: params.executionId,
			seq: { gt: params.afterSeq },
		},
		orderBy: { seq: "asc" },
		take: limit,
	});
}

type MetricBucket = { total: number; success: number; failed: number };

function metricRate(success: number, total: number): number {
	return total === 0 ? 0 : Number((success / total).toFixed(4));
}

function bucketRows(map: Map<string, MetricBucket>): Array<Readonly<{
	key: string;
	total: number;
	success: number;
	failed: number;
	successRate: number;
}>> {
	return [...map.entries()].map(([key, bucket]) => ({
		key,
		...bucket,
		successRate: metricRate(bucket.success, bucket.total),
	})).sort((left, right) => right.total - left.total || left.key.localeCompare(right.key));
}

function addBucket(map: Map<string, MetricBucket>, key: string, succeeded: boolean): void {
	const bucket = map.get(key) ?? { total: 0, success: 0, failed: 0 };
	bucket.total += 1;
	if (succeeded) bucket.success += 1;
	else bucket.failed += 1;
	map.set(key, bucket);
}

export async function getWorkflowExecutionMetricsForOwner(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; flowId?: string; limit?: number }>,
): Promise<Record<string, unknown>> {
	void db;
	const executions = await getPrismaClient().workflow_executions.findMany({
		where: {
			owner_id: params.ownerId,
			...(params.flowId ? { OR: [{ flow_id: params.flowId }, { canvas_id: params.flowId }] } : {}),
		},
		select: {
			id: true,
			status: true,
			flow_version_id: true,
			uses_project_assets: true,
			recovery_of_execution_id: true,
			workflow_node_runs: {
				select: { status: true, node_type: true, tool_name: true, model_key: true },
			},
		},
		orderBy: { created_at: "desc" },
		take: Math.max(1, Math.min(1000, Math.trunc(params.limit ?? 500))),
	});
	const terminal = executions.filter((run) => run.status === "success" || run.status === "failed");
	const succeeded = terminal.filter((run) => run.status === "success").length;
	const recoveries = terminal.filter((run) => Boolean(run.recovery_of_execution_id));
	const nodes = terminal.flatMap((run) => run.workflow_node_runs);
	const settledNodes = nodes.filter((node) => node.status === "success" || node.status === "failed");
	const version = new Map<string, MetricBucket>();
	const assetUsage = new Map<string, MetricBucket>();
	const nodeType = new Map<string, MetricBucket>();
	const tool = new Map<string, MetricBucket>();
	const model = new Map<string, MetricBucket>();
	for (const run of terminal) {
		addBucket(version, run.flow_version_id, run.status === "success");
		addBucket(assetUsage, run.uses_project_assets ? "uses_project_assets" : "no_project_assets", run.status === "success");
	}
	for (const node of settledNodes) {
		const ok = node.status === "success";
		addBucket(nodeType, node.node_type || "unknown", ok);
		if (node.tool_name) addBucket(tool, node.tool_name, ok);
		if (node.model_key) addBucket(model, node.model_key, ok);
	}
	return {
		sampleSize: terminal.length,
		workflowSuccessRate: metricRate(succeeded, terminal.length),
		nodeFailureRate: metricRate(settledNodes.filter((node) => node.status === "failed").length, settledNodes.length),
		recoverySuccessRate: metricRate(recoveries.filter((run) => run.status === "success").length, recoveries.length),
		breakdowns: {
			workflowVersion: bucketRows(version),
			nodeType: bucketRows(nodeType),
			tool: bucketRows(tool),
			model: bucketRows(model),
			projectAssetUsage: bucketRows(assetUsage),
		},
	};
}
