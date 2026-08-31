import { describe, expect, it } from "vitest";

import type { AppContext } from "../../types";
import { orchestrateVideoRun } from "./video-orchestrator.orchestrate";

const generationContract = {
  videoModel: "test-video-model",
  durationOptions: [5, 10, 15],
  maxDurationSeconds: 15,
  referenceImagePolicy: {
    countUnit: "unique_url" as const,
    maximumTotalImages: 9,
    maximumBusinessImages: 9,
  },
  referenceAudioPolicy: {
    minimumDurationSeconds: 1.8,
    maximumDurationSeconds: 30.2,
  },
};

describe("video orchestrator pre-authoring timing plan", () => {
  it("mode=plan 在 clips 省略时返回 12 个未裁决槽位，而不是触发连续性数量错误", async () => {
    const result = await orchestrateVideoRun({
      c: { env: {} } as unknown as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "chapter-flow-33",
      bodyArgs: {
        mode: "plan",
        storyPlan: {
          runId: "chapter-33-v1",
          videoModel: generationContract.videoModel,
          generationContract,
          targetDurationSeconds: 180,
          aspect: "16:9",
          resolution: "480p",
          editingStyle: "cut",
        },
      },
    });

    expect(result.state).toBe("planned");
    expect(result.clipPlan).toHaveLength(12);
    expect(result.clips).toEqual([]);
    expect(
      result.clipPlan.every((item) => item.continuityTopology === "unresolved"),
    ).toBe(true);
    expect(result.nextStep).toContain("complete BeatSheet");
  });

  it("mode=drive 拒绝请求体内联 StoryPlan，只允许按 runId 读冻结计划", async () => {
    await expect(
      orchestrateVideoRun({
        c: { env: {} } as unknown as AppContext,
        requestUserId: "user-1",
        devBypass: false,
        flowId: "chapter-flow-33",
        bodyArgs: {
          mode: "drive",
          storyPlan: {
            runId: "chapter-33-v1",
            videoModel: generationContract.videoModel,
            generationContract,
            targetDurationSeconds: 180,
            aspect: "16:9",
            resolution: "480p",
            editingStyle: "cut",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "video_orchestrate_inline_story_plan_forbidden",
      status: 400,
    });
  });
});
