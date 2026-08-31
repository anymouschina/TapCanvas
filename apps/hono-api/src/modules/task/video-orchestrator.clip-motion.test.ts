import { describe, expect, it } from "vitest";
import {
  buildDialoguePresenceBlockMessage,
  buildStaticClipsWarning,
  isNoDialogueGenre,
} from "./video-orchestrator.clip-motion";
import type { StoryPlanClip } from "./video-orchestrator.orchestrate";

// 一个"有具名角色、全程无对白、连续剪辑"的片：默认会被对白闸拦。
function narrativeNoDialoguePlan(extra: Record<string, unknown> = {}) {
  const clip = (i: number): StoryPlanClip => ({
    clipPrompt: `shot ${i}: she walks forward and turns, camera pushes in, no spoken lines`,
    characterRoleNames: ["图1女主"],
  });
  return {
    editingStyle: "continuous",
    clips: [clip(1), clip(2), clip(3)],
    ...extra,
  } as Parameters<typeof buildDialoguePresenceBlockMessage>[0];
}

describe("isNoDialogueGenre", () => {
  it("命中电商/广告/时尚/MV/复刻/转场类 → true", () => {
    for (const g of ["电商复刻", "时尚转场广告", "ecommerce ad", "fashion MV", "产品转场", "B-roll", "复刻"]) {
      expect(isNoDialogueGenre(g)).toBe(true);
    }
  });
  it("叙事/剧情/漫剧/短剧/空值 → false", () => {
    for (const g of ["叙事短剧", "剧情", "漫剧", "narrative drama", "", undefined as unknown as string]) {
      expect(isNoDialogueGenre(g)).toBe(false);
    }
  });
});

describe("buildDialoguePresenceBlockMessage 题材豁免", () => {
  it("叙事片(具名角色+无对白) → 拦截", () => {
    expect(buildDialoguePresenceBlockMessage(narrativeNoDialoguePlan())).not.toBeNull();
  });

  it("同样的片标 filmGenre=电商复刻 → 自动豁免", () => {
    expect(
      buildDialoguePresenceBlockMessage(narrativeNoDialoguePlan({ filmGenre: "电商复刻" })),
    ).toBeNull();
  });

  it("filmGenre=时尚转场广告 → 豁免", () => {
    expect(
      buildDialoguePresenceBlockMessage(narrativeNoDialoguePlan({ filmGenre: "时尚转场广告" })),
    ).toBeNull();
  });

  it("filmGenre=叙事短剧 → 仍拦截（叙事类不豁免）", () => {
    expect(
      buildDialoguePresenceBlockMessage(narrativeNoDialoguePlan({ filmGenre: "叙事短剧" })),
    ).not.toBeNull();
  });

  it("dialogueReviewed:true 仍可豁免", () => {
    expect(
      buildDialoguePresenceBlockMessage(narrativeNoDialoguePlan({ dialogueReviewed: true })),
    ).toBeNull();
  });

  it("montage 仍豁免", () => {
    expect(
      buildDialoguePresenceBlockMessage(narrativeNoDialoguePlan({ editingStyle: "montage" })),
    ).toBeNull();
  });
});

describe("buildStaticClipsWarning·写入时静态镜告警（Tier1 左移）", () => {
  it("有运镜或动作的镜不告警", () => {
    const clips = [
      { clipPrompt: "镜头缓缓推近，他猛地转身挥剑劈下" },
      { clipPrompt: "横移跟拍，衣袍随步伐荡开" },
    ] as never[];
    expect(buildStaticClipsWarning(clips)).toBeNull();
  });

  it("既无运镜又无动作的纯静态镜按 1-based 镜号点名", () => {
    const clips = [
      { clipPrompt: "镜头缓缓推近，他猛地转身" },
      { clipPrompt: "夕阳下的城墙轮廓，天色昏黄，氛围凝重" },
    ] as never[];
    const w = buildStaticClipsWarning(clips);
    expect(w).toMatch(/镜2/);
    expect(w).toMatch(/motionReviewed/);
  });

  it("motionReviewed:true 豁免；空 clipPrompt 不误报", () => {
    const clips = [
      { clipPrompt: "夕阳下的城墙轮廓，氛围凝重", motionReviewed: true },
      { clipPrompt: "" },
      {},
    ] as never[];
    expect(buildStaticClipsWarning(clips)).toBeNull();
  });
});
