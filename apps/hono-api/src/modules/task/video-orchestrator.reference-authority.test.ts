import { describe, expect, it } from "vitest";

import type { StoryPlan } from "./video-orchestrator.orchestrate";
import { restoreBeatSheetVideoReferenceAuthority } from "./video-orchestrator.reference-authority";

function plan(): StoryPlan {
  return {
    runId: "run-1",
    targetDurationSeconds: 10,
    videoModel: "doubao-seedance-2-0-pro",
    clips: [
      {
        clipPrompt: "clip 0",
        videoReferenceNodeIds: ["auto-ensemble"],
      },
      {
        clipPrompt: "clip 1",
        videoReferenceNodeIds: ["auto-scene"],
      },
    ],
  };
}

describe("restoreBeatSheetVideoReferenceAuthority", () => {
  it("restores the committed canonical references and compiles object-contract nodes", () => {
    const storyPlan = plan();
    const result = restoreBeatSheetVideoReferenceAuthority({
      plan: storyPlan,
      beatSheetJson: JSON.stringify({
        beats: [
          {
            clipIndex: 0,
            videoReferenceNodeIds: ["hero-0"],
            assetObjectContracts: [{ referenceImageNodeIds: ["scene-0"] }],
          },
          { clipIndex: 1, videoReferenceNodeIds: ["hero-1"] },
        ],
      }),
    });

    expect(result).toEqual({ ok: true, restoredClipIndexes: [0, 1] });
    expect(storyPlan.clips.map((clip) => clip.videoReferenceNodeIds)).toEqual([
      ["scene-0", "hero-0"],
      ["hero-1"],
    ]);
  });

  it("restores selected references when a clip intentionally has no keyframe image", () => {
    const storyPlan = plan();
    const result = restoreBeatSheetVideoReferenceAuthority({
      plan: storyPlan,
      beatSheetJson: JSON.stringify({
        beats: [
          { clipIndex: 0, videoReferenceNodeIds: ["hero-0", "prop-0"] },
          { clipIndex: 1, videoReferenceNodeIds: ["ensemble-1"] },
        ],
      }),
    });

    expect(result).toEqual({ ok: true, restoredClipIndexes: [0, 1] });
    expect(storyPlan.clips.map((clip) => clip.videoReferenceNodeIds)).toEqual([
      ["hero-0", "prop-0"],
      ["ensemble-1"],
    ]);
  });

  it("fails when a plan clip has no committed BeatSheet authority", () => {
    expect(
      restoreBeatSheetVideoReferenceAuthority({
        plan: plan(),
        beatSheetJson: JSON.stringify({
          beats: [{ clipIndex: 0, storyboardImageNodeId: "keyframe-0" }],
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: "beat_sheet_reference_authority_invalid",
      }),
    );
  });

  it("fails when committed BeatSheet clip indexes are not continuous", () => {
    expect(
      restoreBeatSheetVideoReferenceAuthority({
        plan: plan(),
        beatSheetJson: JSON.stringify({
          beats: [
            { clipIndex: 0, storyboardImageNodeId: "keyframe-0" },
            { clipIndex: 0, storyboardImageNodeId: "keyframe-1" },
          ],
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: "beat_sheet_reference_authority_invalid",
      }),
    );
  });

  it("fails when BeatSheet and StoryPlan clip counts differ", () => {
    expect(
      restoreBeatSheetVideoReferenceAuthority({
        plan: plan(),
        beatSheetJson: JSON.stringify({
          beats: [
            { clipIndex: 0, storyboardImageNodeId: "keyframe-0" },
            { clipIndex: 1, storyboardImageNodeId: "keyframe-1" },
            { clipIndex: 2, storyboardImageNodeId: "keyframe-2" },
          ],
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: "beat_sheet_reference_authority_invalid",
      }),
    );
  });
});
