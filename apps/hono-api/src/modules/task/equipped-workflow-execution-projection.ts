import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	getExecutionForOwner,
	listNodeRunsForExecutionOwner,
	mapExecutionRow,
} from "../execution/execution.repo";
import { getWorkflowExecutionFamilyPageForOwner } from "../execution/execution.family-store";
import type {
	WorkflowExecutionDto,
	WorkflowExecutionFamilyDto,
} from "../execution/execution.schemas";
import {
	isWorkflowExecutionProjectionNode,
	WORKFLOW_EXECUTION_PROJECTION_OWNER,
	WORKFLOW_EXECUTION_STATUS_NODE_ID,
} from "../flow/flow.workflow-execution-projection";
import {
	findFlowNode,
	freshReadFlowRow,
	persistFlowPatch,
	readFlowNodes,
} from "./video-orchestrator.flow-io";

export type EquippedWorkflowExecutionProjectionResult =
	| { status: "created" | "updated" | "unchanged" }
	| { status: "ignored_stale"; currentExecutionId: string };

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

type CanvasWorkflowExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

function executionStatus(status: WorkflowExecutionDto["status"]): CanvasWorkflowExecutionStatus {
	if (status === "success") return "succeeded";
	if (status === "canceled") return "cancelled";
	return status;
}

function projectionPosition(nodes: ReturnType<typeof readFlowNodes>): { x: number; y: number } {
	const positions = nodes.flatMap((node) => {
		const position = readRecord(node.position);
		return typeof position?.x === "number" && Number.isFinite(position.x)
			&& typeof position.y === "number" && Number.isFinite(position.y)
			? [{ x: position.x, y: position.y }]
			: [];
	});
	if (positions.length === 0) return { x: 0, y: 0 };
	return {
		x: Math.max(...positions.map((position) => position.x)) + 360,
		y: Math.min(...positions.map((position) => position.y)),
	};
}

function sameProjectionData(
	existing: Record<string, unknown>,
	next: Record<string, unknown>,
): boolean {
	return Object.entries(next).every(([key, value]) => Object.is(existing[key], value));
}

type WorkflowExecutionFamilyProjection = Pick<
	WorkflowExecutionFamilyDto,
	| "executionFamilyId"
	| "rootExecutionId"
	| "latestExecutionId"
	| "executionCount"
	| "updatedAt"
>;

function nodeSummary(
	runs: Awaited<ReturnType<typeof listNodeRunsForExecutionOwner>>,
): NonNullable<WorkflowExecutionDto["nodeSummary"]> {
	const summary: NonNullable<WorkflowExecutionDto["nodeSummary"]> = {
		total: runs.length,
		queued: 0,
		running: 0,
		waitingExternal: 0,
		success: 0,
		failed: 0,
		canceled: 0,
		skipped: 0,
		notSelected: 0,
	};
	for (const run of runs) {
		if (run.status === "queued") summary.queued += 1;
		else if (run.status === "running") summary.running += 1;
		else if (run.status === "waiting_external") summary.waitingExternal += 1;
		else if (run.status === "success") summary.success += 1;
		else if (run.status === "failed") summary.failed += 1;
		else if (run.status === "canceled") summary.canceled += 1;
		else if (run.status === "skipped") summary.skipped += 1;
		else if (run.status === "not_selected") summary.notSelected += 1;
	}
	return summary;
}

function projectionTarget(canvasId: string | null | undefined): Readonly<{
	flowId: string;
	chapterId?: string;
}> | null {
	const value = readString(canvasId);
	if (!value) return null;
	if (!value.startsWith("chapter:")) return { flowId: value };
	const chapterId = value.slice("chapter:".length).trim();
	return chapterId ? { flowId: chapterId, chapterId } : null;
}

/**
 * Persist the accepted durable execution before it is dispatched. The fixed node id makes this a
 * singleton status surface, while the execution id in data remains the authoritative identity.
 */
export async function upsertEquippedWorkflowExecutionProjection(input: {
	c: AppContext;
	ownerId: string;
	flowId: string;
	chapterId?: string | null;
	execution: WorkflowExecutionDto;
	family?: WorkflowExecutionFamilyProjection;
}): Promise<EquippedWorkflowExecutionProjectionResult> {
	const row = await freshReadFlowRow({
		c: input.c,
		flowId: input.flowId,
		requestUserId: input.ownerId,
		devBypass: true,
		...(readString(input.chapterId) ? { chapterId: readString(input.chapterId) } : {}),
	});
	const existing = findFlowNode(row, WORKFLOW_EXECUTION_STATUS_NODE_ID);
	if (existing && !isWorkflowExecutionProjectionNode(existing)) {
		throw new AppError("Workflow execution projection node id is occupied by user canvas data", {
			status: 409,
			code: "workflow_execution_projection_id_conflict",
			details: { nodeId: WORKFLOW_EXECUTION_STATUS_NODE_ID, flowId: input.flowId },
		});
	}
	const existingData = existing?.data ?? {};
	const currentExecutionId = readString(existingData.workflowExecutionId);
	const currentCreatedAt = readString(existingData.workflowExecutionCreatedAt);
	const currentFamilyId = readString(existingData.workflowExecutionFamilyId);
	const nextFamilyId = input.family?.executionFamilyId ?? input.execution.executionFamilyId;
	if (
		currentExecutionId
		&& currentExecutionId !== input.execution.id
		&& currentFamilyId !== nextFamilyId
		&& currentCreatedAt
		&& currentCreatedAt > input.execution.createdAt
	) {
		return { status: "ignored_stale", currentExecutionId };
	}
	const existingRecoveryCount = typeof existingData.workflowRecoveryCount === "number"
		&& Number.isInteger(existingData.workflowRecoveryCount)
		&& existingData.workflowRecoveryCount >= 0
		? existingData.workflowRecoveryCount
		: 0;
	const recoveryCount = input.family
		? Math.max(0, input.family.executionCount - 1)
		: currentFamilyId === nextFamilyId
			&& currentExecutionId
			&& currentExecutionId !== input.execution.id
			&& Boolean(input.execution.recoveryOfExecutionId)
			? existingRecoveryCount + 1
			: existingRecoveryCount;
	const data: Record<string, unknown> = {
		kind: "workflowExecution",
		label: "工作流执行",
		managedProjection: WORKFLOW_EXECUTION_PROJECTION_OWNER,
		workflowRuntimeReference: false,
		workflowExecutionId: input.execution.id,
		workflowExecutionFamilyId: nextFamilyId,
		workflowRootExecutionId: input.family?.rootExecutionId ?? nextFamilyId,
		workflowLatestExecutionId: input.family?.latestExecutionId ?? input.execution.id,
		workflowRecoveryCount: recoveryCount,
		workflowFamilyUpdatedAt: input.family?.updatedAt ?? input.execution.finishedAt ?? input.execution.startedAt ?? input.execution.createdAt,
		workflowExecutionCreatedAt: input.execution.createdAt,
		workflowStatus: executionStatus(input.execution.status),
		workflowCompletedUnits: input.execution.nodeSummary?.success ?? 0,
		workflowTotalUnits: input.execution.nodeSummary?.total ?? 0,
		workflowErrorCount: input.execution.nodeSummary?.failed ?? 0,
	};
	if (existing && sameProjectionData(existingData, data)) return { status: "unchanged" };
	await persistFlowPatch({
		c: input.c,
		row,
		flowId: input.flowId,
		requestUserId: input.ownerId,
		devBypass: true,
		...(readString(input.chapterId) ? { chapterId: readString(input.chapterId) } : {}),
		affectedNodeIds: [WORKFLOW_EXECUTION_STATUS_NODE_ID],
		patch: existing
			? {
				patchNodeData: [{ id: WORKFLOW_EXECUTION_STATUS_NODE_ID, data }],
				allowOverwrite: true,
			}
			: {
				createNodes: [{
					id: WORKFLOW_EXECUTION_STATUS_NODE_ID,
					type: "workflowExecutionNode",
					position: projectionPosition(readFlowNodes(row)),
					data,
					selectable: true,
					deletable: false,
				}],
			},
	});
	return { status: existing ? "updated" : "created" };
}

/**
 * Rebuild the canvas status surface from durable family facts. Callers may pass
 * any member id; the newest physical run in that logical family is projected.
 */
export async function refreshEquippedWorkflowExecutionFamilyProjection(input: Readonly<{
	c: AppContext;
	ownerId: string;
	executionId: string;
}>): Promise<EquippedWorkflowExecutionProjectionResult | { status: "not_projectable" }> {
	const family = await getWorkflowExecutionFamilyPageForOwner(input.c.env.DB, {
		ownerId: input.ownerId,
		executionId: input.executionId,
		limit: 1,
	});
	if (!family) return { status: "not_projectable" };
	const executionRow = await getExecutionForOwner(
		input.c.env.DB,
		family.latestExecutionId,
		input.ownerId,
	);
	if (!executionRow) return { status: "not_projectable" };
	const target = projectionTarget(executionRow.canvas_id);
	if (!target) return { status: "not_projectable" };
	const runs = await listNodeRunsForExecutionOwner(input.c.env.DB, {
		ownerId: input.ownerId,
		executionId: executionRow.id,
	});
	return upsertEquippedWorkflowExecutionProjection({
		c: input.c,
		ownerId: input.ownerId,
		...target,
		execution: {
			...mapExecutionRow(executionRow),
			nodeSummary: nodeSummary(runs),
		},
		family,
	});
}
