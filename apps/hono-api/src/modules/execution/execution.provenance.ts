import {
	WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION,
	type WorkflowInputBindingProvenanceV1,
	type WorkflowNodeProvenanceV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type {
	WorkflowNodeExecutionResult,
	WorkflowNodeOutputV1,
} from "./execution.node-runtime";

export type WorkflowProvenanceContext = Readonly<{
	executionId: string;
	nodeRunId: string | null;
	attempt: number | null;
	flowId: string;
	flowVersionId: string;
	nodeId: string;
	inputBindings: readonly WorkflowInputBindingProvenanceV1[];
}>;

function requireText(value: string | null, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow provenance ${field} must be a non-empty string`);
	}
	return value.trim();
}

export function stampWorkflowNodeOutputProvenance(input: Readonly<{
	outputRefs: WorkflowNodeOutputV1;
	context: WorkflowProvenanceContext;
	createdAt?: string;
}>): WorkflowNodeOutputV1 {
	if (!Number.isInteger(input.context.attempt) || Number(input.context.attempt) < 1) {
		throw new Error("Workflow provenance attempt must be a positive integer");
	}
	if (input.outputRefs.nodeId !== input.context.nodeId) {
		throw new Error(`Workflow provenance node identity mismatch: ${input.outputRefs.nodeId} != ${input.context.nodeId}`);
	}
	const provenance: WorkflowNodeProvenanceV1 = {
		protocolVersion: WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION,
		executionId: requireText(input.context.executionId, "executionId"),
		nodeRunId: requireText(input.context.nodeRunId, "nodeRunId"),
		attempt: Number(input.context.attempt),
		flowId: requireText(input.context.flowId, "flowId"),
		flowVersionId: requireText(input.context.flowVersionId, "flowVersionId"),
		nodeId: requireText(input.context.nodeId, "nodeId"),
		executorRef: requireText(input.outputRefs.executorRef, "executorRef"),
		createdAt: input.createdAt ?? new Date().toISOString(),
		inputBindings: input.context.inputBindings,
	};
	return {
		...input.outputRefs,
		evidence: {
			...input.outputRefs.evidence,
			workflowProvenance: provenance,
		},
	};
}

export function stampWorkflowNodeResultProvenance(
	result: WorkflowNodeExecutionResult,
	context: WorkflowProvenanceContext,
): WorkflowNodeExecutionResult {
	if (result.ok) {
		return {
			ok: true,
			outputRefs: stampWorkflowNodeOutputProvenance({ outputRefs: result.outputRefs, context }),
		};
	}
	if (result.waitingExternal === true) {
		return {
			ok: false,
			waitingExternal: true,
			externalCheck: result.externalCheck,
			outputRefs: stampWorkflowNodeOutputProvenance({ outputRefs: result.outputRefs, context }),
		};
	}
	return {
		...result,
		...(result.outputRefs
			? { outputRefs: stampWorkflowNodeOutputProvenance({ outputRefs: result.outputRefs, context }) }
			: {}),
	};
}
