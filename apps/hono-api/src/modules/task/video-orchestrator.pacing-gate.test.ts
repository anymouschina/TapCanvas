import { describe, expect, it } from "vitest";

import { hasPacingDecision, validateStoryPlan } from "./video-orchestrator.orchestrate";

const baseClip = {
  clipPrompt: "a shot",
  videoReferenceNodeIds: [],
  assetObjectContracts: [],
  continuityMode: "editorial_cut" as const,
};

describe("hasPacingDecision (导演产出物节奏决策事实)", () => {
  it("editingStyle:montage → 已做决策", () => {
    expect(hasPacingDecision({ editingStyle: "montage", clips: [baseClip] })).toBe(true);
  });

  it("editingStyle:continuous(显式确认走长镜) → 已做决策", () => {
    expect(hasPacingDecision({ editingStyle: "continuous", clips: [baseClip] })).toBe(true);
  });

  it("每镜都给 durationSeconds → 已做决策", () => {
    expect(
      hasPacingDecision({
        clips: [
          { ...baseClip, durationSeconds: 3 },
          { ...baseClip, durationSeconds: 3 },
        ],
      }),
    ).toBe(true);
  });

  it("editingStyle 未设 → 默认 cut（多镜镜头表）= 已是节奏决策（不再拒绝起跑）", () => {
    expect(hasPacingDecision({ clips: [baseClip, baseClip] })).toBe(true);
  });

  it("只有部分镜给 durationSeconds → 仍算已决策（缺省 cut 兜底，不再硬拦）", () => {
    expect(
      hasPacingDecision({
        clips: [{ ...baseClip, durationSeconds: 3 }, baseClip],
      }),
    ).toBe(true);
  });
});

describe("validateStoryPlan 解析节奏字段", () => {
  const minimal = { runId: "r1", videoModel: "doubao-seedance-2-0-260128", targetDurationSeconds: 20 };

  it("解析 editingStyle 合法枚举，非法值丢弃", () => {
    expect(validateStoryPlan({ ...minimal, editingStyle: "montage", clips: [baseClip] }).editingStyle).toBe(
      "montage",
    );
    expect(
      validateStoryPlan({ ...minimal, editingStyle: "bogus", clips: [baseClip] }).editingStyle,
    ).toBeUndefined();
  });

  it("解析 clips[].durationSeconds（正整数保留、非正丢弃）", () => {
    const plan = validateStoryPlan({
      ...minimal,
      clips: [
        { ...baseClip, clipPrompt: "s1", durationSeconds: 3 },
        { ...baseClip, clipPrompt: "s2", durationSeconds: 0 },
      ],
    });
    expect(plan.clips[0]!.durationSeconds).toBe(3);
    expect(plan.clips[1]!.durationSeconds).toBeUndefined();
  });

  it("保留目录模型身份，不在本地猜测日期别名", () => {
    expect(
      validateStoryPlan({ ...minimal, videoModel: "doubao-seedance-2-0-250428", clips: [baseClip] })
        .videoModel,
    ).toBe("doubao-seedance-2-0-250428");
  });
});
