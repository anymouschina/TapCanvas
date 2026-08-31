import { describe, it, expect } from "vitest";

import {
  distinctSpeakersInOrder,
  extractClipDialogueLines,
  isDegenerateDialogue,
  isValidTimbreSampleDuration,
  resolveClipDialogueAudioReferences,
  buildVerifiedVoiceBindingInstructionFromManifest,
} from "./video-orchestrator.dialog-audio";

describe("extractClipDialogueLines", () => {
  it("解析 @角色（情绪）：「台词」 与 [旁白] 两种写法、保序", () => {
    const cp = [
      "镜1｜中近景｜人羊抬手｜台词：@山羊头人（低沉）：「介绍一下，我是人羊」｜6s",
      "镜2｜全景｜众人抬头｜[旁白]（悬疑）：「他说得轻描淡写」｜4s",
      "镜3｜中景｜@黑T恤男：「你在耍我们？」",
    ].join("\n");
    const lines = extractClipDialogueLines(cp);
    expect(lines).toEqual([
      { speaker: "山羊头人", text: "介绍一下，我是人羊" },
      { speaker: "旁白", text: "他说得轻描淡写" },
      { speaker: "黑T恤男", text: "你在耍我们？" },
    ]);
  });

  it("滤掉纯省略号/标点的退化台词（沉默不是对白）", () => {
    const cp = "@齐夏（沉默）：「……」\n@山羊头人：「很好，九位」";
    const lines = extractClipDialogueLines(cp);
    expect(lines).toEqual([{ speaker: "山羊头人", text: "很好，九位" }]);
  });

  it("无对白返回空数组", () => {
    expect(extractClipDialogueLines("纯动作描写，没有引号对白")).toEqual([]);
  });
});

describe("isDegenerateDialogue", () => {
  it("省略号/单字/纯标点=退化", () => {
    expect(isDegenerateDialogue("……")).toBe(true);
    expect(isDegenerateDialogue("！？")).toBe(true);
    expect(isDegenerateDialogue("啊")).toBe(true);
  });
  it("正常台词不退化", () => {
    expect(isDegenerateDialogue("很好，九位")).toBe(false);
  });
});

describe("distinctSpeakersInOrder", () => {
  it("按首次开口顺序去重", () => {
    const s = distinctSpeakersInOrder([
      { speaker: "山羊头人", text: "第一句" },
      { speaker: "黑T恤男", text: "反驳" },
      { speaker: "山羊头人", text: "第二句" },
    ]);
    expect(s).toEqual(["山羊头人", "黑T恤男"]);
  });

  it("超上限截前 N 个说话人", () => {
    const s = distinctSpeakersInOrder(
      [
        { speaker: "A", text: "a" },
        { speaker: "B", text: "b" },
        { speaker: "C", text: "c" },
        { speaker: "D", text: "d" },
      ],
      3,
    );
    expect(s).toEqual(["A", "B", "C"]);
  });
});

describe("isValidTimbreSampleDuration", () => {
  const check = (durationSec: number | null) => isValidTimbreSampleDuration({
    durationSec,
    minimumDurationSeconds: 1.8,
    maximumDurationSeconds: 30.2,
  });
  it("ARK r2v 下限 1.8s 之下必拒（含 null）", () => {
    expect(check(null)).toBe(false);
    expect(check(1.2)).toBe(false);
    expect(check(1.79)).toBe(false);
  });
  it("只按冻结的供应商上下限验真，不使用本地 8 秒经验闸", () => {
    expect(check(2.0)).toBe(true);
    expect(check(3.7)).toBe(true);
    expect(check(8.0)).toBe(true);
    expect(check(9.1)).toBe(true);
    expect(check(30.3)).toBe(false);
  });
});

describe("resolveClipDialogueAudioReferences — 真实配音卡资产硬失败", () => {
  it("模型零容量合同只在确实请求说话人参考音频时失败", async () => {
    await expect(resolveClipDialogueAudioReferences({
      speakerNames: [],
      audioAssetByCharacter: new Map(),
      referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 },
    })).resolves.toEqual({ urls: [], bindingInstruction: "", segments: [], dropped: [] });
    await expect(resolveClipDialogueAudioReferences({
      speakerNames: ["孟川"],
      audioAssetByCharacter: new Map(),
      referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 },
    })).rejects.toThrow("speaker_reference_audio_unsupported");
  });

  it("当前说话人缺 voiceId 时显式失败", async () => {
    await expect(
      resolveClipDialogueAudioReferences({
        speakerNames: ["孟川"],
        audioAssetByCharacter: new Map(),
        referenceAudioPolicy: { minimumDurationSeconds: 1.8, maximumDurationSeconds: 30.2 },
      }),
    ).rejects.toThrow("speaker_voice_binding_missing");
  });

  it("不会把旁白 voiceId 回退给其他说话人", async () => {
    await expect(
      resolveClipDialogueAudioReferences({
        speakerNames: ["孟川"],
        audioAssetByCharacter: new Map([["旁白", {
          voiceId: "voice-narrator",
          url: "https://assets.example/narrator.mp3",
          durationSec: 3,
        }]]),
        referenceAudioPolicy: { minimumDurationSeconds: 1.8, maximumDurationSeconds: 30.2 },
      }),
    ).rejects.toThrow("speaker_voice_binding_missing");
  });

  it("按说话人顺序把配音卡真实 URL 绑定为 @音频N", async () => {
    const result = await resolveClipDialogueAudioReferences({
      speakerNames: ["孟川", "旁白"],
      audioAssetByCharacter: new Map([
        ["孟川", { voiceId: "voice-meng", url: "https://assets.example/meng.mp3", durationSec: 3.2 }],
        ["旁白", { voiceId: "voice-narrator", url: "https://assets.example/narrator.mp3", durationSec: 4.1 }],
      ]),
      referenceAudioPolicy: { minimumDurationSeconds: 1.8, maximumDurationSeconds: 30.2 },
    });
    expect(result.urls).toEqual([
      "https://assets.example/meng.mp3",
      "https://assets.example/narrator.mp3",
    ]);
    expect(result.bindingInstruction).toContain("@音频1只作为孟川的人声音色参考");
    expect(result.bindingInstruction).toContain("@音频2只作为旁白的人声音色参考");
    expect(result.bindingInstruction).toContain("唯一可发声正文仍仅限本节上方成对〈发声正文〉标签内的文字");
    expect(result.bindingInstruction).not.toContain("镜头表中「」内文字");
    expect(result.bindingInstruction).not.toContain("背景音乐/BGM");
  });
});

describe("final voice reference manifest binding", () => {
  it("binds speakers to the final de-duplicated @音频N order", () => {
    const instruction = buildVerifiedVoiceBindingInstructionFromManifest({
      voiceBindings: [
        { character: "孟川", audioUrl: "https://assets.example/shared.mp3" },
        { character: "旁白", audioUrl: "https://assets.example/shared.mp3" },
        { character: "青龙", audioUrl: "https://assets.example/dragon.mp3" },
      ],
      manifestAudios: [
        { url: "https://assets.example/shared.mp3" },
        { url: "https://assets.example/dragon.mp3" },
      ],
    });
    expect(instruction).toContain("@音频1只作为孟川、旁白的人声音色参考");
    expect(instruction).toContain("@音频2只作为青龙的人声音色参考");
  });

  it("fails when a declared speaker audio is absent from the provider manifest", () => {
    expect(() => buildVerifiedVoiceBindingInstructionFromManifest({
      voiceBindings: [
        { character: "孟川", audioUrl: "https://assets.example/mengchuan.mp3" },
      ],
      manifestAudios: [{ url: "https://assets.example/other.mp3" }],
    })).toThrow("speaker_voice_manifest_mismatch");
  });
});
