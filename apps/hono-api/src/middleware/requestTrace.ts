import type { Next } from "hono";
import type { AppContext } from "../types";
import { appendTraceEvent, ensureRequestId, getTraceSnapshot, initTrace } from "../trace";
import { insertApiRequestLog, stringifyTraceJson } from "../modules/observability/request-logs.repo";

const DEFAULT_SLOW_MS = 30_000;
const DEFAULT_HEARTBEATS_MS = [30_000, 120_000, 600_000, 1_800_000];

function parseNumberEnv(raw: unknown): number | null {
	const n = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(n)) return null;
	return Math.max(0, Math.floor(n));
}

function getSlowThresholdMs(c: AppContext): number {
	const raw = parseNumberEnv((c.env as any).REQUEST_TRACE_SLOW_MS);
	if (typeof raw === "number" && raw > 0) return raw;
	return DEFAULT_SLOW_MS;
}

function getHeartbeatThresholdsMs(c: AppContext): number[] {
	const raw = String((c.env as any).REQUEST_TRACE_HEARTBEATS_MS ?? "").trim();
	if (!raw) return DEFAULT_HEARTBEATS_MS;
	const parsed = raw
		.split(",")
		.map((x) => parseNumberEnv(x))
		.filter((x): x is number => typeof x === "number" && x > 0);
	return parsed.length ? parsed : DEFAULT_HEARTBEATS_MS;
}

function safePath(c: AppContext): string {
	try {
		const url = new URL(c.req.url);
		return url.pathname || "/";
	} catch {
		return "/";
	}
}

function safeMethod(c: AppContext): string {
	return (c.req.method || "UNKNOWN").toUpperCase();
}

function emitTraceLog(line: Record<string, unknown>) {
	try {
		console.warn(JSON.stringify(line));
	} catch {
		console.warn(String(line));
	}
}

export async function requestTraceMiddleware(c: AppContext, next: Next) {
	const startedAtMs = Date.now();
	const requestId = ensureRequestId(c);
	initTrace(c, startedAtMs);

	const path = safePath(c);
	const method = safeMethod(c);

	let finished = false;
	let abortedAtMs: number | null = null;
	const abortSignal = c.req.raw.signal as AbortSignal | undefined;
	const onAbort = () => {
		abortedAtMs = Date.now();
		appendTraceEvent(c, "request:client_abort", {
			elapsedMs: Math.max(0, abortedAtMs - startedAtMs),
		});
		emitTraceLog({
			ts: new Date().toISOString(),
			type: "request_trace",
			event: "client_abort",
			requestId,
			method,
			path,
			elapsedMs: Math.max(0, abortedAtMs - startedAtMs),
			stage: getTraceSnapshot(c).stage,
		});
	};

	try {
		abortSignal?.addEventListener("abort", onAbort, { once: true });
	} catch {
		// ignore
	}

	const heartbeats = Array.from(new Set(getHeartbeatThresholdsMs(c)))
		.filter((x) => x > 0)
		.sort((a, b) => a - b);
	let heartbeatTimer: any = null;
	const scheduleHeartbeat = (idx: number) => {
		if (idx >= heartbeats.length) return;
		const prev = idx === 0 ? 0 : heartbeats[idx - 1]!;
		const delay = Math.max(0, heartbeats[idx]! - prev);
		heartbeatTimer = setTimeout(() => {
			if (finished) return;
			const snap = getTraceSnapshot(c);
			emitTraceLog({
				ts: new Date().toISOString(),
				type: "request_trace",
				event: "still_running",
				requestId,
				method,
				path,
				elapsedMs: Math.max(0, Date.now() - startedAtMs),
				stage: snap.stage,
			});
			scheduleHeartbeat(idx + 1);
		}, delay);
		(heartbeatTimer as any)?.unref?.();
	};
	scheduleHeartbeat(0);

	try {
		await next();
	} finally {
		finished = true;
		if (heartbeatTimer) {
			try {
				clearTimeout(heartbeatTimer);
			} catch {
				// ignore
			}
		}
		try {
			abortSignal?.removeEventListener?.("abort", onAbort as any);
		} catch {
			// ignore
		}

		const durationMs = Math.max(0, Date.now() - startedAtMs);
		const slowMs = getSlowThresholdMs(c);
		const aborted = abortedAtMs !== null;
		const status = typeof c.res?.status === "number" ? c.res.status : null;

		if (aborted || durationMs >= slowMs) {
			const snap = getTraceSnapshot(c);
			const userId = c.get("userId");
			const apiKeyId = c.get("apiKeyId");
			const nowIso = new Date().toISOString();

			const traceJson = stringifyTraceJson({
				...(abortedAtMs ? { abortedAtMs: Math.max(0, abortedAtMs - startedAtMs) } : {}),
				stage: snap.stage,
				events: snap.events,
			});

			emitTraceLog({
				ts: nowIso,
				type: "request_trace",
				event: "request_finished",
				requestId,
				method,
				path,
				status,
				aborted,
				durationMs,
				stage: snap.stage,
				userId: typeof userId === "string" ? userId : null,
				apiKeyId: typeof apiKeyId === "string" ? apiKeyId : null,
			});

			try {
				await insertApiRequestLog(c.env.DB, {
					id: requestId,
					userId: typeof userId === "string" ? userId : null,
					apiKeyId: typeof apiKeyId === "string" ? apiKeyId : null,
					method,
					path,
					status,
					stage: snap.stage,
					aborted,
					startedAt: new Date(startedAtMs).toISOString(),
					finishedAt: nowIso,
					durationMs,
					traceJson,
					nowIso,
				});
			} catch (err: any) {
				emitTraceLog({
					ts: nowIso,
					type: "request_trace",
					event: "persist_failed",
					requestId,
					method,
					path,
					message: err?.message || String(err),
				});
			}
		}
	}
}
