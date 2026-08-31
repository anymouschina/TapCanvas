export const DEFAULT_INPROCESS_WORKER_READY_FILE = "/tmp/tapcanvas-inprocess-worker.ready";
export const DEFAULT_INPROCESS_WORKER_HEALTH_MAX_AGE_MS = 180_000;

export type InprocessWorkerHealthLane =
  | "startup"
  | "finalizer"
  | "media_recovery"
  | "continuation_sweep"
  | "membership_reconciliation"
  | "continuation"
  | "continuation_settlement"
  | "video_production_deadline";

export interface InprocessWorkerHealthState {
  pid: number;
  readyAt: string;
  finalizerAt: string;
  mediaRecoveryAt: string;
  lastSuccessfulLane: InprocessWorkerHealthLane;
  lastSuccessfulAt: string;
}

export type InprocessWorkerHealthAssessment =
  | { healthy: true }
  | { healthy: false; reason: string };

export function createInprocessWorkerHealthState(pid: number): InprocessWorkerHealthState {
  return {
    pid,
    readyAt: "",
    finalizerAt: "",
    mediaRecoveryAt: "",
    lastSuccessfulLane: "startup",
    lastSuccessfulAt: "",
  };
}

export function recordInprocessWorkerHealth(
  previous: InprocessWorkerHealthState,
  lane: InprocessWorkerHealthLane,
  nowIso: string,
): InprocessWorkerHealthState {
  return {
    ...previous,
    readyAt: previous.readyAt || nowIso,
    finalizerAt: lane === "startup" || lane === "finalizer" ? nowIso : previous.finalizerAt,
    mediaRecoveryAt:
      lane === "startup" || lane === "media_recovery" ? nowIso : previous.mediaRecoveryAt,
    lastSuccessfulLane: lane,
    lastSuccessfulAt: nowIso,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assessFreshTimestamp(
  state: Record<string, unknown>,
  field: "finalizerAt" | "mediaRecoveryAt",
  nowMs: number,
  maxAgeMs: number,
): InprocessWorkerHealthAssessment {
  const raw = state[field];
  if (typeof raw !== "string" || raw.length === 0) {
    return { healthy: false, reason: `health state is missing ${field}` };
  }

  const timestampMs = Date.parse(raw);
  if (!Number.isFinite(timestampMs)) {
    return { healthy: false, reason: `health state has invalid ${field}: ${raw}` };
  }

  const ageMs = nowMs - timestampMs;
  if (ageMs < 0) {
    return { healthy: false, reason: `health state ${field} is ${Math.abs(ageMs)}ms in the future` };
  }
  if (ageMs > maxAgeMs) {
    return { healthy: false, reason: `health state ${field} is stale by ${ageMs - maxAgeMs}ms` };
  }

  return { healthy: true };
}

export function assessInprocessWorkerHealth(
  value: unknown,
  nowMs: number,
  maxAgeMs: number,
): InprocessWorkerHealthAssessment {
  if (!Number.isFinite(nowMs)) {
    return { healthy: false, reason: "healthcheck clock is invalid" };
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return { healthy: false, reason: `healthcheck max age must be positive: ${maxAgeMs}` };
  }
  if (!isRecord(value)) {
    return { healthy: false, reason: "health state must be a JSON object" };
  }

  const finalizer = assessFreshTimestamp(value, "finalizerAt", nowMs, maxAgeMs);
  if (!finalizer.healthy) return finalizer;

  return assessFreshTimestamp(value, "mediaRecoveryAt", nowMs, maxAgeMs);
}
