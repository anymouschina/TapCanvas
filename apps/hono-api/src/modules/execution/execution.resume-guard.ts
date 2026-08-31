export type WorkflowResumeFamilyFacts = Readonly<{
	latestExecutionId: string;
	latestExecutionStatus: "queued" | "running" | "success" | "failed" | "canceled";
	latestFailedExecutionId: string | null;
	activeExecutionCount: number;
	activeExecutionIds: readonly string[];
	/**
	 * True only after the resume service proves that every later family member
	 * is terminal and contains no unresolved external side-effect attempt. This permits an
	 * explicit failed checkpoint to be selected after later recovery attempts
	 * were cancelled without reopening unknown supplier or mutation side effects.
	 */
	historicalSourceReplaySafe?: boolean;
}>;

export type WorkflowResumeFamilyGuard =
	| Readonly<{ allowed: true }>
	| Readonly<{
		allowed: false;
		code: "workflow_resume_family_active";
		activeExecutionIds: readonly string[];
	}>
	| Readonly<{
		allowed: false;
		code: "workflow_resume_source_stale";
		latestExecutionId: string;
	}>;

export type WorkflowRecoveryAgentFenceFact = Readonly<{
	status: "interrupted" | "already_inactive" | "failed";
	errorCode: string | null;
}>;

export type WorkflowRecoveryAgentFenceGuard =
	| Readonly<{ allowed: true }>
	| Readonly<{
		allowed: false;
		code: "workflow_resume_agent_fence_failed";
		failedTargetCount: number;
		errorCodes: readonly string[];
	}>;

/**
 * A recovery execution may be created only from the latest family member and
 * only while the family has no active execution. This is a structural
 * side-effect guard: it does not interpret workflow or prompt semantics.
 */
export function evaluateWorkflowResumeFamilyGuard(
	sourceExecutionId: string,
	family: WorkflowResumeFamilyFacts,
): WorkflowResumeFamilyGuard {
	if (family.activeExecutionCount > 0) {
		return {
			allowed: false,
			code: "workflow_resume_family_active",
			activeExecutionIds: family.activeExecutionIds,
		};
	}
	const resumableExecutionId = family.latestExecutionStatus === "canceled"
		? family.latestFailedExecutionId
		: family.latestExecutionId;
	if (resumableExecutionId !== sourceExecutionId) {
		if (family.historicalSourceReplaySafe === true) {
			return { allowed: true };
		}
		return {
			allowed: false,
			code: "workflow_resume_source_stale",
			latestExecutionId: family.latestExecutionId,
		};
	}
	return { allowed: true };
}

/**
 * A recovery may start only after every discovered source Agent turn has a
 * confirmed interruption outcome across all cancellation planes.
 */
export function evaluateWorkflowRecoveryAgentFence(
	results: readonly WorkflowRecoveryAgentFenceFact[],
): WorkflowRecoveryAgentFenceGuard {
	const failures = results.filter((result) => result.status === "failed");
	if (failures.length === 0) return { allowed: true };
	return {
		allowed: false,
		code: "workflow_resume_agent_fence_failed",
		failedTargetCount: failures.length,
		errorCodes: [...new Set(failures.flatMap((failure) => failure.errorCode ? [failure.errorCode] : []))],
	};
}
