// 【配音卡（voice card）— 角色语音锚，和角色卡对称】
//
// 角色卡锁「脸」（基准图 → referenceImages 复用到多个视频节点）；配音卡锁「声音」
// （音色 doubaoVoiceId 或克隆音色 → 复用到多个视频节点）。一张配音卡 fan-out 连到同一角色的
// 多段视频节点：每段视频自己带台词（clipPrompt 引号内对白），配音卡只提供音色锚；出片时按
// 「这段的台词 + 卡的音色」即时 TTS 合成，再 mux 到该段视频上 → 同一角色多段同嗓音。
//
// 形态：复用现有 audio 节点，加 audioType="voice_card"（无固定 text，是可复用声音档案，
// 不是渲染好的固定音频 clip）。编排器的可见血缘使用
// typed voice_reference/reference_only（out-audio → in-any），执行层必须忽略；只有用户明确创建的
// 普通音频边或显式 voiceCardNodeId 才会触发本模块的手工 TTS + mux。
//
// 本模块：纯 helpers（对白抽取 / 配音卡边解析 / 音色自动挑，可单测）+ 合成混音编排
// （dubVideoNodeWithVoiceCard，复用 synthesizeDoubaoSpeechToStorage + muxAudioOntoVideo）。

import type { AppContext } from "../../types";
import { synthesizeDoubaoSpeechToStorage } from "../apiKey/audio-speech";
import { muxAudioOntoVideo } from "../apiKey/video-concat";
import { listDoubaoSeedAudioVoices } from "../apiKey/seed-audio-voices";
import { inferCharacterGender } from "./face-dna";
import { QUOTED_DIALOGUE_PATTERN } from "./video-orchestrator.dialogue-capacity";
import { isReferenceOnlyCanvasEdge } from "@tapcanvas/canvas-edge-semantics";

/** audio 节点进入「配音卡模式」的标记值（audioType）。 */
export const VOICE_CARD_AUDIO_TYPE = "voice_card";

export type FlowNodeLike = { id: string; data?: Record<string, unknown> | null };
export type FlowEdgeLike = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: unknown;
};

export type VoiceCardProfile = {
  nodeId: string;
  /** 该音色归属的角色名（复用/入库按名匹配，镜像角色卡）。 */
  character: string;
  /** 显式锁定的豆包音色 id；空则按角色性别自动挑（可被用户覆盖）。 */
  voiceId: string;
  /** 配音卡本身的真实试听资产；视频模型直接把它作为 @音频N 音色参考。 */
  audioUrl: string;
  audioDurationSec: number | null;
  audioModel: string;
  speechRate: number | null;
  pitchRate: number | null;
  loudnessRate: number | null;
  /** 音色克隆参考（图优先、与音频互斥，与 audio 节点语义一致）。 */
  referenceAudioUrls: string[];
  referenceImageUrl: string;
  audioMixMode: "mix" | "replace";
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 从一个画布节点读出配音卡档案；不是 audioType=voice_card 的节点返回 null。 */
export function readVoiceCardProfile(node: FlowNodeLike | null | undefined): VoiceCardProfile | null {
  const d = (node?.data ?? {}) as Record<string, unknown>;
  if (str(d.audioType).toLowerCase() !== VOICE_CARD_AUDIO_TYPE) return null;
  const character = str(d.voiceCharacter) || str(d.roleName) || str(d.character);
  const referenceAudioUrls = Array.isArray(d.referenceAudioUrls)
    ? (d.referenceAudioUrls as unknown[]).map(str).filter(Boolean).slice(0, 3)
    : [];
  return {
    nodeId: str(node?.id),
    character,
    voiceId: str(d.doubaoVoiceId),
    audioUrl: str(d.audioUrl),
    audioDurationSec: numOrNull(d.audioDurationSec),
    audioModel: str(d.audioModel),
    speechRate: numOrNull(d.speechRate),
    pitchRate: numOrNull(d.pitchRate),
    loudnessRate: numOrNull(d.loudnessRate),
    referenceAudioUrls,
    referenceImageUrl: str(d.referenceImageUrl),
    audioMixMode: str(d.audioMixMode).toLowerCase() === "mix" ? "mix" : "replace",
  };
}

/**
 * 解析「以普通可执行边直接连到某视频节点的配音卡」：遍历以 videoNodeId 为 target 的上游边，
 * 跳过 voice_reference/reference_only 血缘边；源节点若是 audioType=voice_card 即收集。按 nodeId 去重。
 */
export function resolveBoundVoiceCards(
  nodes: FlowNodeLike[],
  edges: FlowEdgeLike[],
  videoNodeId: string,
): VoiceCardProfile[] {
  const target = str(videoNodeId);
  if (!target) return [];
  const byId = new Map(nodes.map((n) => [str(n.id), n]));
  const out: VoiceCardProfile[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (str(e?.target) !== target) continue;
    if (isReferenceOnlyCanvasEdge(e)) continue;
    const src = byId.get(str(e?.source));
    const card = readVoiceCardProfile(src);
    if (card && card.nodeId && !seen.has(card.nodeId)) {
      seen.add(card.nodeId);
      out.push(card);
    }
  }
  return out;
}

/**
 * 按角色名解析「唯一」配音卡（编排路径用：clip 视频节点服务端现建、无法连边，靠角色名绑定）。
 * 扫全画布的 voice_card 节点，voiceCharacter 命中 characterNames 之一即算候选；
 * 恰好命中【一张】才返回（0 张或 >1 张都返回 null）——保守：多角色一镜无法把台词分派到人，
 * 宁可跳过自动配音（留给手动 tapcanvas_voice_card_dub / 未来逐句归属），也不给整段配错音。
 */
export function resolveVoiceCardByCharacterNames(
  nodes: FlowNodeLike[],
  characterNames: Array<string | null | undefined>,
): VoiceCardProfile | null {
  const wanted = new Set(characterNames.map((n) => str(n)).filter(Boolean));
  if (wanted.size === 0) return null;
  const matched: VoiceCardProfile[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const card = readVoiceCardProfile(node);
    if (!card || !card.character || !wanted.has(card.character)) continue;
    if (seen.has(card.character)) continue;
    seen.add(card.character);
    matched.push(card);
  }
  return matched.length === 1 ? matched[0] : null;
}

/**
 * 抽出可念的口播对白：只取引号内文本（弯引号/直角引号/英文引号，与对白容量闸同口径），
 * 逐句换行拼接。动作/旁白描写不算。无对白返回空串（= 不配音）。
 */
export function extractSpokenDialogue(...texts: Array<string | null | undefined>): string {
  const joined = texts.map((t) => t || "").join("\n");
  const lines: string[] = [];
  for (const m of joined.matchAll(QUOTED_DIALOGUE_PATTERN)) {
    const captured = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").trim();
    if (captured) lines.push(captured);
  }
  return lines.join("\n");
}

function normalizeGender(g: string): "male" | "female" | "" {
  const s = g.toLowerCase();
  if (s.includes("female") || s.includes("女")) return "female";
  if (s.includes("male") || s.includes("男")) return "male";
  return "";
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 中文音色（zh_ / ICL_uranus_zh_ 两族·2026-07-04 实测该端点有效且为中文的家族）。
 * 目录里混着 en_/pt_/mx_/ja_ 外语音色且 gender 同样标「男/女」——只按性别挑会把
 * 中文角色配成英文音色（实测 黑T恤男 被挑成 en_male_jimmy）。默认必须先过语言闸。
 */
export function isChineseVoiceId(id: string): boolean {
  return /^(zh_|ICL_uranus_zh_)/.test(String(id || "").trim());
}

/** 音色目录条目（listDoubaoSeedAudioVoices 的富元数据子集；旧调用方只传 {id,gender} 仍兼容）。 */
export type VoiceCatalogEntry = {
  id: string;
  gender?: string;
  name?: string;
  /** 目录词表（2026-07-17 实测 415 条）：儿童 / 少年/少女 / 青年 / 中年 / 老年。 */
  age?: string;
  scene?: string;
  description?: string;
};

/** 角色年龄段（与目录 age 词表对齐）。 */
export type VoiceAgeBand = "child" | "teen" | "youth" | "middle" | "elder";

/**
 * 数字年龄优先解析（2026-07-17 真实角色卡实测：「十七岁」被 `[三四五六七八九]岁` 部分匹配成
 * 「七岁」儿童、「四十五岁」匹配成「五岁」——lookbehind 挡掉十位前缀，且十位段先于个位段判）。
 */
const NUMERIC_AGE_MARKERS: Array<{ band: VoiceAgeBand; re: RegExp }> = [
  { band: "elder", re: /[六七八九]十[一二三四五六七八九]?岁/ },
  { band: "middle", re: /[三四五]十[一二三四五六七八九]?岁/ },
  { band: "youth", re: /二十[一二三四五六七八九]?岁|十[八九]岁/ },
  { band: "teen", re: /(?<![二三四五六七八九])十[二三四五六七]岁/ },
  { band: "child", re: /(?<![十两一二三四五六七八九])[两三四五六七八九]岁/ },
];

const AGE_BAND_MARKERS: Array<{ band: VoiceAgeBand; re: RegExp }> = [
  // 顺序即优先级：更特异的先判（老年/儿童词很少误报；青年词最泛最后）。
  { band: "elder", re: /老人|老者|老头|老太|爷爷|奶奶|外公|外婆|姥爷|姥姥|老翁|老妪|老先生|老夫人|老年|花甲|古稀|耄耋|苍老|白发老|皱纹/ },
  { band: "child", re: /儿童|幼儿|小孩|孩童|娃娃|小学生|小朋友|奶声|孩子气/ },
  { band: "middle", re: /中年|大叔|大婶|大妈|阿姨|姨妈|姨母|舅妈|婶婶|伯父|伯母|叔叔|舅舅|父亲|母亲|爸爸|妈妈|老板娘|掌柜|师傅|教授|院长|局长|长官/ },
  { band: "teen", re: /少年|少女|初中生|高中生|中学生|校服|半大|稚气/ },
  { band: "youth", re: /青年|大学生|年轻|小伙|姑娘|女生|男生|青春|学长|学姐|白领|实习/ },
];

/** 目录 age 字段 → 年龄段。 */
export function catalogAgeBand(age: string | undefined): VoiceAgeBand | "" {
  const a = String(age ?? "");
  if (a.includes("儿童")) return "child";
  if (a.includes("少年") || a.includes("少女")) return "teen";
  if (a.includes("青年")) return "youth";
  if (a.includes("中年")) return "middle";
  if (a.includes("老年")) return "elder";
  return "";
}

/**
 * 气质词表：角色侧描述（角色卡 label/prompt/原文摘录）→ 目录侧关键词（name/description/scene）。
 * 命中一条 = 该气质在角色画像里成立；目录音色 desc 再命中右侧词 = 加分。
 */
const TRAIT_LEXICON: Array<{ key: string; roleRe: RegExp; voiceRe: RegExp }> = [
  // roleRe 侧刻意不收「柔和」这类词——角色卡模板 boilerplate（柔和电影级光影/柔光）会让全员误命中。
  { key: "cold", roleRe: /高冷|冷酷|清冷|冷峻|冷淡|冰冷|淡漠|疏离|寡言|孤僻/, voiceRe: /高冷|清冷|冷|疏离|淡泊|孤/ },
  { key: "steady", roleRe: /沉稳|稳重|低沉|深沉|成熟|老练|干练|从容|克制/, voiceRe: /沉稳|低音|成熟|磁性|深沉|稳/ },
  { key: "mighty", roleRe: /威严|霸气|王者|将军|首领|总裁|上位|强势|杀伐/, voiceRe: /霸道|霸气|威严|总裁|王|上位/ },
  { key: "sunny", roleRe: /阳光|开朗|活泼|元气|朝气|灿烂|爽朗|热血|少年感/, voiceRe: /阳光|开朗|活泼|元气|清爽|热血/ },
  { key: "gentle", roleRe: /温柔|温和|亲切|和善|温婉|体贴|慈爱|治愈/, voiceRe: /温柔|亲切|温和|软|暖|治愈/ },
  { key: "playful", roleRe: /俏皮|调皮|机灵|古灵精怪|顽皮|捣蛋|贫嘴|痞/, voiceRe: /俏皮|调皮|灵动|搞怪|痞/ },
  { key: "yandere", roleRe: /病娇|偏执|阴郁|疯批|破碎感/, voiceRe: /病娇|偏执|破碎/ },
  { key: "sultry", roleRe: /御姐|妩媚|性感|风情|妖娆/, voiceRe: /御姐|妩媚|性感|邪魅/ },
  { key: "rustic", roleRe: /憨厚|朴实|老实|木讷|敦厚|市井|操劳/, voiceRe: /憨|朴实|老实|敦厚|市井|烟火/ },
  { key: "rough", roleRe: /粗犷|豪爽|莽撞|大汉|壮汉|彪悍/, voiceRe: /粗犷|豪爽|浑厚|大汉|糙/ },
  { key: "refined", roleRe: /文雅|书卷|儒雅|斯文|学者|医生|医师|教授|精英|律师|绅士/, voiceRe: /儒雅|知性|精英|斯文|学者|绅士/ },
  { key: "narrator", roleRe: /旁白|解说|叙述|画外音/, voiceRe: /解说|旁白|纪录|叙述|播音|磁性/ },
];

/**
 * 强人设小众音色（病娇/撒娇夹子音/邪魅/霸总系）：角色画像没有对应气质时罚分——
 * 否则无气质信号的角色（如「同伴」）纯哈希决胜会随机撞上「病娇白莲」这类强人设嗓（实测）。
 */
const NICHE_VOICE_PENALTIES: Array<{ traitKey: string; voiceRe: RegExp }> = [
  { traitKey: "yandere", voiceRe: /病娇|偏执|疯批|破碎/ },
  { traitKey: "sultry", voiceRe: /邪魅|妩媚|性感|御姐/ },
  { traitKey: "mighty", voiceRe: /霸道总裁|帝王|霸气/ },
  { traitKey: "playful", voiceRe: /撒娇|夹子音|奶凶|傲娇/ },
];

/**
 * 补充性别标记（仅当 face-dna 的 inferCharacterGender 判不出时启用）：角色卡文本常无「男/女」
 * 字面（实测「阿诺·街头青年·痞气」判不出 → 混入女声池），用强性别倾向的形象词兜底。
 */
const SUPPLEMENTAL_MALE_RE = /少年|痞气|混混|硬汉|糙汉|寸头|板寸|平头|胡茬|喉结/;
const SUPPLEMENTAL_FEMALE_RE = /少女|连衣裙|双马尾|马尾辫|红唇|妆容/;

export function supplementalGenderFromProfile(text: string): "male" | "female" | "" {
  const t = String(text ?? "");
  const m = SUPPLEMENTAL_MALE_RE.test(t);
  const f = SUPPLEMENTAL_FEMALE_RE.test(t);
  if (m && !f) return "male";
  if (f && !m) return "female";
  return "";
}

/** 角色画像（确定性文本分析，无 LLM）：性别交给 inferCharacterGender，这里补年龄段 + 气质。 */
export function inferVoiceProfile(text: string): { ageBand: VoiceAgeBand | ""; traits: string[] } {
  const t = String(text ?? "");
  let ageBand: VoiceAgeBand | "" = "";
  for (const m of NUMERIC_AGE_MARKERS) {
    if (m.re.test(t)) {
      ageBand = m.band;
      break;
    }
  }
  if (!ageBand) {
    for (const m of AGE_BAND_MARKERS) {
      if (m.re.test(t)) {
        ageBand = m.band;
        break;
      }
    }
  }
  const traits = TRAIT_LEXICON.filter((x) => x.roleRe.test(t)).map((x) => x.key);
  return { ageBand, traits };
}

const ADJACENT_BANDS: Record<VoiceAgeBand, VoiceAgeBand[]> = {
  child: ["teen"],
  teen: ["youth", "child"],
  youth: ["teen", "middle"],
  middle: ["youth", "elder"],
  elder: ["middle"],
};

/** 目录里的「童声系」音色（名字/描述带童声标记）：非儿童角色绝不配（阿诺→天才童声事故根治）。 */
function isChildishVoice(v: VoiceCatalogEntry): boolean {
  if (catalogAgeBand(v.age) === "child") return true;
  return /童声|娃娃音|小萝莉|正太|奶声|小朋友/.test(`${v.name ?? ""} ${v.description ?? ""}`);
}

/**
 * 按角色画像从音色库确定性挑一个官方音色（同角色恒定同音色，不随机漂）。
 *
 * 【2026-07-17 根治「音色乱生成」】旧实现只有 性别→哈希，目录的 age/description/scene 富元数据
 * 全被扔掉（实测：姨妈→病娇萌妹、街头青年阿诺→天才童声）。现改为画像评分匹配：
 *   筛选优先级：中文音色 → 性别 → 童声守卫（非儿童角色排除童声系）→ excludeIds 排重；
 *   评分：年龄段（同段+30/邻段+10/隔段−25）+ 气质词命中（每条+8·封顶24）+ 场景偏置
 *         （角色扮演+3/视频配音+2；客服−5/趣味口音−8/多语种−5/教学−3——剧用音色）；
 *   决胜：同分池内按 seedName 稳定哈希（保持「同角色跨镜跨章恒定同一把嗓」不变量）。
 * profileText 缺省时退化为旧行为等价（全员同分 → 纯哈希）。库为空返回空串（relay 用默认音色）。
 */
export function autoPickVoiceId(
  voices: VoiceCatalogEntry[],
  opts: {
    gender?: "male" | "female";
    seedName: string;
    excludeIds?: Iterable<string>;
    /** 角色画像文本（角色名+角色卡 label/prompt 等）；给了才启用年龄/气质评分。 */
    profileText?: string;
  },
): string {
  const usable = voices.filter((v) => str(v.id));
  if (usable.length === 0) return "";
  // ① 语言闸：默认只挑中文音色（除非过滤后为空才回退全池，保底不哑）。
  const zh = usable.filter((v) => isChineseVoiceId(v.id));
  let pool = zh.length ? zh : usable;
  // ② 性别（调用方判不出时用画像文本的强性别倾向词兜底）
  const gender = opts.gender || supplementalGenderFromProfile(opts.profileText ?? "");
  if (gender) {
    const matched = pool.filter((v) => normalizeGender(str(v.gender)) === gender);
    if (matched.length) pool = matched;
  }
  const profile = inferVoiceProfile(opts.profileText ?? "");
  // ③ 童声守卫：角色不是儿童 → 童声系整体出池（除非排完池空，保底不哑）。
  if (profile.ageBand !== "child") {
    const noChild = pool.filter((v) => !isChildishVoice(v));
    if (noChild.length) pool = noChild;
  }
  // ④ 排重：排掉项目里其他角色已占用的音色（撞车实测：白大褂男/黑T恤男同 paoxiaoxiaoge）。
  if (opts.excludeIds) {
    const excluded = new Set([...opts.excludeIds].map((x) => str(x)).filter(Boolean));
    if (excluded.size) {
      const dedup = pool.filter((v) => !excluded.has(str(v.id)));
      if (dedup.length) pool = dedup;
    }
  }
  // ⑤ 画像评分。
  const traitRes = TRAIT_LEXICON.filter((x) => profile.traits.includes(x.key)).map((x) => x.voiceRe);
  const score = (v: VoiceCatalogEntry): number => {
    let s = 0;
    const hay = `${v.name ?? ""} ${v.description ?? ""} ${v.scene ?? ""}`;
    if (profile.ageBand) {
      const band = catalogAgeBand(v.age);
      if (band) {
        if (band === profile.ageBand) s += 30;
        else if (ADJACENT_BANDS[profile.ageBand].includes(band)) s += 10;
        else s -= 25;
      }
    }
    if (traitRes.length) {
      let hit = 0;
      for (const re of traitRes) if (re.test(hay)) hit += 8;
      s += Math.min(24, hit);
    }
    for (const n of NICHE_VOICE_PENALTIES) {
      if (!profile.traits.includes(n.traitKey) && n.voiceRe.test(hay)) s -= 8;
    }
    const scene = str(v.scene);
    if (scene === "角色扮演") s += 3;
    else if (scene === "视频配音") s += 2;
    else if (scene === "客服场景") s -= 5;
    else if (scene === "趣味口音") s -= 8;
    else if (scene === "多语种") s -= 5;
    else if (scene === "教学场景") s -= 3;
    return s;
  };
  let best = -Infinity;
  const scored = pool.map((v) => {
    const s = score(v);
    if (s > best) best = s;
    return { v, s };
  });
  const top = scored
    .filter((x) => x.s === best)
    .map((x) => x.v)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const idx = hashString(opts.seedName || "") % top.length;
  return str(top[idx].id);
}

/**
 * 【voiceLabel/label 单一真相源·2026-07-17 根治三层错乱】画布实测同一张卡 label 后缀、voiceLabel、
 * voiceId 三个字段互相矛盾（label「女声窃语」/voiceLabel「孱弱少爷 2.0」/voiceId=清冷高雅）——
 * 各写卡点各算一套、改 voiceId 不同步标签所致。所有写 doubaoVoiceId 的地方必须同时用本函数
 * 重算 voiceLabel 与节点 label，禁止手拼。
 */
export function voiceCardDisplayFields(
  role: string,
  voiceId: string,
  catalog: VoiceCatalogEntry[],
  fallbackVoiceLabel = "",
): { voiceLabel: string; label: string } {
  const voiceLabel =
    str(catalog.find((v) => str(v.id) === str(voiceId))?.name) || str(fallbackVoiceLabel);
  const label = voiceLabel ? `配音卡｜${str(role)}·${voiceLabel}` : `配音卡｜${str(role)}`;
  return { voiceLabel, label };
}

export type VoiceCardDubResult = {
  /** 配音后的成片 url（音轨已 mux 到视频上）。 */
  videoUrl: string;
  /** 合成出的语音 url（可作为音频节点产物回写）。 */
  audioUrl: string;
  voiceId: string;
  durationSec: number | null;
  character: string;
  dialogue: string;
};

/**
 * 用配音卡给一段视频配音：解析音色（卡显式 voiceId 优先；缺则按性别自动挑）→ TTS 合成台词
 * → mux 到视频。台词为空 / 视频 url 非法 → 返回 null（无可配内容，不阻断）。
 */
export async function dubVideoNodeWithVoiceCard(
  c: AppContext,
  userId: string,
  input: {
    videoUrl: string;
    dialogueText: string;
    card: VoiceCardProfile;
    /** 额外的性别推断文本（如镜头 prompt），辅助自动挑音色。 */
    genderHintText?: string;
  },
): Promise<VoiceCardDubResult | null> {
  const dialogue = (input.dialogueText || "").trim();
  const videoUrl = (input.videoUrl || "").trim();
  if (!dialogue || !/^https?:\/\//.test(videoUrl)) return null;

  // 音色：卡显式 doubaoVoiceId 优先（= 用户覆盖点）；无显式音色且未走克隆时，按角色性别自动挑官方音色。
  let voiceId = input.card.voiceId;
  const usingClone = input.card.referenceAudioUrls.length > 0 || Boolean(input.card.referenceImageUrl);
  if (!voiceId && !usingClone) {
    try {
      const voices = await listDoubaoSeedAudioVoices(c);
      const profileText = `${input.card.character} ${input.genderHintText || ""}`;
      const gender = inferCharacterGender(profileText);
      voiceId = autoPickVoiceId(voices, {
        ...(gender ? { gender } : {}),
        seedName: input.card.character || input.card.nodeId,
        profileText,
      });
    } catch {
      // 音色库拉取失败 → 不指定音色（relay 用默认），不阻断配音。
    }
  }

  const synth = await synthesizeDoubaoSpeechToStorage(c, userId, {
    text: dialogue,
    ...(input.card.audioModel ? { model: input.card.audioModel } : {}),
    ...(voiceId ? { voiceId } : {}),
    speechRate: input.card.speechRate,
    pitchRate: input.card.pitchRate,
    loudnessRate: input.card.loudnessRate,
    ...(input.card.referenceAudioUrls.length
      ? { referenceAudioUrls: input.card.referenceAudioUrls }
      : {}),
    ...(input.card.referenceImageUrl ? { referenceImageUrl: input.card.referenceImageUrl } : {}),
  });

  const mux = await muxAudioOntoVideo(c, userId, {
    videoUrl,
    audioUrl: synth.url,
    mode: input.card.audioMixMode,
  });

  return {
    videoUrl: mux.url,
    audioUrl: synth.url,
    voiceId: synth.voiceId || voiceId,
    durationSec: synth.durationSec,
    character: input.card.character,
    dialogue,
  };
}
