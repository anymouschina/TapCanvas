import {
	WORKFLOW_EXECUTION_RECOVERY_POLICIES,
	type WorkflowExecutionRecoveryPolicy,
} from "@tapcanvas/workflow-kernel-protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFlowRoot(value: unknown): Record<string, unknown> | null {
	if (isRecord(value)) return value;
	if (typeof value !== "string") return null;
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export class WorkflowExecutionRecoveryPolicyError extends Error {
	constructor(
		message: string,
		public readonly details: Readonly<Record<string, unknown>>,
	) {
		super(message);
		this.name = "WorkflowExecutionRecoveryPolicyError";
	}
}

export function resolveWorkflowExecutionRecoveryPolicy(
	flowData: unknown,
	triggerNodeId: string,
): WorkflowExecutionRecoveryPolicy {
	const root = readFlowRoot(flowData);
	const nodes = Array.isArray(root?.nodes) ? root.nodes : [];
	const triggerNode = nodes.find((candidate) => isRecord(candidate) && candidate.id === triggerNodeId);
	const data = isRecord(triggerNode) && isRecord(triggerNode.data) ? triggerNode.data : null;
	const authored = data?.workflowExecutionRecoveryPolicy;
	if (authored === undefined) return "recoverable";
	if (typeof authored === "string" && WORKFLOW_EXECUTION_RECOVERY_POLICIES.includes(
		authored as WorkflowExecutionRecoveryPolicy,
	)) {
		return authored as WorkflowExecutionRecoveryPolicy;
	}
	throw new WorkflowExecutionRecoveryPolicyError(
		"workflowExecutionRecoveryPolicy must be recoverable or fresh_only",
		{ triggerNodeId, workflowExecutionRecoveryPolicy: authored ?? null },
	);
}

export function assertWorkflowExecutionRecoveryAllowed(
	flowData: unknown,
	triggerNodeId: string,
): void {
	const policy = resolveWorkflowExecutionRecoveryPolicy(flowData, triggerNodeId);
	if (policy !== "fresh_only") return;
	throw new WorkflowExecutionRecoveryPolicyError(
		"This workflow requires a fresh execution and cannot recover or resume an earlier execution",
		{ triggerNodeId, workflowExecutionRecoveryPolicy: policy },
	);
}
