import { describe, expect, it } from "vitest";

import { validateStoryPlan } from "./video-orchestrator.orchestrate";

const basePlan = {
  runId: "run-contract-v3",
  videoModel: "video-model-v3",
  targetDurationSeconds: 5,
};

const baseClip = {
  clipPrompt: "frozen executable prompt",
  videoReferenceNodeIds: [],
  assetObjectContracts: [],
  continuityMode: "editorial_cut",
};

describe("validateStoryPlan executable contract", () => {
  it("rejects the removed clips[].prompt alias", () => {
    expect(() =>
      validateStoryPlan({
        ...basePlan,
        clips: [{ ...baseClip, clipPrompt: undefined, prompt: "legacy prompt" }],
      }),
    ).toThrow(/\.prompt 已移除/);
  });

  it("rejects a shots array containing an invalid shot instead of filtering it", () => {
    expect(() =>
      validateStoryPlan({
        ...basePlan,
        clips: [
          {
            ...baseClip,
            shots: [
              { shotNo: 1, action: "角色推门", durationSeconds: 3 },
              { shotNo: 2, action: "", durationSeconds: 2 },
            ],
          },
        ],
      }),
    ).toThrow(/shots contains an invalid shot/);
  });

  it("preserves an explicit montage decision", () => {
    const plan = validateStoryPlan({
      ...basePlan,
      editingStyle: "montage",
      clips: [{ ...baseClip, characterRoleNames: ["角色甲"] }],
    });

    expect(plan.editingStyle).toBe("montage");
  });

  it("preserves commercial directing fields and an independent whole-line speech event", () => {
    const plan = validateStoryPlan({
      ...basePlan,
      clips: [
        {
          ...baseClip,
          speakerBindings: [{ name: "角色甲", assetKind: "character" }],
          speechEvents: [{
            speechEventId: "speech-line-0",
            lineId: "line-0",
            startOffset: 0,
            endOffset: 5,
            startSeconds: 0.5,
            endSeconds: 4.5,
            speakerName: "角色甲",
            delivery: "on_screen",
            performance: "克制低声，短停后落重音",
            spokenText: "还给你。",
          }],
          shots: [
            {
              shotNo: 1,
              visualTask: "读清角色放下戒指后的关系变化",
              action: "角色把戒指放在桌面后收回手",
              durationSeconds: 5,
              framing: "中近景",
              lensIntent: "中焦压缩两人距离，浅景深维持戒指和反应的层级",
              composition: "戒指前景偏左，接收者中景偏右",
              cameraMove: "随手势短移后在接收者反应处停住",
              lighting: "窗外冷侧光为主光，桌灯仅形成戒指暖边",
              materialResponse: "磨砂银面划痕随转动出现窄幅高光",
              speechEventIds: ["speech-line-0"],
              soundPerspective: "跟随接收者听觉，环境底声短暂收窄",
              sound: "衣料摩擦；金属触桌短响",
            },
          ],
        },
      ],
    });

    expect(plan.clips[0]?.shots?.[0]).toMatchObject({
      visualTask: "读清角色放下戒指后的关系变化",
      lensIntent: "中焦压缩两人距离，浅景深维持戒指和反应的层级",
      materialResponse: "磨砂银面划痕随转动出现窄幅高光",
      speechEventIds: ["speech-line-0"],
      soundPerspective: "跟随接收者听觉，环境底声短暂收窄",
    });
    expect(plan.clips[0]?.speechEvents).toEqual([
      expect.objectContaining({
        speechEventId: "speech-line-0",
        lineId: "line-0",
        spokenText: "还给你。",
      }),
    ]);
  });

  it("rejects removed shot-level speech fields instead of maintaining a second dialogue path", () => {
    expect(() => validateStoryPlan({
      ...basePlan,
      clips: [{
        ...baseClip,
        shots: [{
          action: "角色开口",
          durationSeconds: 5,
          dialogueLineId: "line-0",
        }],
      }],
    })).toThrow(/人声字段已移除/);
  });
});
