import { describe, expect, it } from "vitest";
import {
	createWorkflowAgentRateLimitBackpressureEvidence,
	isWorkflowAgentRateLimitError,
	parseWorkflowAgentPhysicalFailureEvidence,
	remainingWorkflowAgentRateLimitDelayMs,
} from "./execution.agent-backpressure";

describe("workflow Agent durable rate-limit backpressure", () => {
	it("classifies only the exact structural 429 error code", () => {
		expect(isWorkflowAgentRateLimitError({ code: "llm_http_429" })).toBe(true);
		expect(isWorkflowAgentRateLimitError({ code: "llm_http_429 " })).toBe(false);
		expect(isWorkflowAgentRateLimitError(new Error("429 Too Many Requests"))).toBe(false);
		expect(isWorkflowAgentRateLimitError({ code: "llm_http_403" })).toBe(false);
	});

	it("persists increasing quiet windows", () => {
		const first = createWorkflowAgentRateLimitBackpressureEvidence(null, 1_000);
		expect(first).toMatchObject({
			physicalFailureReason: "llm_http_429",
			physicalRetryOrdinal: 1,
			rateLimitDeferralCount: 1,
			retryAfterMs: 5_000,
			retryNotBeforeAt: new Date(6_000).toISOString(),
		});

		const second = createWorkflowAgentRateLimitBackpressureEvidence(
			{ deliveryEvidence: first },
			100_000,
		);
		expect(second).toMatchObject({
			physicalRetryOrdinal: 2,
			rateLimitDeferralCount: 2,
			retryAfterMs: 10_000,
			retryNotBeforeAt: new Date(110_000).toISOString(),
		});
		const parsed = parseWorkflowAgentPhysicalFailureEvidence({ deliveryEvidence: second });
		expect(parsed).not.toBeNull();
		if (!parsed) throw new Error("Expected physical failure evidence");
		expect(remainingWorkflowAgentRateLimitDelayMs(parsed, 100_000)).toBe(10_000);
		expect(remainingWorkflowAgentRateLimitDelayMs(parsed, 110_000)).toBe(0);
	});

	it("caps repeated 429 backoff", () => {
		const evidence = createWorkflowAgentRateLimitBackpressureEvidence({
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "llm_http_429",
				physicalRetryOrdinal: 42,
				rateLimitDeferralCount: 42,
			},
		}, 10_000);
		expect(evidence).toMatchObject({
			physicalRetryOrdinal: 43,
			rateLimitDeferralCount: 43,
			retryBaseDelayMs: 180_000,
			retryAfterMs: 180_000,
		});
	});

	it("recovers a physical retry cursor through nested durable delivery envelopes", () => {
		const parsed = parseWorkflowAgentPhysicalFailureEvidence({
			deliveryEvidence: {
				deliveryEvidence: {
					retryablePhysicalFailure: true,
					physicalFailureReason: "provider_stream_interrupted",
					physicalRetryOrdinal: 4,
				},
			},
		});
		expect(parsed).toMatchObject({
			retryOrdinal: 4,
			reason: "provider_stream_interrupted",
		});
	});

	it("keeps item recovery deterministic with stable jitter", () => {
		const left = createWorkflowAgentRateLimitBackpressureEvidence(null, 1_000, "family:item-a");
		const leftReplay = createWorkflowAgentRateLimitBackpressureEvidence(null, 1_000, "family:item-a");
		const right = createWorkflowAgentRateLimitBackpressureEvidence(null, 1_000, "family:item-b");
		expect(leftReplay).toEqual(left);
		expect(left.retryJitterMs).toBeGreaterThanOrEqual(0);
		expect(left.retryAfterMs).not.toBe(right.retryAfterMs);
		expect(left.retryAfterMs).toBeGreaterThanOrEqual(5_000);
		expect(left.retryAfterMs).toBeLessThanOrEqual(6_000);
	});
});
