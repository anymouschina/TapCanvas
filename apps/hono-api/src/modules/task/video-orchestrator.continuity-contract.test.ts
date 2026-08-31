import { describe, expect, it } from "vitest";

import { validateClipContinuitySequence } from "./video-orchestrator.continuity-contract";

describe("clip continuity contract", () => {
  it("accepts a closed bridge seam and a later reference-video seam", () => {
    expect(
      validateClipContinuitySequence(
        [
          {
            clipIndex: 0,
            continuityMode: "editorial_cut",
            lastFrameImageNodeId: "bridge-01",
          },
          {
            clipIndex: 1,
            continuityMode: "bridge_frames",
            storyboardImageNodeId: "bridge-01",
          },
          { clipIndex: 2, continuityMode: "reference_video" },
        ],
        { complete: true },
      ),
    ).toEqual([]);
  });

  it("rejects invalid first-clip continuity and a bridge whose node IDs do not close", () => {
    const issues = validateClipContinuitySequence(
      [
        {
          clipIndex: 0,
          continuityMode: "bridge_frames",
          lastFrameImageNodeId: "tail-a",
        },
        {
          clipIndex: 1,
          continuityMode: "bridge_frames",
          storyboardImageNodeId: "head-b",
        },
      ],
      { complete: true },
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["first_clip_continuity_invalid", "bridge_frame_mismatch"]),
    );
  });

  it("rejects a reference-video time jump and orphan last frame", () => {
    const issues = validateClipContinuitySequence(
      [
        {
          clipIndex: 0,
          continuityMode: "editorial_cut",
          lastFrameImageNodeId: "unused-tail",
        },
        {
          clipIndex: 1,
          continuityMode: "reference_video",
          timeJumpNote: "三日后",
        },
      ],
      { complete: true },
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["orphan_last_frame", "reference_video_time_jump_conflict"]),
    );
  });

  it("allows an incomplete add_clips batch to reserve a future bridge tail, then closes it", () => {
    const firstBatch = [
      {
        clipIndex: 0,
        continuityMode: "editorial_cut",
        lastFrameImageNodeId: "bridge-01",
      },
    ];
    expect(validateClipContinuitySequence(firstBatch, { complete: false })).toEqual([]);
    expect(validateClipContinuitySequence(firstBatch, { complete: true })).toEqual([
      expect.objectContaining({ code: "orphan_last_frame" }),
    ]);
  });
});
