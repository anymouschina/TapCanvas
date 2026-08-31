import { describe, it, expect } from "vitest";
import {
  VOICE_CARD_AUDIO_TYPE,
  readVoiceCardProfile,
  resolveBoundVoiceCards,
  resolveVoiceCardByCharacterNames,
  extractSpokenDialogue,
  autoPickVoiceId,
  inferVoiceProfile,
  catalogAgeBand,
  voiceCardDisplayFields,
  type VoiceCatalogEntry,
} from "./voice-card-dub";

describe("readVoiceCardProfile", () => {
  it("reads a voice_card audio node into a profile", () => {
    const p = readVoiceCardProfile({
      id: "vc1",
      data: {
        audioType: "voice_card",
        voiceCharacter: "天海",
        doubaoVoiceId: "zh_female_vv_uranus_bigtts",
        speechRate: 10,
        audioMixMode: "mix",
        referenceAudioUrls: ["https://a.mp3", ""],
      },
    });
    expect(p).not.toBeNull();
    expect(p?.character).toBe("天海");
    expect(p?.voiceId).toBe("zh_female_vv_uranus_bigtts");
    expect(p?.speechRate).toBe(10);
    expect(p?.audioMixMode).toBe("mix");
    expect(p?.referenceAudioUrls).toEqual(["https://a.mp3"]);
  });

  it("defaults audioMixMode to replace and falls back roleName→character", () => {
    const p = readVoiceCardProfile({
      id: "vc2",
      data: { audioType: "voice_card", roleName: "李长安" },
    });
    expect(p?.character).toBe("李长安");
    expect(p?.audioMixMode).toBe("replace");
  });

  it("returns null for non voice_card audio nodes", () => {
    expect(readVoiceCardProfile({ id: "a1", data: { audioType: "speech", text: "旁白" } })).toBeNull();
    expect(readVoiceCardProfile({ id: "a2", data: {} })).toBeNull();
    expect(readVoiceCardProfile(null)).toBeNull();
  });
});

describe("resolveBoundVoiceCards", () => {
  const nodes = [
    { id: "video1", data: { kind: "video" } },
    { id: "vc1", data: { audioType: VOICE_CARD_AUDIO_TYPE, voiceCharacter: "天海" } },
    { id: "audioFixed", data: { audioType: "speech", audioUrl: "https://x.mp3" } },
  ];

  it("collects voice cards directly connected to the target video node", () => {
    const edges = [
      { source: "vc1", target: "video1" },
      { source: "audioFixed", target: "video1" },
    ];
    const cards = resolveBoundVoiceCards(nodes, edges, "video1");
    expect(cards).toHaveLength(1);
    expect(cards[0].character).toBe("天海");
  });

  it("ignores edges to other nodes and dedupes", () => {
    const edges = [
      { source: "vc1", target: "video1" },
      { source: "vc1", target: "video1" },
      { source: "vc1", target: "video2" },
    ];
    expect(resolveBoundVoiceCards(nodes, edges, "video1")).toHaveLength(1);
    expect(resolveBoundVoiceCards(nodes, edges, "video1")[0].nodeId).toBe("vc1");
  });

  it("ignores visual voice-reference edges while preserving ordinary executable bindings", () => {
    const edges = [
      {
        source: "vc1",
        target: "video1",
        data: {
          edgeType: "audio",
          relationKind: "voice_reference",
          executionRole: "reference_only",
        },
      },
    ];
    expect(resolveBoundVoiceCards(nodes, edges, "video1")).toEqual([]);
    expect(resolveBoundVoiceCards(nodes, [{ source: "vc1", target: "video1" }], "video1")).toHaveLength(1);
  });
});

describe("resolveVoiceCardByCharacterNames", () => {
  const nodes = [
    { id: "vcTianhai", data: { audioType: VOICE_CARD_AUDIO_TYPE, voiceCharacter: "天海" } },
    { id: "vcLi", data: { audioType: VOICE_CARD_AUDIO_TYPE, voiceCharacter: "李长安" } },
    { id: "video1", data: { kind: "video" } },
  ];

  it("returns the single matching card when exactly one clip character has a voice card", () => {
    const card = resolveVoiceCardByCharacterNames(nodes, ["天海", "路人甲"]);
    expect(card?.character).toBe("天海");
  });

  it("returns null when no clip character has a voice card", () => {
    expect(resolveVoiceCardByCharacterNames(nodes, ["路人甲", "路人乙"])).toBeNull();
  });

  it("returns null when multiple characters have voice cards (ambiguous → skip auto-dub)", () => {
    expect(resolveVoiceCardByCharacterNames(nodes, ["天海", "李长安"])).toBeNull();
  });

  it("returns null for empty character list", () => {
    expect(resolveVoiceCardByCharacterNames(nodes, [])).toBeNull();
    expect(resolveVoiceCardByCharacterNames(nodes, [null, "", undefined])).toBeNull();
  });
});

describe("extractSpokenDialogue", () => {
  it("extracts quoted dialogue across quote styles, joined by line", () => {
    expect(extractSpokenDialogue('他冷笑，“你终于来了”', "「我等你很久」")).toBe("你终于来了\n我等你很久");
  });

  it("returns empty when there is no quoted dialogue", () => {
    expect(extractSpokenDialogue("天海拔剑冲向敌阵，镜头拉近", "")).toBe("");
  });
});

describe("autoPickVoiceId", () => {
  const voices = [
    { id: "male_a", gender: "男" },
    { id: "male_b", gender: "male" },
    { id: "female_a", gender: "女" },
    { id: "female_b", gender: "female" },
  ];

  it("picks within the matching gender pool and is deterministic per seed", () => {
    const v1 = autoPickVoiceId(voices, { gender: "female", seedName: "天海" });
    const v2 = autoPickVoiceId(voices, { gender: "female", seedName: "天海" });
    expect(v1).toBe(v2);
    expect(["female_a", "female_b"]).toContain(v1);
  });

  it("different characters can get different voices", () => {
    const picks = new Set(
      ["天海", "李长安", "夏繁星", "王五"].map((n) =>
        autoPickVoiceId(voices, { gender: "male", seedName: n }),
      ),
    );
    // 至少不是全塌成一个（种子哈希分散）。
    expect(picks.size).toBeGreaterThanOrEqual(1);
    for (const p of picks) expect(["male_a", "male_b"]).toContain(p);
  });

  it("returns empty for an empty voice library", () => {
    expect(autoPickVoiceId([], { seedName: "天海" })).toBe("");
  });
});

describe("inferVoiceProfile — 角色画像（年龄段+气质）", () => {
  it("识别年龄段：姨妈→middle / 少年→teen / 爷爷→elder / 小学生→child", () => {
    expect(inferVoiceProfile("姨妈 中年女性 市侩").ageBand).toBe("middle");
    expect(inferVoiceProfile("林七夜 黑缎缠目的清瘦少年").ageBand).toBe("teen");
    expect(inferVoiceProfile("爷爷 白发老者").ageBand).toBe("elder");
    expect(inferVoiceProfile("小明 小学生").ageBand).toBe("child");
    expect(inferVoiceProfile("路人").ageBand).toBe("");
  });
  it("数字年龄不被部分匹配（真实角色卡实测病根）：十七岁≠七岁儿童、四十五岁≠五岁", () => {
    expect(inferVoiceProfile("林七夜，十七岁少年").ageBand).toBe("teen");
    expect(inferVoiceProfile("约四十五岁中年劳动妇女").ageBand).toBe("middle");
    expect(inferVoiceProfile("约二十八岁年轻男精神科医生").ageBand).toBe("youth");
    expect(inferVoiceProfile("七岁小孩").ageBand).toBe("child");
    expect(inferVoiceProfile("六十八岁老工人").ageBand).toBe("elder");
  });
  it("角色卡模板词「柔和电影级光影」不再污染 gentle 气质", () => {
    expect(inferVoiceProfile("柔和电影级光影 冷灰蓝单色调").traits).toEqual([]);
  });
  it("识别气质词：高冷/沉稳/旁白", () => {
    expect(inferVoiceProfile("高冷疏离的隐士").traits).toContain("cold");
    expect(inferVoiceProfile("沉稳成熟的医生").traits).toEqual(
      expect.arrayContaining(["steady", "refined"]),
    );
    expect(inferVoiceProfile("旁白").traits).toContain("narrator");
  });
});

describe("catalogAgeBand — 目录 age 词表映射", () => {
  it("maps 儿童/少年/青年/中年/老年", () => {
    expect(catalogAgeBand("儿童")).toBe("child");
    expect(catalogAgeBand("少年/少女")).toBe("teen");
    expect(catalogAgeBand("青年")).toBe("youth");
    expect(catalogAgeBand("中年")).toBe("middle");
    expect(catalogAgeBand("老年")).toBe("elder");
    expect(catalogAgeBand(undefined)).toBe("");
  });
});

describe("autoPickVoiceId — 画像评分匹配（2026-07-17 音色乱生成根治）", () => {
  // 仿真实目录（zh 前缀过语言闸；字段与 SeedAudioVoiceMeta 对齐）。
  const catalog: VoiceCatalogEntry[] = [
    { id: "zh_female_mengmei", gender: "女", name: "病娇萌妹 2.0", age: "少年/少女", scene: "角色扮演", description: "破碎感美人，偏执但纯真呆萌" },
    { id: "zh_female_zhixing", gender: "女", name: "知性女声", age: "中年", scene: "视频配音", description: "成熟知性，温和从容" },
    { id: "zh_female_qingleng", gender: "女", name: "清冷高雅 2.0", age: "青年", scene: "角色扮演", description: "清冷高雅的隐士，淡泊疏离" },
    { id: "zh_male_tiancai_tongsheng", gender: "男", name: "天才童声 2.0", age: "儿童", scene: "角色扮演", description: "聪明伶俐的小朋友" },
    { id: "zh_male_shaonian", gender: "男", name: "少年梓辛 2.0", age: "青年", scene: "通用场景", description: "少年感十足的清爽男生，阳光开朗" },
    { id: "zh_male_chenwen", gender: "男", name: "沉稳男声", age: "中年", scene: "视频配音", description: "低音沉稳成熟磁性" },
    { id: "zh_male_laozhe", gender: "男", name: "苍老长者", age: "老年", scene: "有声阅读", description: "苍老沙哑的老者" },
  ];

  it("姨妈（中年女）匹配到中年女声，而不是少女系病娇萌妹", () => {
    const picked = autoPickVoiceId(catalog, {
      gender: "female",
      seedName: "姨妈",
      profileText: "姨妈 中年妇女 精明市侩",
    });
    expect(picked).toBe("zh_female_zhixing");
  });

  it("街头青年（非儿童）绝不配童声（童声守卫）", () => {
    for (const seed of ["阿诺", "小张", "黑T恤男", "王五"]) {
      const picked = autoPickVoiceId(catalog, {
        gender: "male",
        seedName: seed,
        profileText: `${seed} 街头青年 阳光爽朗`,
      });
      expect(picked).not.toBe("zh_male_tiancai_tongsheng");
    }
  });

  it("清瘦少年匹配少年感音色", () => {
    const picked = autoPickVoiceId(catalog, {
      gender: "male",
      seedName: "林七夜",
      profileText: "林七夜 黑缎缠目的清瘦少年 平静无澜",
    });
    expect(picked).toBe("zh_male_shaonian");
  });

  it("老者角色匹配老年音色", () => {
    const picked = autoPickVoiceId(catalog, {
      gender: "male",
      seedName: "老村长",
      profileText: "老村长 白发苍苍的老者",
    });
    expect(picked).toBe("zh_male_laozhe");
  });

  it("excludeIds 仍然生效（被占用的最优音色让位给次优）", () => {
    const picked = autoPickVoiceId(catalog, {
      gender: "male",
      seedName: "少年乙",
      profileText: "少年乙 清瘦少年",
      excludeIds: ["zh_male_shaonian"],
    });
    expect(picked).not.toBe("zh_male_shaonian");
    expect(picked).not.toBe("zh_male_tiancai_tongsheng"); // 童声守卫不因排重失效
  });

  it("同角色同画像恒定同一把嗓（确定性）", () => {
    const a = autoPickVoiceId(catalog, { gender: "female", seedName: "姨妈", profileText: "姨妈 中年妇女" });
    const b = autoPickVoiceId(catalog, { gender: "female", seedName: "姨妈", profileText: "姨妈 中年妇女" });
    expect(a).toBe(b);
  });

  it("无 profileText 退化为哈希挑（旧行为兼容·不抛错）", () => {
    const picked = autoPickVoiceId(catalog, { gender: "female", seedName: "某女" });
    expect(picked).toMatch(/^zh_female_/);
  });

  it("小众强人设罚分：无气质信号的角色不会撞上病娇系音色", () => {
    // 病娇萌妹被罚分后，同为角色扮演的清冷高雅胜出（哈希不再有机会撞进病娇）。
    for (const seed of ["同伴", "路人乙", "邻家女孩", "小美"]) {
      const picked = autoPickVoiceId(catalog, { gender: "female", seedName: seed });
      expect(picked).not.toBe("zh_female_mengmei");
    }
  });

  it("补充性别兜底：痞气/寸头等强男性形象词把无「男」字画像锁进男声池", () => {
    const picked = autoPickVoiceId(catalog, {
      seedName: "阿诺",
      profileText: "阿诺 约二十岁街头青年 眼神精明带痞气 黄色挑染短寸",
    });
    expect(picked).toMatch(/^zh_male_/);
  });
});

describe("voiceCardDisplayFields — voiceLabel/label 单一真相源", () => {
  const catalog: VoiceCatalogEntry[] = [
    { id: "zh_male_shaonian", name: "少年梓辛 2.0", gender: "男" },
  ];
  it("voiceLabel 取目录里该 voiceId 的真名，label 同源合成", () => {
    const d = voiceCardDisplayFields("林七夜", "zh_male_shaonian", catalog);
    expect(d.voiceLabel).toBe("少年梓辛 2.0");
    expect(d.label).toBe("配音卡｜林七夜·少年梓辛 2.0");
  });
  it("目录查不到时用 fallback；再没有则 label 不带后缀", () => {
    expect(voiceCardDisplayFields("阿诺", "unknown_id", catalog, "街头青年男声").voiceLabel).toBe(
      "街头青年男声",
    );
    expect(voiceCardDisplayFields("阿诺", "unknown_id", catalog).label).toBe("配音卡｜阿诺");
  });
});
