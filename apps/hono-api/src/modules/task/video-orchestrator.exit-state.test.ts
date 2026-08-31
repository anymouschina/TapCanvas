import { describe, it, expect } from "vitest";
import { validateStoryPlan } from "./video-orchestrator.orchestrate";

describe("exitState/densityReviewed 字段透传", () => {
  const executionContract = {
    videoReferenceNodeIds: [],
    assetObjectContracts: [],
    continuityMode: "editorial_cut" as const,
  };

  it("clip.exitState 与 densityReviewed 经归一化后保留", () => {
    const plan = validateStoryPlan({
      runId: "r1",
      videoModel: "doubao-seedance-2-0-260128",
      targetDurationSeconds: 30,
      clips: [
        {
          ...executionContract,
          clipPrompt: "甲起身拔剑",
          exitState: "甲立于案前、剑已出鞘指向乙,乙仍端坐,烛光偏暖",
          densityReviewed: true,
        },
      ],
    });
    expect(plan.clips[0].exitState).toContain("剑已出鞘");
    expect(plan.clips[0].densityReviewed).toBe(true);
  });

  it("未声明时不产生虚构字段", () => {
    const plan = validateStoryPlan({
      runId: "r2",
      videoModel: "doubao-seedance-2-0-260128",
      targetDurationSeconds: 10,
      clips: [{ ...executionContract, clipPrompt: "空镜" }],
    });
    expect("exitState" in plan.clips[0]).toBe(false);
    expect("densityReviewed" in plan.clips[0]).toBe(false);
  });
});
