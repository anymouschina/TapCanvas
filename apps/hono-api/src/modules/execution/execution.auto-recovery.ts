export const WORKFLOW_FAMILY_AUTOMATIC_EXECUTION_LIMIT = 3 as const;

const AUTOMATIC_RECOVERY_FAILURE_STAGES = new Set([
	"input",
	"asset_access",
	"agent_authoring",
	"control",
	"artifact_persistence",
	"assembly",
	"delivery_verification",
	"export",
]);

export type WorkflowFamilyAutomaticRecoveryDecision = Readonly<{
	eligible: boolean;
	reason:
		| "repairable_pre_submit_failure"
		| "execution_not_failed"
		| "failure_stage_not_replayable"
		| "family_execution_budget_exhausted"
		| "family_already_active";
}>;

/**
 * Task-level continuation policy. It uses only frozen lifecycle facts: no prompt
 * text, workflow name, model name or error-message matching. Provider/media
 * stages are excluded because accepted paid work must be reconciled by its own
 * node receipt contract rather than replayed as a fresh family execution.
 */
export function decideWorkflowFamilyAutomaticRecovery(input: Readonly<{
	executionStatus: string;
	failureStage: string | null;
	familyExecutionCount: number;
	activeExecutionCount: number;
}>): WorkflowFamilyAutomaticRecoveryDecision {
	if (input.executionStatus !== "failed") {
		return { eligible: false, reason: "execution_not_failed" };
	}
	if (input.activeExecutionCount > 0) {
		return { eligible: false, reason: "family_already_active" };
	}
	if (input.familyExecutionCount >= WORKFLOW_FAMILY_AUTOMATIC_EXECUTION_LIMIT) {
		return { eligible: false, reason: "family_execution_budget_exhausted" };
	}
	if (!input.failureStage || !AUTOMATIC_RECOVERY_FAILURE_STAGES.has(input.failureStage)) {
		return { eligible: false, reason: "failure_stage_not_replayable" };
	}
	return { eligible: true, reason: "repairable_pre_submit_failure" };
}
