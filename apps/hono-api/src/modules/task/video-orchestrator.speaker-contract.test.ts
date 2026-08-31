import { describe, expect, it } from "vitest";

import {
  buildSpeakerCoveragePlanFingerprint,
  collectSpeakerAssetRequirements,
  readClipSpeakerBindings,
  validateClipSpeakerNamesAuthority,
} from "./video-orchestrator.speaker-contract";
import { validateStoryPlan } from "./video-orchestrator.orchestrate";

const speechEvent = (input: {
  id: string;
  speakerName: string;
  spokenText: string;
  startSeconds?: number;
  endSeconds?: number;
}) => ({
  speechEventId: input.id,
  lineId: `line-${input.id}`,
  startOffset: 0,
  endOffset: Array.from(input.spokenText).length,
  startSeconds: input.startSeconds ?? 0,
  endSeconds: input.endSeconds ?? 2,
  speakerName: input.speakerName,
  delivery: "on_screen",
  spokenText: input.spokenText,
});

describe("speaker contract", () => {
  it("说话人身份清单不冒充供应商实际参考音频预算", () => {
    const events = ["甲", "乙", "丙", "丁"].map((name, index) =>
      speechEvent({
        id: `speech-${index + 1}`,
        speakerName: name,
        spokenText: `${name}的台词`,
        startSeconds: index * 2,
        endSeconds: index * 2 + 2,
      }));
    const result = readClipSpeakerBindings({
      speakerBindings: ["甲", "乙", "丙", "丁"].map((name) => ({ name, assetKind: "character" })),
      speechEvents: events,
      shots: events.map((event) => ({
        action: `${event.speakerName}开口`,
        durationSeconds: 2,
        speechEventIds: [event.speechEventId],
      })),
    });
    expect(result.bindings).toHaveLength(4);
    expect(result.issues).toEqual([]);
  });

  it("writer 说话人集合必须与 BeatSheet 权威集合一致", () => {
    const result = validateClipSpeakerNamesAuthority({
      speakerBindings: [
        { name: "甲", assetKind: "character" },
        { name: "乙", assetKind: "character" },
      ],
      speechEvents: [speechEvent({ id: "speech-1", speakerName: "甲", spokenText: "台词" })],
    }, ["甲", "乙"]);
    expect(result.some((issue) => issue.path === "speechEvents[].speakerName")).toBe(true);
  });

  it("有对白但没有 speakerBindings 时结构性失败", () => {
    const result = readClipSpeakerBindings({
      speechEvents: [speechEvent({ id: "speech-1", speakerName: "章节旁白", spokenText: "这是台词。" })],
    });
    expect(result.bindings).toEqual([]);
    expect(result.issues.some((issue) => issue.problem.includes("必须声明说话人资产类型"))).toBe(true);
  });

  it("纯声音通道不允许同时申报为画面角色", () => {
    const result = readClipSpeakerBindings({
      characterRoleNames: ["论坛标题播报"],
      speakerBindings: [{ name: "论坛标题播报", assetKind: "voice" }],
      speechEvents: [speechEvent({ id: "speech-1", speakerName: "论坛标题播报", spokenText: "标题播报" })],
    });
    expect(result.issues.some((issue) => issue.problem.includes("同时出现在 characterRoleNames"))).toBe(true);
  });

  it("每个 speechEvent 都必须存在 canonical speakerName 并精确命中 speakerBindings.name", () => {
    const missing = readClipSpeakerBindings({
      speakerBindings: [{ name: "孟川", assetKind: "character" }],
      speechEvents: [{ ...speechEvent({ id: "speech-1", speakerName: "孟川", spokenText: "我回来了" }), speakerName: "" }],
    });
    expect(missing.issues.some((issue) => issue.path === "speechEvents[0].speakerName")).toBe(true);

    const dangling = readClipSpeakerBindings({
      speakerBindings: [{ name: "孟川", assetKind: "character" }],
      speechEvents: [speechEvent({ id: "speech-1", speakerName: "母亲", spokenText: "回来就好" })],
    });
    expect(dangling.issues.some((issue) => issue.problem.includes("未在 speakerBindings"))).toBe(true);
  });

  it("旧 shot.speakerName/dialogue 不再构成人声事实", () => {
    const result = readClipSpeakerBindings({
      speakerBindings: [{ name: "孟川", assetKind: "character" }],
      shots: [{ action: "孟川开口", durationSeconds: 3, speakerName: "孟川", dialogue: "旧字段" }],
    });
    expect(result.issues).toEqual([]);
    expect(result.bindings).toEqual([{ name: "孟川", assetKind: "character" }]);
  });

  it("全章聚合 character 与 voice 资产需求且不靠姓名白名单", () => {
    const result = collectSpeakerAssetRequirements([
      {
        clipIndex: 0,
        speakerBindings: [
          { name: "归来学生", assetKind: "character" },
          { name: "章节旁白", assetKind: "voice" },
        ],
      },
      {
        clipIndex: 1,
        speakerBindings: [{ name: "论坛声线甲", assetKind: "voice" }],
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.requirements).toEqual({
      characterSpeakers: ["归来学生"],
      voiceOnlySpeakers: ["章节旁白", "论坛声线甲"],
    });
  });

  it("同一说话人跨 clip 资产类型冲突时显式失败", () => {
    const result = collectSpeakerAssetRequirements([
      { clipIndex: 0, speakerBindings: [{ name: "学生甲", assetKind: "character" }] },
      { clipIndex: 1, speakerBindings: [{ name: "学生甲", assetKind: "voice" }] },
    ]);
    expect(result.issues.at(-1)?.issues[0]?.problem).toContain("跨 clip 同时声明");
  });

  it("StoryPlan 归一化保留 SpeechEvent 外键，start 阶段不会把台词塞回 shot", () => {
    const event = speechEvent({
      id: "speech-1",
      speakerName: "论坛标题播报",
      spokenText: "失踪学生回来了",
      startSeconds: 0,
      endSeconds: 15,
    });
    const plan = validateStoryPlan({
      runId: "speaker-contract-v2",
      videoModel: "doubao-seedance-2-0-260128",
      targetDurationSeconds: 15,
      clips: [{
        clipPrompt: "论坛页面滚动，画外播报标题。",
        durationSeconds: 15,
        videoReferenceNodeIds: [],
        assetObjectContracts: [],
        continuityMode: "editorial_cut",
        speakerBindings: [{ name: "论坛标题播报", assetKind: "voice" }],
        speechEvents: [event],
        shots: [{
          action: "论坛页面滚动",
          durationSeconds: 15,
          speechEventIds: [event.speechEventId],
        }],
      }],
    });
    expect(plan.clips[0]?.speakerBindings).toEqual([
      { name: "论坛标题播报", assetKind: "voice" },
    ]);
    expect(plan.clips[0]?.speechEvents?.[0]).toMatchObject({
      speechEventId: "speech-1",
      speakerName: "论坛标题播报",
      spokenText: "失踪学生回来了",
    });
    expect(plan.clips[0]?.shots?.[0]).toMatchObject({
      speechEventIds: ["speech-1"],
    });
  });

  it("计划说话人绑定变化会改变 coverage 指纹", () => {
    const base = [{
      clipPrompt: "论坛页面滚动",
      durationSeconds: 15,
      characterRoleNames: [],
      speakerBindings: [{ name: "播报甲", assetKind: "voice" }],
    }];
    const changed = [{
      ...base[0],
      speakerBindings: [{ name: "播报乙", assetKind: "voice" }],
    }];
    expect(buildSpeakerCoveragePlanFingerprint(base)).not.toBe(
      buildSpeakerCoveragePlanFingerprint(changed),
    );
  });
});
