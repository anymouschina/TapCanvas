export type WorkflowWaitingReasonCode =
	| "structured_output_repair_required"
	| "provider_balance_required"
	| "workflow_agent_no_progress_recovery_deferred"
	| "external_dependency_unavailable";

export type WorkflowWaitingReason = Readonly<{
	code: WorkflowWaitingReasonCode;
	label: string;
}>;

/**
 * Projects only versioned runtime facts already present in the workflow node
 * receipt. Conflicting or unknown reason codes stay generic instead of being
 * guessed from error prose, node labels, prompts or task content.
 */
export declare function resolveWorkflowWaitingReason(outputRefs: unknown): WorkflowWaitingReason | null;
