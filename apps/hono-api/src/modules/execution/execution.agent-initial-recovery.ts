import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

export type WorkflowAgentInitialRecoveryV1 = Readonly<{
	version: 1;
	sourceExecutionId: string;
	sourceNodeRunId: string;
	nodeId: string;
	reason: "structured_failure_without_turn_receipt";
}>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** This identity is attached only by owner-authorized unchanged-snapshot replay,
 * never inferred from a missing current durable turn or a caller's prompt. */
export function bindWorkflowAgentInitialRecovery(input: Readonly<{
	output: WorkflowNodeOutputV1; sourceExecutionId: string; sourceNodeRunId: string;
}>): WorkflowNodeOutputV1 {
	const evidence = input.output.evidence;
	if (evidence.agentInitialRecovery !== undefined) return input.output;
	const failure = evidence.outputContractFailure;
	const delivery = record(evidence.deliveryEvidence) ? evidence.deliveryEvidence : null;
	if (input.output.executorRef !== "agents.logical-task/v2" || input.output.executionMode !== "once"
		|| evidence.executorCompleted !== false || !record(failure) || failure.code !== "structured_output_invalid"
		|| evidence.taskId != null || delivery?.sessionKey != null || delivery?.logicalTaskId != null
		|| input.output.artifacts.length > 0 || input.output.itemRuns.length > 0 || Object.keys(input.output.ports).length > 0
		|| (evidence.providerReceiptRefs !== undefined && (!Array.isArray(evidence.providerReceiptRefs) || evidence.providerReceiptRefs.length > 0))) return input.output;
	return { ...input.output, evidence: { ...evidence, agentInitialRecovery: { version: 1,
		sourceExecutionId: input.sourceExecutionId, sourceNodeRunId: input.sourceNodeRunId, nodeId: input.output.nodeId,
		reason: "structured_failure_without_turn_receipt" } satisfies WorkflowAgentInitialRecoveryV1 } };
}

export function readWorkflowAgentInitialRecovery(evidence: Record<string, unknown> | null | undefined): WorkflowAgentInitialRecoveryV1 | null {
	const value = evidence?.agentInitialRecovery;
	if (value === undefined) return null;
	if (!record(value) || value.version !== 1 || value.reason !== "structured_failure_without_turn_receipt"
		|| ["sourceExecutionId", "sourceNodeRunId", "nodeId"].some(key => typeof value[key] !== "string" || !value[key])) {
		throw new Error("workflow_agent_initial_recovery_invalid");
	}
	return { version: 1, reason: value.reason, sourceExecutionId: value.sourceExecutionId as string,
		sourceNodeRunId: value.sourceNodeRunId as string, nodeId: value.nodeId as string };
}
