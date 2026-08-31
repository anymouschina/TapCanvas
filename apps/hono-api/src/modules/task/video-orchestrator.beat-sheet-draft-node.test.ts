import { describe, expect, it } from "vitest";

import {
  projectBeatExecutionSelectors,
  validateBeatSheetDraftNode,
} from "./video-orchestrator.beat-sheet-draft-node";

describe("minimal BeatSheet authoring node", () => {
  it("projects all duplicated selectors from canonical structural sources", () => {
    const projected = projectBeatExecutionSelectors({
      clipIndex: 0,
      logline: "任意故事变化",
      durationBudget: 10,
      continuityMode: "editorial_cut",
      dialogueScript: [{
        lineId: "line-1",
        speakerName: "沈知夏",
        text: "我不会再走原来的路。",
        delivery: "on_screen",
      }],
      videoReferenceNodeIds: [],
      sceneName: "模型误填的旧场景",
      characterRoleNames: ["模型误填的旧角色"],
      speakerNames: ["模型误填的旧说话人"],
      propNames: ["模型误填的旧道具"],
      vfxNames: ["模型误填的旧特效"],
      assetObjectContracts: [
        { kind: "character", name: "沈知夏" },
        { kind: "scene", name: "军属家属院" },
        { kind: "prop", name: "旧皮箱" },
      ],
    });

    expect(projected).toMatchObject({
      sceneName: "军属家属院",
      characterRoleNames: ["沈知夏"],
      speakerNames: ["沈知夏"],
      propNames: ["旧皮箱"],
      vfxNames: [],
    });
  });

  it("projects narrative-audio speakers without merging authored narration into source dialogue", () => {
    const projected = projectBeatExecutionSelectors({
      dialogueScript: [{
        lineId: "source-line-0",
        speakerName: "医生",
        text: "想好了就开始吧。",
        delivery: "on_screen",
      }],
      narrativeAudioPlan: {
        strategy: "mixed",
        rationale: "现场对白负责动作，内心声负责跨时段因果。",
        lines: [{
          lineId: "narrative-line-0",
          speakerName: "沈知夏·内心",
          text: "原来的结局不能再走一遍。",
          delivery: "voice_over",
          afterSourceLineId: "source-line-0",
          sourceEvidence: ["source-unit-0009"],
        }],
      },
      assetObjectContracts: [{ kind: "character", name: "沈知夏" }],
    });

    expect(projected.speakerNames).toEqual(["医生", "沈知夏·内心"]);
    expect(projected.dialogueScript).toEqual([{
      lineId: "source-line-0",
      speakerName: "医生",
      text: "想好了就开始吧。",
      delivery: "on_screen",
    }]);
  });

  it("rejects only structural line-id collisions between source and narrative speech", () => {
    const beat = projectBeatExecutionSelectors({
      clipIndex: 0,
      logline: "现实与回忆通过声音桥接。",
      durationBudget: 10,
      continuityMode: "editorial_cut",
      dialogueScript: [{
        lineId: "line-0",
        speakerName: "沈知夏",
        text: "我不做了。",
        delivery: "on_screen",
      }],
      narrativeAudioPlan: {
        strategy: "mixed",
        rationale: "需要补足决定。",
        lines: [{
          lineId: "line-0",
          speakerName: "沈知夏·内心",
          text: "我要改命。",
          delivery: "voice_over",
          afterSourceLineId: "line-0",
          sourceEvidence: ["source-unit-0009"],
        }],
      },
      videoReferenceNodeIds: [],
      assetObjectContracts: [{ kind: "character", name: "沈知夏" }],
    });

    expect(validateBeatSheetDraftNode(beat, {
      mode: "task_context",
      sourceLabel: "任意输入",
      bookId: null,
      ledgerRevision: null,
      effectiveAt: null,
      consumedFactIds: [],
      consumedContextKeys: [],
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("与 dialogueScript 重复"),
    ]));
  });

  it("preserves an explicit canonical primary scene when multiple scene contracts exist", () => {
    const projected = projectBeatExecutionSelectors({
      sceneName: "卧房",
      assetObjectContracts: [
        { kind: "scene", name: "院门" },
        { kind: "scene", name: "卧房" },
      ],
    });

    expect(projected.sceneName).toBe("卧房");
  });

  it("does not retain an invented scene selector when the object contract is ambiguous", () => {
    const projected = projectBeatExecutionSelectors({
      sceneName: "模型误填的场景",
      assetObjectContracts: [
        { kind: "scene", name: "院门" },
        { kind: "scene", name: "卧房" },
      ],
    });

    expect(projected).not.toHaveProperty("sceneName");
  });

  it("accepts a minimal beat and still enforces executable provider boundaries", () => {
    const beat = projectBeatExecutionSelectors({
      clipIndex: 0,
      logline: "沈知夏在军属家属院醒来，意识到自己身处另一段人生。",
      sceneName: "军属家属院",
      durationBudget: 10,
      continuityMode: "editorial_cut",
      dialogueScript: [],
      videoReferenceNodeIds: [],
      assetObjectContracts: [{
        kind: "scene",
        name: "军属家属院",
        referenceImageNodeIds: [],
        referenceRole: "environment",
      }],
    });

    expect(validateBeatSheetDraftNode(beat, {
      mode: "task_context",
      sourceLabel: "任意输入",
      bookId: null,
      ledgerRevision: null,
      effectiveAt: null,
      consumedFactIds: [],
      consumedContextKeys: [],
    }, {
      generationContract: {
        videoModel: "model-a",
        durationOptions: [10, 30],
        maxDurationSeconds: 30,
        referenceImagePolicy: {
          countUnit: "unique_url",
          maximumTotalImages: 30,
          maximumBusinessImages: 30,
        },
        referenceAudioPolicy: {
          minimumDurationSeconds: 1.8,
          maximumDurationSeconds: 30,
        },
      },
    })).toEqual([]);
  });
});
