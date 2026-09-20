import { workflowAgentPublicTurnId, workflowAgentSessionKey } from "./execution.agent-identity";

export type WorkflowAgentRepairSource = Readonly<{ sessionKey: string; turnId: string }>;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only a frozen replay receipt may nominate an inactive predecessor session. */
export function workflowAgentRepairSource(input: {
	evidence: Record<string, unknown>; sourceExecutionId: string; nodeId: string;
}): WorkflowAgentRepairSource | null {
	const delivery = record(input.evidence.deliveryEvidence);
	const checkpoint = record(delivery?.recoveryCheckpoint);
	if (!delivery || !checkpoint) return null;
	const ordinal = delivery.physicalRetryOrdinal;
	if (ordinal !== undefined && ordinal !== null && (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1)) {
		throw new Error("workflow_agent_repair_source_ordinal_invalid");
	}
	const identity = { executionId: input.sourceExecutionId, nodeId: input.nodeId,
		physicalRetryOrdinal: typeof ordinal === "number" ? ordinal : null };
	const sessionKey = workflowAgentSessionKey(identity);
	const turnId = workflowAgentPublicTurnId(identity);
	if (delivery.sessionKey !== sessionKey || delivery.logicalTaskId !== turnId) {
		throw new Error("workflow_agent_repair_source_identity_mismatch");
	}
	return { sessionKey, turnId };
}

/** Preserve every repair field, but never move a draft across source/contract identity. */
export function verifyWorkflowAgentRepairHandoff(input: {
	checkpoint: Record<string, unknown>; sourceContext: string;
}): Record<string, unknown> {
	const checkpoint = input.checkpoint;
	if (checkpoint.version !== 1 || typeof checkpoint.candidate !== "string" || typeof checkpoint.correction !== "string" || !checkpoint.correction) {
		throw new Error("workflow_agent_repair_checkpoint_invalid");
	}
	if (typeof checkpoint.contractHash !== "string" || !checkpoint.contractHash) throw new Error("workflow_agent_repair_contract_missing");
	// agents-cli compares this hash against its normalized contract at admission.
	if (checkpoint.sourceContext !== input.sourceContext) throw new Error("workflow_agent_repair_source_mismatch");
	return { ...checkpoint };
}
