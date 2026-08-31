import { describe, expect, it } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import {
  deriveClipCharacterRoleNames,
  resolveClipReferenceImageEntries,
  buildClipVoiceBindings,
  ensureClipVoiceBindings,
  type StoryPlanClip,
} from "./video-orchestrator.orchestrate";
import { buildLibraryVoiceCardProjectionPlan } from "./video-orchestrator.asset-selfheal";

const rowWith = (nodes: Array<Record<string, unknown>>): FlowRow => ({
  id: "flow-1",
  name: "Flow",
  data: JSON.stringify({ nodes, edges: [] }),
  owner_id: "user-1",
  project_id: "project-1",
  created_at: "2026-06-08T00:00:00.000Z",
  updated_at: "2026-06-08T00:00:00.000Z",
});

const clipOf = (over: Partial<StoryPlanClip>): StoryPlanClip =>
  ({ clipIndex: 0, ...over } as unknown as StoryPlanClip);

const spokenClip = (input: {
  speakerName: string;
  spokenText: string;
  assetKind?: "character" | "voice";
  action?: string;
  durationSeconds?: number;
  over?: Partial<StoryPlanClip>;
}): StoryPlanClip => {
  const durationSeconds = input.durationSeconds ?? 3;
  const speechEventId = "speech-1";
  return clipOf({
    ...input.over,
    speakerBindings: [{ name: input.speakerName, assetKind: input.assetKind ?? "character" }],
    speechEvents: [{
      speechEventId,
      lineId: "line-1",
      startOffset: 0,
      endOffset: Array.from(input.spokenText).length,
      startSeconds: 0,
      endSeconds: durationSeconds,
      speakerName: input.speakerName,
      delivery: input.assetKind === "voice" ? "voice_over" : "on_screen",
      spokenText: input.spokenText,
    }],
    shots: [{
      action: input.action ?? `${input.speakerName}开口`,
      durationSeconds,
      speechEventIds: [speechEventId],
    }],
  });
};

const QIXIA = "https://cdn/x/qixia.png";
const GOAT = "https://cdn/x/goat.png";
const HEITSHIRT = "https://cdn/x/heitshirt.png";

const chapterNodes = [
  { id: "role-qixia", data: { kind: "image", productionLayer: "anchors", roleName: "齐夏", imageUrl: QIXIA } },
  { id: "role-goat", data: { kind: "image", productionLayer: "anchors", roleName: "山羊头人", imageUrl: GOAT } },
  { id: "role-heit", data: { kind: "image", productionLayer: "anchors", roleName: "黑T恤男", imageUrl: HEITSHIRT } },
];

describe("deriveClipCharacterRoleNames — 确定性推导出场 cast（人物飘 keystone）", () => {
  it("① 显式 characterRoleNames 原样保留并优先", () => {
    const row = rowWith(chapterNodes);
    expect(deriveClipCharacterRoleNames(row, clipOf({ characterRoleNames: ["齐夏"] }))).toEqual(["齐夏"]);
  });

  it("② 从 referenceImageNodeIds 指向的角色卡节点回收 roleName（LLM 只手列 node-id 的情况）", () => {
    const row = rowWith(chapterNodes);
    const names = deriveClipCharacterRoleNames(
      row,
      clipOf({ videoReferenceNodeIds: ["role-qixia", "role-goat"] }),
    );
    expect(names).toContain("齐夏");
    expect(names).toContain("山羊头人");
  });

  it("clipPrompt 提及角色不会触发本地语义推断", () => {
    const row = rowWith(chapterNodes);
    const names = deriveClipCharacterRoleNames(
      row,
      clipOf({ clipPrompt: "山羊头人缓缓抬手，黑T恤男后退一步" }),
    );
    expect(names).toEqual([]);
  });

  it("结构化声明与显式 node id 并集去重，声明在前", () => {
    const row = rowWith(chapterNodes);
    const names = deriveClipCharacterRoleNames(
      row,
      clipOf({
        characterRoleNames: ["齐夏"],
        videoReferenceNodeIds: ["role-goat"],
        clipPrompt: "黑T恤男、齐夏、山羊头人同框",
      }),
    );
    expect(names[0]).toBe("齐夏");
    expect(new Set(names)).toEqual(new Set(["齐夏", "山羊头人"]));
  });

  it("空镜（无声明/无 id/无文本命中）→ 空数组", () => {
    const row = rowWith(chapterNodes);
    expect(deriveClipCharacterRoleNames(row, clipOf({ clipPrompt: "空屋，一盏吊灯" }))).toEqual([]);
  });

  it("镜头表、logline 与 continuity 都不参与角色绑定", () => {
    const row = rowWith(chapterNodes);
    const prompt =
      "【logline】顺齐夏目光看去，山羊头人静立街角\n" +
      "【镜头表】（时间轴逐拍推进）\n[0-3s] 镜1|远景|黑T恤男独自走来，面容渐清\n" +
      "【时空】承接上镜齐夏扭头僵住的视线。";
    const names = deriveClipCharacterRoleNames(row, clipOf({ clipPrompt: prompt }));
    expect(names).toEqual([]);
  });
});

describe("resolveClipReferenceImageEntries — keystone 推导驱动精确绑卡", () => {
  it("clip 只列了 node-id（无 characterRoleNames）→ 角色卡仍按角色语义精确绑定并打「角色卡·名」标签", () => {
    const row = rowWith(chapterNodes);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["role-qixia"] }),
      "",
    );
    // 齐夏卡被绑（url 命中）且标签是角色卡语义（供 seedance 精确制导 + 可观测归类）
    expect(entries.map((e) => e.url)).toContain(QIXIA);
    expect(entries.some((e) => /角色卡·齐夏/.test(e.label))).toBe(true);
  });

  it("clip 只在散文提及角色但未声明 → 不绑定任何角色卡", () => {
    const row = rowWith(chapterNodes);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ clipPrompt: "黑T恤男独自坐在圆桌旁" }),
      "",
    );
    expect(entries.map((e) => e.url)).not.toContain(HEITSHIRT);
  });
});

describe("显式群像资产绑定", () => {
  const ENS = "https://cdn/x/ensemble.png";
  const nodesWithEnsemble = [
    ...chapterNodes,
    { id: "ens", data: { kind: "image", productionLayer: "anchors", referenceType: "ensemble", label: "群像图｜圆桌十人+山羊头", imageUrl: ENS } },
  ];
  it("显式绑定群像图时不由本地镜头语义否定", () => {
    const row = rowWith(nodesWithEnsemble);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["role-qixia", "role-goat", "ens"] }),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(QIXIA);
    expect(urls).toContain(GOAT);
    expect(urls).toContain(ENS);
  });
  it("仅 1 张个体角色卡 + 群像图 → 群像图保留（群像/建立镜承载 casting 一致性）", () => {
    const row = rowWith(nodesWithEnsemble);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ videoReferenceNodeIds: ["role-qixia", "ens"] }),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(QIXIA);
    expect(urls).toContain(ENS);
  });
});

describe("道具卡只按 canonical propNames 绑定", () => {
  const MASK = "https://cdn/x/mask.png";
  const CLOCK = "https://cdn/x/clock.png";
  const nodesWithProps = [
    ...chapterNodes,
    { id: "prop-mask", data: { kind: "image", productionLayer: "anchors", label: "道具卡｜山羊头骨面具", imageUrl: MASK } },
    { id: "prop-clock", data: { kind: "image", productionLayer: "anchors", label: "道具卡｜繁纹座钟", imageUrl: CLOCK } },
  ];
  it("propNames 声明「山羊头骨面具」→ 对应道具卡被绑入参考", () => {
    const row = rowWith(nodesWithProps);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["山羊头人"], propNames: ["山羊头骨面具"], clipPrompt: "山羊头人戴着山羊头骨面具起身" }),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(MASK);
    expect(urls).not.toContain(CLOCK); // 未提到的道具不绑
  });
  it("prompt 提及但 propNames 未声明时不绑定道具卡", () => {
    const row = rowWith(nodesWithProps);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["山羊头人"], clipPrompt: "山羊头人戴着山羊头骨面具起身" }),
      "",
    ).map((e) => e.url);
    expect(urls).not.toContain(MASK);
  });
  it("章节无道具卡时零行为变化（安全空转）", () => {
    const row = rowWith(chapterNodes);
    const urls = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["齐夏"], clipPrompt: "齐夏观察座钟" }),
      "",
    ).map((e) => e.url);
    expect(urls).toContain(QIXIA);
  });
});

describe("音频绑定「音频N=角色·音色」— 按台词说话人绑（2026-07-17 ch1 复盘根治）", () => {
  const nodesWithVoice = [
    ...chapterNodes,
    { id: "vc-qixia", data: { kind: "audio", audioType: "voice_card", voiceCharacter: "齐夏", doubaoVoiceId: "ICL_uranus_zh_male_lengjungaozhi_tob", voiceLabel: "冷峻高智" } },
    { id: "vc-goat", data: { kind: "audio", audioType: "voice_card", voiceCharacter: "山羊头人", doubaoVoiceId: "ICL_uranus_zh_male_diyinchenyu_tob", voiceLabel: "低音沉郁" } },
    { id: "vc-crowd", data: { kind: "audio", audioType: "voice_card", voiceCharacter: "围观群众", doubaoVoiceId: "zh_male_houge_tob", voiceLabel: "猴哥2.0" } },
  ];
  it("素材库投影节点可被 runtime 同一画布合同直接绑定", () => {
    const projection = buildLibraryVoiceCardProjectionPlan({
      nodes: chapterNodes,
      roleNames: ["章节旁白"],
      libraryAssets: [{
        id: "voice-lib-narrator",
        name: "章节旁白",
        latestVersion: {
          id: "voice-lib-version",
          data: { doubaoVoiceId: "voice-real-narrator", voiceLabel: "沉稳旁白" },
        },
      }],
    });
    const bindings = buildClipVoiceBindings(
      rowWith([...chapterNodes, ...projection.createNodes]),
      spokenClip({
        speakerName: "章节旁白",
        spokenText: "风暴将至",
        assetKind: "voice",
        action: "画面推进",
        durationSeconds: 4,
      }),
    );
    expect(bindings).toEqual([
      expect.objectContaining({
        character: "章节旁白",
        voiceId: "voice-real-narrator",
        voiceLabel: "沉稳旁白",
      }),
    ]);
  });
  it("按台词说话人（首次开口序）绑配音卡；无台词的出场角色不绑", () => {
    const row = rowWith(nodesWithVoice);
    const b = buildClipVoiceBindings(
      row,
      spokenClip({
        speakerName: "齐夏",
        spokenText: "你输了",
        action: "齐夏逼近，山羊头人沉默不语",
        durationSeconds: 4,
        over: { characterRoleNames: ["齐夏", "山羊头人"] },
      }),
    );
    expect(b.map((x) => x.character)).toEqual(["齐夏"]); // 山羊头人出场但没开口 → 不绑
    expect(b[0].voiceLabel).toBe("冷峻高智");
  });
  it("画外说话人（围观群众）不在 cast 也能绑到自愈配音卡（ch1 clip1 病根）", () => {
    const row = rowWith(nodesWithVoice);
    const b = buildClipVoiceBindings(
      row,
      spokenClip({
        speakerName: "围观群众",
        spokenText: "那人好怪啊",
        assetKind: "voice",
        action: "齐夏静立，画外传来窃语",
        durationSeconds: 4,
        over: { characterRoleNames: ["齐夏"] },
      }),
    );
    expect(b.map((x) => x.character)).toEqual(["围观群众"]);
    expect(b[0].voiceId).toBe("zh_male_houge_tob");
  });
  it("非 canonical 缩略称呼不再模糊绑定", () => {
    const row = rowWith([
      ...nodesWithVoice,
      { id: "vc-fisher", data: { kind: "audio", audioType: "voice_card", voiceCharacter: "戴渔夫帽同伴", doubaoVoiceId: "zh_male_fisher_tob", voiceLabel: "低沉青年" } },
    ]);
    try {
      buildClipVoiceBindings(row, spokenClip({
        speakerName: "同伴",
        spokenText: "总得有人陪着吧",
        action: "同伴迟疑",
        durationSeconds: 4,
      }));
      throw new Error("expected missing binding");
    } catch (error) {
      expect(error).toMatchObject({ code: "speaker_voice_binding_missing" });
    }
  });
  it("精确同名配音卡重复时显式失败", () => {
    const row = rowWith([
      ...nodesWithVoice,
      { id: "vc-qixia-duplicate", data: { kind: "audio", audioType: "voice_card", voiceCharacter: "齐夏", doubaoVoiceId: "zh_duplicate" } },
    ]);
    try {
      buildClipVoiceBindings(row, spokenClip({ speakerName: "齐夏", spokenText: "走吧" }));
      throw new Error("expected ambiguous binding");
    } catch (error) {
      expect(error).toMatchObject({ code: "speaker_voice_binding_ambiguous" });
    }
  });
  it("精确同名重复卡使用同一 voiceId 时确定性归并，不制造伪歧义", () => {
    const row = rowWith([
      ...nodesWithVoice,
      { id: "aa-qixia-equivalent", data: { kind: "audio", audioType: "voice_card", voiceCharacter: "齐夏", doubaoVoiceId: "ICL_uranus_zh_male_lengjungaozhi_tob", voiceLabel: "同一音色副本" } },
    ]);
    const bindings = buildClipVoiceBindings(row, spokenClip({ speakerName: "齐夏", spokenText: "走吧" }));
    expect(bindings).toHaveLength(1);
    expect(bindings[0].voiceId).toBe("ICL_uranus_zh_male_lengjungaozhi_tob");
    expect(bindings[0].nodeId).toBe("aa-qixia-equivalent");
  });
  it("无台词镜（纯动作）→ 空数组（不给无念白镜塞音色）", () => {
    const row = rowWith(nodesWithVoice);
    expect(
      buildClipVoiceBindings(row, clipOf({ characterRoleNames: ["齐夏"], clipPrompt: "齐夏拔刀冲锋" })),
    ).toEqual([]);
  });
  it("超过供应商参考音频硬上限时给 Agent 明确拆 clip 证据", () => {
    const row = rowWith(nodesWithVoice);
    try {
      const names = ["甲", "乙", "丙", "丁"];
      buildClipVoiceBindings(row, clipOf({
        speakerBindings: names.map((name) => ({ name, assetKind: "character" })),
        speechEvents: names.map((speakerName, index) => ({
          speechEventId: `speech-${index + 1}`,
          lineId: `line-${index + 1}`,
          startOffset: 0,
          endOffset: 2,
          startSeconds: index * 2,
          endSeconds: index * 2 + 2,
          speakerName,
          delivery: "on_screen",
          spokenText: "台词",
        })),
        shots: names.map((speakerName, index) => ({
          action: `${speakerName}开口`,
          durationSeconds: 2,
          speechEventIds: [`speech-${index + 1}`],
        })),
      }));
      throw new Error("expected buildClipVoiceBindings to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "speaker_reference_audio_limit_exceeded",
        terminal: true,
        details: expect.objectContaining({
          maxSpeakerCount: 3,
          requiredAction: "agents_split_clip",
        }),
      });
    }
  });
  it("有对白但没有配音卡时显式失败", () => {
    const row = rowWith(chapterNodes);
    try {
      buildClipVoiceBindings(row, spokenClip({
        speakerName: "齐夏",
        spokenText: "谁在那里",
        action: "齐夏警觉回头",
      }));
      throw new Error("expected missing binding");
    } catch (error) {
      expect(error).toMatchObject({ code: "speaker_voice_binding_missing" });
    }
  });

  it("缺少同名配音卡时显式失败，不在供应商提交边界猜音色或补卡", async () => {
    await expect(ensureClipVoiceBindings({
      row: rowWith(chapterNodes),
      clip: spokenClip({
        speakerName: "医生",
        spokenText: "签字吧",
        assetKind: "voice",
        action: "医生递出报告",
      }),
    })).rejects.toMatchObject({ code: "speaker_voice_binding_missing" });
  });

  it("已有同名真实配音卡时严格绑定冻结 voiceId", async () => {
    const result = await ensureClipVoiceBindings({
      row: rowWith(nodesWithVoice),
      clip: spokenClip({ speakerName: "齐夏", spokenText: "走吧" }),
    });
    expect(result.bindings[0]?.voiceId).toBe("ICL_uranus_zh_male_lengjungaozhi_tob");
  });
});

describe("同名多卡取卡 — 无图占位卡永不当选（2026-07-11 ch17「巖」实证）", () => {
  const YAN = "https://cdn/x/yan.png";
  it("占位壳（无 imageUrl）+ 真卡并存 → 绑真卡", () => {
    const row = rowWith([
      // 节点序故意让无图占位卡在前（ch17 实际翻车形态）
      { id: "role-yan-placeholder", data: { kind: "image", productionLayer: "anchors", roleName: "巖" } },
      { id: "role-yan-real", data: { kind: "image", productionLayer: "anchors", roleName: "巖", imageUrl: YAN } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["巖"] }),
      "",
    );
    expect(entries.map((e) => e.url)).toContain(YAN);
    expect(entries.some((e) => /角色卡·巖/.test(e.label))).toBe(true);
  });

  it("全部同名卡都无图 → 保持空绑定（走跨章兜底路径·不误绑）", () => {
    const row = rowWith([
      { id: "role-yan-placeholder", data: { kind: "image", productionLayer: "anchors", roleName: "巖" } },
    ]);
    const entries = resolveClipReferenceImageEntries(
      row,
      clipOf({ characterRoleNames: ["巖"] }),
      "",
    );
    expect(entries.some((e) => /角色卡·巖/.test(e.label))).toBe(false);
  });
});
