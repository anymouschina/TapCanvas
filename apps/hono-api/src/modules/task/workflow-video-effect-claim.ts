import { createHash } from "node:crypto";

export type WorkflowVideoSubmissionState =
	| "submitting"
	| "accepted"
	| "materialized"
	| "rejected_pre_upstream"
	| "rejected_by_provider"
	| "uncertain";

export type WorkflowVideoEffectReplayDecision =
	| Readonly<{ action: "retry_pre_upstream" }>
	| Readonly<{ action: "reuse_success" }>
	| Readonly<{ action: "reuse_running"; taskId: string }>
	| Readonly<{ action: "reject_terminal"; reason: string }>
	| Readonly<{ action: "reject_uncertain"; reason: string }>;

export const WORKFLOW_VIDEO_EFFECT_OPERATION = "video.generate" as const;

/** Server-generated authorization passed from an exact workflow media receipt to one append-only retry attempt. */
export type WorkflowVideoRetryAuthorization = Readonly<{
	sourceCanvasNodeId: string;
	failedCanvasNodeId: string;
	failedTaskId: string | null;
	executionId: string;
	runtimeNodeId: string;
	retryKey: string;
	retryIndex: number;
	idempotencyKey: string;
	preUpstreamRejected: boolean;
}>;

export function buildWorkflowVideoEffectV2Identity(input: Readonly<{
	executionFamilyId: string;
	clipId: string;
}>): Readonly<{ canvasNodeId: string; effectId: string }> {
	const executionFamilyId = readString(input.executionFamilyId);
	const clipId = readString(input.clipId);
	if (!executionFamilyId || !clipId) {
		throw new Error("workflow video effect identity requires executionFamilyId and stable clipId");
	}
	const effectId = `${executionFamilyId}:${WORKFLOW_VIDEO_EFFECT_OPERATION}:${encodeURIComponent(clipId)}`;
	const outputHash = createHash("sha256")
		.update([executionFamilyId, WORKFLOW_VIDEO_EFFECT_OPERATION, clipId].join("\u001f"))
		.digest("hex")
		.slice(0, 24);
	return {
		canvasNodeId: `workflow-video-${outputHash}::family::${executionFamilyId}::output::video`,
		effectId,
	};
}

export function buildWorkflowVideoEffectRetryV2Identity(input: Readonly<{
	executionFamilyId: string;
	clipId: string;
	sourceCanvasNodeId: string;
	retryKey: string;
}>): Readonly<{ canvasNodeId: string; effectId: string }> {
	const base = buildWorkflowVideoEffectV2Identity(input);
	const sourceCanvasNodeId = readString(input.sourceCanvasNodeId);
	const retryKey = readString(input.retryKey);
	if (sourceCanvasNodeId !== base.canvasNodeId || !retryKey) {
		throw new Error("workflow video retry identity requires its stable source canvas node and exact retry key");
	}
	const attemptHash = createHash("sha256")
		.update([input.executionFamilyId, WORKFLOW_VIDEO_EFFECT_OPERATION, input.clipId, sourceCanvasNodeId, retryKey].join("\u001f"))
		.digest("hex")
		.slice(0, 24);
	return {
		canvasNodeId: `${base.canvasNodeId}::retry::${attemptHash}`,
		effectId: `${base.effectId}:retry:${attemptHash}`,
	};
}

export type WorkflowVideoEffectFingerprintInput = Readonly<{
	executionFamilyId: string;
	operation: typeof WORKFLOW_VIDEO_EFFECT_OPERATION;
	clipId: string;
	sourceSnapshot: unknown;
	providerRequest: Readonly<{
		kind: string;
		prompt: string;
		negativePrompt?: string;
		extras: Readonly<Record<string, unknown>>;
	}>;
	modelSpec: Readonly<Record<string, unknown>>;
	referenceIdentity: Readonly<Record<string, unknown>>;
	voiceContract: Readonly<Record<string, unknown>>;
	generationContract: unknown;
}>;

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.keys(value as Record<string, unknown>)
			.sort()
			.reduce<Record<string, unknown>>((result, key) => {
				result[key] = canonicalize((value as Record<string, unknown>)[key]);
				return result;
			}, {});
	}
	return value;
}

export function buildWorkflowVideoEffectFingerprint(input: WorkflowVideoEffectFingerprintInput): string {
	const executionFamilyId = readString(input.executionFamilyId);
	const clipId = readString(input.clipId);
	if (!executionFamilyId || !clipId || input.operation !== WORKFLOW_VIDEO_EFFECT_OPERATION) {
		throw new Error("workflow video effect fingerprint requires executionFamilyId, video.generate and stable clipId");
	}
	const identityBoundRequest = {
		version: 2,
		executionFamilyId,
		operation: input.operation,
		clipId,
		sourceSnapshot: input.sourceSnapshot,
		providerRequest: input.providerRequest,
		modelSpec: input.modelSpec,
		referenceIdentity: input.referenceIdentity,
		voiceContract: input.voiceContract,
		generationContract: input.generationContract,
	};
	const canonical = JSON.stringify(canonicalize(identityBoundRequest));
	if (!canonical) throw new Error("workflow video effect fingerprint could not serialize the provider request");
	return createHash("sha256").update(canonical).digest("hex");
}

export function workflowVideoEffectFingerprintConflict(input: Readonly<{
	existing: Readonly<Record<string, unknown>>;
	requestedFingerprint: string;
	requestedSourceSnapshot?: unknown;
}>): Readonly<{ code: "workflow_video_effect_fingerprint_conflict"; existingFingerprint: string | null }> | null {
	// A confirmed pre-upstream rejection has no accepted provider task or asset.
	// Its provider request may be corrected, but the frozen Clip source must stay exact.
	if (resolveWorkflowVideoEffectReplay(input.existing).action === "retry_pre_upstream"
		&& input.requestedSourceSnapshot !== undefined
		&& input.existing.workflowEffectSourceSnapshot !== undefined
		&& JSON.stringify(canonicalize(input.existing.workflowEffectSourceSnapshot))
			=== JSON.stringify(canonicalize(input.requestedSourceSnapshot))) return null;
	const existingFingerprint = readString(input.existing.workflowEffectFingerprint);
	if (existingFingerprint === input.requestedFingerprint) return null;
	return {
		code: "workflow_video_effect_fingerprint_conflict",
		existingFingerprint: existingFingerprint || null,
	};
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function resolveWorkflowVideoEffectReplay(
	data: Readonly<Record<string, unknown>>,
): WorkflowVideoEffectReplayDecision {
	const rawStatus = readString(data.status).toLowerCase();
	const status = rawStatus === "error" ? "failed" : rawStatus;
	const submissionState = readString(data.workflowSubmissionState).toLowerCase();
	const taskId = readString(data.taskId) || readString(data.videoTaskId) || readString(data.remoteTaskId)
		|| readString(data.imageTaskId);
	const hasProviderAcceptance = Boolean(readString(data.providerAcceptedAt));
	const hasVideoAsset = ["videoUrl", "assetUrl", "mediaUrl"]
		.some((field) => Boolean(readString(data[field])))
		|| Array.isArray(data.videoResults) && data.videoResults.length > 0;

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
		if (!taskId && !hasProviderAcceptance && !hasVideoAsset) {
			return { action: "retry_pre_upstream" };
		}
		return { action: "reject_uncertain", reason: "A pre-upstream rejection conflicts with a persisted provider receipt or asset" };
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
	fingerprint?: string;
}>): Record<string, unknown> {
	return {
		...input.base,
		kind: "video",
		status: "submitting",
		workflowEffectId: input.effectId,
		workflowSubmissionState: "submitting" satisfies WorkflowVideoSubmissionState,
		workflowSubmissionClaimedAt: input.claimedAt,
		...(input.fingerprint ? { workflowEffectFingerprint: input.fingerprint } : {}),
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
