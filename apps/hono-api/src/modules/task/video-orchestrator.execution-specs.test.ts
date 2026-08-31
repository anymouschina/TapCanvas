import { describe, expect, it } from "vitest";

import { resolveVideoExecutionSpecs } from "./video-orchestrator.execution-specs";

describe("video execution specification projection", () => {
  it("uses explicit BeatSheet meta when it agrees with delivery facts", () => {
    expect(resolveVideoExecutionSpecs({
      aspect: "16:9",
      resolution: "480p",
      userIntentContract: { delivery: { aspect: "16:9", resolution: "480p" } },
    })).toEqual({ aspect: "16:9", resolution: "480p" });
  });

  it("inherits missing execution fields from the current delivery contract", () => {
    expect(resolveVideoExecutionSpecs({
      userIntentContract: { delivery: { aspect: "9:16", resolution: "720p" } },
    })).toEqual({ aspect: "9:16", resolution: "720p" });
  });

  it("fails explicitly instead of inventing a default", () => {
    expect(() => resolveVideoExecutionSpecs({ userIntentContract: { delivery: {} } }))
      .toThrow("video_execution_spec_missing:aspect");
  });

  it("fails when two persisted facts disagree", () => {
    expect(() => resolveVideoExecutionSpecs({
      aspect: "16:9",
      resolution: "480p",
      userIntentContract: { delivery: { aspect: "9:16", resolution: "480p" } },
    })).toThrow("video_execution_spec_conflict:aspect");
  });
});
