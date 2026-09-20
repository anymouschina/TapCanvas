import { describe, expect, it } from "vitest";

import {
  compileStructuredClipForExecution,
  parseShotMotionDynamics,
  renderClipPromptFromShots,
  StructuredClipExecutionContractError,
  type StructuredClip,
} from "./video-orchestrator.clip-shots";
import { assetObjectContractIdentityKey } from "./video-orchestrator.asset-object-contract";
import { compileTemporalFrameContract } from "./video-orchestrator.temporal-frame-track";

function sampleClip(): StructuredClip & Record<string, unknown> {
  return {
    durationSeconds: 6,
    continuity: "同一客厅、时间连续",
    exitState: "钥匙留在茶几上，两人仍在原位",
    sceneState: {
      subscene: "客厅", interiorExterior: "interior", timeOfDay: "白天", lighting: "窗侧自然光",
      spatialAnchor: "茶几连接窗与门", stateIn: "小美靠窗，阿诚靠门", stateOut: "两人仍在原位",
    },
    characterStateVersions: {
      小美: { stateId: "standing-with-key", visualState: "靠窗站立", stateIn: "右手持钥匙", stateOut: "右手空着" },
    },
    continuityLedger: {
      inheritsPreviousExit: false,
      entry: { stateScope: "living-room", facts: [{ key: "key-location", value: "小美右手" }] },
      exit: { stateScope: "living-room", facts: [{ key: "key-location", value: "茶几上" }] },
    },
    assetObjectContracts: [{
      kind: "character",
      name: "小美",
      referenceRole: "identity",
      referenceImageNodeIds: ["image-node-1"],
      identityInvariant: "同一角色",
      startState: "靠窗持钥匙",
      spatialRelation: "茶几左侧",
      driver: "归还钥匙",
      stateChange: "钥匙转移到茶几",
      endState: "靠窗空手",
    }],
    speakerBindings: [{ name: "小美", assetKind: "character" }],
    speechEvents: [{
      speechEventId: "speech-L01",
      lineId: "L01",
      startOffset: 0,
      endOffset: 8,
      startSeconds: 1,
      endSeconds: 5,
      speakerName: "小美",
      delivery: "on_screen",
      performance: "平静，一口气说完，句末收住",
      spokenText: "我只是来还钥匙。",
    }],
    temporalFrameTrack: [
      { windowIndex: 0, storyEventIndices: [0], startSeconds: 0, endSeconds: 1, startState: "右手持钥匙", startFrame: "手在身侧", transition: "抬手", carryState: "钥匙到茶几上方", carryFrame: "手悬在茶几上" },
      { windowIndex: 1, storyEventIndices: [0], startSeconds: 1, endSeconds: 2, startState: "钥匙到茶几上方", startFrame: "手悬在茶几上", transition: "松手", carryState: "钥匙落在茶几", carryFrame: "钥匙静止" },
    ],
    shots: [
      {
        shotNo: 1,
        visualTask: "看清钥匙从右手移向茶几",
        depictedStoryEventIndices: [0],
        action: "小美抬起右手，将钥匙移到茶几上方",
        durationSeconds: 2,
        framing: "中近景",
        composition: "茶几连接两人",
        cameraMove: "固定",
        motionDynamics: {
          tempo: "sustained",
          force: "light",
          direction: "forward",
          airborne: "none",
          rotation: "none",
          brakingMode: "ground_friction",
          environmentalResponse: "none",
          subject: "小美",
        },
        lighting: "窗侧自然光",
        materialResponse: "金属钥匙反射窄亮边",
        speechEventIds: ["speech-L01"],
        sound: "衣料轻响",
      },
      {
        shotNo: 2,
        visualTask: "看清钥匙落桌与阿诚收手",
        depictedStoryEventIndices: [0],
        action: "钥匙落在桌面；阿诚把双手从膝上收回身侧",
        durationSeconds: 4,
        framing: "过肩中景",
        composition: "钥匙位于两人之间",
        cameraMove: "轻微横移到阿诚反应",
        speechEventIds: ["speech-L01"],
        sound: "钥匙触桌声",
      },
    ],
  };
}

describe("prompt-package v2 deterministic projection", () => {
  it("requires actual execution text for static shots instead of rendering their planning purpose", () => {
    const clip = sampleClip();
    clip.speechEvents = [];
    clip.shots = [{
      shotNo: 1, durationSeconds: 6, depictedStoryEventIndices: [0],
      visualTask: "建立物件位置", action: "钥匙静置于空桌中央", framing: "全景", cameraMove: "固定",
    }];
    const compiled = compileStructuredClipForExecution(clip);
    expect(compiled.clipPrompt).toContain("钥匙静置于空桌中央");
    expect(compiled.clipPrompt).not.toContain("建立物件位置");
    expect(compiled.shots).toEqual(clip.shots);
    for (const action of [undefined, "", "   "]) {
      clip.shots[0]!.action = action;
      expect(() => compileStructuredClipForExecution(clip)).toThrow(StructuredClipExecutionContractError);
      expect(() => renderClipPromptFromShots(clip)).toThrow("structured_clip_action_missing");
    }
  });

  it("preserves force and material execution prose without exposing motion enum evidence", () => {
    const clip = sampleClip();
    clip.shots[0]!.action = "小美前冲撞上墙面，肩部受阻后身体反弹，双脚擦地制动";
    clip.shots[0]!.materialResponse = "肩部接触处墙灰落下，脚下尘土被擦向前方";
    clip.shots[0]!.motionDynamics = {
      tempo: "fast", force: "heavy", direction: "forward", airborne: "none",
      rotation: "partial", brakingMode: "wall_impact", impactSurface: "wall", environmentalResponse: "dust",
    };
    const before = JSON.stringify(clip);
    const rendered = renderClipPromptFromShots(clip);
    expect(rendered).toContain(clip.shots[0]!.action);
    expect(rendered).toContain(clip.shots[0]!.materialResponse);
    expect(rendered).not.toContain("wall_impact");
    expect(JSON.stringify(clip)).toBe(before);
  });

  it("keeps planning evidence out of the prompt and preserves sub-tenth boundaries", () => {
    const clip = sampleClip();
    clip.continuity = "来客承接门外的侧移";
    clip.editRhythm = "接触声切到另一侧，动作方向接续";
    clip.shots = [
      { shotNo: 1, durationSeconds: 0.04, visualTask: "接触", action: "物体接触" },
      { shotNo: 2, durationSeconds: 0.035, visualTask: "偏转", action: "物体偏转" },
      { shotNo: 3, durationSeconds: 5.925, visualTask: "离开", action: "物体离开" },
    ];
    const speech = clip.speechEvents?.[0];
    if (!speech) throw new Error("fixture speech missing");
    speech.startSeconds = 0.075;
    const rendered = renderClipPromptFromShots(clip);
    expect(rendered).not.toContain(clip.continuity);
    expect(rendered).not.toContain(clip.editRhythm);
    expect(rendered).toContain("镜头1（0-0.04s）");
    expect(rendered).toContain("镜头2（0.04-0.075s）");
    expect(rendered).toContain("镜头3（0.075-6s）");
    expect(rendered).toContain("对白（0.075-5s");
  });
  it("normalizes a valid high-motion dynamics contract without interpreting action text", () => {
    const result = parseShotMotionDynamics({
      tempo: "instant",
      force: "heavy",
      direction: "diagonal",
      airborne: "brief",
      rotation: "partial",
      brakingMode: "counterforce",
      impactSurface: "wall",
      environmentalResponse: "debris",
      subject: "持刀者",
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({
      tempo: "instant",
      force: "heavy",
      direction: "diagonal",
      brakingMode: "counterforce",
      impactSurface: "wall",
    });
  });

  it("rejects malformed enum values as a structural input error", () => {
    const result = parseShotMotionDynamics({
      tempo: "fast-ish",
      force: "heavy",
      direction: "diagonal",
      airborne: "brief",
      rotation: "partial",
      brakingMode: "counterforce",
      environmentalResponse: "debris",
    });
    expect(result.value).toBeNull();
    expect(result.errors[0]).toContain("tempo 必须是 instant/fast/sustained");
    expect(result.errors[0]).toContain("实收 \"fast-ish\"");
  });

  it("treats null motion dynamics as the strict-tool representation of omission", () => {
    expect(parseShotMotionDynamics(null)).toEqual({ value: null, errors: [] });
  });

  it("renders only provider-facing audiovisual language and reference tokens", () => {
    const rendered = renderClipPromptFromShots(sampleClip());
    expect(rendered).not.toContain("起始状态：同一客厅、时间连续");
    expect(rendered).toContain("镜头1（0-2s）");
    expect(rendered).not.toContain("运动学");
    expect(rendered).toContain("小美抬起右手，将钥匙移到茶几上方");
    expect(rendered).not.toContain("结束状态：");
    expect(rendered).not.toContain("【AUDIO】");
    expect(rendered).not.toContain("【ENTRY+REFERENCES】");
    expect(rendered).not.toContain("【SHOTS】");
    expect(rendered).not.toContain("【EXIT】");
    expect(rendered).not.toContain("SpeechEvent");
    expect(rendered).not.toContain("VISUAL_ONLY");
    expect(rendered).not.toContain("SFX_ONLY");
    expect(rendered).not.toContain("TEMPORAL_FRAME_TRACK");
    expect(rendered).not.toContain("logline");
    expect(rendered).not.toContain("剪辑节奏");
  });

  it("keeps one complete speech event across multiple camera cuts", () => {
    const rendered = renderClipPromptFromShots(sampleClip());
    expect(rendered.match(/我只是来还钥匙。/g)).toHaveLength(1);
    expect(rendered).not.toContain("speech-L01");
    expect(rendered).not.toMatch(/SpokenText=/);
  });

  it("keeps canonical subjects and binds their final manifest images separately", () => {
    const clip = sampleClip();
    clip.continuity = "小美在画左，阿诚在画右，钥匙位于两人之间";
    clip.exitState = "小美空手，阿诚收回双手";
    clip.shots[0]!.composition = "小美在画左，阿诚在画右，钥匙位于两人之间";
    clip.assetObjectContracts = [
      ...(clip.assetObjectContracts ?? []),
      {
        kind: "character",
        name: "阿诚",
        referenceRole: "identity",
        referenceImageNodeIds: ["image-node-2"],
        identityInvariant: "同一角色",
        startState: "靠门坐着",
        spatialRelation: "茶几右侧",
        driver: "接住钥匙",
        stateChange: "双手收回身侧",
        endState: "靠门收手",
      },
    ];
    const references = new Map([
      [assetObjectContractIdentityKey("character", "小美"), ["@图3"]],
      [assetObjectContractIdentityKey("character", "阿诚"), ["@图2"]],
    ]);
    const rendered = renderClipPromptFromShots(clip, null, {
      assetReferenceIndicesByContractKey: references,
    });
    expect(rendered).not.toContain("起始状态：@图3在画左，@图2在画右");
    expect(rendered).toContain("小美抬起右手");
    expect(rendered).toContain("小美（identity）：@图3");
    expect(rendered).toContain("阿诚把双手从膝上收回身侧");
    expect(rendered).toContain("小美在画左");
    expect(rendered).toContain("阿诚在画右");
  });

  it("does not turn multiple views into multiple subjects or replace names inside words", () => {
    const clip = sampleClip();
    clip.continuity = "小美独自拿着手机，手机壳在桌上";
    clip.shots[0]!.action = "小美独自拿着手机，手机壳在桌上";
    clip.assetObjectContracts = [...(clip.assetObjectContracts ?? []), {
      kind: "prop", name: "手机", referenceRole: "prop", referenceImageNodeIds: ["phone"],
    }];
    const references = new Map([
      [assetObjectContractIdentityKey("character", "小美"), ["@图2", "@图3"]],
      [assetObjectContractIdentityKey("prop", "手机"), ["@图1"]],
    ]);
    const before = JSON.stringify(clip);
    const rendered = renderClipPromptFromShots(clip, null, { assetReferenceIndicesByContractKey: references });
    expect(rendered).toContain("小美（identity）：@图2、@图3");
    expect(rendered).toContain("手机（prop）：@图1");
    expect(rendered).toContain("小美独自拿着手机，手机壳在桌上");
    expect(rendered).not.toContain("@图2、@图3独自");
    expect(rendered).not.toContain("@图1壳");
    expect(JSON.stringify(clip)).toBe(before);
  });

  it("retains exact event state timestamps as evidence without rendering duplicate states", () => {
    const clip = sampleClip();
    const compiled = compileTemporalFrameContract({
      durationSeconds: 6,
      storyEvents: [{ startSeconds: 0, endSeconds: 6, entryState: "右手持钥匙", exitState: "钥匙在桌面，双手已收回" }],
      exitState: "钥匙在桌面，双手已收回",
      shots: clip.shots,
      field: "clip",
    });
    clip.temporalFrameTrack = [...compiled.temporalFrameTrack];
    const originalTrack = JSON.stringify(clip.temporalFrameTrack);
    const rendered = renderClipPromptFromShots(clip);
    expect(compiled.temporalFrameTrack[0]!.stateAnchors).toContainEqual({ seconds: 0, state: "右手持钥匙" });
    expect(rendered).not.toContain("边界状态=");
    expect(rendered).not.toContain("边界状态=6s:钥匙在桌面，双手已收回");
    expect(rendered).not.toContain("3s:右手持钥匙");
    expect(rendered.split(clip.shots[1]!.action!)).toHaveLength(2);
    expect(JSON.stringify(clip.temporalFrameTrack)).toBe(originalTrack);
  });

  it("does not claim a sampled checkpoint is a timestamped physical pose", () => {
    const clip = sampleClip();
    const rendered = renderClipPromptFromShots(clip);
    expect(rendered).not.toContain("边界状态=");
    expect(rendered).toContain(clip.shots[0]!.action!);
    expect(rendered).not.toContain(`结束状态：${clip.exitState}`);
  });

  it("preserves the speaker identity independently of reference indices", () => {
    const references = new Map([[assetObjectContractIdentityKey("character", "小美"), ["@图1"]]]);
    const rendered = renderClipPromptFromShots(sampleClip(), null, {
      assetReferenceIndicesByContractKey: references,
    });
    expect(rendered).not.toContain("对白（1-5s，@图1，画内对白");
    expect(rendered).toContain("小美，画内对白");
    expect(rendered).not.toContain("VoiceManifest");
  });

  it("renders structured speech as audiovisual language without machine audio fields", () => {
    const rendered = renderClipPromptFromShots(sampleClip());
    expect(rendered).toContain("对白（1-5s，小美，画内对白");
    expect(rendered).not.toContain("SpeechEvent");
    expect(rendered).not.toContain("VoiceManifest=");
  });

  it("compiles the v2 prompt while retaining the full authoring envelope as evidence", () => {
    const clip = sampleClip();
    const compiled = compileStructuredClipForExecution(clip);
    expect(compiled.clipPrompt).toContain("镜头1（0-2s）");
    expect(compiled.temporalFrameTrack).toEqual(clip.temporalFrameTrack);
    expect(compiled.speechEvents).toEqual(clip.speechEvents);
  });

  it("still rejects structurally invalid shot clocks before execution", () => {
    const clip = sampleClip();
    clip.shots[1].durationSeconds = 3;
    expect(() => compileStructuredClipForExecution(clip)).toThrow(StructuredClipExecutionContractError);
  });
});

describe("shot-local speech projection", () => {
  it("places the full line at its onset and carries it across cuts without duplication", () => {
    const clip = sampleClip();
    const before = JSON.stringify(clip);
    const rendered = renderClipPromptFromShots(clip);
    const first = rendered.indexOf("镜头1（");
    const second = rendered.indexOf("镜头2（");
    const dialogue = rendered.indexOf("对白（1-5s");
    expect(dialogue).toBeGreaterThan(first);
    expect(dialogue).toBeLessThan(second);
    expect(rendered.slice(second)).toContain("对白接续（本镜 2-5s，小美，画内对白）");
    expect(rendered.slice(second)).toContain("5s 结束");
    const line = JSON.stringify(clip.speechEvents![0]!.spokenText);
    expect(rendered.split(line)).toHaveLength(2);
    expect(JSON.stringify(clip)).toBe(before);
  });

  it("starts speech exactly on a cut in the next shot and leaves silent shots silent", () => {
    const clip = sampleClip();
    clip.speechEvents![0]!.startSeconds = 2;
    const rendered = renderClipPromptFromShots(clip);
    const first = rendered.indexOf("镜头1（");
    const second = rendered.indexOf("镜头2（");
    expect(rendered.slice(first, second)).not.toContain("对白");
    expect(rendered.slice(second)).toContain("对白（2-5s");
    expect(rendered).not.toContain("对白接续");
  });
});
