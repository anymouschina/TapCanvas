import { randomBytes } from "node:crypto";

import type {
	AgentTraceCapturePolicy,
	AgentTraceCorrelationInputV1,
} from "@tapcanvas/agent-observability";

const TRACEPARENT_PATTERN = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/;

export type HonoAgentTraceContext = {
	traceId: string;
	requestSpanId: string;
	incomingParentSpanId: string | null;
	agentsInput: AgentTraceCorrelationInputV1;
	traceparent: string;
};

function createTraceId(): string {
	return randomBytes(16).toString("hex");
}

export function createAgentSpanId(): string {
	return randomBytes(8).toString("hex");
}

export function parseTraceparent(value: string | null | undefined): {
	traceId: string;
	parentSpanId: string;
} | null {
	const normalized = String(value || "").trim().toLowerCase();
	const match = TRACEPARENT_PATTERN.exec(normalized);
	if (!match) return null;
	const traceId = match[1];
	const parentSpanId = match[2];
	if (!traceId || !parentSpanId || /^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;
	return { traceId, parentSpanId };
}

export function formatTraceparent(traceId: string, spanId: string): string {
	if (!/^[a-f0-9]{32}$/.test(traceId) || /^0+$/.test(traceId)) {
		throw new Error("traceId must be 32 non-zero lowercase hex characters");
	}
	if (!/^[a-f0-9]{16}$/.test(spanId) || /^0+$/.test(spanId)) {
		throw new Error("spanId must be 16 non-zero lowercase hex characters");
	}
	return `00-${traceId}-${spanId}-01`;
}

export function createHonoAgentTraceContext(input: {
	requestId: string;
	threadId: string | null;
	capturePolicy: AgentTraceCapturePolicy;
	startedAt: string;
	incomingTraceparent?: string | null;
}): HonoAgentTraceContext {
	const suppliedTraceparent = String(input.incomingTraceparent || "").trim();
	const incoming = parseTraceparent(suppliedTraceparent);
	if (suppliedTraceparent && !incoming) {
		throw new Error("incoming traceparent is invalid");
	}
	const traceId = incoming?.traceId ?? createTraceId();
	const requestSpanId = createAgentSpanId();
	return {
		traceId,
		requestSpanId,
		incomingParentSpanId: incoming?.parentSpanId ?? null,
		agentsInput: {
			version: 1,
			traceId,
			parentSpanId: requestSpanId,
			requestId: input.requestId,
			threadId: input.threadId,
			capturePolicy: input.capturePolicy,
			startedAt: input.startedAt,
		},
		traceparent: formatTraceparent(traceId, requestSpanId),
	};
}

export function resolveAgentTraceCapturePolicy(value: unknown): AgentTraceCapturePolicy {
	if (value === undefined || value === null) return "structural";
	if (value === "structural" || value === "diagnostic" || value === "full") return value;
	throw new Error("AGENT_TRACE_CAPTURE_POLICY must be structural, diagnostic, or full");
}
