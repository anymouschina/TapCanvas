import { describe, expect, it } from "vitest";

import {
  bindVerifiedVoiceReferences,
  compileStructuredClipForExecution,
  renderClipPromptFromShots,
  StructuredClipExecutionContractError,
  VOICE_REFERENCE_BINDING_PLACEHOLDER,
  type StructuredClip,
} from "./video-orchestrator.clip-shots";
import { assetObjectContractIdentityKey } from "./video-orchestrator.asset-object-contract";

function sampleClip(): StructuredClip & Record<string, unknown> {
  return {
    durationSeconds: 6,
    continuity: "同一客厅、时间连续",
    exitState: "钥匙留在茶几上，两人仍在原位",
    sceneState: { entry: "小美靠窗，阿诚靠门" },
    characterStateVersions: {
      小美: { stateKey: "standing-with-key", source: "beat" },
    },
    continuityLedger: { entry: { facts: ["钥匙在小美右手"] } },
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
      { startSeconds: 0, endSeconds: 1, startState: "右手持钥匙", startFrame: "手在身侧", transition: "抬手", carryState: "钥匙到茶几上方", carryFrame: "手悬在茶几上" },
      { startSeconds: 1, endSeconds: 2, startState: "钥匙到茶几上方", startFrame: "手悬在茶几上", transition: "松手", carryState: "钥匙落在茶几", carryFrame: "钥匙静止" },
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
  it("renders only AUDIO, ENTRY+REFERENCES, SHOTS and EXIT sections", () => {
    const rendered = renderClipPromptFromShots(sampleClip());
    expect(rendered).toContain("【AUDIO】");
    expect(rendered).toContain("【ENTRY+REFERENCES】");
    expect(rendered).toContain("【SHOTS】");
    expect(rendered).toContain("【EXIT】");
    expect(rendered).not.toContain("TEMPORAL_FRAME_TRACK");
    expect(rendered).not.toContain("logline");
    expect(rendered).not.toContain("剪辑节奏");
  });

  it("keeps one complete speech event across multiple camera cuts", () => {
    const rendered = renderClipPromptFromShots(sampleClip());
    expect(rendered.match(/我只是来还钥匙。/g)).toHaveLength(1);
    expect(rendered.match(/Speech=speech-L01/g)).toHaveLength(2);
    expect(rendered).not.toMatch(/SpokenText="我只是来"/);
    expect(rendered).not.toMatch(/SpokenText="还钥匙。"/);
  });

  it("folds temporal state into the intersecting shot instead of repeating a second table", () => {
    const rendered = renderClipPromptFromShots(sampleClip());
    expect(rendered).toContain("状态=0-1:右手持钥匙→抬手→钥匙到茶几上方");
    expect(rendered).toContain("1-2:钥匙到茶几上方→松手→钥匙落在茶几");
  });

  it("losslessly compacts adjacent provider windows within each shot", () => {
    const clip = sampleClip();
    clip.temporalFrameTrack = [
      { startSeconds: 0, endSeconds: 1, startState: "门仍关闭", startFrame: "门板轻颤", transition: "来客持续拍门", carryState: "门仍关闭", carryFrame: "门闩震动" },
      { startSeconds: 1, endSeconds: 2, startState: "门仍关闭", startFrame: "门板轻颤", transition: "来客持续拍门", carryState: "门仍关闭", carryFrame: "门闩震动" },
      { startSeconds: 2, endSeconds: 3, startState: "门仍关闭", startFrame: "门板轻颤", transition: "来客持续拍门", carryState: "门仍关闭", carryFrame: "门闩震动" },
      { startSeconds: 3, endSeconds: 4, startState: "门仍关闭", startFrame: "手抵门板", transition: "屋主抽开门闩", carryState: "门闩已解除", carryFrame: "门扇尚未打开" },
    ];

    const rendered = renderClipPromptFromShots(clip);
    expect(rendered).toContain("状态=0-2:门仍关闭→来客持续拍门→门仍关闭");
    expect(rendered).toContain("2-3:门仍关闭→来客持续拍门→门仍关闭");
    expect(rendered.split("来客持续拍门")).toHaveLength(3);
    expect(rendered).toContain("3-4:门仍关闭→屋主抽开门闩→门闩已解除");
    expect(clip.temporalFrameTrack).toHaveLength(4);
  });

  it("uses final manifest indices and freezes the unique VoiceManifest address", () => {
    const references = new Map([[assetObjectContractIdentityKey("character", "小美"), ["@图1"]]]);
    const rendered = renderClipPromptFromShots(sampleClip(), null, {
      assetReferenceIndicesByContractKey: references,
    });
    expect(rendered).toContain("Speaker=@图1（小美）");
    expect(rendered).toContain(VOICE_REFERENCE_BINDING_PLACEHOLDER);
    const bound = bindVerifiedVoiceReferences(rendered, "小美=@音频1");
    expect(bound).toContain("VoiceManifest=小美=@音频1");
    expect(bound).not.toContain(VOICE_REFERENCE_BINDING_PLACEHOLDER);
  });

  it("renders structured speech without a fake VoiceManifest when provider-native audio is frozen", () => {
    const rendered = renderClipPromptFromShots(sampleClip(), null, {
      voiceReferenceMode: "provider_native",
    });
    expect(rendered).toContain("VoiceMode=ProviderNativeAudio");
    expect(rendered).not.toContain(VOICE_REFERENCE_BINDING_PLACEHOLDER);
    expect(rendered).not.toContain("VoiceManifest=");
  });

  it("hard-fails missing or duplicated VoiceManifest placeholders", () => {
    expect(() => bindVerifiedVoiceReferences("no placeholder", "小美=@音频1")).toThrow("voice_reference_binding_placeholder_missing");
    expect(() => bindVerifiedVoiceReferences(
      `${VOICE_REFERENCE_BINDING_PLACEHOLDER}${VOICE_REFERENCE_BINDING_PLACEHOLDER}`,
      "小美=@音频1",
    )).toThrow("voice_reference_binding_placeholder_duplicated");
  });

  it("compiles the v2 prompt while retaining the full authoring envelope as evidence", () => {
    const clip = sampleClip();
    const compiled = compileStructuredClipForExecution(clip);
    expect(compiled.clipPrompt).toContain("【SHOTS】");
    expect(compiled.temporalFrameTrack).toEqual(clip.temporalFrameTrack);
    expect(compiled.speechEvents).toEqual(clip.speechEvents);
  });

  it("still rejects structurally invalid shot clocks before execution", () => {
    const clip = sampleClip();
    clip.shots[1].durationSeconds = 3;
    expect(() => compileStructuredClipForExecution(clip)).toThrow(StructuredClipExecutionContractError);
  });
});
