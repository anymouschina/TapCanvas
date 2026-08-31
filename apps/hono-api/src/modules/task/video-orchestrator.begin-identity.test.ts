import { describe, expect, it } from "vitest";
import { assertPreflightBeginIdentityAbsent } from "./video-orchestrator.begin-identity";

describe("preflight begin identity boundary", () => {
  it("accepts a new begin without caller-owned durable identity", () => {
    expect(() => assertPreflightBeginIdentityAbsent({
      topLevelRunId: undefined,
      draftRevision: undefined,
      headerRunId: undefined,
    })).not.toThrow();
  });

  it.each([
    { topLevelRunId: "video-old", draftRevision: undefined, headerRunId: undefined },
    { topLevelRunId: undefined, draftRevision: "revision-old", headerRunId: undefined },
    { topLevelRunId: undefined, draftRevision: undefined, headerRunId: "video-old" },
  ])("rejects stale caller identity at every begin input path", (input) => {
    expect(() => assertPreflightBeginIdentityAbsent(input)).toThrow(
      /preflight_begin_identity_forbidden/u,
    );
  });
});
