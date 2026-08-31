const TRANSPORT_RETRY_PREFIX = "video_transport_retry:v1:";

export type VideoTransportRetryState = {
  attempt: number;
  firstFailureAt: string;
  nextAttemptAt: string;
  lastError: string;
};

export type VideoTransportRetryDecision =
  | { action: "retry"; state: VideoTransportRetryState; encoded: string }
  | { action: "exhausted"; state: VideoTransportRetryState; encoded: string };

function readIso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(Date.parse(value)).toISOString();
}

export function parseVideoTransportRetryState(value: string | null | undefined): VideoTransportRetryState | null {
  const raw = String(value ?? "");
  if (!raw.startsWith(TRANSPORT_RETRY_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(TRANSPORT_RETRY_PREFIX.length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const attempt = Number(record.attempt);
    const firstFailureAt = readIso(record.firstFailureAt);
    const nextAttemptAt = readIso(record.nextAttemptAt);
    const lastError = typeof record.lastError === "string" ? record.lastError.trim().slice(0, 400) : "";
    if (!Number.isInteger(attempt) || attempt < 1 || !firstFailureAt || !nextAttemptAt || !lastError) return null;
    return { attempt, firstFailureAt, nextAttemptAt, lastError };
  } catch {
    return null;
  }
}

function stableJitter(key: string): number {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 0.8 + ((hash >>> 0) % 401) / 1000;
}

function encodeVideoTransportRetryState(state: VideoTransportRetryState): string {
  return `${TRANSPORT_RETRY_PREFIX}${JSON.stringify(state)}`;
}

export function isVideoTransportRetryWaiting(
  state: VideoTransportRetryState | null,
  nowIso: string,
): boolean {
  return state !== null && Date.parse(nowIso) < Date.parse(state.nextAttemptAt);
}

export function nextVideoTransportRetryDecision(input: {
  previous: VideoTransportRetryState | null;
  nowIso: string;
  error: string;
  identity: string;
  maxAttempts?: number;
  deadlineMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): VideoTransportRetryDecision {
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(nowMs)) throw new Error("video transport retry requires a valid nowIso");
  const attempt = (input.previous?.attempt ?? 0) + 1;
  const firstFailureAt = input.previous?.firstFailureAt ?? new Date(nowMs).toISOString();
  const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts ?? 8));
  const deadlineMs = Math.max(1_000, Math.trunc(input.deadlineMs ?? 30 * 60 * 1000));
  const baseDelayMs = Math.max(1_000, Math.trunc(input.baseDelayMs ?? 15_000));
  const maxDelayMs = Math.max(baseDelayMs, Math.trunc(input.maxDelayMs ?? 2 * 60 * 1000));
  const elapsedMs = Math.max(0, nowMs - Date.parse(firstFailureAt));
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const delayMs = Math.max(1_000, Math.round(exponentialDelay * stableJitter(`${input.identity}:${attempt}`)));
  const state: VideoTransportRetryState = {
    attempt,
    firstFailureAt,
    nextAttemptAt: new Date(nowMs + delayMs).toISOString(),
    lastError: input.error.trim().slice(0, 400) || "transport_error",
  };
  const encoded = encodeVideoTransportRetryState(state);
  return attempt >= maxAttempts || elapsedMs >= deadlineMs
    ? { action: "exhausted", state, encoded }
    : { action: "retry", state, encoded };
}
