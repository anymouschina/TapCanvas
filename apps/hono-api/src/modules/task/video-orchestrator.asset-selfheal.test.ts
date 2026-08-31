import { describe, expect, it, vi } from "vitest";

vi.mock("../apiKey/audio-speech", () => ({
  synthesizeDoubaoSpeechToStorage: vi.fn(async () => ({
    url: "https://file.example/preview.mp3",
    durationSec: 6.5,
    voiceId: "ICL_x",
  })),
}));

import { synthesizeDoubaoSpeechToStorage } from "../apiKey/audio-speech";
import {
  detectClipSpeakingRoles,
  collectSpeakingRoles,
  pickVoiceForRole,
  synthVoiceCardPreviewFields,
  characterGenderHintFromCards,
  detectEnsembleGaps,
  clipNeedsEnsemble,
  autoBindBlockingFrameRefs,
  autoBindEnsembleRefs,
  isAssetSelfHealEnabled,
  detectSpeakerCharacterCardGaps,
  collectKnownCharacterCardNames,
  collectComposeAudioNodeIds,
  buildComposeEdges,
  collectMissingPropNames,
  collectDanglingSceneCardIds,
  buildLibraryVoiceCardProjectionPlan,
} from "./video-orchestrator.asset-selfheal";

const clip = (over: Record<string, unknown>) => over as never;

describe("library voice card projection — 真实素材证据落章节画布", () => {
  it("保留素材库真实 voiceId 与配音字段，不选择或制造默认音色", () => {
    const plan = buildLibraryVoiceCardProjectionPlan({
      nodes: [],
      roleNames: ["旁白"],
      libraryAssets: [
        {
          id: "voice-asset-narrator",
          name: "旁白",
          latestVersion: {
            id: "voice-version-3",
            data: {
              doubaoVoiceId: "voice-real-narrator",
              voiceLabel: "沉稳叙事",
              audioModel: "doubao-seed-audio-1-0",
              speechRate: 0.95,
              pitchRate: -1,
              loudnessRate: 1.1,
              audioUrl: "https://file.example/narrator-preview.mp3",
            },
          },
        },
      ],
    });
    expect(plan.projected).toEqual(["旁白"]);
    expect(plan.missing).toEqual([]);
    expect(plan.createNodes).toHaveLength(1);
    expect(plan.createNodes[0]?.data).toMatchObject({
      kind: "audio",
      audioType: "voice_card",
      voiceCharacter: "旁白",
      roleName: "旁白",
      doubaoVoiceId: "voice-real-narrator",
      voiceLabel: "沉稳叙事",
      audioModel: "doubao-seed-audio-1-0",
      speechRate: 0.95,
      pitchRate: -1,
      loudnessRate: 1.1,
      audioUrl: "https://file.example/narrator-preview.mp3",
      materialAssetId: "voice-asset-narrator",
      materialAssetVersionId: "voice-version-3",
      materializedFromLibrary: true,
    });
  });

  it("库卡缺 voiceId 时不投影并明确报告 missing", () => {
    const plan = buildLibraryVoiceCardProjectionPlan({
      nodes: [],
      roleNames: ["画外播报"],
      libraryAssets: [
        { id: "voice-empty", name: "画外播报", latestVersion: { data: { voiceLabel: "无效卡" } } },
      ],
    });
    expect(plan.createNodes).toEqual([]);
    expect(plan.projected).toEqual([]);
    expect(plan.missing).toEqual(["画外播报"]);
  });

  it("同名素材存在不同 voiceId 时显式失败，不按查询顺序任选", () => {
    expect(() => buildLibraryVoiceCardProjectionPlan({
      nodes: [],
      roleNames: ["旁白"],
      libraryAssets: [
        { id: "voice-a", name: "旁白", latestVersion: { data: { doubaoVoiceId: "voice-a" } } },
        { id: "voice-b", name: "旁白", latestVersion: { data: { doubaoVoiceId: "voice-b" } } },
      ],
    })).toThrow("library_voice_card_ambiguous");
  });

  it("画布已有同名真实 voiceId 时幂等跳过库投影", () => {
    const plan = buildLibraryVoiceCardProjectionPlan({
      nodes: [{
        id: "voice-on-canvas",
        data: { audioType: "voice_card", voiceCharacter: "旁白", doubaoVoiceId: "voice-canvas" },
      }],
      roleNames: ["旁白"],
      libraryAssets: [
        { id: "voice-library", name: "旁白", latestVersion: { data: { doubaoVoiceId: "voice-library" } } },
      ],
    });
    expect(plan).toEqual({ createNodes: [], projected: [], missing: [] });
  });

  it("画布卡名只在繁简上相近仍会投影 writer canonical 名，保证 runtime 精确命中", () => {
    const plan = buildLibraryVoiceCardProjectionPlan({
      nodes: [{
        id: "voice-traditional",
        data: { audioType: "voice_card", voiceCharacter: "章節旁白", doubaoVoiceId: "voice-real" },
      }],
      roleNames: ["章节旁白"],
      libraryAssets: [
        { id: "voice-library", name: "章節旁白", latestVersion: { data: { doubaoVoiceId: "voice-real" } } },
      ],
    });
    expect(plan.projected).toEqual(["章节旁白"]);
    expect(plan.createNodes[0]?.data).toMatchObject({
      voiceCharacter: "章节旁白",
      doubaoVoiceId: "voice-real",
    });
  });
});

describe("detectClipSpeakingRoles — 只读取结构化说话人合同", () => {
  it("读取 speakerBindings 并保序", () => {
    const roles = detectClipSpeakingRoles(
      clip({
        speakerBindings: [
          { name: "山羊头人", assetKind: "character" },
          { name: "齐夏", assetKind: "voice" },
        ],
      }),
    );
    expect(roles).toEqual(["山羊头人", "齐夏"]);
  });
  it("只有对白文案、没有结构化合同 → 不猜", () => {
    expect(detectClipSpeakingRoles(clip({ clipPrompt: "@齐夏：「不要猜。」" }))).toEqual([]);
  });
});

describe("collectSpeakingRoles — 全片说话角色去重", () => {
  it("跨 clip 汇总去重", () => {
    const roles = collectSpeakingRoles({
      clips: [
        clip({ speakerBindings: [{ name: "齐夏", assetKind: "character" }] }),
        clip({ speakerBindings: [
          { name: "清冷女人", assetKind: "character" },
          { name: "齐夏", assetKind: "character" },
        ] }),
      ],
    } as never);
    expect(new Set(roles)).toEqual(new Set(["齐夏", "清冷女人"]));
  });
});

describe("pickVoiceForRole — 确定性挑音色（性别启发式 + 稳定哈希）", () => {
  it("同名恒定同一把嗓（声音连续性）", () => {
    const a = pickVoiceForRole("齐夏");
    const b = pickVoiceForRole("齐夏");
    expect(a.voiceId).toBe(b.voiceId);
    expect(a.voiceId).toMatch(/zh_male|_male_/);
  });
  it("女性名 → 女声池", () => {
    expect(pickVoiceForRole("尖叫女生").voiceId).toMatch(/female/);
    expect(pickVoiceForRole("清冷女人").voiceId).toMatch(/female/);
  });
  it("男性/中性名 → 男声池", () => {
    expect(pickVoiceForRole("山羊头人").voiceId).toMatch(/male/);
    expect(pickVoiceForRole("白大褂男").voiceId).toMatch(/male/);
  });
  it("称谓角色名 → 女声池（2026-07-16 实测：「姨妈」落男少年音）", () => {
    expect(pickVoiceForRole("姨妈").voiceId).toMatch(/female/);
    expect(pickVoiceForRole("大妈").voiceId).toMatch(/female/);
  });
});

describe("characterGenderHintFromCards — 角色卡文本作性别提示（2026-07-16「街角青年乙」配女声根治）", () => {
  const nodes = [
    {
      id: "r1",
      data: {
        kind: "image",
        referenceType: "character",
        characterProfileVersion: "character-card/v3",
        label: "角色卡·街角青年乙·知情者",
        roleName: "街角青年乙",
        prompt: "Character reference sheet, young man in black polo, short hair",
      },
    },
    { id: "a1", data: { kind: "audio", label: "配音卡｜街角青年乙", roleName: "街角青年乙" } },
  ];
  it("roleName 命中角色卡 → 返回 label+prompt（含性别词，配合 inferCharacterGender 判男）", () => {
    const hint = characterGenderHintFromCards(nodes as never, "街角青年乙");
    expect(hint).toContain("man");
    expect(hint).toContain("角色卡");
  });
  it("音频节点不算提示源；无同名角色卡 → 空串", () => {
    expect(characterGenderHintFromCards(nodes as never, "姨妈")).toBe("");
  });
});

describe("synthVoiceCardPreviewFields — selfheal 配音卡必带试听音频（2026-07-16 哑卡根治）", () => {
  it("合成成功 → 返回 audioUrl/audioDurationSec/text（含角色名试听文案）", async () => {
    const fields = await synthVoiceCardPreviewFields({} as never, "u1", "街角青年乙", "ICL_x");
    expect(fields.audioUrl).toBe("https://file.example/preview.mp3");
    expect(fields.audioDurationSec).toBe(6.5);
    expect(String(fields.text)).toContain("街角青年乙");
  });
  it("合成失败 → 空对象（卡仍带 voiceId 落地，不阻断自愈）", async () => {
    vi.mocked(synthesizeDoubaoSpeechToStorage).mockRejectedValueOnce(new Error("relay down"));
    const fields = await synthVoiceCardPreviewFields({} as never, "u1", "旁白", "v2");
    expect(fields).toEqual({});
  });
});

describe("autoBindBlockingFrameRefs — 俯视底图自动绑定（2026-07-17 v4 实测：图生成了却没进参考图）", () => {
  const spatialClip = () => ({
    clipPrompt: "阿诺与同伴隔街对峙走位，围观人群包抄合围",
    characterRoleNames: ["阿诺", "同伴"],
    spatialBlocking: true,
    sceneName: "都市街角十字路口",
  });

  it("显式空间调度镜只绑定 sceneName 精确一致的俯视底图", () => {
    const clip = spatialClip();
    const notes = autoBindBlockingFrameRefs(
      [clip],
      [{ id: "floorplan-street-corner-ch1-v3", sceneName: "都市街角十字路口", hasMedia: true }],
      [0],
    );
    expect((clip as { blockingFrameNodeId?: string }).blockingFrameNodeId).toBe(
      "floorplan-street-corner-ch1-v3",
    );
    expect(notes.length).toBe(1);
  });

  it("已带 blockingFrameNodeId / 未声明空间调度的镜头 → 不动", () => {
    const bound = { ...spatialClip(), blockingFrameNodeId: "fp-x" };
    const calm = { clipPrompt: "阿诺低头抽烟，独自沉思", characterRoleNames: ["阿诺"] };
    const notes = autoBindBlockingFrameRefs(
      [bound, calm],
      [{ id: "fp-1", label: "俯视底图｜街角", hasMedia: true }],
    );
    expect(bound.blockingFrameNodeId).toBe("fp-x");
    expect((calm as { blockingFrameNodeId?: string }).blockingFrameNodeId).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it("多张候选：出生申报的 sceneName 逐字匹配者胜出（申报优先于 label）", () => {
    const clip = { ...spatialClip(), sceneName: "都市街角十字路口" };
    autoBindBlockingFrameRefs(
      [clip],
      [
        { id: "fp-label-only", label: "俯视底图｜都市街角十字路口（旧）", hasMedia: true },
        { id: "fp-declared", label: "俯视底图 v2", sceneName: "都市街角十字路口", hasMedia: true },
      ],
    );
    expect((clip as { blockingFrameNodeId?: string }).blockingFrameNodeId).toBe("fp-declared");
  });

  it("无 sceneName 申报时不按 label 或单候选猜测绑定", () => {
    const clip = { ...spatialClip(), sceneName: "都市街角十字路口" };
    autoBindBlockingFrameRefs(
      [clip],
      [
        { id: "fp-bedroom", label: "俯视底图｜卧室问诊", hasMedia: true },
        { id: "fp-street", label: "俯视底图｜都市街角十字路口", hasMedia: true },
      ],
    );
    expect((clip as { blockingFrameNodeId?: string }).blockingFrameNodeId).toBeUndefined();

    const noScene = { ...spatialClip(), sceneName: undefined };
    autoBindBlockingFrameRefs(
      [noScene],
      [{ id: "fp-a", label: "俯视底图｜甲" }],
    );
    expect((noScene as { blockingFrameNodeId?: string }).blockingFrameNodeId).toBeUndefined();
  });
});

describe("detectEnsembleGaps — ≥3人同框须逐镜绑群像图（2026-07-04 ch7 实测改）", () => {
  it("有 clip ≥3 角色且画布无群像图 → 报缺口 clipIndex", () => {
    const gaps = detectEnsembleGaps(
      {
        clips: [
          clip({ clipIndex: 0, characterRoleNames: ["齐夏"] }),
          clip({ clipIndex: 1, characterRoleNames: ["齐夏", "山羊头人", "花臂男", "清冷女人"] }),
        ],
      } as never,
      new Set<string>(),
    );
    expect(gaps).toEqual([1]);
  });
  it("画布有群像图但镜未绑进 referenceImageNodeIds → 照样报缺口（画布有图≠镜里生效）", () => {
    const gaps = detectEnsembleGaps(
      { clips: [clip({ clipIndex: 0, characterRoleNames: ["a", "b", "c"] })] } as never,
      new Set(["ensemble-ch7-a"]),
    );
    expect(gaps).toEqual([0]);
  });
  it("镜已把群像图节点 id 绑进 referenceImageNodeIds → 不报", () => {
    const gaps = detectEnsembleGaps(
      {
        clips: [
          clip({
            clipIndex: 0,
            characterRoleNames: ["a", "b", "c"],
            videoReferenceNodeIds: ["scene-1", "ensemble-ch7-a"],
          }),
        ],
      } as never,
      new Set(["ensemble-ch7-a", "ensemble-ch7-b"]),
    );
    expect(gaps).toEqual([]);
  });
});

describe("clipNeedsEnsemble — 只看 clip 自身文本，不吃 filmBible 污染（2026-07-06 ch2 实测修正）", () => {
  it("有 shots 结构：渲染版 clipPrompt 含圣经「群像反应镜」也不误判独角镜", () => {
    const solo = clip({
      characterRoleNames: ["孟川"],
      clipPrompt: "【导演基调】…群像反应镜堆张力…\n【镜头表】镜1|中景|孟川独立光阵中央|缓推|他闭目蓄势|7s",
      shots: [{ framing: "中景", composition: "孟川独立光阵中央", action: "他闭目蓄势", durationSeconds: 7 }],
      logline: "孟川抉择",
      continuity: "时间连续",
    });
    expect(clipNeedsEnsemble(solo)).toBe(false);
  });
  it("shots 自身描述人群 → 判群像段", () => {
    const crowd = clip({
      characterRoleNames: ["孟川"],
      shots: [{ framing: "全景", composition: "周围同学纷纷被光柱笼罩", action: "众人神情各异", durationSeconds: 6 }],
    });
    expect(clipNeedsEnsemble(crowd)).toBe(true);
  });
  it("无 shots 的存量纯文本 clip 回落 clipPrompt（零回归）", () => {
    expect(clipNeedsEnsemble(clip({ clipPrompt: "九人围坐圆桌" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ clipPrompt: "两人对话" }))).toBe(false);
  });
  it("「数量词+个+人称」与聚集动词命中（2026-07-17 ch1 镜1 实测：三四个青年被判非群像→群像图遭误剔）", () => {
    expect(clipNeedsEnsemble(clip({ clipPrompt: "树荫下三四个青年簇在一起等红灯" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ clipPrompt: "三四青年簇于荫下等灯" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ clipPrompt: "一群路人扎堆看热闹" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ clipPrompt: "两个人并肩走过街角" }))).toBe(false);
    // 运镜词误报教训不回退（2026-07-07 ch4）
    expect(clipNeedsEnsemble(clip({ clipPrompt: "镜头环绕一圈，他扫视一圈后环视四周" }))).toBe(false);
  });
  it("writer 显式「纯净镜——禁挂 ensemble」豁免优先于人群正则（2026-07-17 ch1 clip2 实测）", () => {
    // 【时空】承接段的「围观议论未散」是上一镜世界状态，曾误触 CROWD_FRAMING_RE 把牵手特写判成群像镜
    const pure = clip({
      characterRoleNames: ["林七夜", "牵手小女孩"],
      clipPrompt:
        "镜1|中近·略仰|小女孩仰起脸望着少年。【时空】承上：围观议论未散，镜头切到少年身侧近处。纯净镜——禁挂 ensemble。",
    });
    expect(clipNeedsEnsemble(pure)).toBe(false);
    // 豁免写在结构化 continuity 字段同样生效
    const pureStructured = clip({
      characterRoleNames: ["林七夜"],
      shots: [{ framing: "特写", composition: "两只手交握", action: "轻柔握住", durationSeconds: 4 }],
      continuity: "围观议论未散。纯净镜——禁挂 ensemble。",
      clipPrompt: "特写手部",
    });
    expect(clipNeedsEnsemble(pureStructured)).toBe(false);
    // 无豁免声明时围观词照旧判群像（零回归）
    expect(clipNeedsEnsemble(clip({ clipPrompt: "街边一圈路人围观议论纷纷" }))).toBe(true);
  });
});

describe("autoBindEnsembleRefs — 入库前自动绑群像图（正确默认）", () => {
  const classmates = { id: "ens-classmates", label: "群像图｜操场同学四人", roleNames: ["孟川", "肖巖", "羅鋒", "陳北玄"], hasMedia: true };
  const family = { id: "ens-family", label: "群像图｜场边家人三人", roleNames: ["王秀蘭", "孟山河", "孟小雨"], hasMedia: true };

  it("按 characterRoleNames 交集挑对图并写进 referenceImageNodeIds", () => {
    const c = clip({
      characterRoleNames: ["王秀蘭", "孟山河", "孟小雨"],
      videoReferenceNodeIds: ["scene-1"],
    }) as Record<string, unknown>;
    const notes = autoBindEnsembleRefs([c], [classmates, family], [7]);
    expect(c.videoReferenceNodeIds).toEqual(["scene-1", "ens-family"]);
    expect(notes.join()).toContain("段8");
    expect(notes.join()).toContain("场边家人");
  });
  it("已绑群像图的段不动", () => {
    const c = clip({
      characterRoleNames: ["孟川", "肖巖", "羅鋒"],
      videoReferenceNodeIds: ["ens-classmates"],
    }) as Record<string, unknown>;
    const notes = autoBindEnsembleRefs([c], [classmates, family]);
    expect(notes).toEqual([]);
    expect(c.videoReferenceNodeIds).toEqual(["ens-classmates"]);
  });
  it("非群像段不绑", () => {
    const c = clip({ characterRoleNames: ["孟川"], shots: [{ action: "独白", durationSeconds: 5 }] }) as Record<string, unknown>;
    const notes = autoBindEnsembleRefs([c], [classmates, family]);
    expect(notes).toEqual([]);
    expect(c.videoReferenceNodeIds).toBeUndefined();
  });
  it("多张候选且无交集 → 不绑（留告警）；只有一张 → 用它", () => {
    const noOverlap = clip({ characterRoleNames: ["甲", "乙", "丙"] }) as Record<string, unknown>;
    expect(autoBindEnsembleRefs([noOverlap], [classmates, family])).toEqual([]);
    expect(noOverlap.videoReferenceNodeIds).toBeUndefined();
    const single = clip({ characterRoleNames: ["甲", "乙", "丙"] }) as Record<string, unknown>;
    const notes = autoBindEnsembleRefs([single], [classmates]);
    expect(notes).toHaveLength(1);
    expect(single.videoReferenceNodeIds).toEqual(["ens-classmates"]);
  });
  it("label 包含角色名也算命中（节点缺 roleNames 时的回落）", () => {
    const c = clip({ characterRoleNames: ["孟小雨", "路人甲", "路人乙"] }) as Record<string, unknown>;
    const bare = { id: "ens-x", label: "群像图｜孟小雨与路人们", hasMedia: true };
    const notes = autoBindEnsembleRefs([c], [bare, classmates]);
    expect(notes).toHaveLength(1);
    expect(c.videoReferenceNodeIds).toEqual(["ens-x"]);
  });
});

describe("资产自愈开关", () => {
  it("selfheal 默认 ON", () => {
    expect(isAssetSelfHealEnabled({})).toBe(true);
    expect(isAssetSelfHealEnabled({ VIDEO_ASSET_SELFHEAL: "0" })).toBe(false);
  });
});

describe("detectSpeakerCharacterCardGaps — 按结构化资产类型检查角色卡", () => {
  const fold = (s: string) => s; // 测试用简体名，folded==原名小写；detectSpeaker 内部自 foldName
  it("说话人无卡 → 报缺口（沉默青年案复现）", () => {
    const gaps = detectSpeakerCharacterCardGaps(
      { clips: [clip({ speakerBindings: [
        { name: "沉默青年", assetKind: "character" },
        { name: "阿诺", assetKind: "character" },
      ] })] },
      new Set([fold("阿诺")]),
    );
    expect(gaps).toEqual([{ clipIndex: 0, roles: ["沉默青年"] }]);
  });
  it("全部说话人有卡 → 无缺口", () => {
    const gaps = detectSpeakerCharacterCardGaps(
      { clips: [clip({ speakerBindings: [{ name: "阿诺", assetKind: "character" }] })] },
      new Set([fold("阿诺")]),
    );
    expect(gaps).toEqual([]);
  });
  it("assetKind=voice 的纯声音通道不要求角色卡", () => {
    const gaps = detectSpeakerCharacterCardGaps(
      { clips: [clip({ speakerBindings: [{ name: "论坛标题播报", assetKind: "voice" }] })] },
      new Set(),
    );
    expect(gaps).toEqual([]);
  });
  it("clipIndex 字段优先于数组下标", () => {
    const gaps = detectSpeakerCharacterCardGaps(
      { clips: [clip({ clipIndex: 6, speakerBindings: [{ name: "同伴A", assetKind: "character" }] })] },
      new Set(),
    );
    expect(gaps).toEqual([{ clipIndex: 6, roles: ["同伴A"] }]);
  });
  it("只有新版结构化身份且有真实图的角色卡才覆盖说话人", () => {
    const known = collectKnownCharacterCardNames([
      {
        id: "asset-ch30-char-whitehaired-daoist",
        data: {
          kind: "image",
          referenceType: "character",
          characterProfileVersion: "character-card/v3",
          roleName: "白髮老道",
          label: "角色卡｜白髮老道",
          imageUrl: "https://file.example/whitehaired-daoist.png",
        },
      },
    ]);
    const gaps = detectSpeakerCharacterCardGaps(
      { clips: [clip({ speakerBindings: [{ name: "白髮老道", assetKind: "character" }] })] },
      known,
    );
    expect(gaps).toEqual([]);
  });
  it("角色卡没有任何真实图片 URL 时不能通过覆盖门禁", () => {
    const known = collectKnownCharacterCardNames([
      {
        id: "empty-card",
        data: {
          kind: "image",
          referenceType: "character",
          characterProfileVersion: "character-card/v3",
          roleName: "白髮老道",
          label: "角色卡｜白髮老道",
        },
      },
    ]);
    expect(known.size).toBe(0);
  });
  it("旧 label 或裸 roleName 即使有图也不再构成角色卡", () => {
    const known = collectKnownCharacterCardNames([
      { id: "legacy-label", data: { kind: "image", label: "角色卡｜白髮老道", imageUrl: "https://file.example/legacy.png" } },
      { id: "legacy-role", data: { kind: "image", roleName: "白髮老道", imageUrl: "https://file.example/legacy-role.png" } },
    ]);
    expect(known.size).toBe(0);
  });
});

describe("CROWD_FRAMING_RE 语境化（2026-07-07 ch4 实测：运镜词误判人群）", () => {
  it("独角镜的「环绕一周/扫视一圈/环视四周」不再判群像", () => {
    expect(clipNeedsEnsemble(clip({ characterRoleNames: ["孟川"], clipPrompt: "镜头环绕一圈，孟川扫视一圈后环视四周" }))).toBe(false);
  });
  it("真人群语义仍判群像：围成一圈/环视众人", () => {
    expect(clipNeedsEnsemble(clip({ characterRoleNames: ["孟川"], clipPrompt: "弟子们围成一圈" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ characterRoleNames: ["孟川"], clipPrompt: "他环视众人" }))).toBe(true);
  });
  it("围观/围拢/一圈路人也判群像（2026-07-16 ch1 镜3「吸引一圈路人」滑过检测实证）", () => {
    expect(clipNeedsEnsemble(clip({ characterRoleNames: ["阿诺"], clipPrompt: "匪夷所思的画面吸引一圈路人，窃窃私语" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ characterRoleNames: ["阿诺"], clipPrompt: "树荫下三四人围拢一处议论" }))).toBe(true);
    expect(clipNeedsEnsemble(clip({ characterRoleNames: ["林七夜"], clipPrompt: "路口有人驻足围观" }))).toBe(true);
  });
});

describe("collectComposeAudioNodeIds — 成片节点该收编哪些音频节点（2026-07-16 白生成根治）", () => {
  const node = (id: string, data: Record<string, unknown>) => ({ id, data });

  it("speech 音频（有 audioUrl）→ 收编（旁白/slogan 靠连边才混得进成片）", () => {
    const ids = collectComposeAudioNodeIds([
      node("a1", { kind: "audio", audioType: "speech", audioUrl: "https://r2/x.mp3" }),
    ]);
    expect(ids).toEqual(["a1"]);
  });

  it("music 音频 → 收编（BGM 铺底同样走连边混音）", () => {
    const ids = collectComposeAudioNodeIds([
      node("m1", { kind: "audio", audioType: "music", audioUrl: "https://r2/bgm.mp3" }),
    ]);
    expect(ids).toEqual(["m1"]);
  });

  it("mixExclude=true 的独立素材（章级 BGM）→ 不收编（用户在剪辑软件自行拼接，自动混音=双轨打架）", () => {
    const ids = collectComposeAudioNodeIds([
      node("bgm", {
        kind: "audio",
        audioType: "music",
        audioUrl: "https://r2/chapter-bgm.mp3",
        mixExclude: true,
        label: "章节BGM｜第1章·夜探",
      }),
      node("m2", { kind: "audio", audioType: "music", audioUrl: "https://r2/inline.mp3" }),
    ]);
    expect(ids).toEqual(["m2"]);
  });

  it("voice_card → 不收编（音色锚走 seedance audio_url 原生对白，连边会重复人声）", () => {
    const ids = collectComposeAudioNodeIds([
      node("v1", { kind: "audio", audioType: "voice_card", voiceCharacter: "齐夏", audioUrl: "https://r2/try.mp3" }),
    ]);
    expect(ids).toEqual([]);
  });

  it("无 audioUrl 的哑节点 → 不收编", () => {
    const ids = collectComposeAudioNodeIds([node("a2", { kind: "audio", audioType: "speech" })]);
    expect(ids).toEqual([]);
  });

  it("非 audio 节点 → 不收编", () => {
    const ids = collectComposeAudioNodeIds([
      node("i1", { kind: "image", imageUrl: "https://r2/a.png" }),
      node("vd1", { kind: "video", videoUrl: "https://r2/a.mp4" }),
    ]);
    expect(ids).toEqual([]);
  });

  it("audioType 缺省视作 speech → 收编（工具默认 audioType=speech）", () => {
    const ids = collectComposeAudioNodeIds([node("a3", { kind: "audio", audioUrl: "https://r2/x.mp3" })]);
    expect(ids).toEqual(["a3"]);
  });

  it("混合画布：只挑出该混音的，保序", () => {
    const ids = collectComposeAudioNodeIds([
      node("v1", { kind: "audio", audioType: "voice_card", audioUrl: "https://r2/v.mp3" }),
      node("a1", { kind: "audio", audioType: "speech", audioUrl: "https://r2/n.mp3" }),
      node("i1", { kind: "image", imageUrl: "https://r2/a.png" }),
      node("m1", { kind: "audio", audioType: "music", audioUrl: "https://r2/b.mp3" }),
    ]);
    expect(ids).toEqual(["a1", "m1"]);
  });
});

describe("buildComposeEdges — clip 段 + 音频轨 → 成片入边", () => {
  const film = "film-run1";
  const none = new Set<string>();

  it("clip 段按序连边 + 音频轨一并连上", () => {
    const edges = buildComposeEdges({
      filmNodeId: film,
      clipNodeIds: ["c1", "c2"],
      audioNodeIds: ["a1"],
      existingEdgeIds: none,
    });
    expect(edges).toEqual([
      { id: "e-c1-film-run1", source: "c1", target: film },
      { id: "e-c2-film-run1", source: "c2", target: film },
      { id: "e-a1-film-run1", source: "a1", target: film },
    ]);
  });

  it("已存在的 edge 不重复连（重复 drive 幂等）", () => {
    const edges = buildComposeEdges({
      filmNodeId: film,
      clipNodeIds: ["c1", "c2"],
      audioNodeIds: ["a1"],
      existingEdgeIds: new Set(["e-c1-film-run1", "e-a1-film-run1"]),
    });
    expect(edges).toEqual([{ id: "e-c2-film-run1", source: "c2", target: film }]);
  });

  it("空源 / 自环 被剔除（成片节点自己被误收编时不连自环）", () => {
    const edges = buildComposeEdges({
      filmNodeId: film,
      clipNodeIds: ["", "  "],
      audioNodeIds: [film],
      existingEdgeIds: none,
    });
    expect(edges).toEqual([]);
  });

  it("同一节点重复出现只连一条", () => {
    const edges = buildComposeEdges({
      filmNodeId: film,
      clipNodeIds: ["c1"],
      audioNodeIds: ["c1", "a1"],
      existingEdgeIds: none,
    });
    expect(edges.map((e) => e.source)).toEqual(["c1", "a1"]);
  });

  it("只有音频轨没有 clip 段（单段直采）也照样连", () => {
    const edges = buildComposeEdges({
      filmNodeId: film,
      clipNodeIds: [],
      audioNodeIds: ["a1", "m1"],
      existingEdgeIds: none,
    });
    expect(edges.map((e) => e.source)).toEqual(["a1", "m1"]);
  });
});

describe("collectMissingPropNames — 申报了道具但画布上没卡（2026-07-16 补齐·与角色卡库卡落画布对等）", () => {
  const propCard = (name: string) => ({
    id: `p-${name}`,
    data: { kind: "image", label: `道具卡｜${name}`, imageUrl: "https://r2/p.png" },
  });

  it("clip 申报 propNames、画布无卡 → 报缺", () => {
    const missing = collectMissingPropNames(
      { clips: [clip({ propNames: ["混元金斗", "山羊头骨面具"] })] } as never,
      [],
    );
    expect(missing).toEqual(["混元金斗", "山羊头骨面具"]);
  });

  it("画布已有道具卡 → 不报缺", () => {
    const missing = collectMissingPropNames(
      { clips: [clip({ propNames: ["混元金斗"] })] } as never,
      [propCard("混元金斗")],
    );
    expect(missing).toEqual([]);
  });

  it("法宝卡/武器卡等同族前缀也算已有（PROP_KIND_WORDS 同口径）", () => {
    const missing = collectMissingPropNames(
      { clips: [clip({ propNames: ["混元金斗"] })] } as never,
      [{ id: "p1", data: { kind: "image", label: "法宝卡·混元金斗", imageUrl: "https://r2/p.png" } }],
    );
    expect(missing).toEqual([]);
  });

  it("跨 clip 去重 + 空名剔除", () => {
    const missing = collectMissingPropNames(
      {
        clips: [
          clip({ propNames: ["座钟", "  "] }),
          clip({ propNames: ["座钟", "吊灯"] }),
        ],
      } as never,
      [],
    );
    expect(missing).toEqual(["座钟", "吊灯"]);
  });

  it("无 propNames 申报 → 空（零行为变化）", () => {
    expect(collectMissingPropNames({ clips: [clip({})] } as never, [])).toEqual([]);
  });
});

describe("collectDanglingSceneCardIds — sceneCardNodeId 指向画布上不存在的节点（2026-07-16·ch15 静默 no-scene 根治）", () => {
  const sceneNode = (id: string) => ({
    id,
    data: { kind: "image", label: "场景卡｜祭坛残殿", imageUrl: "https://r2/s.png" },
  });

  it("申报的 sceneCardNodeId 画布上有 → 不报", () => {
    const dangling = collectDanglingSceneCardIds(
      { clips: [clip({ sceneCardNodeId: "scene-1" })] } as never,
      [sceneNode("scene-1")],
    );
    expect(dangling).toEqual([]);
  });

  it("申报的 sceneCardNodeId 画布上没有 → 报悬空（填了库资产id/前章节点id 的典型事故）", () => {
    const dangling = collectDanglingSceneCardIds(
      { clips: [clip({ sceneCardNodeId: "mat-asset-ch14-xyz" })] } as never,
      [sceneNode("scene-1")],
    );
    expect(dangling).toEqual(["mat-asset-ch14-xyz"]);
  });

  it("多镜引用同一悬空 id → 去重", () => {
    const dangling = collectDanglingSceneCardIds(
      {
        clips: [
          clip({ sceneCardNodeId: "mat-x" }),
          clip({ sceneCardNodeId: "mat-x" }),
          clip({ sceneCardNodeId: "mat-y" }),
        ],
      } as never,
      [],
    );
    expect(dangling).toEqual(["mat-x", "mat-y"]);
  });

  it("未申报 sceneCardNodeId → 空（零行为变化）", () => {
    expect(collectDanglingSceneCardIds({ clips: [clip({})] } as never, [])).toEqual([]);
  });
});

describe("collectMissingPropNames 繁简折叠（与 resolveAuthoringAssetCoverageInputs 同口径·防双卡）", () => {
  it("画布上是繁体卡、clip 申报简体 → 判已有，不重复落卡", () => {
    const missing = collectMissingPropNames(
      { clips: [clip({ propNames: ["混元金斗"] })] } as never,
      [{ id: "p1", data: { kind: "image", label: "法宝卡·混元金鬥", imageUrl: "https://r2/p.png" } }],
    );
    expect(missing).toEqual([]);
  });

  it("castManifest 主路径已物化的卡（label 道具卡｜+ referenceType=prop）→ 起跑前兜底判已有", () => {
    const missing = collectMissingPropNames(
      { clips: [clip({ propNames: ["乾坤尺"] })] } as never,
      [
        {
          id: "asset-manifest-prop-qiankunchi",
          data: { kind: "image", referenceType: "prop", label: "道具卡｜乾坤尺", imageUrl: "https://r2/p.png", autoMaterialized: true },
        },
      ],
    );
    expect(missing).toEqual([]);
  });
});
