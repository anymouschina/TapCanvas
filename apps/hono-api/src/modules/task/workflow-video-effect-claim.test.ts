import { describe, expect, it } from "vitest";
import {
	buildWorkflowVideoEffectFingerprint,
	buildWorkflowVideoEffectV2Identity,
	buildWorkflowVideoEffectRetryV2Identity,
	resolveWorkflowVideoEffectReplay,
	workflowVideoEffectFingerprintConflict,
	workflowVideoSubmissionFailureData,
	workflowVideoSubmittingData,
} from "./workflow-video-effect-claim";

describe("workflow video paid-effect claim", () => {
	it("keys one clip effect by execution family and operation instead of workflow node id", () => {
		const first = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0" });
		const second = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0" });
		expect(second).toEqual(first);
		expect(first.effectId).toBe("family-1:video.generate:source%3Aclip%3A0");
	});

	it("binds append-only V2 retry identities to the immutable clip source and exact receipt key", () => {
		const source = buildWorkflowVideoEffectV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0" });
		const first = buildWorkflowVideoEffectRetryV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0",
			sourceCanvasNodeId: source.canvasNodeId, retryKey: "receipt-key-a" });
		expect(buildWorkflowVideoEffectRetryV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0",
			sourceCanvasNodeId: source.canvasNodeId, retryKey: "receipt-key-a" })).toEqual(first);
		expect(buildWorkflowVideoEffectRetryV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0",
			sourceCanvasNodeId: source.canvasNodeId, retryKey: "receipt-key-b" })).not.toEqual(first);
		expect(() => buildWorkflowVideoEffectRetryV2Identity({ executionFamilyId: "family-1", clipId: "source:clip:0",
			sourceCanvasNodeId: "another-canvas-node", retryKey: "receipt-key-a" })).toThrow();
	});

	it("fingerprints the final request, source snapshot and generation contract independent of key order", () => {
		const base = {
			executionFamilyId: "family-1",
			operation: "video.generate" as const,
			clipId: "source:clip:0",
			sourceSnapshot: { sourceHash: "sha256-source", sourceRange: { start: 4, end: 9 } },
			providerRequest: { kind: "image_to_video", prompt: "final provider prompt", extras: { modelKey: "model-a", referenceImages: ["https://assets.test/ref.png"] } },
			modelSpec: { durationSeconds: 5, resolution: "1080p" },
			referenceIdentity: { assetIds: ["asset-v3"] },
			voiceContract: { voiceId: "voice-a" },
			generationContract: { videoModel: "model-a", version: 2 },
		};
		const first = buildWorkflowVideoEffectFingerprint(base);
		const reordered = buildWorkflowVideoEffectFingerprint({
			...base,
			modelSpec: { resolution: "1080p", durationSeconds: 5 },
			providerRequest: { ...base.providerRequest, extras: { referenceImages: ["https://assets.test/ref.png"], modelKey: "model-a" } },
		});
		expect(reordered).toBe(first);
		expect(buildWorkflowVideoEffectFingerprint({ ...base, providerRequest: { ...base.providerRequest, prompt: "changed prompt" } })).not.toBe(first);
		expect(buildWorkflowVideoEffectFingerprint({ ...base, referenceIdentity: { assetIds: ["asset-v4"] } })).not.toBe(first);
		expect(buildWorkflowVideoEffectFingerprint({ ...base, sourceSnapshot: { sourceHash: "sha256-other", sourceRange: { start: 4, end: 9 } } })).not.toBe(first);
	});

	it("reuses only a running effect with a durable provider identity", () => {
		expect(resolveWorkflowVideoEffectReplay({
			status: "running",
			workflowSubmissionState: "accepted",
			taskId: "provider-task-1",
		})).toEqual({ action: "reuse_running", taskId: "provider-task-1" });
	});

	it("fails closed when a pre-submit claim has no provider receipt", () => {
		expect(resolveWorkflowVideoEffectReplay({
			status: "submitting",
			workflowSubmissionState: "submitting",
		})).toMatchObject({ action: "reject_uncertain" });
	});

	it.each(["failed", "error"])("permits same-effect retry after proven pre-upstream rejection persisted as %s", (status) => {
		expect(resolveWorkflowVideoEffectReplay({
			status,
			workflowSubmissionState: "rejected_pre_upstream",
		})).toMatchObject({ action: "retry_pre_upstream" });
	});

	it("keeps pre-upstream video retries fail-closed when any provider receipt or asset exists", () => {
		for (const receipt of [
			{ remoteTaskId: "remote-task" },
			{ providerAcceptedAt: "2026-09-25T01:13:00.000Z" },
			{ videoUrl: "https://assets.test/video.mp4" },
			{ videoResults: [{ url: "https://assets.test/video.mp4" }] },
			{ assetUrl: "https://assets.test/video.mp4" },
			{ mediaUrl: "https://assets.test/video.mp4" },
		]) {
			expect(resolveWorkflowVideoEffectReplay({
				status: "error",
				workflowSubmissionState: "rejected_pre_upstream",
				...receipt,
			})).toMatchObject({ action: "reject_uncertain" });
		}
		expect(workflowVideoEffectFingerprintConflict({
			existing: { status: "failed", workflowSubmissionState: "rejected_pre_upstream", workflowEffectFingerprint: "old",
				workflowEffectSourceSnapshot: { clipId: "clip-1", sourceHash: "source-1" } },
			requestedFingerprint: "corrected",
			requestedSourceSnapshot: { sourceHash: "source-1", clipId: "clip-1" },
		})).toBeNull();
		expect(workflowVideoEffectFingerprintConflict({
			existing: { status: "failed", workflowSubmissionState: "rejected_pre_upstream", workflowEffectFingerprint: "old",
				workflowEffectSourceSnapshot: { clipId: "clip-1", sourceHash: "source-1" } },
			requestedFingerprint: "corrected",
			requestedSourceSnapshot: { clipId: "clip-1", sourceHash: "another-source" },
		})).toMatchObject({ code: "workflow_video_effect_fingerprint_conflict" });
		expect(workflowVideoEffectFingerprintConflict({
			existing: { status: "running", workflowSubmissionState: "accepted", taskId: "provider-task", workflowEffectFingerprint: "old" },
			requestedFingerprint: "corrected",
		})).toMatchObject({ code: "workflow_video_effect_fingerprint_conflict" });
	});

	it("requires a new explicit execution family after an exact provider rejection", () => {
		expect(resolveWorkflowVideoEffectReplay({
			status: "failed",
			workflowSubmissionState: "rejected_by_provider",
		})).toMatchObject({ action: "reject_terminal" });
	});

	it("does not treat an unknown or receipt-less running state as retryable", () => {
		expect(resolveWorkflowVideoEffectReplay({ status: "running" })).toMatchObject({
			action: "reject_uncertain",
		});
		expect(resolveWorkflowVideoEffectReplay({ status: "failed" })).toMatchObject({
			action: "reject_uncertain",
		});
	});

	it("builds append-only factual submission state transitions", () => {
		const submitting = workflowVideoSubmittingData({
			base: { prompt: "shot prompt" },
			effectId: "effect-1",
			claimedAt: "2026-08-11T10:00:00.000Z",
			fingerprint: "frozen-request-sha256",
		});
		expect(submitting).toMatchObject({
			status: "submitting",
			workflowEffectId: "effect-1",
			workflowSubmissionState: "submitting",
			workflowEffectFingerprint: "frozen-request-sha256",
		});

		expect(workflowVideoSubmissionFailureData({
			base: submitting,
			knownPreUpstream: false,
			errorCode: "network_unknown",
			errorMessage: "connection closed after POST",
			failedAt: "2026-08-11T10:00:05.000Z",
			providerRejectedUrls: ["https://cdn.test/rejected.png"],
			providerRejectedReferenceIds: ["asset-rejected"],
		})).toMatchObject({
			status: "failed",
			workflowSubmissionState: "rejected_by_provider",
			errorCode: "network_unknown",
			providerRejectedUrls: ["https://cdn.test/rejected.png"],
			providerRejectedReferenceIds: ["asset-rejected"],
		});
	});

	it("records an exact provider rejection without requiring a rejected reference", () => {
		expect(workflowVideoSubmissionFailureData({
			base: { workflowEffectId: "effect-1" },
			knownPreUpstream: false,
			providerRejected: true,
			errorCode: "provider_policy_violation",
			errorMessage: "provider rejected output",
			failedAt: "2026-08-31T00:00:00.000Z",
		})).toMatchObject({
			status: "failed",
			workflowSubmissionState: "rejected_by_provider",
		});
	});
});
