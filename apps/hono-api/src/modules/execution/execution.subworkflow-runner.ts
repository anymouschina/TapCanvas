import type { WorkerEnv } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import { startWorkflowExecution } from "./execution.start-service";

export type WorkflowSubworkflowRunRequest = Readonly<{
	parentExecutionId: string;
	parentNodeId: string;
	parentFlowVersionId: string;
	ancestry: readonly string[];
	ownerId: string;
	targetFlowId: string;
	targetFlowVersionId: string;
	triggerNodeId: string;
	input: unknown;
	childExecutionId: string | null;
}>;

export type WorkflowSubworkflowRunResult =
	| Readonly<{ status: "waiting_external"; childExecutionId: string; childFlowVersionId: string }>
	| Readonly<{ status: "success"; childExecutionId: string; childFlowVersionId: string; nodeRuns: readonly Readonly<{ nodeId: string; status: string; outputRefs: unknown }>[] }>
	| Readonly<{ status: "failed"; childExecutionId: string | null; errorMessage: string }>;

function parseStoredJson(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

export async function runWorkflowSubworkflow(
	env: WorkerEnv,
	request: WorkflowSubworkflowRunRequest,
): Promise<WorkflowSubworkflowRunResult> {
	if (request.childExecutionId) {
		const child = await env.DB.workflow_executions.findFirst({
			where: { id: request.childExecutionId, owner_id: request.ownerId },
			select: { id: true, status: true, flow_version_id: true, error_message: true },
		});
		if (!child) return { status: "failed", childExecutionId: request.childExecutionId, errorMessage: "Persisted child workflow execution no longer exists in the authorized owner scope" };
		if (child.status === "queued" || child.status === "running") {
			return { status: "waiting_external", childExecutionId: child.id, childFlowVersionId: child.flow_version_id };
		}
		if (child.status !== "success") {
			return { status: "failed", childExecutionId: child.id, errorMessage: child.error_message || `Child workflow ended with ${child.status}` };
		}
		const nodeRuns = await env.DB.workflow_node_runs.findMany({
			where: { execution_id: child.id },
			select: { node_id: true, status: true, output_refs: true },
			orderBy: { created_at: "asc" },
		});
		return {
			status: "success",
			childExecutionId: child.id,
			childFlowVersionId: child.flow_version_id,
			nodeRuns: nodeRuns.map((run) => ({ nodeId: run.node_id, status: run.status, outputRefs: parseStoredJson(run.output_refs) })),
		};
	}

	const ancestry = [...new Set([...request.ancestry, request.parentFlowVersionId])];
	if (ancestry.includes(request.targetFlowVersionId)) {
		return { status: "failed", childExecutionId: null, errorMessage: `Subworkflow version cycle detected at ${request.targetFlowVersionId}` };
	}
	const targetFlow = await env.DB.flows.findFirst({
		where: { id: request.targetFlowId, owner_id: request.ownerId },
		select: {
			id: true,
			name: true,
			data: true,
			owner_id: true,
			project_id: true,
			created_at: true,
			updated_at: true,
			canvas_revision: true,
		},
	});
	if (!targetFlow) return { status: "failed", childExecutionId: null, errorMessage: "Target subworkflow flow does not exist in the authorized owner scope" };
	const targetVersion = await env.DB.flow_versions.findFirst({
		where: { id: request.targetFlowVersionId, flow_id: request.targetFlowId },
		select: { id: true, data: true, name: true, created_at: true },
	});
	if (!targetVersion) return { status: "failed", childExecutionId: null, errorMessage: "Target subworkflow immutable version does not exist" };
	const pinnedFlow: FlowRow = {
		...targetFlow,
		name: targetVersion.name,
		data: targetVersion.data,
		updated_at: targetVersion.created_at,
	};
	const started = await startWorkflowExecution(env, {
		flow: pinnedFlow,
		ownerId: request.ownerId,
		triggerNodeId: request.triggerNodeId,
		trigger: "subworkflow",
		idempotencyKey: `subworkflow:${request.parentExecutionId}:${request.parentNodeId}:${request.targetFlowVersionId}`,
		triggerPayload: {
			version: 1,
			kind: "subworkflow",
			parentExecutionId: request.parentExecutionId,
			parentNodeId: request.parentNodeId,
			input: request.input,
		},
		workflowAncestry: [...ancestry, request.targetFlowVersionId],
	});
	return {
		status: "waiting_external",
		childExecutionId: started.execution.id,
		childFlowVersionId: started.execution.flowVersionId,
	};
}
