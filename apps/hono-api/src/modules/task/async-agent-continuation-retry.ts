export type AsyncAgentContinuationFailureEvidence = {
	occurredAt: string;
	code: string;
	status: number | null;
	upstreamStatus: number | null;
	message: string;
	retryable: boolean;
};

export type AsyncAgentContinuationRetryPlan = {
	shouldRetry: boolean;
	attempt: number;
	nextAttemptAt: string | null;
	failure: AsyncAgentContinuationFailureEvidence;
};

export const ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS = 5;

const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const;
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SAFE_BRIDGE_REJECTION_CODES = new Set([
	"agents_bridge_failed",
	"agents_bridge_queue_failed",
	"new_api_request_failed",
	"newapi_request_failed",
]);
const DURABLY_RESUMABLE_STREAM_CODES = new Set([
	"agents_bridge_stream_interrupted",
	"agents_bridge_stream_failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHttpStatus(value: unknown): number | null {
	const status = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(status)) return null;
	const normalized = Math.trunc(status);
	return normalized >= 400 && normalized <= 599 ? normalized : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text || text.length > 100_000) return null;
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function findUpstreamStatus(value: unknown, depth = 0): number | null {
	if (depth > 6 || !isRecord(value)) return null;
	const direct = readHttpStatus(value.upstreamStatus ?? value.upstream_status);
	if (direct !== null) return direct;

	const body = parseJsonObject(value.body ?? value.upstreamBody ?? value.upstream_body);
	if (body) {
		const fromBody = findUpstreamStatus(body, depth + 1);
		if (fromBody !== null) return fromBody;
	}

	for (const key of ["details", "error", "cause", "data", "upstreamData", "upstream_data"]) {
		const nested = findUpstreamStatus(value[key], depth + 1);
		if (nested !== null) return nested;
	}
	return null;
}

function normalizeFailure(error: unknown, occurredAt: string): AsyncAgentContinuationFailureEvidence {
	const record = isRecord(error) ? error : null;
	const code =
		typeof record?.code === "string" && record.code.trim()
			? record.code.trim()
			: "unknown_error";
	const status = readHttpStatus(record?.status);
	const upstreamStatus = findUpstreamStatus(record?.details);
	const effectiveStatus = upstreamStatus ?? status;
	const retryable =
		DURABLY_RESUMABLE_STREAM_CODES.has(code) || (
			SAFE_BRIDGE_REJECTION_CODES.has(code) &&
			effectiveStatus !== null &&
			RETRYABLE_UPSTREAM_STATUSES.has(effectiveStatus)
		);
	const rawMessage =
		typeof record?.message === "string" && record.message.trim()
			? record.message.trim()
			: error instanceof Error
				? error.message
				: String(error ?? "unknown error");
	return {
		occurredAt,
		code,
		status,
		upstreamStatus,
		message: rawMessage.slice(0, 500),
		retryable,
	};
}

/**
 * Retries only responses that either structurally prove the bridge/upstream
 * rejected the request or carry the dedicated durable-stream interruption
 * code. The latter resumes the same persisted session, model and DAG cursor;
 * operation fences and idempotency receipts prevent duplicate side effects.
 * Unclassified transport failures remain terminal.
 */
export function planAsyncAgentContinuationRetry(input: {
	error: unknown;
	currentAttempt: number;
	now?: Date;
}): AsyncAgentContinuationRetryPlan {
	const now = input.now ?? new Date();
	const occurredAt = now.toISOString();
	const attempt = Math.max(0, Math.trunc(input.currentAttempt)) + 1;
	const failure = normalizeFailure(input.error, occurredAt);
	const shouldRetry =
		failure.retryable && attempt < ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS;
	const delayIndex = Math.min(Math.max(0, attempt - 1), RETRY_DELAYS_MS.length - 1);
	return {
		shouldRetry,
		attempt,
		nextAttemptAt: shouldRetry
			? new Date(now.getTime() + RETRY_DELAYS_MS[delayIndex]).toISOString()
			: null,
		failure,
	};
}

export function isAsyncAgentContinuationAttemptDue(
	nextAttemptAt: string | null,
	nowMs = Date.now(),
): boolean {
	if (!nextAttemptAt) return true;
	const timestamp = Date.parse(nextAttemptAt);
	return Number.isFinite(timestamp) && timestamp <= nowMs;
}
