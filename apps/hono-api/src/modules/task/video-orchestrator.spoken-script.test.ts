import { describe, expect, it } from "vitest";

import {
  collectSpokenSpeakerNames,
  combineSpokenScript,
  parseNarrativeAudioPlan,
  validateNarrativeAudioPlacement,
} from "./video-orchestrator.spoken-script";

describe("narrative audio plan", () => {
  it("accepts an exact empty list as the canonical optional absence", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan([], "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("rejects a non-empty list instead of guessing its narrative semantics", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan([{}], "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual(["narrativeAudioPlan 必须是对象"]);
  });

  it("accepts the lossless empty projection without blocking clip fan-out", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({ lines: [] }, "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("normalizes a provider's nested empty audio-plan projection", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      lines: [{
        strategy: "环境音铺底",
        rationale: "无新增人声",
        lines: [],
        sourceEvidence: "sb-01",
      }],
      sourceEvidence: "sb-01",
    }, "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("treats a free-form empty sound note as no narrative speech", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      lines: [],
      strategy: "幽魂低诵以环境式低鸣处理",
      rationale: "没有可辨识的人声台词",
    }, "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("treats an empty plan with a blank rationale as non-executable diagnostics", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      lines: [],
      strategy: "source_speech_only",
      rationale: "",
    }, "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("parses source-grounded voice lines and interleaves them at an explicit source-speech anchor", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      strategy: "mixed",
      rationale: "对白推动现场动作，VO 只连接跨年因果。",
      lines: [{
        lineId: "narrative-0",
        speakerName: "沈知夏·内心",
        text: "原来的她离婚后被抛下，最后冻死在冬天。",
        delivery: "voice_over",
        afterSourceLineId: "source-0",
        sourceEvidence: ["source-unit-0010", "source-unit-0011"],
        narrativeFunction: "说明改命动机",
      }],
    }, "narrativeAudioPlan", errors);

    expect(errors).toEqual([]);
    const combined = combineSpokenScript([{
      lineId: "source-0",
      speakerName: "医生",
      text: "想好了就开始吧。",
      delivery: "on_screen",
    }], plan);
    expect(combined.map((line) => line.lineId)).toEqual(["source-0", "narrative-0"]);
    expect(collectSpokenSpeakerNames(combined)).toEqual(["医生", "沈知夏·内心"]);
  });

  it("preserves an Agent-authored on-screen narrative delivery without semantic rewriting", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      strategy: "mixed",
      rationale: "由画面中的发声主体补充源事实。",
      lines: [{
        lineId: "narrative-on-screen",
        speakerName: "现场司仪",
        text: "送老爷子最后一程。",
        delivery: "on_screen",
        afterSourceLineId: null,
        sourceEvidence: ["source-unit-0001"],
      }],
    }, "narrativeAudioPlan", errors);

    expect(errors).toEqual([]);
    expect(plan?.lines[0]?.delivery).toBe("on_screen");
  });

  it("preserves a missing supplemental delivery for the downstream Clip writer to author", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      strategy: "source_grounded_voice",
      rationale: "先冻结源事实与发声正文，镜头内外关系由 Clip writer 决定。",
      lines: [{
        lineId: "narrative-deferred-delivery",
        speakerName: "混杂声浪",
        text: "京剧、梆子、黄梅、花鼓一齐开唱。",
        afterSourceLineId: null,
        sourceEvidence: ["source-unit-0001"],
      }],
    }, "narrativeAudioPlan", errors);

    expect(errors).toEqual([]);
    expect(plan?.lines[0]).toEqual({
      lineId: "narrative-deferred-delivery",
      speakerName: "混杂声浪",
      text: "京剧、梆子、黄梅、花鼓一齐开唱。",
      afterSourceLineId: null,
      sourceEvidence: ["source-unit-0001"],
    });
  });

  it("reports only deterministic shape errors and does not score semantic quality", () => {
    const errors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      strategy: "source_grounded_voice",
      rationale: "",
      lines: [{
        lineId: "narrative-0",
        speakerName: "旁白",
        text: "",
        delivery: "broadcast",
        afterSourceLineId: null,
        sourceEvidence: "source-unit-0001",
      }],
    }, "narrativeAudioPlan", errors);

    expect(plan).toBeUndefined();
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("rationale 必须是非空字符串"),
      expect.stringContaining("text 必须是非空字符串"),
      expect.stringContaining("delivery 必须是 on_screen/off_screen/voice_over"),
      expect.stringContaining("sourceEvidence 必须是字符串数组"),
    ]));
  });

  it("rejects a narrative placement that does not reference the current source ledger", () => {
    const parseErrors: string[] = [];
    const plan = parseNarrativeAudioPlan({
      strategy: "source_grounded_voice",
      rationale: "在两轮现场对白之间交代时间变化。",
      lines: [{
        lineId: "narrative-0",
        speakerName: "沈知夏·内心",
        text: "那已经是另一段时间。",
        delivery: "voice_over",
        afterSourceLineId: "missing-source-line",
        sourceEvidence: ["source-unit-0007"],
      }],
    }, "narrativeAudioPlan", parseErrors);
    const placementErrors: string[] = [];

    validateNarrativeAudioPlacement([{
      lineId: "source-0",
      speakerName: "医生",
      text: "想好了就开始吧。",
      delivery: "on_screen",
    }], plan, "narrativeAudioPlan", placementErrors);

    expect(parseErrors).toEqual([]);
    expect(placementErrors).toEqual([
      expect.stringContaining("必须引用当前 dialogueScript 的 lineId"),
    ]);
  });
});
