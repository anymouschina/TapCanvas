import { describe, expect, it } from "vitest";
import {
	resolveWorkflowVideoEffectReplay,
	workflowVideoSubmissionFailureData,
	workflowVideoSubmittingData,
} from "./workflow-video-effect-claim";

describe("workflow video paid-effect claim", () => {
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

	it("requires a new explicit execution family after a proven pre-upstream rejection", () => {
		expect(resolveWorkflowVideoEffectReplay({
			status: "failed",
			workflowSubmissionState: "rejected_pre_upstream",
		})).toMatchObject({ action: "reject_terminal" });
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
		});
		expect(submitting).toMatchObject({
			status: "submitting",
			workflowEffectId: "effect-1",
			workflowSubmissionState: "submitting",
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
