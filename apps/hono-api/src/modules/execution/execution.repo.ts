import { hydrateExecutionHistoryFocus, type ExecutionHistoryFocus, type ExecutionHistoryNodeMetadata } from "./execution.history-focus";
import { decodeWorkflowOutput } from "./execution.output-storage";
import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type {
	WorkflowExecutionDto,
	WorkflowExecutionEventDto,
	WorkflowExecutionSnapshotDto,
	WorkflowNodeRunHistoryDto,
	WorkflowNodeRunDto,
} from "./execution.schemas";
import { resolveWorkflowWaitingReason } from "./execution.workflow-waiting-reason";
import { Prisma } from "@prisma/client";
import {
	parseWorkflowNodeAgentProgress,
	type WorkflowNodeAgentProgress,
} from "./execution.agent-progress";
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
	agent_progress?: WorkflowNodeAgentProgress | null;
	tool_calls?: string | null;
	retry_count?: number;
	node_type?: string | null;
	tool_name?: string | null;
	model_key?: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type ExecutionHistoryNodeRow = ExecutionHistoryNodeMetadata;

export class WorkflowRecoveryAdmissionError extends Error {
	constructor(
		message: string,
		public readonly reason:
			| "recovery_source_missing"
			| "recovery_source_owner_mismatch"
			| "recovery_source_status_changed"
			| "recovery_family_active"
			| "recovery_family_not_latest"
			| "recovery_family_canceled",
	) {
		super(message);
		this.name = "WorkflowRecoveryAdmissionError";
	}
}

/**
 * One caller canvas is the delivery target of at most one active full run of a
 * given workflow. Two concurrent families writing the same chapter canvas double
 * the paid Agent/media work and race each other's canvas projections (AI chat
 * launching while a manual recovery of the same chapter was already running).
 */
export type WorkflowExclusiveDeliveryScope = Readonly<{
	projectId: string;
	canvasId: string;
}>;

export class WorkflowDeliveryScopeBusyError extends Error {
	constructor(public readonly activeExecutionId: string) {
		super(`当前画布已有同一工作流在运行（${activeExecutionId}），不能重复发起`);
		this.name = "WorkflowDeliveryScopeBusyError";
	}
}

async function assertDeliveryScopeIdle(
	transaction: Prisma.TransactionClient,
	params: Readonly<{
		ownerId: string;
		flowId: string;
		executionFamilyId: string;
		scope: WorkflowExclusiveDeliveryScope;
	}>,
): Promise<void> {
	// Serializes concurrent admissions for the same scope; released at commit.
	await transaction.$queryRawUnsafe(
		"SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext($1))",
		`workflow-delivery-scope:${params.ownerId}:${params.flowId}:${params.scope.projectId}:${params.scope.canvasId}`,
	);
	const active = await transaction.workflow_executions.findFirst({
		where: {
			owner_id: params.ownerId,
			flow_id: params.flowId,
			project_id: params.scope.projectId,
			canvas_id: params.scope.canvasId,
			status: { in: ["queued", "running"] },
			// The same family (idempotent retry, or the recovery's own source) is not a competitor.
			NOT: { execution_family_id: params.executionFamilyId },
		},
		select: { id: true },
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
	});
	if (active) throw new WorkflowDeliveryScopeBusyError(active.id);
}

/**
 * The status a recovery source must already have when the child execution is
 * admitted.
 *
 * `provider_balance_recovery` (balance restoration and Agent model cutover)
 * fences its own source before admission: the caller cancels the active
 * execution so no live turn can race the recovery. That fence leaves the
 * source `canceled`, so requiring `failed` here would reject the very recovery
 * that just performed it. A terminal source that was never fenced stays
 * admissible too, because the suspension receipt — not the execution status —
 * is the authority for this mode.
 */
function requiredRecoverySourceStatus(
	admission: "failed_source" | "cancellation_revocation" | "provider_balance_recovery" | "media_retry",
): readonly string[] {
	if (admission === "failed_source") return ["failed"];
	if (admission === "cancellation_revocation") return ["canceled"];
	if (admission === "media_retry") return ["success", "failed", "canceled"];
	return ["canceled", "failed"];
}

export type ExecutionHistoryRow = ExecutionRow & {
	workflow_node_runs: ExecutionHistoryNodeRow[];
	focus_node: ExecutionHistoryFocus | null;
};

// History exposes execution metadata, never the frozen project/media payloads.
// Select at the database boundary so Prisma does not materialize those strings.
const executionHistoryMetadataSelect = {
	id: true, flow_id: true, flow_version_id: true, owner_id: true,
	status: true, concurrency: true, trigger: true,
	error_message: true, error_code: true, failure_stage: true,
	project_id: true, canvas_id: true, user_input: true,
	retry_count: true, recovery_of_execution_id: true, execution_family_id: true,
	uses_project_assets: true, created_at: true, started_at: true, finished_at: true,
} as const;

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

export function mapExecutionHistoryRow(row: ExecutionHistoryRow): WorkflowExecutionDto {
	const { project_context: _projectContext, asset_snapshot: _assetSnapshot, ...metadata } = row;
	const execution = mapExecutionRow(metadata);
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
	const focus = row.focus_node?.node;
	const focusWaitingReason = row.focus_node?.waitingReason;
	return {
		...execution,
		nodeSummary: summary,
		focusNode: focus && row.focus_node
			? {
				nodeId: focus.node_id,
				nodeLabel: row.focus_node.label,
				status: (focus.status === "pending" ? "queued" : focus.status) as WorkflowNodeRunDto["status"],
				errorMessage: focus.error_message,
				waitingReasonCode: focusWaitingReason?.code ?? null,
				waitingReasonLabel: focusWaitingReason?.label ?? null,
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
	const outputRefs = row.output_refs === null ? undefined : decodeWorkflowOutput(row.output_refs);
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
		...(row.agent_progress ? { agentProgress: row.agent_progress } : {}),
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
		recoveryAdmission?: "failed_source" | "cancellation_revocation" | "provider_balance_recovery" | "media_retry";
		executionFamilyId: string;
		usesProjectAssets?: boolean;
		/** Reject admission while another family is actively delivering into this canvas. */
		exclusiveDeliveryScope?: WorkflowExclusiveDeliveryScope;
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
	const exclusiveDeliveryScope = params.exclusiveDeliveryScope;
	if (!params.recoveryOfExecutionId) {
		if (!exclusiveDeliveryScope) {
			await getPrismaClient().workflow_executions.create({ data });
			return;
		}
		await getPrismaClient().$transaction(async (transaction) => {
			await assertDeliveryScopeIdle(transaction, {
				ownerId,
				flowId,
				executionFamilyId: params.executionFamilyId,
				scope: exclusiveDeliveryScope,
			});
			await transaction.workflow_executions.create({ data });
		}, { timeout: 20_000, maxWait: 10_000 });
		return;
	}

	const sourceExecutionId = params.recoveryOfExecutionId;
	const admission = params.recoveryAdmission ?? "failed_source";
	await getPrismaClient().$transaction(async (transaction) => {
		if (exclusiveDeliveryScope) {
			await assertDeliveryScopeIdle(transaction, {
				ownerId,
				flowId,
				executionFamilyId: params.executionFamilyId,
				scope: exclusiveDeliveryScope,
			});
		}
		// The same source-row lock is contended by cancellation's status UPDATE.
		// Whichever operation wins becomes observable to the loser before a child
		// execution can be inserted, closing the cancel-vs-resume admission race.
		const sources = await transaction.$queryRawUnsafe<Array<{
			id: string;
			owner_id: string;
			status: string;
			execution_family_id: string;
			created_at: string;
		}>>(
			'SELECT "id", "owner_id", "status", "execution_family_id", "created_at" FROM "workflow_executions" WHERE "id" = $1 FOR UPDATE',
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
		const requiredStatuses = requiredRecoverySourceStatus(admission);
		if (!requiredStatuses.includes(source.status)) {
			throw new WorkflowRecoveryAdmissionError(
				`Workflow recovery source status changed from ${requiredStatuses.join("/")} to ${source.status}`,
				"recovery_source_status_changed",
			);
		}
		if (admission === "media_retry") {
			const existingAttempt = await transaction.workflow_executions.findFirst({
				where: { id, owner_id: ownerId, execution_family_id: source.execution_family_id },
				select: { id: true, recovery_of_execution_id: true },
			});
			if (existingAttempt) {
				if (existingAttempt.recovery_of_execution_id !== sourceExecutionId) {
					throw new WorkflowRecoveryAdmissionError(
						"The media retry identity belongs to a different source execution",
						"recovery_source_owner_mismatch",
					);
				}
				// Let the primary-key conflict converge duplicate clicks onto the
				// existing immutable attempt in startWorkflowExecution.
			} else {
				const [latest, activeCount] = await Promise.all([
					transaction.workflow_executions.findFirst({
						where: { execution_family_id: source.execution_family_id, owner_id: ownerId },
						select: { id: true },
						orderBy: [{ created_at: "desc" }, { id: "desc" }],
					}),
					transaction.workflow_executions.count({
						where: {
							execution_family_id: source.execution_family_id,
							owner_id: ownerId,
							status: { in: ["queued", "running"] },
						},
					}),
				]);
				if (latest?.id !== sourceExecutionId) {
					throw new WorkflowRecoveryAdmissionError(
						"Media retry requires the latest execution-family member",
						"recovery_family_not_latest",
					);
				}
				if (activeCount > 0) {
					throw new WorkflowRecoveryAdmissionError(
						"Media retry requires an inactive execution family",
						"recovery_family_active",
					);
				}
			}
		}
		if (admission === "failed_source") {
			const canceledFamilyMember = await transaction.workflow_execution_events.findFirst({
				where: {
					event_type: "execution_canceled",
					// This source was already admitted across earlier fences by an
					// authorized recovery. Only cancellations since that admission
					// can revoke its right to continue; historical cutover/revocation
					// receipts must not permanently poison the whole execution family.
					created_at: { gte: source.created_at },
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

export async function listSuccessfulNodeRunsForOwnerCanvas(
	db: PrismaClient,
	params: { ownerId: string; canvasId: string },
): Promise<Array<{ execution_id: string; output_refs: string | null }>> {
	void db;
	return getPrismaClient().workflow_node_runs.findMany({
		where: {
			status: "success",
			output_refs: { not: null },
			workflow_executions: { owner_id: params.ownerId, canvas_id: params.canvasId },
		},
		select: { execution_id: true, output_refs: true },
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
	});
}

export async function listExecutionHistoryForOwnerFlow(
	db: PrismaClient,
	params: { ownerId: string; flowId: string; limit?: number; activeOnly?: boolean },
): Promise<ExecutionHistoryRow[]> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 30)));
	const rows = await getPrismaClient().workflow_executions.findMany({
		where: {
			owner_id: params.ownerId,
			OR: [{ flow_id: params.flowId }, { canvas_id: params.flowId }],
			...(params.activeOnly === true ? { status: { in: ["queued", "running"] } } : {}),
		},
		select: {
			...executionHistoryMetadataSelect,
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
	return hydrateExecutionHistoryFocus(getPrismaClient(), rows);
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
		select: {
			...executionHistoryMetadataSelect,
			flows: { select: { name: true } },
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
		items: await hydrateExecutionHistoryFocus(getPrismaClient(), items),
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
	const prisma = getPrismaClient();
	const rows = await prisma.workflow_node_runs.findMany({
		where: {
			execution_id: params.executionId,
			workflow_executions: {
				owner_id: params.ownerId,
			},
		},
		orderBy: { created_at: "asc" },
	});
	if (rows.length === 0) return rows;
	let progressRows: Array<{ node_id: string; data: string | null }>;
	try {
		progressRows = await prisma.$queryRaw<Array<{ node_id: string; data: string | null }>>(Prisma.sql`
			SELECT DISTINCT ON (activity."node_id") activity."node_id", activity."data"
			FROM "workflow_execution_events" AS activity
			JOIN "workflow_node_runs" AS current_run
				ON current_run."execution_id" = activity."execution_id"
				AND current_run."node_id" = activity."node_id"
			JOIN "workflow_executions" AS execution
				ON execution."id" = activity."execution_id"
			WHERE activity."execution_id" = ${params.executionId}
				AND execution."owner_id" = ${params.ownerId}
				AND activity."event_type" = 'node_agent_activity'
				AND activity."node_id" IS NOT NULL
				AND activity."data" IS NOT NULL
				AND activity."data"::jsonb ->> 'attempt' = current_run."attempt"::text
			ORDER BY activity."node_id", activity."seq" DESC
		`);
	} catch (error: unknown) {
		console.warn(JSON.stringify({
			message: "workflow_node_agent_activity_poll_projection_failed",
			executionId: params.executionId,
			ownerId: params.ownerId,
			errorName: error instanceof Error ? error.name : "unknown",
		}));
		return rows;
	}
	const progressByNodeId = new Map<string, WorkflowNodeAgentProgress>();
	const runByNodeId = new Map(rows.map((run) => [run.node_id, run] as const));
	for (const row of progressRows) {
		if (typeof row.data !== "string") continue;
		let raw: unknown;
		try {
			raw = JSON.parse(row.data) as unknown;
		} catch {
			console.warn(JSON.stringify({
				message: "workflow_node_agent_activity_poll_event_invalid_json",
				executionId: params.executionId,
				nodeId: row.node_id,
			}));
			continue;
		}
		const progress = parseWorkflowNodeAgentProgress(raw);
		const run = runByNodeId.get(row.node_id);
		if (!progress || !run || progress.attempt !== run.attempt) {
			console.warn(JSON.stringify({
				message: "workflow_node_agent_activity_poll_event_invalid_contract",
				executionId: params.executionId,
				nodeId: row.node_id,
				attempt: run?.attempt ?? null,
			}));
			continue;
		}
		progressByNodeId.set(row.node_id, progress);
	}
	return rows.map((row) => ({
		...row,
		...(progressByNodeId.has(row.node_id)
			? { agent_progress: progressByNodeId.get(row.node_id) }
			: {}),
	}));
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

/** Re-admit only an owner-scoped execution that never acquired a scheduler. */
export async function requeueUnstartedExecution(
	db: PrismaClient,
	input: Readonly<{ executionId: string; ownerId: string }>,
): Promise<boolean> {
	const result = await db.workflow_executions.updateMany({
		where: {
			id: input.executionId, owner_id: input.ownerId, status: "failed",
			started_at: null, workflow_node_runs: { none: {} },
			OR: [{ error_code: null }, { error_code: "workflow_dispatch_pending" }],
		},
		data: { status: "queued", finished_at: null, error_message: null, error_code: null, failure_stage: null },
	});
	return result.count === 1;
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
	const prisma = getPrismaClient();
	// Keep lock acquisition and sequence allocation in separate READ COMMITTED
	// statements: allocation must see commits made while waiting for the lock.
	// Batch execution avoids a JS interactive transaction expiring between calls.
	const [lockedExecution, inserted] = await prisma.$transaction([
		prisma.$queryRawUnsafe<Array<{ id: string }>>(
			'SELECT "id" FROM "workflow_executions" WHERE "id" = $1 FOR UPDATE',
			params.executionId,
		),
		prisma.$queryRawUnsafe<Array<{ seq: number }>>(
			`INSERT INTO "workflow_execution_events"
			 ("id", "execution_id", "seq", "event_type", "level", "node_id", "message", "data", "created_at")
			 SELECT $1, parent."id", COALESCE((
			   SELECT MAX("seq") FROM "workflow_execution_events" WHERE "execution_id" = $2
			 ), 0) + 1, $3, $4, $5, $6, $7, $8
			 FROM "workflow_executions" parent WHERE parent."id" = $2
			 RETURNING "seq"`,
			params.id, params.executionId, params.eventType, params.level || "info",
			params.nodeId ?? null, params.message ?? null, payload, params.nowIso,
		),
	], { isolationLevel: "ReadCommitted" });
	if (lockedExecution.length !== 1 || inserted.length !== 1) {
		throw new Error(`workflow execution not found while appending event: ${params.executionId}`);
	}
	return inserted[0].seq;
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

export async function listSuccessfulWorkflowOutputNodeRunsForExecutionOwner(
	db: PrismaClient,
	params: { ownerId: string; executionId: string },
): Promise<NodeRunRow[]> {
	void db;
	return getPrismaClient().workflow_node_runs.findMany({
		where: {
			execution_id: params.executionId,
			status: "success",
			workflow_executions: {
				owner_id: params.ownerId,
			},
		},
		orderBy: [{ created_at: "asc" }, { id: "asc" }],
	});
}

export async function readExecutionFrozenGraphForOwner(
	db: PrismaClient,
	params: { ownerId: string; executionId: string },
): Promise<unknown> {
	void db;
	const row = await getPrismaClient().workflow_executions.findFirst({
		where: { id: params.executionId, owner_id: params.ownerId },
		select: { flow_versions: { select: { data: true } } },
	});
	if (!row) throw new Error("Workflow execution not found for owner");
	return JSON.parse(row.flow_versions.data) as unknown;
}
