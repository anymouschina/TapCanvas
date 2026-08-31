import type { AppContext } from "../../types";

// Production is owned by the durable worker. `last_drive_at` is only a short
// per-cycle lease, not an HTTP request ownership window or a progress signal.
export const DEFAULT_VIDEO_RUN_RECOVERY_STALE_MS = 30 * 1000;
export const DEFAULT_VIDEO_AUTHORING_DRIVE_STALE_MS = 5 * 1000;

/** Recovery is asset preservation after a broken synchronous request, not a delivery mode. */
export function isVideoRunRecoveryDisabled(c: AppContext): boolean {
  const raw = String(
    ((c.env as Record<string, unknown>)?.VIDEO_RUN_RECOVERY ??
      globalThis.process?.env?.VIDEO_RUN_RECOVERY ??
      "true") as string,
  )
    .trim()
    .toLowerCase();
  return raw === "false" || raw === "0" || raw === "off";
}

export function resolveVideoRunRecoveryStaleMs(c: AppContext): number {
  const raw = Number(
    (c.env as Record<string, unknown>)?.VIDEO_RUN_RECOVERY_STALE_MS ??
      globalThis.process?.env?.VIDEO_RUN_RECOVERY_STALE_MS,
  );
  return Number.isFinite(raw) && raw >= 5_000
    ? Math.trunc(raw)
    : DEFAULT_VIDEO_RUN_RECOVERY_STALE_MS;
}

export function buildVideoRunRecoveryStaleBeforeIso(
  c: AppContext,
  nowMs: number,
): string {
  return new Date(nowMs - resolveVideoRunRecoveryStaleMs(c)).toISOString();
}

/**
 * Authoring nodes wait for local specialist results and are safe to revisit on
 * a short lease. Keep this separate from provider recovery, whose longer lease
 * prevents duplicate paid submissions.
 */
export function resolveVideoAuthoringDriveStaleMs(c: AppContext): number {
  const raw = Number(
    (c.env as Record<string, unknown>)?.VIDEO_AUTHORING_DRIVE_STALE_MS ??
      globalThis.process?.env?.VIDEO_AUTHORING_DRIVE_STALE_MS,
  );
  return Number.isFinite(raw) && raw >= 1_000
    ? Math.trunc(raw)
    : DEFAULT_VIDEO_AUTHORING_DRIVE_STALE_MS;
}

export function buildVideoAuthoringDriveStaleBeforeIso(
  c: AppContext,
  nowMs: number,
): string {
  return new Date(nowMs - resolveVideoAuthoringDriveStaleMs(c)).toISOString();
}
