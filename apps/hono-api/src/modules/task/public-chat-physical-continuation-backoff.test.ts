import { describe, expect, it } from "vitest";
import { resolvePhysicalContinuationNextAttemptAt } from "./public-chat-physical-continuation-backoff";

describe("physical continuation interruption backoff", () => {
	const nowMs = Date.parse("2026-08-22T10:00:00.000Z");

	it("keeps productive physical-budget continuation immediate", () => {
		expect(resolvePhysicalContinuationNextAttemptAt({
			reasonCode: "root_physical_execution_budget_exhausted",
			stage: 3,
			nowMs,
		})).toBeNull();
	});

	it("backs off repeated provider interruptions with a bounded schedule", () => {
		expect([1, 2, 3, 4, 9].map((stage) => resolvePhysicalContinuationNextAttemptAt({
			reasonCode: "provider_stream_interrupted",
			stage,
			nowMs,
		}))).toEqual([
			"2026-08-22T10:00:15.000Z",
			"2026-08-22T10:00:30.000Z",
			"2026-08-22T10:01:00.000Z",
			"2026-08-22T10:02:00.000Z",
			"2026-08-22T10:02:00.000Z",
		]);
	});
});
