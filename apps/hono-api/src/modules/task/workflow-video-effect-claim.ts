export type WorkflowVideoSubmissionState =
	| "submitting"
	| "accepted"
	| "materialized"
	| "rejected_pre_upstream"
	| "rejected_by_provider"
	| "uncertain";

export type WorkflowVideoEffectReplayDecision =
	| Readonly<{ action: "reuse_success" }>
	| Readonly<{ action: "reuse_running"; taskId: string }>
	| Readonly<{ action: "reject_terminal"; reason: string }>
	| Readonly<{ action: "reject_uncertain"; reason: string }>;

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function resolveWorkflowVideoEffectReplay(
	data: Readonly<Record<string, unknown>>,
): WorkflowVideoEffectReplayDecision {
	const status = readString(data.status).toLowerCase();
	const submissionState = readString(data.workflowSubmissionState).toLowerCase();
	const taskId = readString(data.taskId) || readString(data.videoTaskId);

	if (status === "success" && submissionState !== "uncertain") {
		return { action: "reuse_success" };
	}
	if (
		(status === "running" || status === "queued" || status === "submitted")
		&& taskId
	) {
		return { action: "reuse_running", taskId };
	}
	if (status === "failed" && submissionState === "rejected_pre_upstream") {
		return {
			action: "reject_terminal",
			reason: "The workflow media effect reached a terminal rejection; a new provider submission requires a new explicit execution family",
		};
	}
	if (status === "failed" && submissionState === "rejected_by_provider") {
		return {
			action: "reject_terminal",
			reason: "The provider explicitly rejected the workflow media effect; a new provider submission requires a new explicit execution family",
		};
	}
	if (submissionState === "submitting") {
		return {
			action: "reject_uncertain",
			reason: "The durable workflow effect claim exists but no provider receipt was persisted",
		};
	}
	if (submissionState === "uncertain") {
		return {
			action: "reject_uncertain",
			reason: "The provider submission outcome is explicitly uncertain",
		};
	}
	if (
		(status === "running" || status === "queued" || status === "submitted")
		&& !taskId
	) {
		return {
			action: "reject_uncertain",
			reason: "The persisted workflow video node is non-terminal but has no provider task identity",
		};
	}
	return {
		action: "reject_uncertain",
		reason: `The persisted workflow video effect has an unsupported state (${status || "missing"}/${submissionState || "missing"})`,
	};
}

export function workflowVideoSubmittingData(input: Readonly<{
	base: Readonly<Record<string, unknown>>;
	effectId: string;
	claimedAt: string;
}>): Record<string, unknown> {
	return {
		...input.base,
		kind: "video",
		status: "submitting",
		workflowEffectId: input.effectId,
		workflowSubmissionState: "submitting" satisfies WorkflowVideoSubmissionState,
		workflowSubmissionClaimedAt: input.claimedAt,
		errorCode: null,
		errorMessage: null,
	};
}

export function workflowVideoSubmissionFailureData(input: Readonly<{
	base: Readonly<Record<string, unknown>>;
	knownPreUpstream: boolean;
	providerRejected?: boolean;
	errorCode: string | null;
	errorMessage: string;
	failedAt: string;
	providerRejectedUrls?: readonly string[];
	providerRejectedReferenceIds?: readonly string[];
}>): Record<string, unknown> {
	const providerRejectedReferenceIds = [...new Set(input.providerRejectedReferenceIds ?? [])];
	return {
		...input.base,
		status: "failed",
		workflowSubmissionState: (
			input.knownPreUpstream
				? "rejected_pre_upstream"
				: input.providerRejected === true || providerRejectedReferenceIds.length > 0
					? "rejected_by_provider"
					: "uncertain"
		) satisfies WorkflowVideoSubmissionState,
		workflowSubmissionFailedAt: input.failedAt,
		errorCode: input.errorCode,
		errorMessage: input.errorMessage,
		providerRejectedUrls: [...new Set(input.providerRejectedUrls ?? [])],
		providerRejectedReferenceIds,
	};
}
