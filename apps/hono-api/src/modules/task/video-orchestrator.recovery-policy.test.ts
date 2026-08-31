import { describe, expect, it } from "vitest";

import type { AppContext } from "../../types";
import {
  buildVideoAuthoringDriveStaleBeforeIso,
  buildVideoRunRecoveryStaleBeforeIso,
  resolveVideoAuthoringDriveStaleMs,
  resolveVideoRunRecoveryStaleMs,
} from "./video-orchestrator.recovery-policy";

function context(env: Record<string, unknown>): AppContext {
  return { env } as unknown as AppContext;
}

describe("video orchestrator leases", () => {
  it("keeps specialist authoring cadence independent from paid recovery", () => {
    const c = context({
      VIDEO_AUTHORING_DRIVE_STALE_MS: "5000",
      VIDEO_RUN_RECOVERY_STALE_MS: "300000",
    });

    expect(resolveVideoAuthoringDriveStaleMs(c)).toBe(5_000);
    expect(resolveVideoRunRecoveryStaleMs(c)).toBe(300_000);
    expect(buildVideoAuthoringDriveStaleBeforeIso(c, 400_000)).toBe(
      new Date(395_000).toISOString(),
    );
    expect(buildVideoRunRecoveryStaleBeforeIso(c, 400_000)).toBe(
      new Date(100_000).toISOString(),
    );
  });

  it("rejects sub-second authoring leases and uses the safe default", () => {
    expect(resolveVideoAuthoringDriveStaleMs(context({
      VIDEO_AUTHORING_DRIVE_STALE_MS: "100",
    }))).toBe(5_000);
  });
});
