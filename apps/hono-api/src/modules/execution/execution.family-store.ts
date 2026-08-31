import { parseWorkflowExecutionSemanticsV2 } from "@tapcanvas/workflow-kernel-protocol";
import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type {
	WorkflowExecutionFamilyDto,
	WorkflowExecutionFamilyMemberDto,
	WorkflowNodeAttemptDto,
	WorkflowNodeAttemptPageDto,
} from "./execution.schemas";

type WorkflowExecutionFamilyMemberRow = Readonly<{
	id: string;
	flow_id: string;
	flow_version_id: string;
	status: string;
	concurrency: number;
	trigger: string | null;
	error_message: string | null;
	error_code: string | null;
	failure_stage: string | null;
	project_id: string | null;
	canvas_id: string | null;
	retry_count: number;
	recovery_of_execution_id: string | null;
	execution_family_id: string;
	uses_project_assets: boolean;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	flows?: Readonly<{ name: string }>;
}>;

const WORKFLOW_EXECUTION_FAMILY_MEMBER_SELECT = {
	id: true,
	flow_id: true,
	flow_version_id: true,
	status: true,
	concurrency: true,
	trigger: true,
	error_message: true,
	error_code: true,
	failure_stage: true,
	project_id: true,
	canvas_id: true,
	retry_count: true,
	recovery_of_execution_id: true,
	execution_family_id: true,
	uses_project_assets: true,
	created_at: true,
	started_at: true,
	finished_at: true,
	flows: { select: { name: true } },
} as const;

function executionDurationMs(startedAt: string | null, finishedAt: string | null): number | null {
	if (!startedAt || !finishedAt) return null;
	const duration = Date.parse(finishedAt) - Date.parse(startedAt);
	return Number.isFinite(duration) && duration >= 0 ? Math.trunc(duration) : null;
}

export function mapWorkflowExecutionFamilyMemberRow(
	row: WorkflowExecutionFamilyMemberRow,
): WorkflowExecutionFamilyMemberDto {
	return {
		id: row.id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		workflowVersion: row.flow_version_id,
		...(row.flows ? { flowName: row.flows.name } : {}),
		status: row.status as WorkflowExecutionFamilyMemberDto["status"],
		concurrency: Number(row.concurrency || 1),
		trigger: row.trigger,
		errorMessage: row.error_message,
		errorCode: row.error_code,
		failureStage: row.failure_stage,
		projectId: row.project_id,
		canvasId: row.canvas_id,
		durationMs: executionDurationMs(row.started_at ?? row.created_at, row.finished_at),
		retryCount: Number(row.retry_count || 0),
		recoveryOfExecutionId: row.recovery_of_execution_id,
		executionFamilyId: row.execution_family_id,
		usesProjectAssets: row.uses_project_assets,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export type WorkflowNodeAttemptRow = Readonly<{
	id: string;
	execution_family_id: string;
	execution_id: string;
	node_run_id: string;
	node_id: string;
	attempt: number;
	trigger: string;
	status: string;
	semantics_snapshot: string;
	input_refs: string | null;
	output_refs: string | null;
	tool_calls: string | null;
	provider_receipts: string | null;
	token_usage: string | null;
	credit_usage: string | null;
	error_message: string | null;
	error_code: string | null;
	failure_stage: string | null;
	node_type: string | null;
	tool_name: string | null;
	model_key: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}>;

function parseJson(value: string | null, field: string): unknown | undefined {
	if (value === null) return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch (error: unknown) {
		throw new Error(`${field} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function parseProviderReceipts(value: string | null): readonly string[] | undefined {
	const parsed = parseJson(value, "Workflow node attempt providerReceipts");
	if (parsed === undefined) return undefined;
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item.trim())) {
		throw new Error("Workflow node attempt providerReceipts must be a non-empty string array");
	}
	return parsed.map((item) => item.trim());
}

export function mapWorkflowNodeAttemptRow(row: WorkflowNodeAttemptRow): WorkflowNodeAttemptDto {
	const semantics = parseWorkflowExecutionSemanticsV2(parseJson(row.semantics_snapshot, "Workflow node attempt semanticsSnapshot"));
	const inputRefs = parseJson(row.input_refs, "Workflow node attempt inputRefs");
	const outputRefs = parseJson(row.output_refs, "Workflow node attempt outputRefs");
	const toolCalls = parseJson(row.tool_calls, "Workflow node attempt toolCalls");
	const providerReceipts = parseProviderReceipts(row.provider_receipts);
	const tokenUsage = parseJson(row.token_usage, "Workflow node attempt tokenUsage");
	const creditUsage = parseJson(row.credit_usage, "Workflow node attempt creditUsage");
	return {
		id: row.id,
		executionFamilyId: row.execution_family_id,
		executionId: row.execution_id,
		nodeRunId: row.node_run_id,
		nodeId: row.node_id,
		attempt: Number(row.attempt),
		trigger: row.trigger as WorkflowNodeAttemptDto["trigger"],
		status: row.status as WorkflowNodeAttemptDto["status"],
		semanticsSnapshot: semantics,
		...(inputRefs !== undefined ? { inputRefs } : {}),
		...(outputRefs !== undefined ? { outputRefs } : {}),
		...(toolCalls !== undefined ? { toolCalls } : {}),
		...(providerReceipts !== undefined ? { providerReceipts: [...providerReceipts] } : {}),
		...(tokenUsage !== undefined ? { tokenUsage } : {}),
		...(creditUsage !== undefined ? { creditUsage } : {}),
		errorMessage: row.error_message,
		errorCode: row.error_code,
		failureStage: row.failure_stage,
		nodeType: row.node_type,
		toolName: row.tool_name,
		modelKey: row.model_key,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

function boundedPageLimit(limit: number | undefined): number {
	return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

export async function listWorkflowExecutionFamilyMemberIdsForOwner(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; executionFamilyId: string }>,
): Promise<readonly string[]> {
	void db;
	const prisma = getPrismaClient();
	const rows = await prisma.workflow_executions.findMany({
		where: {
			execution_family_id: params.executionFamilyId,
			owner_id: params.ownerId,
		},
		select: { id: true },
		orderBy: [{ created_at: "asc" }, { id: "asc" }],
	});
	return rows.map((row) => row.id);
}

export async function listWorkflowNodeAttemptsPageForExecutionOwner(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; executionId: string; cursor?: string; limit?: number }>,
): Promise<WorkflowNodeAttemptPageDto> {
	void db;
	const prisma = getPrismaClient();
	const limit = boundedPageLimit(params.limit);
	if (params.cursor) {
		const cursor = await prisma.workflow_node_attempts.findFirst({
			where: {
				id: params.cursor,
				execution_id: params.executionId,
				workflow_executions: { owner_id: params.ownerId },
			},
			select: { id: true },
		});
		if (!cursor) throw new Error("workflow_node_attempt_cursor_invalid");
	}
	const rows = await prisma.workflow_node_attempts.findMany({
		where: {
			execution_id: params.executionId,
			workflow_executions: { owner_id: params.ownerId },
		},
		orderBy: [{ created_at: "asc" }, { id: "asc" }],
		...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
		take: limit + 1,
	});
	const hasMore = rows.length > limit;
	const items = (hasMore ? rows.slice(0, limit) : rows).map((row) =>
		mapWorkflowNodeAttemptRow(row as WorkflowNodeAttemptRow),
	);
	return {
		items,
		nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
	};
}

export async function getWorkflowExecutionFamilyPageForOwner(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; executionId: string; cursor?: string; limit?: number }>,
): Promise<WorkflowExecutionFamilyDto | null> {
	void db;
	const prisma = getPrismaClient();
	const limit = boundedPageLimit(params.limit);
	const source = await prisma.workflow_executions.findFirst({
		where: { id: params.executionId, owner_id: params.ownerId },
		select: { execution_family_id: true },
	});
	if (!source) return null;
	if (params.cursor) {
		const cursor = await prisma.workflow_executions.findFirst({
			where: {
				id: params.cursor,
				execution_family_id: source.execution_family_id,
				owner_id: params.ownerId,
			},
			select: { id: true },
		});
		if (!cursor) throw new Error("workflow_execution_family_cursor_invalid");
	}
	const [
		executionRows,
		rootRow,
		latestRow,
		activeRows,
		activeExecutionCount,
		executionCount,
		successfulExecutionCount,
		nodeAttemptCount,
		activityAggregate,
	] = await Promise.all([
		prisma.workflow_executions.findMany({
			where: { execution_family_id: source.execution_family_id, owner_id: params.ownerId },
			select: WORKFLOW_EXECUTION_FAMILY_MEMBER_SELECT,
			orderBy: [{ created_at: "asc" }, { id: "asc" }],
			...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
			take: limit + 1,
		}),
		prisma.workflow_executions.findFirst({
			where: { id: source.execution_family_id, owner_id: params.ownerId },
			select: WORKFLOW_EXECUTION_FAMILY_MEMBER_SELECT,
		}),
		prisma.workflow_executions.findFirst({
			where: { execution_family_id: source.execution_family_id, owner_id: params.ownerId },
			select: WORKFLOW_EXECUTION_FAMILY_MEMBER_SELECT,
			orderBy: [{ created_at: "desc" }, { id: "desc" }],
		}),
		prisma.workflow_executions.findMany({
			where: {
				execution_family_id: source.execution_family_id,
				owner_id: params.ownerId,
				status: { in: ["queued", "running"] },
			},
			select: { id: true },
			orderBy: [{ created_at: "asc" }, { id: "asc" }],
			take: 200,
		}),
		prisma.workflow_executions.count({
			where: {
				execution_family_id: source.execution_family_id,
				owner_id: params.ownerId,
				status: { in: ["queued", "running"] },
			},
		}),
		prisma.workflow_executions.count({
			where: { execution_family_id: source.execution_family_id, owner_id: params.ownerId },
		}),
		prisma.workflow_executions.count({
			where: { execution_family_id: source.execution_family_id, owner_id: params.ownerId, status: "success" },
		}),
		prisma.workflow_node_attempts.count({
			where: { execution_family_id: source.execution_family_id, workflow_executions: { owner_id: params.ownerId } },
		}),
		prisma.workflow_executions.aggregate({
			where: { execution_family_id: source.execution_family_id, owner_id: params.ownerId },
			_max: { created_at: true, started_at: true, finished_at: true },
		}),
	]);
	if (!rootRow) {
		throw new Error("Workflow execution family root is missing or is not owned by the execution owner");
	}
	const latest = latestRow
		? mapWorkflowExecutionFamilyMemberRow(latestRow as WorkflowExecutionFamilyMemberRow)
		: null;
	if (!latest) throw new Error("Workflow execution family has no latest execution");
	const root = mapWorkflowExecutionFamilyMemberRow(rootRow as WorkflowExecutionFamilyMemberRow);
	const hasMore = executionRows.length > limit;
	const executions = (hasMore ? executionRows.slice(0, limit) : executionRows)
		.map((row) => mapWorkflowExecutionFamilyMemberRow(row as WorkflowExecutionFamilyMemberRow));
	return {
		executionFamilyId: source.execution_family_id,
		rootExecutionId: source.execution_family_id,
		latestExecutionId: latest.id,
		latestExecutionStatus: latest.status,
		activeExecutionIds: activeRows.map((row) => row.id),
		activeExecutionCount,
		activeExecutionIdsTruncated: activeExecutionCount > activeRows.length,
		executionCount,
		successfulExecutionCount,
		nodeAttemptCount,
		createdAt: root.createdAt,
		updatedAt: [
			activityAggregate._max.created_at,
			activityAggregate._max.started_at,
			activityAggregate._max.finished_at,
		].filter((value): value is string => typeof value === "string").sort().at(-1) ?? root.createdAt,
		executions,
		nextCursor: hasMore ? executions.at(-1)?.id ?? null : null,
	};
}

export async function getLatestFailedWorkflowExecutionIdForOwner(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; executionFamilyId: string }>,
): Promise<string | null> {
	void db;
	const row = await getPrismaClient().workflow_executions.findFirst({
		where: {
			execution_family_id: params.executionFamilyId,
			owner_id: params.ownerId,
			status: "failed",
		},
		select: { id: true },
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
	});
	return row?.id ?? null;
}
