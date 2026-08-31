import { describe, expect, it } from "vitest";

import {
  assertFrozenClipTopology,
  validateStoryPlan,
} from "./video-orchestrator.orchestrate";

const base = {
  runId: "topology-test",
  videoModel: "doubao-seedance-2-0-260128",
  targetDurationSeconds: 10,
};

const executionContract = {
  videoReferenceNodeIds: [],
  assetObjectContracts: [],
  continuityMode: "editorial_cut" as const,
};

describe("frozen clip topology", () => {
  it("accepts a pre-writer plan skeleton with clips omitted", () => {
    const plan = validateStoryPlan(base);
    expect(plan.clips).toEqual([]);
  });

  it("rejects a malformed requested clip instead of silently dropping it and changing segmentation", () => {
    expect(() => validateStoryPlan({
      ...base,
      clips: [{ ...executionContract, durationSeconds: 5 }],
    })).toThrow(
      "each clip requires clipPrompt",
    );
  });

  it("rejects a realized plan whose topology differs from the semantic contract", () => {
    const plan = validateStoryPlan({
      ...base,
      clipTopology: { expectedClipCount: 2, durationsSeconds: [5, 5] },
      clips: [
        { ...executionContract, clipPrompt: "first", durationSeconds: 5 },
        { ...executionContract, clipPrompt: "second", durationSeconds: 5 },
      ],
    });
    expect(() => assertFrozenClipTopology(plan, [{ durationSeconds: 10 }])).toThrow(
      "realized clip plan diverges",
    );
  });
});
