import { describe, expect, it } from "vitest";
import {
  isVideoTransportRetryWaiting,
  nextVideoTransportRetryDecision,
  parseVideoTransportRetryState,
} from "./video-orchestrator.transport-retry";

describe("video transport retry policy", () => {
  it("persists a bounded retry receipt that can be parsed", () => {
    const decision = nextVideoTransportRetryDecision({
      previous: null,
      nowIso: "2026-08-08T00:00:00.000Z",
      error: "fetch failed",
      identity: "run-1",
    });
    expect(decision.action).toBe("retry");
    expect(parseVideoTransportRetryState(decision.encoded)).toEqual(decision.state);
    expect(isVideoTransportRetryWaiting(decision.state, "2026-08-08T00:00:01.000Z")).toBe(true);
  });

  it("stops after the configured attempt budget", () => {
    const first = nextVideoTransportRetryDecision({
      previous: null,
      nowIso: "2026-08-08T00:00:00.000Z",
      error: "connection reset",
      identity: "run-2",
      maxAttempts: 2,
    });
    const second = nextVideoTransportRetryDecision({
      previous: first.state,
      nowIso: "2026-08-08T00:01:00.000Z",
      error: "connection reset",
      identity: "run-2",
      maxAttempts: 2,
    });
    expect(second.action).toBe("exhausted");
    expect(second.state.attempt).toBe(2);
  });

  it("rejects malformed persisted retry evidence", () => {
    expect(parseVideoTransportRetryState("video_transport_retry:v1:{}")).toBeNull();
    expect(parseVideoTransportRetryState("fetch failed")).toBeNull();
  });
});
