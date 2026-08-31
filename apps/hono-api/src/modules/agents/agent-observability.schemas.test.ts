import { describe, expect, it } from "vitest";

import { AgentTraceCorrelationSchema } from "./agent-observability.schemas";

const validCorrelation = {
	version: 1 as const,
	traceId: "a".repeat(32),
	parentSpanId: "b".repeat(16),
	requestId: "request-1",
	threadId: "thread-1",
	capturePolicy: "structural" as const,
	startedAt: "2026-08-01T00:00:00.000Z",
	spanId: "c".repeat(16),
	turnId: "turn-1",
	service: "agents-cli" as const,
};

describe("agent observability runtime schemas", () => {
	it("accepts a valid W3C correlation envelope", () => {
		expect(AgentTraceCorrelationSchema.safeParse(validCorrelation).success).toBe(true);
	});

	it("rejects all-zero W3C trace and span identifiers", () => {
		expect(AgentTraceCorrelationSchema.safeParse({
			...validCorrelation,
			traceId: "0".repeat(32),
		}).success).toBe(false);
		expect(AgentTraceCorrelationSchema.safeParse({
			...validCorrelation,
			spanId: "0".repeat(16),
		}).success).toBe(false);
	});
});
