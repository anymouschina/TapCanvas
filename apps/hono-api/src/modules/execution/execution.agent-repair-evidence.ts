import type { AgentTaskCompletionSignalV1 } from "@tapcanvas/agent-observability";

/** Facts from a closed physical window; this receipt has no terminal authority. */
export function projectWorkflowPhysicalFailureRepairEvidence(
	evidence: Readonly<Record<string, unknown>> | null,
): AgentTaskCompletionSignalV1 | null {
	if (!evidence || typeof evidence.physicalFailureReason !== "string"
		|| !evidence.physicalFailureReason.trim()) return null;
	return {
		version: 1,
		disposition: "replan_required",
		reasonCode: evidence.physicalFailureReason,
		rationale: JSON.stringify({
			physicalFailureReason: evidence.physicalFailureReason,
			recoveryCheckpoint: evidence.recoveryCheckpoint ?? null,
			recoveryWindow: evidence.recoveryWindow ?? null,
			noProgressRecoveryEpoch: evidence.noProgressRecoveryEpoch ?? null,
			physicalRetryOrdinal: evidence.physicalRetryOrdinal ?? null,
		}),
		missingCriteria: ["verified_delivery_for_frozen_task_contract"],
		requiredActions: ["agent_replan_from_preserved_failure_evidence"],
		terminalBoundary: null,
		safePathsExhausted: false,
	};
}
