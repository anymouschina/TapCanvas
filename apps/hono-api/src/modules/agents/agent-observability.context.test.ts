import { describe, expect, it } from "vitest";

import {
	createHonoAgentTraceContext,
	formatTraceparent,
	parseTraceparent,
	resolveAgentTraceCapturePolicy,
} from "./agent-observability.context";

describe("agent observability trace context", () => {
	it("continues a valid W3C trace and creates a new request span", () => {
		const incoming = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01";
		const context = createHonoAgentTraceContext({
			requestId: "request-1",
			threadId: "thread-1",
			capturePolicy: "structural",
			startedAt: "2026-08-01T00:00:00.000Z",
			incomingTraceparent: incoming,
		});
		expect(context.traceId).toBe("a".repeat(32));
		expect(context.incomingParentSpanId).toBe("b".repeat(16));
		expect(context.requestSpanId).toMatch(/^[a-f0-9]{16}$/);
		expect(context.agentsInput.parentSpanId).toBe(context.requestSpanId);
		expect(context.traceparent).toBe(formatTraceparent(context.traceId, context.requestSpanId));
	});

	it("rejects malformed traceparent instead of accepting partial context", () => {
		expect(parseTraceparent("00-bad-bad-01")).toBeNull();
		expect(() => createHonoAgentTraceContext({
			requestId: "request-1",
			threadId: "thread-1",
			capturePolicy: "structural",
			startedAt: "2026-08-01T00:00:00.000Z",
			incomingTraceparent: "00-bad-bad-01",
		})).toThrow(/traceparent is invalid/);
	});

	it("defaults only an absent capture policy and rejects invalid configuration", () => {
		expect(resolveAgentTraceCapturePolicy(undefined)).toBe("structural");
		expect(resolveAgentTraceCapturePolicy("diagnostic")).toBe("diagnostic");
		expect(() => resolveAgentTraceCapturePolicy("automatic")).toThrow(/AGENT_TRACE_CAPTURE_POLICY/);
	});
});
