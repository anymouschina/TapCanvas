import type { AppContext } from "./types";

type TraceEvent = {
	atMs: number;
	stage: string;
	meta?: unknown;
};

const SENSITIVE_KEYS = new Set([
	"apikey",
	"api_key",
	"key",
	"token",
	"access_token",
	"refresh_token",
	"secret",
	"password",
	"client_secret",
	"authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"secretToken",
]);

const MAX_TRACE_EVENTS = 120;
const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ARRAY = 30;
const MAX_STRING = 600;

function createRequestId(): string {
	try {
		if (crypto?.randomUUID) return crypto.randomUUID();
	} catch {
		// ignore
	}
	return `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

export function ensureRequestId(c: AppContext): string {
	const existing = c.get("requestId");
	if (typeof existing === "string" && existing.trim()) return existing.trim();
	const id = createRequestId();
	c.set("requestId", id);
	return id;
}

function sanitizeForTrace(value: unknown): unknown {
	const seen = new WeakSet<object>();

	const sanitizeString = (str: string): string => {
		const trimmed = (str || "").trim();
		if (trimmed.length <= MAX_STRING) return trimmed;
		return `${trimmed.slice(0, MAX_STRING)}…(truncated,len=${trimmed.length})`;
	};

	const walk = (v: any, depth: number): any => {
		if (v === null || v === undefined) return v;
		const t = typeof v;
		if (t === "string") return sanitizeString(v);
		if (t === "number" || t === "boolean") return v;
		if (t === "bigint") return String(v);
		if (t === "function") return "[Function]";
		if (t !== "object") return String(v);

		if (seen.has(v)) return "[Circular]";
		seen.add(v);

		if (depth >= MAX_DEPTH) return `[MaxDepth:${MAX_DEPTH}]`;

		if (Array.isArray(v)) {
			const out = v.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1));
			if (v.length > MAX_ARRAY) out.push(`[...omitted ${v.length - MAX_ARRAY} items]`);
			return out;
		}

		const entries = Object.entries(v);
		const out: Record<string, any> = {};
		let kept = 0;
		for (const [key, val] of entries) {
			if (kept >= MAX_KEYS) break;
			const lower = key.toLowerCase();
			out[key] = SENSITIVE_KEYS.has(lower) ? "***" : walk(val, depth + 1);
			kept += 1;
		}
		if (entries.length > kept) out.__omittedKeys = entries.length - kept;
		return out;
	};

	return walk(value, 0);
}

export function initTrace(c: AppContext, startedAtMs: number) {
	c.set("traceStartedAtMs", startedAtMs);
	c.set("traceStage", "request:start");
	c.set("traceEvents", [{ atMs: 0, stage: "request:start" } as TraceEvent]);
}

export function setTraceStage(
	c: AppContext,
	stage: string,
	meta?: Record<string, unknown> | null,
) {
	const startedAt = c.get("traceStartedAtMs");
	const base =
		typeof startedAt === "number" && Number.isFinite(startedAt)
			? startedAt
			: Date.now();
	const atMs = Math.max(0, Date.now() - base);

	const event: TraceEvent = {
		atMs,
		stage: (stage || "").trim() || "unknown",
		...(meta ? { meta: sanitizeForTrace(meta) } : {}),
	};

	const events = (c.get("traceEvents") as TraceEvent[] | undefined) || [];
	events.push(event);
	if (events.length > MAX_TRACE_EVENTS) events.splice(0, events.length - MAX_TRACE_EVENTS);
	c.set("traceEvents", events);
	c.set("traceStage", event.stage);
}

export function appendTraceEvent(
	c: AppContext,
	stage: string,
	meta?: Record<string, unknown> | null,
) {
	const startedAt = c.get("traceStartedAtMs");
	const base =
		typeof startedAt === "number" && Number.isFinite(startedAt)
			? startedAt
			: Date.now();
	const atMs = Math.max(0, Date.now() - base);

	const event: TraceEvent = {
		atMs,
		stage: (stage || "").trim() || "unknown",
		...(meta ? { meta: sanitizeForTrace(meta) } : {}),
	};

	const events = (c.get("traceEvents") as TraceEvent[] | undefined) || [];
	events.push(event);
	if (events.length > MAX_TRACE_EVENTS) events.splice(0, events.length - MAX_TRACE_EVENTS);
	c.set("traceEvents", events);
}

export function getTraceSnapshot(c: AppContext): {
	requestId: string;
	stage: string | null;
	events: TraceEvent[];
} {
	const requestId = ensureRequestId(c);
	const stageRaw = c.get("traceStage");
	const stage = typeof stageRaw === "string" && stageRaw.trim() ? stageRaw.trim() : null;
	const events = (c.get("traceEvents") as TraceEvent[] | undefined) || [];
	return { requestId, stage, events };
}
