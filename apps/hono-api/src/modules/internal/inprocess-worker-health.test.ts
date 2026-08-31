import { describe, expect, it } from "vitest";

import {
  assessInprocessWorkerHealth,
  createInprocessWorkerHealthState,
  recordInprocessWorkerHealth,
} from "./inprocess-worker-health";

const NOW_MS = Date.parse("2026-08-26T03:00:00.000Z");
const MAX_AGE_MS = 180_000;

describe("in-process worker health contract", () => {
  it("marks the worker healthy after startup records both required lanes", () => {
    const initial = createInprocessWorkerHealthState(42);
    const ready = recordInprocessWorkerHealth(initial, "startup", new Date(NOW_MS).toISOString());

    expect(ready).toMatchObject({
      pid: 42,
      finalizerAt: "2026-08-26T03:00:00.000Z",
      mediaRecoveryAt: "2026-08-26T03:00:00.000Z",
      lastSuccessfulLane: "startup",
    });
    expect(assessInprocessWorkerHealth(ready, NOW_MS, MAX_AGE_MS)).toEqual({ healthy: true });
  });

  it("rejects the retired driveAt shape instead of reporting a false healthy state", () => {
    const legacyState = {
      finalizerAt: new Date(NOW_MS).toISOString(),
      driveAt: new Date(NOW_MS).toISOString(),
    };

    expect(assessInprocessWorkerHealth(legacyState, NOW_MS, MAX_AGE_MS)).toEqual({
      healthy: false,
      reason: "health state is missing mediaRecoveryAt",
    });
  });

  it.each([
    ["finalizerAt", "2026-08-26T02:56:59.999Z"],
    ["mediaRecoveryAt", "2026-08-26T02:56:59.999Z"],
  ] as const)("rejects a stale %s timestamp", (field, staleTimestamp) => {
    const state = {
      finalizerAt: new Date(NOW_MS).toISOString(),
      mediaRecoveryAt: new Date(NOW_MS).toISOString(),
      [field]: staleTimestamp,
    };

    const assessment = assessInprocessWorkerHealth(state, NOW_MS, MAX_AGE_MS);

    expect(assessment.healthy).toBe(false);
    if (!assessment.healthy) expect(assessment.reason).toContain(`${field} is stale`);
  });

  it("preserves the other required lane timestamp when recording a successful tick", () => {
    const startupAt = "2026-08-26T02:59:00.000Z";
    const finalizerAt = "2026-08-26T03:00:00.000Z";
    const initial = recordInprocessWorkerHealth(
      createInprocessWorkerHealthState(42),
      "startup",
      startupAt,
    );

    expect(recordInprocessWorkerHealth(initial, "finalizer", finalizerAt)).toMatchObject({
      readyAt: startupAt,
      finalizerAt,
      mediaRecoveryAt: startupAt,
      lastSuccessfulLane: "finalizer",
      lastSuccessfulAt: finalizerAt,
    });
  });
});
