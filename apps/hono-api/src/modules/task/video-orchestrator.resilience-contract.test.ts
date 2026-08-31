import { describe, expect, it } from "vitest";

import { buildProductionEffectId } from "./production-effect-ledger";
import { resolveVideoProviderDurationTopology } from "./video-orchestrator.provider-submission-topology";
import { nextVideoTransportRetryDecision } from "./video-orchestrator.transport-retry";

describe("video workflow resilience contract", () => {
  it("keeps paid effect identity stable while transport recovery remains bounded", () => {
    const effectInput = {
      runId: "run-resilience",
      workflowNodeId: "media-production" as const,
      effectKey: "video-clip:0",
      revision: 1,
      operation: "video.generate",
      inputHash: "frozen-input-hash",
    };
    expect(buildProductionEffectId(effectInput)).toBe(buildProductionEffectId(effectInput));

    const firstRetry = nextVideoTransportRetryDecision({
      previous: null,
      nowIso: "2026-08-22T00:00:00.000Z",
      error: "connection reset",
      identity: "run-resilience",
      maxAttempts: 2,
    });
    const exhausted = nextVideoTransportRetryDecision({
      previous: firstRetry.state,
      nowIso: "2026-08-22T00:01:00.000Z",
      error: "connection reset",
      identity: "run-resilience",
      maxAttempts: 2,
    });
    expect(firstRetry.action).toBe("retry");
    expect(exhausted.action).toBe("exhausted");
  });

  it("keeps multi-clip duration topology and effect identities deterministic", () => {
    const topology = resolveVideoProviderDurationTopology({
      targetDurationSeconds: 40,
      durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
    });
    expect(topology.minimumClipDurations).toEqual([30, 10]);

    const effectIds = topology.minimumClipDurations.map((durationSeconds, clipIndex) =>
      buildProductionEffectId({
        runId: "run-resilience-40s",
        workflowNodeId: "media-production",
        effectKey: `video-clip:${clipIndex}`,
        revision: 1,
        operation: "video.generate",
        inputHash: `frozen-input-hash-${durationSeconds}`,
      }),
    );
    expect(new Set(effectIds).size).toBe(effectIds.length);
  });
});
