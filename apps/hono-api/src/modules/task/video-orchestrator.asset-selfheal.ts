// 【起跑前资产自愈·检测纠正（非硬闸）·2026-07-03 用户「全部根治」】
//
// 病根：2026-06-29 去硬闸把「缺锚定资产→拒绝起跑」降级成软告警「质量靠 SKILL」，但 SKILL 是软引导、
// 小T 会跳过（ch3《说谎》实测：说话角色 0 配音卡、≥3人同框 0 群像图、角色卡没落画布，照样起跑出片）。
// 质检(qa_panel/shot_table_critic)只查剧本/镜头表文字、不查资产是否真建出来 → 资产不全照样过。
//
// 正解（优先级：正确默认 > 检测纠正 > 硬闸）：起跑前服务端确定性自愈——
//  ① 说话角色缺配音卡 → 服务端从现有富音色目录按性别/气质确定性建卡（成对+按名音色绑定·免费·不依赖小T）；
//  ② ≥3人同框缺群像图 → 返回结构化缺口，由 agents-cli 决策下一步。
// 角色卡/场景卡的创建、复用和物化不在本模块执行，统一回到对应 agents-cli Skill 单轨。
// 纯检测/挑选逻辑抽成纯函数可单测；异步建卡由 selfHealOrchestrateAssets 编排。

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import type { StoryPlan, StoryPlanClip } from "./video-orchestrator.orchestrate";
import { persistFlowPatch, freshReadFlowRow } from "./video-orchestrator.flow-io";
import {
  readVoiceCardProfile,
  autoPickVoiceId,
  voiceCardDisplayFields,
  type FlowNodeLike,
} from "./voice-card-dub";
import { synthesizeDoubaoSpeechToStorage } from "../apiKey/audio-speech";
import { inferCharacterGender } from "./face-dna";
import { listDoubaoSeedAudioVoices } from "../apiKey/seed-audio-voices";
import { maybeAutoRegisterVoiceCard } from "./material-auto-register";
import { listProjectNodeAssetsForOwner } from "../material/material.service";
// 纯分类函数（零 DB 依赖，material-card-classify 专为此抽出）：道具卡/场景卡画布识别与
// orchestrate 的 resolveChapterPropCardEntries 同口径，避免自愈判「有卡」而绑定判「没卡」。
import { classifyCanvasCardForRegistry } from "./material-card-classify";
// 繁简折叠：与 authoring-driver.resolveAuthoringAssetCoverageInputs 同口径——小T 申报常简体、
// 库卡名常繁体（书源）。不折叠会把繁体已有卡判成「缺」→ 落一张简体重复卡（双卡事故）。
import { foldT2S } from "./video-orchestrator.t2s-fold";
import {
  readClipSpeakerBindings,
  type ClipSpeakerBinding,
} from "./video-orchestrator.speaker-contract";

/** 富音色目录（从 /audio/doubao-voices 414 个里策展的常用池·按性别分）。确定性按名挑，同角色恒定同一把嗓。 */
const MALE_VOICES: Array<{ id: string; label: string }> = [
  { id: "ICL_uranus_zh_male_lengjungaozhi_tob", label: "冷峻高智" },
  { id: "ICL_uranus_zh_male_diyinchenyu_tob", label: "低音沉郁" },
  { id: "ICL_uranus_zh_male_chenwenyouya_tob", label: "沉稳优雅" },
  { id: "ICL_uranus_zh_male_bujiqingnian_tob", label: "不羁青年" },
  { id: "ICL_uranus_zh_male_zhishuaiqingnian_tob", label: "直率青年" },
  { id: "zh_male_ruyaqingnian_uranus_bigtts", label: "儒雅青年" },
  { id: "zh_male_yangguangqingnian_uranus_bigtts", label: "阳光青年" },
  { id: "zh_male_xuanyijieshuo_uranus_bigtts", label: "悬疑解说" },
];
const FEMALE_VOICES: Array<{ id: string; label: string }> = [
  { id: "ICL_uranus_zh_female_qinglenggaoya_tob", label: "清冷高雅" },
  { id: "zh_female_gaolengyujie_uranus_bigtts", label: "高冷御姐" },
  { id: "zh_female_zhixingnv_uranus_bigtts", label: "知性女声" },
  { id: "ICL_uranus_zh_female_bingruoshaonv_tob", label: "病弱少女" },
  { id: "ICL_uranus_zh_female_xiemeiyujie_tob", label: "邪魅御姐" },
];

const FEMALE_MARKER_RE = /女|妈|姨|姥|娘|妹|姐|母|嫂|妃|后|妻|婶|婆|奶|姑|媛|少女|女生|女人|女孩|丫头/;

/** 稳定哈希（cyrb-lite）：同名恒定 → 同角色跨镜跨章恒定同一把嗓（声音连续性）。 */
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 【兜底用·仅当真实豆包音色目录取不到时】按角色名确定性挑一把音色（性别启发式 + 稳定哈希）。
 * 主路径走 selfHeal 里的 inferCharacterGender + autoPickVoiceId（复用既有配音卡口径·从真实目录挑·
 * 与 VOICE_CARD_AUTO_DUB 同一把嗓·避免硬编码 id 下线成哑卡），本函数只在目录 fetch 失败时兜底。
 * avoidIds：画布已被其他角色占用的音色——从哈希位起顺延到第一把未占用的（防兜底路径撞嗓）。
 */
export function pickVoiceForRole(
  name: string,
  hintText = "",
  avoidIds?: Iterable<string>,
): { voiceId: string; voiceLabel: string } {
  const key = String(name ?? "").trim();
  const isFemale = FEMALE_MARKER_RE.test(key) || FEMALE_MARKER_RE.test(hintText);
  const pool = isFemale ? FEMALE_VOICES : MALE_VOICES;
  const avoid = new Set([...(avoidIds ?? [])].filter(Boolean));
  const start = stableHash(key) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(start + i) % pool.length];
    if (!avoid.has(cand.id)) return { voiceId: cand.id, voiceLabel: cand.label };
  }
  const pick = pool[start]; // 全占满（角色数>池子）→ 退回哈希位，撞嗓好过哑卡
  return { voiceId: pick.id, voiceLabel: pick.label };
}

/**
 * 角色卡文本作性别提示（2026-07-16 实测：「街角青年乙/丙」纯名字判不出性别 → 全池哈希
 * 挑中女声"假小子/客服婉君"；而画布角色卡 label/prompt 里通常写明男女——男/女、male/man）。
 * 只从验真的 character-card/v3 读取同名卡，返回其展示文本与 prompt（截断防长文噪声）。
 * 裸 roleName 与 label 包含关系不再作为身份兜底。
 */
export function characterGenderHintFromCards(nodes: Array<Record<string, unknown>>, role: string): string {
  const key = norm(role);
  if (!key) return "";
  for (const n of nodes) {
    const d = ((n as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    if (String(d.kind ?? "") !== "image") continue;
    const classification = classifyCanvasCardForRegistry(d);
    if (classification?.kind !== "character") continue;
    const rn = norm(classification.name);
    const label = String(d.label ?? "");
    if (rn !== key) continue;
    return `${label} ${String(d.prompt ?? "")}`.slice(0, 500);
  }
  return "";
}

/**
 * 项目库 kind=voice 资产的 {角色名集合, 已占用音色集合}。
 * 【撞嗓根治·2026-07-17】旧排重只看画布节点的 voiceId——库里已有同名卡时画布不建卡（名字判重命中）、
 * 但那把嗓的 voiceId 不进排除集 → 别的角色确定性哈希撞上同一把（实测：林七夜/阿诺同 shaonianzixin）。
 * 一角色一把嗓的守恒必须横跨画布+项目库两个真相源。
 */
export function collectLibVoiceMeta(
  libAssets: Array<{ name?: unknown; latestVersion?: { data?: unknown } }>,
): { names: Set<string>; voiceIds: Set<string> } {
  const names = new Set<string>();
  const voiceIds = new Set<string>();
  for (const a of libAssets) {
    const nm = String(a?.name ?? "").trim();
    if (nm) names.add(norm(nm));
    const data = (a?.latestVersion?.data ?? {}) as Record<string, unknown>;
    const vid = String(data.doubaoVoiceId ?? "").trim();
    if (vid) voiceIds.add(vid);
  }
  return { names, voiceIds };
}

/**
 * 配音卡试听音频（2026-07-16 哑卡根治）：selfheal 建卡此前只写 voiceId 不合成音频 →
 * 画布上出现"空的音频卡"（无波形无时长，用户视角=没生成资产）。与 generate-audio-to-canvas
 * 同口径（用户拍板：配音卡是一等资产，必须有真实音频文件；文案 ~30 字防豆包短句异常）。
 * best-effort：合成失败返回空对象，卡仍带 voiceId 落地（对白配音可用，仅缺试听），不阻断自愈。
 */
export async function synthVoiceCardPreviewFields(
  c: AppContext,
  userId: string,
  role: string,
  voiceId: string,
): Promise<Record<string, unknown>> {
  const text = `大家好，我是${role}。这是我在本剧中的声音，用于音色试听与跨章节的声音锁定。`;
  try {
    const r = await synthesizeDoubaoSpeechToStorage(c, userId, {
      text,
      model: "doubao-seed-audio-1-0",
      voiceId: voiceId || null,
    });
    return {
      ...(r.url ? { audioUrl: r.url } : {}),
      ...(r.durationSec ? { audioDurationSec: r.durationSec } : {}),
      text,
    };
  } catch (e) {
    console.warn(
      `[asset-selfheal] voice card preview synth failed (${role}): ${e instanceof Error ? e.message : String(e)}`,
    );
    return {};
  }
}

/** 一个 clip 的结构化说话人合同。禁止从 clipPrompt / dialogue 文本反推。 */
export function detectClipSpeakerBindings(clip: StoryPlanClip | undefined): ClipSpeakerBinding[] {
  return readClipSpeakerBindings(clip).bindings;
}

/** 一个 clip 的所有说话人名（跨资产类型去重·保序）。 */
export function detectClipSpeakingRoles(clip: StoryPlanClip | undefined): string[] {
  return detectClipSpeakerBindings(clip).map((binding) => binding.name);
}

/** 全片所有说话角色（跨 clip 去重·保序）。 */
export function collectSpeakingRoles(plan: { clips?: readonly unknown[] }): string[] {
  const out: string[] = [];
  for (const clip of plan.clips ?? []) {
    for (const nm of detectClipSpeakingRoles(clip as StoryPlanClip)) {
      if (!out.includes(nm)) out.push(nm);
    }
  }
  return out;
}

/**
 * 群像图缺口：某 clip 需要多人同框但画布无群像图。两条判据（满足其一即缺口）：
 *  ① characterRoleNames 显式列了 ≥ ENSEMBLE_THRESHOLD 人；
 *  ② clipPrompt 描述的是人群/多人同框取景（九人围桌、众人、所有人、一圈…）——即使 LLM 只在
 *     characterRoleNames 里列了焦点说话者(1~2人)，背景仍是一群人，同样需要群像图锁背景人脸防同脸漂移。
 * 返回缺口 clipIndex 列表（非空 → 调用方硬 flag 让导演先建群像图）。纯函数。
 */
export const ENSEMBLE_SAME_FRAME_THRESHOLD = 3;
/** 人群/多人同框取景关键词（命中即认定该镜为群像镜，需要群像图资产）。
 * 2026-07-07 语境化收紧（ch4 实测误判）：裸「一圈」命中了独角镜的运镜词「环绕一周/扫视一圈」、
 * 「环视四周/环视一圈」是单人扫视环境非人群——只保留真人群语义（围成一圈/环视众人/环视全场）。
 * 2026-07-17 recall 补洞（ch1 镜1 实测）：「三四个青年簇在一起」不命中「三四人/三位」格式 →
 * 群像镜被判非群像、writer 显式申报的群像图遭污染护栏误剔（违反群像铁律）。补「数量词+个+人称名词」
 * 与聚集动词（簇在/扎堆/一群/成群…）两族；「两个人」仍不算（阈值≥3），运镜词误报教训不回退。 */
export const CROWD_FRAMING_RE =
  /[三四五六七八九十]人|[三四五六七八九]位|[三四五六七八九十几]个(?:人|青年|少年|年轻人|路人|孩子|小孩|学生|士兵|汉子|大汉|男人|女人|弟子|随从|护卫)|一群|一伙(?:人)?|成群|扎堆|簇拥|簇[在于成]|三三两两|三五成群|众人|所有人|每个人|一众|大家|全体|围成一圈|围坐|围桌|圆桌|长桌|一桌人|人群|群像|合影|挨个|逐一|环视(?:众人|全场)|每人(?:一|发|面前)|一一|围观|围拢|一圈路人|路人们/;
/**
 * 取 clip「自身」的画面文本（2026-07-06 ch2 实测修正）：结构化 clip 的渲染版 clipPrompt 里
 * 前置了 filmBible（导演基调常含「群像反应镜」等词）——拿它做人群判定会把**每一段**都误判成
 * 群像段（独角镜被迫绑群像图=身份污染源）。有 shots 结构时只看镜头表字段+段级叙事字段；
 * 无 shots 的存量纯文本 clip 回落 clipPrompt（零回归）。
 */
function clipIntrinsicText(clip: unknown): string {
  const c = (clip ?? {}) as Record<string, unknown>;
  const shots = Array.isArray(c.shots) ? (c.shots as unknown[]) : [];
  if (shots.length) {
    const parts: string[] = [];
    for (const s of shots) {
      const sh = (s ?? {}) as Record<string, unknown>;
      parts.push(String(sh.framing ?? ""), String(sh.composition ?? ""), String(sh.action ?? ""));
    }
    parts.push(String(c.logline ?? ""), String(c.continuity ?? ""), String(c.editRhythm ?? ""));
    return parts.join(" ");
  }
  return String(c.clipPrompt ?? "");
}
/** 多元素同框实体阈值（2026-07-14 用户拍板「群像图针对资产不止角色」）：角色+申报道具合计 ≥ 此值=多元素镜。 */
export const MULTI_ENTITY_FRAME_THRESHOLD = 4;

/** writer 显式豁免声明（2026-07-17 ch1-firstmin 复盘）：贴身情绪镜的【时空】承接段常含
 * 「围观议论未散」等**上一镜世界状态**词 → CROWD_FRAMING_RE 误命中，把纯净镜判成群像镜，
 * 群像铁律反过来护住了误挂的群像图（ch1 clip2 牵手特写实测：writer 写明「纯净镜——禁挂
 * ensemble」仍被挂上群像图）。显式声明优先于正则猜测：命中即本镜不需要/不允许群像图。 */
export const ENSEMBLE_OPTOUT_RE = /纯净镜|禁挂\s*ensemble|no[-\s]?ensemble/i;

export function clipNeedsEnsemble(clip: unknown): boolean {
  const c = (clip ?? {}) as Record<string, unknown>;
  if (ENSEMBLE_OPTOUT_RE.test(`${String(c.clipPrompt ?? "")} ${String(c.continuity ?? "")}`)) {
    return false;
  }
  const roles = Array.isArray(c.characterRoleNames) ? (c.characterRoleNames as unknown[]) : [];
  const namedCount = roles.filter((r) => String(r ?? "").trim()).length;
  if (namedCount >= ENSEMBLE_SAME_FRAME_THRESHOLD) return true;
  // 【实体泛化·2026-07-14 用户拍板】群像图锚定的是"帧内独立视觉实体的布局与外观"，不只人脸：
  // 角色+具名道具（propNames 申报）合计 ≥4 = 多元素同框，同样需要合成参考图防实体漏画/漂移/互吞。
  const props = Array.isArray(c.propNames) ? (c.propNames as unknown[]) : [];
  const propCount = props.filter((r) => String(r ?? "").trim()).length;
  if (namedCount + propCount >= MULTI_ENTITY_FRAME_THRESHOLD && namedCount >= 1) return true;
  return CROWD_FRAMING_RE.test(clipIntrinsicText(clip));
}

/** 紧景别（贴身单体镜）关键词——命中即「特写/近景」类。 */
export const TIGHT_FRAMING_RE =
  /大?特写|近景|中近景|脸部|面部|眼部|微距|close[-\s]?up|extreme close|\bECU\b|\bMCU\b|\bCU\b/i;
/** 宽景关键词——含此类 beat 说明镜内可能真有多主体同框，纯净度护栏不介入（交给群像图逻辑）。 */
export const WIDE_FRAMING_RE = /全景|远景|大远景|群像|wide[-\s]?shot|full[-\s]?shot|establishing/i;
/**
 * 本镜是否为「贴身单体特写/近景镜」：≤1 具名角色 且景别为紧景别 且不含任何宽景 beat。
 * 用途（视频模型吃图不吃字·2026-07-08 用户拍板）：seedance 只吸收参考图的视觉内容，几乎不吸收
 * 「人物站位/画面描述/台词」等文字列——把一张群像图（多主体同框）喂给一个只该有「主角+当前单个
 * 对应主体」的特写镜，模型会照抄把多余主体全画进来 → 主体稀释、画面脏。故这类镜要把误绑的群像图剔掉。
 * 只看 shots[].framing 景别字段（存量无 shots 时回落 shotSize/framing 单字段），避免 action/logline
 * 叙述里的「特写」误命中；含宽景 beat（全景/远景，可能真多主体）时返回 false，让群像图逻辑接管。
 */
export function clipIsTightSingleSubject(clip: unknown): boolean {
  const c = (clip ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(c.characterRoleNames)
    ? (c.characterRoleNames as unknown[]).filter((r) => String(r ?? "").trim()).length
    : 0;
  if (roles >= 2) return false;
  const shots = Array.isArray(c.shots) ? (c.shots as unknown[]) : [];
  const framingText = shots.length
    ? shots.map((s) => String((s as Record<string, unknown>)?.framing ?? "")).join(" ")
    : String(c.shotSize ?? c.framing ?? "");
  if (!framingText.trim()) return false;
  if (WIDE_FRAMING_RE.test(framingText)) return false;
  return TIGHT_FRAMING_RE.test(framingText);
}

/** 只有 agents 对当前 clip 的结构化空间决策可以要求站位图。 */
export function clipNeedsBlockingDiagram(clip: unknown): boolean {
  const c = (clip ?? {}) as Record<string, unknown>;
  if (String(c.blockingFrameNodeId ?? "").trim()) return false;
  return c.spatialBlocking === true;
}

// ── 群像图自动绑定（2026-07-06「正确默认」：lint 能确定性判出缺口+该绑哪张，就直接代绑）────
// 病根（ch2 实测）：lint 只告警等 LLM 返工、旧 start 曾把 ensemble_asset_missing 当硬拦——明明画布上有
// 现成群像图。add_clips 入库前服务端把结构匹配的群像图节点写入唯一 videoReferenceNodeIds
//（存储前 mutate，redis/DB 落的即绑好版）。生成时 addEnsembleForCrowdClip 仍是兜底。

export type EnsembleCandidate = {
  id: string;
  label?: string;
  /** 群像图节点 data.characterRoleNames（建图时列全的出镜者）。 */
  roleNames?: readonly string[];
  hasMedia?: boolean;
};

/**
 * 为一批 clips 自动绑定群像图（原地 mutate videoReferenceNodeIds）。匹配规则（确定性）：
 * ① 节点 characterRoleNames 与该段 characterRoleNames 交集最大者（>0）胜出；
 * ② 无交集时若节点 label 包含该段某个角色名（逐字）也算命中；
 * ③ 仍无法判定且画布只有一张群像图 → 用它；多张且判不出 → 不绑（lint 告警留给人/LLM）。
 * 并列时 hasMedia 优先、再按 id 字典序（稳定）。返回绑定说明（段号按 slotNos 对位，1-based）。
 */
export function autoBindEnsembleRefs(
  clips: readonly unknown[],
  candidates: readonly EnsembleCandidate[],
  slotNos?: readonly number[],
): string[] {
  if (!candidates.length) return [];
  const candidateIds = new Set(candidates.map((c) => c.id));
  const notes: string[] = [];
  clips.forEach((raw, i) => {
    const clip = (raw ?? {}) as Record<string, unknown>;
    if (!clipNeedsEnsemble(clip)) return;
    const refs = Array.isArray(clip.videoReferenceNodeIds)
      ? (clip.videoReferenceNodeIds as unknown[])
      : [];
    if (refs.some((id) => candidateIds.has(String(id ?? "").trim()))) return; // 已绑
    const clipRoles = (Array.isArray(clip.characterRoleNames) ? clip.characterRoleNames : [])
      .map((r) => String(r ?? "").trim())
      .filter(Boolean);
    const scored = candidates
      .map((cand) => {
        const candRoles = new Set((cand.roleNames ?? []).map((r) => String(r ?? "").trim()));
        let overlap = clipRoles.filter((r) => candRoles.has(r)).length;
        if (!overlap && cand.label) {
          overlap = clipRoles.some((r) => r.length >= 2 && String(cand.label).includes(r)) ? 1 : 0;
        }
        return { cand, overlap };
      })
      .sort(
        (a, b) =>
          b.overlap - a.overlap ||
          Number(Boolean(b.cand.hasMedia)) - Number(Boolean(a.cand.hasMedia)) ||
          a.cand.id.localeCompare(b.cand.id),
      );
    const top = scored[0];
    const pick = top && top.overlap > 0 ? top.cand : candidates.length === 1 ? candidates[0] : null;
    if (!pick) return;
    clip.videoReferenceNodeIds = [...refs, pick.id];
    const slot = slotNos?.[i];
    const no = Number.isInteger(slot) && (slot as number) >= 0 ? (slot as number) + 1 : i + 1;
    notes.push(`段${no}已自动绑群像图「${pick.label || pick.id}」`);
  });
  return notes;
}
// ── 俯视底图自动绑定（2026-07-17 v4 实测：小T 专门出了 floorplan 却没填 blockingFrameNodeId，
// 站位靠模型乱猜=拍间跳变。与群像自动绑同构「正确默认」：lint 能确定性判出缺口+该绑哪张就代绑）──

export type BlockingFrameCandidate = {
  id: string;
  label?: string;
  /** 出生申报的归属场景（节点 data.sceneName·与 clip.sceneName 同一符号体系）——首选匹配依据。 */
  sceneName?: string;
  hasMedia?: boolean;
};

/**
 * 为一批 clips 自动绑定俯视底图（原地 mutate blockingFrameNodeId）。只接受两侧逐字一致的
 * sceneName 申报；无场景申报、单候选和 label 相似均不构成绑定证据。已带
 * blockingFrameNodeId 或未声明 spatialBlocking:true 的 clip 不动。
 * 并列时 hasMedia 优先、再按 id 字典序（稳定）。
 */
export function autoBindBlockingFrameRefs(
  clips: readonly unknown[],
  candidates: readonly BlockingFrameCandidate[],
  slotNos?: readonly number[],
): string[] {
  if (!candidates.length) return [];
  const stable = (a: BlockingFrameCandidate, b: BlockingFrameCandidate): number =>
    Number(Boolean(b.hasMedia)) - Number(Boolean(a.hasMedia)) || a.id.localeCompare(b.id);
  const notes: string[] = [];
  clips.forEach((raw, i) => {
    const clip = (raw ?? {}) as Record<string, unknown>;
    if (!clipNeedsBlockingDiagram(clip)) return; // 已带 blockingFrameNodeId 时该判定自身返回 false
    const sceneName = String(clip.sceneName ?? "").trim();
    const declared = sceneName
      ? [...candidates].filter((c) => String(c.sceneName ?? "").trim() === sceneName).sort(stable)
      : [];
    const pick = declared[0] ?? null;
    if (!pick) return;
    clip.blockingFrameNodeId = pick.id;
    const slot = slotNos?.[i];
    const no = Number.isInteger(slot) && (slot as number) >= 0 ? (slot as number) + 1 : i + 1;
    notes.push(`段${no}已自动绑俯视底图「${pick.label || pick.id}」`);
  });
  return notes;
}

export function detectEnsembleGaps(
  plan: Pick<StoryPlan, "clips">,
  ensembleNodeIds: ReadonlySet<string>,
): number[] {
  // 【2026-07-04 ch7 实测改逐镜绑定】旧版「画布有一张群像图即全放行」是身份漂移温床：
  // ch7 建了两张群像图但 clip0-4 全没把它们挂进 videoReferenceNodeIds，五镜群像裸奔 →
  // 全景人数崩/角色时隐时现/动作张冠李戴。群像图必须逐镜绑进 videoReferenceNodeIds 才算数。
  const gaps: number[] = [];
  (plan.clips ?? []).forEach((clip, i) => {
    if (!clipNeedsEnsemble(clip)) return;
    const refs = Array.isArray((clip as { videoReferenceNodeIds?: unknown }).videoReferenceNodeIds)
      ? ((clip as { videoReferenceNodeIds: unknown[] }).videoReferenceNodeIds)
      : [];
    const bound = refs.some((id) => ensembleNodeIds.has(String(id ?? "").trim()));
    if (bound) return;
    const rawIndex = (clip as { clipIndex?: unknown }).clipIndex;
    gaps.push(typeof rawIndex === "number" ? rawIndex : i);
  });
  return gaps;
}

/**
 * 【说话人角色卡缺口】
 * speakerBindings.assetKind=character 是 agents-cli 对画面身份的结构化语义结论；若画布+库都没有他的
 * **有图**角色卡，该角色的镜头没有任何个体身份锚——群像图兜不住（单人紧景别镜按参考图
 * 纯净度会剔除群像图；且群像成员申报常不全）→ 逐段重掷脸=跨段人物漂移。
 * assetKind=voice 是纯声音通道，不要求图片角色卡，但仍由资产段要求真实配音卡。
 * knownCharacterNames 传 foldName 折叠后的已验真角色资产名字集合。纯函数。
 */
export function detectSpeakerCharacterCardGaps(
  plan: Pick<StoryPlan, "clips">,
  knownCharacterNames: ReadonlySet<string>,
): Array<{ clipIndex: number; roles: string[] }> {
  const gaps: Array<{ clipIndex: number; roles: string[] }> = [];
  (plan.clips ?? []).forEach((clip, i) => {
    const missing = detectClipSpeakerBindings(clip)
      .filter((binding) => binding.assetKind === "character")
      .map((binding) => binding.name)
      .filter((name) => !knownCharacterNames.has(foldName(name)));
    if (!missing.length) return;
    const rawIndex = (clip as { clipIndex?: unknown }).clipIndex;
    gaps.push({ clipIndex: typeof rawIndex === "number" ? rawIndex : i, roles: missing });
  });
  return gaps;
}

function readEnvFlag(env: unknown, key: string): string {
  const rec = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
  return String(rec[key] ?? "").trim().toLowerCase();
}

/** flag：起跑前资产自愈总开关（默认 ON·检测纠正非硬闸）。0/false/off 关闭回旧行为。 */
export function isAssetSelfHealEnabled(env: unknown = process.env): boolean {
  const raw = readEnvFlag(env, "VIDEO_ASSET_SELFHEAL");
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

function parseFlowNodes(row: FlowRow | null): Array<Record<string, unknown>> {
  if (!row?.data) return [];
  try {
    const d = JSON.parse(row.data) as { nodes?: unknown };
    return Array.isArray(d.nodes) ? (d.nodes as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}
function characterCardName(data: Record<string, unknown>): string {
  const classification = classifyCanvasCardForRegistry(data);
  return classification?.kind === "character" ? classification.name : "";
}
function nodeCharacterCardName(node: Record<string, unknown>): string {
  return characterCardName((node.data ?? {}) as Record<string, unknown>);
}
function libraryCharacterCardName(asset: { latestVersion?: { data?: unknown } }): string {
  const data = asset.latestVersion?.data;
  return characterCardName(
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {},
  );
}
function norm(s: string): string {
  return s.trim().toLowerCase();
}
/**
 * 资产名比对键：去空白 + 繁简折叠（与 authoring-driver.resolveAuthoringAssetCoverageInputs 同口径）。
 * 小T 申报常简体、库卡/画布卡名常繁体（书源）——只 trim+lowercase 会把「混元金鬥」与
 * 「混元金斗」判成两个资产 → 重复落卡。
 */
function foldName(s: string): string {
  return foldT2S(String(s ?? "").trim().replace(/\s+/g, "")).toLowerCase();
}

function nodeHasRealImageUrl(n: Record<string, unknown>): boolean {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const isHttpUrl = (value: unknown): boolean => /^https?:\/\//.test(String(value ?? "").trim());
  if (isHttpUrl(d.imageUrl) || isHttpUrl(d.url)) return true;
  if (!Array.isArray(d.imageResults)) return false;
  return d.imageResults.some((result) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) return false;
    return isHttpUrl((result as Record<string, unknown>).url);
  });
}

/**
 * 收集已具备真实图片资产的角色 canonical 名。
 * 角色身份只接受 classifyCanvasCardForRegistry 验真的 character-card/v3 结构化合同。
 * label、裸 roleName 和历史旁路节点不再构成角色卡身份事实。
 */
export function collectKnownCharacterCardNames(
  nodes: readonly Record<string, unknown>[],
): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const classification = classifyCanvasCardForRegistry(data);
    if (classification?.kind !== "character" || !nodeHasRealImageUrl(node)) continue;
    names.add(foldName(classification.name));
  }
  return names;
}

export type SelfHealResult = {
  createdVoiceCards: Array<{ character: string; voiceLabel: string }>;
  /** 群像库卡落画布并已绑进缺口段（2026-07-10 ch11 实测补齐：与角色卡「库卡落画布」对等）。 */
  patchedEnsembleCards: string[];
  /** 道具/法宝库卡落画布（2026-07-16 补齐：与角色卡/群像图「库卡落画布」对等·根治同名法宝跨章重画）。 */
  patchedPropCards: string[];
  ensembleGapClips: number[];
  /** 说话人角色卡缺口（2026-07-18 斩神2「沉默青年」根治）：具名台词说话人查无有图角色卡的段。 */
  speakerCardGapClips: Array<{ clipIndex: number; roles: string[] }>;
};

/**
 * 【成片音频收编·2026-07-16 用户实测「音频节点都没连视频，白生成了」根治】
 *
 * 病根（四层全断，没有任何一层负责建边）：
 *  ① 工具 schema（task.agents-bridge tapcanvas_audio_generate_to_canvas）没有任何连边参数，
 *     且 additionalProperties:false → 小T 想连也传不进去（参数名不在 schema = 静默忽略）；
 *  ② 服务端实现（agents-tool-bridge.generate-audio-to-canvas）只发 createNodes，从不 createEdges，
 *     尽管 persistFlowPatch 的 patch 类型本就支持 createEdges——能力在，没接；
 *  ③ 前端 collectUpstreamComposeAudioTracks 只吃 incoming edge，收不到就静默返回空（对比同文件
 *     视频源收集有 clipRunId 兜底，音频这条完全没写）；
 *  ④ SKILL 只说 out-audio「可连」，没有任何一步要求生成后 flow_patch 建边。
 * → speech/music 音频节点 100% 孤儿 → 合成时收不到 → 积分已扣、音轨没进片 = 白花钱。
 *
 * 正解（优先级：正确默认 > 检测纠正 > 硬闸）：不靠小T自觉、不加硬闸，起跑前服务端确定性认领，
 * 成片节点建出时确定性连边。本函数只负责「收编口径」这一纯决策，可单测。
 *
 * 收编口径：
 *  - kind=audio 且 audioUrl 非空才算真资产（哑节点不连，连了前端也收不到 url）；
 *  - audioType=voice_card **排除**：配音卡是音色锚，按 voiceCharacter 名字被 orchestrate 消费
 *    （合成台词 → seedance audio_url 原生对口型），连边混音会让同一句台词出现两遍人声；
 *  - audioType 缺省视作 speech（工具默认值），speech/music 都收（旁白/slogan/BGM 都靠连边混音）；
 *  - mixExclude=true **排除**（2026-07-17 用户拍板「章级 BGM 与封面同为必备交付物·30s 左右·剪辑软件自行拼接」）：
 *    章级 BGM/环境音是独立素材，自动混进成片会与用户手工配乐双轨打架——写入侧唯一来源是
 *    generate-audio-to-canvas 的 mixExclude 参数，此处是唯一消费点（单一判据单一实现）。
 */
export function collectComposeAudioNodeIds(
  nodes: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const ids: string[] = [];
  for (const n of nodes ?? []) {
    const d = (n?.data ?? {}) as Record<string, unknown>;
    if (String(d.kind ?? "").trim().toLowerCase() !== "audio") continue;
    if (!String(d.audioUrl ?? "").trim()) continue;
    if (d.mixExclude === true) continue;
    // 缺省 = speech（与 generate-audio-to-canvas 的默认值同口径）。
    const audioType = (String(d.audioType ?? "speech").trim().toLowerCase() || "speech");
    if (audioType === "voice_card") continue;
    const id = String(n?.id ?? "").trim();
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * 【道具卡缺口检测·2026-07-16 用户「视频生成前找到对应资产(音频/场景/道具等)」】
 *
 * 病根：既有起跑前自愈没有覆盖道具卡的真实绑定。
 * resolveChapterPropCardEntries 只读**当前画布**，库里明明有前章沉淀的同名法宝也绑不上
 * （混元金斗三章三个设计＝同一病根：卡在库里，画布上没有 → 按名取不到 → 模型重新脑补）。
 * 道具仍保留现有独立协议；角色卡与场景卡不复用这条 Hono 物化路径。
 *
 * 返回「申报了但画布上没有对应道具卡」的道具名（保序去重）。画布判定复用
 * classifyCanvasCardForRegistry（法宝卡/武器卡/器物卡等同族前缀同口径识别）。
 * 无 propNames 申报 → 空数组 = 零行为变化。纯函数。
 *
 * 与 authoring-driver.resolveAuthoringAssetCoverageInputs 的分工：那条走 castManifest 申报、在
 * 编排域主干（script_approved 前置）物化，是主路径；本函数走 clip.propNames、在起跑前兜底
 * castManifest 漏申报的道具。判重同口径（繁简折叠 + 画布按名识别）→ 主路径已落的卡这里判
 * 「已有」直接跳过，不会双卡。
 */
export function collectMissingPropNames(
  plan: StoryPlan,
  nodes: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const declared: string[] = [];
  const seen = new Set<string>();
  for (const clip of plan?.clips ?? []) {
    const names = (clip as { propNames?: unknown }).propNames;
    for (const raw of Array.isArray(names) ? names : []) {
      const nm = String(raw ?? "").trim();
      if (!nm || seen.has(foldName(nm))) continue;
      seen.add(foldName(nm));
      declared.push(nm);
    }
  }
  if (!declared.length) return [];
  const onCanvas = new Set<string>();
  for (const n of nodes ?? []) {
    const cls = classifyCanvasCardForRegistry((n?.data ?? {}) as Record<string, unknown>);
    if (cls?.kind === "prop" && cls.name) onCanvas.add(foldName(cls.name));
  }
  return declared.filter((nm) => !onCanvas.has(foldName(nm)));
}

/**
 * 【场景卡悬空引用检测·2026-07-16 用户「视频生成前找到对应资产」】
 *
 * 病根（2026-07-11 ch15 实测）：clip.sceneCardNodeId 必须是**本章画布上真实存在的节点 id**，
 * 但小T 常填成库资产 materialAssetId 或前章节点 id → 服务端按节点 id 查不到 → **静默**回退
 * no-scene → 整章场景零参考图、全靠文字硬扛。静默是最坏的：既没报错也没告警，导演无从发现。
 *
 * 返回「clip 申报了但画布上找不到对应节点」的 sceneCardNodeId（保序去重）。调用方拿它回查
 * 设定库：命中就用**原 id 作新节点 id** 落画布 —— clip.sceneCardNodeId 无需回填即自动命中。
 * 未申报 → 空数组 = 零行为变化。纯函数。
 */
export function collectDanglingSceneCardIds(
  plan: StoryPlan,
  nodes: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const onCanvas = new Set<string>();
  for (const n of nodes ?? []) {
    const id = String(n?.id ?? "").trim();
    if (id) onCanvas.add(id);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const clip of plan?.clips ?? []) {
    const id = String((clip as { sceneCardNodeId?: unknown }).sceneCardNodeId ?? "").trim();
    if (!id || onCanvas.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 【成片节点入边构造·纯函数可单测】clip 段 + 音频轨 → 成片节点的 createEdges。
 * edge id 固定为 `e-<source>-<target>` → 重复 drive 幂等去重（existingEdgeIds 过滤）。
 *
 * 音频轨与 clip 段一视同仁走 incoming edge：前端 collectUpstreamComposeAudioTracks 与
 * collectUpstreamComposeSources 都只认入边，按上游节点 kind 分流成视频源/音频轨。
 */
export function buildComposeEdges(input: {
  filmNodeId: string;
  clipNodeIds: ReadonlyArray<string>;
  audioNodeIds: ReadonlyArray<string>;
  existingEdgeIds: ReadonlySet<string>;
}): Array<{ id: string; source: string; target: string }> {
  const seen = new Set<string>();
  return [...(input.clipNodeIds ?? []), ...(input.audioNodeIds ?? [])]
    .map((s) => String(s ?? "").trim())
    .filter((source) => {
      if (!source || source === input.filmNodeId) return false;
      if (seen.has(source)) return false; // 同一节点既是 clip 又被当音频收编时只连一条
      seen.add(source);
      return true;
    })
    .map((source) => ({
      id: `e-${source}-${input.filmNodeId}`,
      source,
      target: input.filmNodeId,
    }))
    .filter((e) => !input.existingEdgeIds.has(e.id));
}

/**
 * 【音色并发落·根治「音色 deferred 到 start、没跟角色卡并发」（2026-07-03 用户目标）】
 * 给定一批出镜角色名，为画布/库里都还没有配音卡的角色，从真实豆包音色目录确定性挑一把（inferCharacterGender+
 * autoPickVoiceId·与 VOICE_CARD_AUTO_DUB 同源）建配音卡节点落画布 + 入库。add_clips 收批时调 → 音色跟角色卡一起并发落。
 * best-effort：失败只 warn。返回本次建的 {character,voiceLabel}。
 */
export async function buildVoiceCardsForRoles(input: {
  c: AppContext;
  userId: string;
  flowId: string;
  chapterId?: string;
  projectId: string | null;
  roleNames: string[];
}): Promise<{ created: Array<{ character: string; voiceLabel: string }> }> {
  const wanted = [...new Set(input.roleNames.map((r) => String(r ?? "").trim()).filter(Boolean))];
  if (!wanted.length) return { created: [] };
  let row: FlowRow;
  try {
    row = await freshReadFlowRow({
      c: input.c,
      flowId: input.flowId,
      requestUserId: input.userId,
      devBypass: true,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
  } catch {
    return { created: [] };
  }
  const nodes = parseFlowNodes(row);
  const canvasVoice = new Set<string>();
  // 【撞嗓查重·2026-07-04 ch3 实测】齐夏与健硕男共用 zh_male_shaonianzixin——主角与战术担当同一把嗓。
  // 画布上已被占用的 voiceId 全部进排除集，本批新卡逐个累加，保证「一角色一把嗓」。
  const usedVoiceIds = new Set<string>();
  for (const n of nodes) {
    const card = readVoiceCardProfile(n as FlowNodeLike);
    if (card?.character) canvasVoice.add(norm(card.character));
    if (card?.voiceId) usedVoiceIds.add(card.voiceId);
  }
  const libVoice = new Set<string>();
  if (input.projectId) {
    try {
      const libs = await listProjectNodeAssetsForOwner(input.c, input.userId, {
        projectId: input.projectId,
        kind: "voice",
      });
      const meta = collectLibVoiceMeta(libs as never);
      for (const nm of meta.names) libVoice.add(nm);
      // 撞嗓守恒跨画布+库：库里已占用的音色一并进排除集。
      for (const vid of meta.voiceIds) usedVoiceIds.add(vid);
    } catch {
      // ignore
    }
  }
  const missing = wanted.filter((nm) => !canvasVoice.has(norm(nm)) && !libVoice.has(norm(nm)));
  if (!missing.length) return { created: [] };
  // 正牌角色判定（孤儿治理）：有同名角色卡（画布/库）或=旁白 → 一等资产可入库；
  // 否则是本章龙套（围观路人/同伴甲…）→ 卡只落画布供本章念白，不进项目库。
  const canvasCharNamesForVoice = new Set(
    nodes.map((n) => norm(nodeCharacterCardName(n as Record<string, unknown>))).filter(Boolean),
  );
  const libCharNames = new Set<string>();
  if (input.projectId) {
    try {
      const libChars = await listProjectNodeAssetsForOwner(input.c, input.userId, {
        projectId: input.projectId,
        kind: "character",
      });
      for (const a of libChars as Array<{ latestVersion?: { data?: unknown } }>) {
        const nm = libraryCharacterCardName(a);
        if (nm) libCharNames.add(norm(nm));
      }
    } catch {
      // ignore
    }
  }
  const voiceCatalog = await listDoubaoSeedAudioVoices(input.c).catch(() => []);
  const createNodes: Array<Record<string, unknown>> = [];
  const created: Array<{ character: string; voiceLabel: string }> = [];
  let px = 1700;
  for (const role of missing) {
    let voiceId = "";
    let fallbackVoiceLabel = "";
    const genderHint = characterGenderHintFromCards(nodes as Array<Record<string, unknown>>, role);
    const profileText = `${role} ${genderHint}`;
    if (voiceCatalog.length) {
      const gender = inferCharacterGender(profileText);
      voiceId = autoPickVoiceId(voiceCatalog, {
        ...(gender ? { gender } : {}),
        seedName: role,
        excludeIds: usedVoiceIds,
        profileText,
      });
    }
    if (!voiceId) {
      const fb = pickVoiceForRole(role, genderHint, usedVoiceIds);
      voiceId = fb.voiceId;
      fallbackVoiceLabel = fb.voiceLabel;
    }
    if (voiceId) usedVoiceIds.add(voiceId);
    const display = voiceCardDisplayFields(role, voiceId, voiceCatalog, fallbackVoiceLabel);
    const voiceLabel = display.voiceLabel;
    const isEphemeral =
      norm(role) !== norm("旁白") &&
      !canvasCharNamesForVoice.has(norm(role)) &&
      !libCharNames.has(norm(role));
    const nodeId = `voicecard-selfheal-${stableHash(role).toString(36)}`;
    const nodeData: Record<string, unknown> = {
      kind: "audio",
      audioType: "voice_card",
      voiceCharacter: role,
      roleName: role,
      doubaoVoiceId: voiceId,
      voiceLabel,
      audioModel: "doubao-seed-audio-1-0",
      ...(await synthVoiceCardPreviewFields(input.c, input.userId, role, voiceId)),
      label: display.label,
      status: "success",
      autoSelfHealed: true,
      ...(isEphemeral ? { ephemeralSpeaker: true } : {}),
    };
    createNodes.push({ id: nodeId, type: "taskNode", position: { x: px, y: 900 }, data: nodeData });
    try {
      await maybeAutoRegisterVoiceCard({
        c: input.c,
        userId: input.userId,
        nodeData,
        nodeId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(input.flowId ? { flowId: input.flowId } : {}),
      });
    } catch {
      // best-effort
    }
    created.push({ character: role, voiceLabel });
    px += 360;
  }
  if (createNodes.length) {
    try {
      await persistFlowPatch({
        c: input.c,
        row,
        flowId: input.flowId,
        requestUserId: input.userId,
        devBypass: true,
        patch: { createNodes } as never,
        affectedNodeIds: createNodes.map((n) => String(n.id)),
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      });
    } catch (e) {
      console.warn(
        `[asset-selfheal] progressive voice-card flow_patch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { created: [] };
    }
  }
  return { created };
}

type LibraryVoiceAsset = {
  id?: unknown;
  name?: unknown;
  latestVersion?: { id?: unknown; data?: unknown } | null;
};

export type LibraryVoiceCardProjectionPlan = {
  createNodes: Array<Record<string, unknown>>;
  projected: string[];
  missing: string[];
};

/**
 * 把项目素材库中的真实配音卡转换为章节画布节点。这里只搬运已存在的 voiceId 与卡字段，
 * 不选择默认音色、不合成试听音频，也不制造缺失字段。相同角色若存在多个不同 voiceId，
 * 说明素材真相冲突，必须显式失败，不能按查询顺序任选一张。
 */
export function buildLibraryVoiceCardProjectionPlan(input: {
  nodes: Array<Record<string, unknown>>;
  libraryAssets: LibraryVoiceAsset[];
  roleNames: string[];
}): LibraryVoiceCardProjectionPlan {
  const wanted = [...new Set(input.roleNames.map((role) => String(role ?? "").trim()).filter(Boolean))];
  const canvasVoiceNames = new Set<string>();
  for (const node of input.nodes) {
    const card = readVoiceCardProfile(node as FlowNodeLike);
    if (card?.character && card.voiceId) canvasVoiceNames.add(card.character.trim());
  }

  const createNodes: Array<Record<string, unknown>> = [];
  const projected: string[] = [];
  const missing: string[] = [];
  let px = 1700;
  for (const role of wanted) {
    const roleKey = foldName(role);
    if (canvasVoiceNames.has(role)) continue;
    const candidates = input.libraryAssets
      .map((asset) => {
        const assetId = String(asset.id ?? "").trim();
        const assetName = String(asset.name ?? "").trim();
        const data =
          asset.latestVersion?.data &&
          typeof asset.latestVersion.data === "object" &&
          !Array.isArray(asset.latestVersion.data)
            ? (asset.latestVersion.data as Record<string, unknown>)
            : {};
        const voiceId = String(data.doubaoVoiceId ?? "").trim();
        return { asset, assetId, assetName, data, voiceId };
      })
      .filter(
        (candidate) =>
          candidate.assetId &&
          candidate.voiceId &&
          foldName(candidate.assetName) === roleKey,
      );
    const distinctVoiceIds = new Set(candidates.map((candidate) => candidate.voiceId));
    if (distinctVoiceIds.size > 1) {
      throw new Error(
        `library_voice_card_ambiguous: 说话人「${role}」在项目素材库命中 ${distinctVoiceIds.size} 个不同 voiceId`,
      );
    }
    const candidate = candidates
      .slice()
      .sort((left, right) => left.assetId.localeCompare(right.assetId))[0];
    if (!candidate) {
      missing.push(role);
      continue;
    }

    const voiceLabel = String(candidate.data.voiceLabel ?? "").trim();
    const sourceVersionId = String(candidate.asset.latestVersion?.id ?? "").trim();
    const nodeId = `voicecard-library-${stableHash(`${roleKey}:${candidate.assetId}`).toString(36)}`;
    createNodes.push({
      id: nodeId,
      type: "taskNode",
      position: { x: px, y: 900 },
      data: {
        ...candidate.data,
        kind: "audio",
        audioType: "voice_card",
        voiceCharacter: role,
        roleName: role,
        doubaoVoiceId: candidate.voiceId,
        ...(voiceLabel ? { voiceLabel } : {}),
        label:
          String(candidate.data.label ?? "").trim() ||
          `配音卡｜${role}${voiceLabel ? `·${voiceLabel}` : ""}`,
        materialAssetId: candidate.assetId,
        ...(sourceVersionId ? { materialAssetVersionId: sourceVersionId } : {}),
        materialSourceName: candidate.assetName,
        materializedFromLibrary: true,
      },
    });
    projected.push(role);
    canvasVoiceNames.add(role);
    px += 360;
  }
  return { createNodes, projected, missing };
}

/**
 * 将当前项目素材库里已有、但章节画布缺失的配音卡投影到画布。authoring 与 production drive
 * 共用这条路径，随后都只从画布解析 voice binding，避免 coverage 与 runtime 使用不同真相源。
 * 读取、映射、持久化任一步失败都会向上抛出，由状态机原地记录失败。
 */
export async function flowPatchMissingVoiceCardsFromLibrary(input: {
  c: AppContext;
  userId: string;
  flowId: string;
  chapterId?: string;
  projectId: string | null;
  roleNames: string[];
  devBypass: boolean;
}): Promise<{ patched: string[]; missing: string[]; row: FlowRow }> {
  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.userId,
    devBypass: input.devBypass,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const nodes = parseFlowNodes(row);
  const canvasOnlyPlan = buildLibraryVoiceCardProjectionPlan({
    nodes,
    libraryAssets: [],
    roleNames: input.roleNames,
  });
  if (!canvasOnlyPlan.missing.length) {
    return { patched: [], missing: [], row };
  }
  const libraryAssets = input.projectId
    ? await listProjectNodeAssetsForOwner(input.c, input.userId, {
        projectId: input.projectId,
        kind: "voice",
      })
    : [];
  const plan = buildLibraryVoiceCardProjectionPlan({
    nodes,
    libraryAssets,
    roleNames: input.roleNames,
  });
  if (!plan.createNodes.length) {
    return { patched: [], missing: plan.missing, row };
  }
  const persisted = await persistFlowPatch({
    c: input.c,
    row,
    flowId: input.flowId,
    requestUserId: input.userId,
    devBypass: input.devBypass,
    patch: { createNodes: plan.createNodes },
    affectedNodeIds: plan.createNodes.map((node) => String(node.id)),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const verifiedVoiceNames = new Set<string>();
  for (const node of parseFlowNodes(persisted.row)) {
    const card = readVoiceCardProfile(node as FlowNodeLike);
    if (card?.character && card.voiceId) verifiedVoiceNames.add(card.character.trim());
  }
  const unverified = plan.projected.filter((role) => !verifiedVoiceNames.has(role));
  if (unverified.length) {
    throw new Error(`library_voice_card_projection_unverified: ${unverified.join("、")}`);
  }
  return { patched: plan.projected, missing: plan.missing, row: persisted.row };
}

/**
 * 起跑前资产自愈（异步·检测纠正）：
 *  ① 说话角色缺配音卡（画布无 + 库无）→ 建 audioType=voice_card 音频节点落画布 + 入库 kind=voice（成对·按名音色绑定）。
 *  ② ≥3人同框缺群像图 → 收集缺口 clipIndex 交调用方处理。
 * 角色卡与场景卡不在 Hono 自愈：缺口必须返回 agents-cli，由 tapcanvas-character-card /
 * tapcanvas-scene-card 单轨使用 canonical ID 创建或复用。
 */
export async function selfHealOrchestrateAssets(input: {
  c: AppContext;
  userId: string;
  flowId: string;
  chapterId?: string;
  row: FlowRow;
  plan: StoryPlan;
  projectId: string | null;
}): Promise<SelfHealResult> {
  const result: SelfHealResult = {
    createdVoiceCards: [],
    patchedEnsembleCards: [],
    patchedPropCards: [],
    ensembleGapClips: [],
    speakerCardGapClips: [],
  };
  const nodes = parseFlowNodes(input.row);
  // 收集所有要新建的节点，最后**一次** persistFlowPatch 落盘（避免逐个写：flow 模式下 persistFlowPatch
  // 用传入的 stale row → 逐个写会互相覆盖丢节点；且一次写比 N 次写更抗前端并发覆盖）。
  const createNodes: Array<Record<string, unknown>> = [];

  // ── ① 配音卡自愈 ──────────────────────────────────────────────
  const speakingRoles = collectSpeakingRoles(input.plan);
  if (speakingRoles.length) {
    const canvasVoiceChars = new Set<string>();
    // 撞嗓查重（与 buildVoiceCardsForRoles 同纪律）：已占用音色进排除集，一角色一把嗓。
    const usedVoiceIds = new Set<string>();
    for (const n of nodes) {
      const card = readVoiceCardProfile(n as FlowNodeLike);
      if (card?.character) canvasVoiceChars.add(norm(card.character));
      if (card?.voiceId) usedVoiceIds.add(card.voiceId);
    }
    // 库里已有的配音卡（跨章复用同一把嗓）；其已占用音色一并进排除集（撞嗓守恒跨画布+库）。
    const libVoiceChars = new Set<string>();
    if (input.projectId) {
      try {
        const libVoices = await listProjectNodeAssetsForOwner(input.c, input.userId, {
          projectId: input.projectId,
          kind: "voice",
        });
        const meta = collectLibVoiceMeta(libVoices as never);
        for (const nm of meta.names) libVoiceChars.add(nm);
        for (const vid of meta.voiceIds) usedVoiceIds.add(vid);
      } catch {
        // ignore
      }
    }
    // 正牌角色判定（孤儿治理）：cast（plan characterRoleNames）∪ 同名角色卡（画布/库）∪ 旁白。
    const legitVoiceRoles = new Set<string>([norm("旁白")]);
    for (const n of nodes) {
      const rn = norm(nodeCharacterCardName(n as Record<string, unknown>));
      if (rn) legitVoiceRoles.add(rn);
    }
    for (const clip of input.plan.clips ?? []) {
      const rns = (clip as { characterRoleNames?: unknown }).characterRoleNames;
      if (Array.isArray(rns)) for (const r of rns) legitVoiceRoles.add(norm(String(r ?? "")));
    }
    if (input.projectId) {
      try {
        const libChars = await listProjectNodeAssetsForOwner(input.c, input.userId, {
          projectId: input.projectId,
          kind: "character",
        });
        for (const a of libChars as Array<{ latestVersion?: { data?: unknown } }>) {
          const nm = libraryCharacterCardName(a);
          if (nm) legitVoiceRoles.add(norm(nm));
        }
      } catch {
        // ignore
      }
    }
    // 真实豆包音色目录（与 VOICE_CARD_AUTO_DUB 同源）：画像评分匹配挑嗓，
    // 保证自愈建的卡与既有配音卡口径一致（同角色同一把嗓·不硬编码 id·目录下线也不会挑到哑 id）。
    const voiceCatalog = await listDoubaoSeedAudioVoices(input.c).catch(() => []);
    let px = 1700;
    for (const role of speakingRoles) {
      const key = norm(role);
      if (canvasVoiceChars.has(key) || libVoiceChars.has(key)) continue; // 已有卡·跳过
      let voiceId = "";
      let fallbackVoiceLabel = "";
      const genderHint = characterGenderHintFromCards(nodes as Array<Record<string, unknown>>, role);
      const profileText = `${role} ${genderHint}`;
      if (voiceCatalog.length) {
        const gender = inferCharacterGender(profileText);
        voiceId = autoPickVoiceId(voiceCatalog, {
          ...(gender ? { gender } : {}),
          seedName: role,
          excludeIds: usedVoiceIds,
          profileText,
        });
      }
      if (!voiceId) {
        // 目录取不到（未配 AK/SK 等）→ 兜底本地策展池（同样排重）。
        const fb = pickVoiceForRole(role, genderHint, usedVoiceIds);
        voiceId = fb.voiceId;
        fallbackVoiceLabel = fb.voiceLabel;
      }
      if (voiceId) usedVoiceIds.add(voiceId);
      const display = voiceCardDisplayFields(role, voiceId, voiceCatalog, fallbackVoiceLabel);
      const voiceLabel = display.voiceLabel;
      const isEphemeral = !legitVoiceRoles.has(key);
      const nodeId = `voicecard-selfheal-${stableHash(role).toString(36)}`;
      const finalNodeData: Record<string, unknown> = {
        kind: "audio",
        audioType: "voice_card",
        voiceCharacter: role,
        roleName: role,
        doubaoVoiceId: voiceId,
        voiceLabel,
        audioModel: "doubao-seed-audio-1-0",
        ...(await synthVoiceCardPreviewFields(input.c, input.userId, role, voiceId)),
        label: display.label,
        status: "success",
        autoSelfHealed: true,
        ...(isEphemeral ? { ephemeralSpeaker: true } : {}),
      };
      createNodes.push({ id: nodeId, type: "taskNode", position: { x: px, y: 900 }, data: finalNodeData });
      // 入库（跨章复用）独立于画布写·best-effort。
      try {
        await maybeAutoRegisterVoiceCard({
          c: input.c,
          userId: input.userId,
          nodeData: finalNodeData,
          nodeId,
          ...(input.chapterId ? { chapterId: input.chapterId } : {}),
          ...(input.flowId ? { flowId: input.flowId } : {}),
        });
      } catch (e) {
        console.warn(
          `[asset-selfheal] voice card register ${role} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      result.createdVoiceCards.push({ character: role, voiceLabel });
      px += 360;
    }
  }

  // ── ②c 道具/法宝库卡落画布（2026-07-16 用户「视频生成前找到对应资产」补齐）───────
  // 与 ②角色卡 / ②b群像图 完全对等：库里有卡但没落画布 → 按名取不到 → 模型重新脑补造型
  // （混元金斗三章三个设计＝同一病根）。只落「本片申报了 propNames 且画布上确实没卡」的，
  // 库里也没有的真缺口不在这里造图（不自动烧钱，与群像图口径一致）。
  const missingProps = collectMissingPropNames(input.plan, nodes);
  if (missingProps.length && input.projectId) {
    try {
      const libProps = (await listProjectNodeAssetsForOwner(input.c, input.userId, {
        projectId: input.projectId,
        kind: "prop",
      })) as Array<{ name?: unknown; latestVersion?: { data?: unknown } }>;
      let px = 200;
      for (const nm of missingProps) {
        // 繁简折叠比对：简体申报 ↔ 繁体库卡（书源）必须对上，否则查不到 → 白白重画。
        const lib = libProps.find((a) => foldName(String(a?.name ?? "")) === foldName(nm));
        const data = (lib?.latestVersion?.data ?? {}) as Record<string, unknown>;
        const imageUrl = String(data.imageUrl ?? "").trim();
        if (!lib || !imageUrl) continue; // 库里也没有/无图 → 真缺口，交绑定层告警，不在这造图
        const canonical = String(lib.name ?? nm).trim();
        const nodeId = `prop-selfheal-${stableHash(canonical).toString(36)}`;
        createNodes.push({
          id: nodeId,
          type: "taskNode",
          position: { x: px, y: 1500 },
          data: {
            kind: "image",
            productionLayer: "anchors",
            // referenceType=prop 是机器字段，classifyCanvasCardForRegistry 显式优先于 label 猜测。
            referenceType: "prop",
            label: `道具卡｜${canonical}`,
            imageUrl,
            status: "success",
            autoSelfHealed: true,
          },
        });
        result.patchedPropCards.push(canonical);
        px += 320;
      }
      if (result.patchedPropCards.length) {
        console.log(
          `[asset-selfheal] 道具库卡落画布: ${result.patchedPropCards.join("、")}`,
        );
      }
    } catch (e) {
      console.warn(
        `[asset-selfheal] list library props failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── ②b 群像图库卡落画布（2026-07-10 ch11 实测补齐·与角色卡「库卡落画布」对等）──────
  // 病根：detectEnsembleGaps/autoBindEnsembleRefs 只认**当前画布**上的群像节点——设定库里明明有
  // 前章沉淀的同批群像（ch10「镜·陰穢群怪围困」），因没落画布被判「缺」→ 旧硬闸曾拦 start 逼重画
  //（用户：「群像卡为什么丢了？」）。统一项目资产方案：群像也按「库卡落画布+就近复用」自愈，
  // 这里只记录真缺口（库里也没有的）供诊断/同链修订。匹配判据与画布 autoBindEnsembleRefs 同构：
  // participants 与该段 characterRoleNames 交集最大者胜出，并列取 updatedAt 最新。
  const canvasEnsembleCandidates: EnsembleCandidate[] = [];
  for (const n of nodes) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const isEnsemble =
      String(d.referenceType ?? "").toLowerCase() === "ensemble" ||
      /群像/.test(String(d.label ?? ""));
    if (!isEnsemble) continue;
    const id = String((n as { id?: unknown }).id ?? "").trim();
    if (!id) continue;
    canvasEnsembleCandidates.push({
      id,
      label: String(d.label ?? ""),
      roleNames: Array.isArray(d.characterRoleNames)
        ? (d.characterRoleNames as unknown[]).map((r) => String(r ?? "").trim()).filter(Boolean)
        : [],
      hasMedia: /^https?:\/\//.test(String(d.imageUrl ?? "")),
    });
  }
  const preGaps = detectEnsembleGaps(input.plan, new Set(canvasEnsembleCandidates.map((c) => c.id)));
  if (preGaps.length && input.projectId) {
    try {
      const libEnsembles = (await listProjectNodeAssetsForOwner(input.c, input.userId, {
        projectId: input.projectId,
        kind: "ensemble",
      })) as Array<{
        name?: unknown;
        updatedAt?: unknown;
        latestVersion?: { data?: unknown };
      }>;
      // 收集缺口段的角色名，用于挑最匹配的库群像。
      const gapRoles = new Set<string>();
      for (const gi of preGaps) {
        const clip = (input.plan.clips ?? [])[gi] as { characterRoleNames?: unknown[] } | undefined;
        for (const r of Array.isArray(clip?.characterRoleNames) ? clip.characterRoleNames : []) {
          const nm = String(r ?? "").trim();
          if (nm) gapRoles.add(nm);
        }
      }
      const scored = libEnsembles
        .map((a) => {
          const data = (a?.latestVersion?.data ?? {}) as Record<string, unknown>;
          const imageUrl = String(data.imageUrl ?? "").trim();
          const participants = Array.isArray(data.ensembleParticipants)
            ? (data.ensembleParticipants as unknown[]).map((r) => String(r ?? "").trim()).filter(Boolean)
            : [];
          const name = String(a?.name ?? "").trim();
          let overlap = participants.filter((p) => gapRoles.has(p)).length;
          if (!overlap && name) {
            overlap = [...gapRoles].some((r) => r.length >= 2 && name.includes(r)) ? 1 : 0;
          }
          const ts = Date.parse(String(a?.updatedAt ?? "")) || 0;
          return { name, imageUrl, participants, overlap, ts };
        })
        .filter((s) => s.imageUrl && s.overlap > 0)
        .sort((x, y) => y.overlap - x.overlap || y.ts - x.ts);
      // 并列不绑（2026-07-10 边界修）：top 与次名 overlap 打平＝按 updatedAt 裁决太弱，可能把
      // 「操场同学四人」（含主角）绑进洪荒邪物群镜（跨题材串卡）。只有唯一最优才自动落卡，
      // 并列不自动绑定，记录候选让导演或 agents 选择/新建；不把不确定性升级为任务阻断。
      const pick =
        scored.length && (scored.length === 1 || scored[0].overlap > scored[1].overlap)
          ? scored[0]
          : null;
      if (!pick && scored.length > 1) {
        console.log(
          `[asset-selfheal] 群像库卡并列候选不自动绑（${scored
            .slice(0, 3)
            .map((s) => `${s.name}:overlap=${s.overlap}`)
            .join("、")}）→ 保留候选诊断，由导演或 agents 定`,
        );
      }
      if (pick) {
        const nodeId = `ensemble-selfheal-${stableHash(pick.name).toString(36)}`;
        createNodes.push({
          id: nodeId,
          type: "taskNode",
          position: { x: 200, y: 1200 },
          data: {
            kind: "image",
            productionLayer: "anchors",
            referenceType: "ensemble",
            label: /^群像/.test(pick.name) ? pick.name : `群像图｜${pick.name}`,
            imageUrl: pick.imageUrl,
            ...(pick.participants.length ? { characterRoleNames: pick.participants } : {}),
            status: "success",
            autoSelfHealed: true,
          },
        });
        canvasEnsembleCandidates.push({
          id: nodeId,
          label: pick.name,
          roleNames: pick.participants,
          hasMedia: true,
        });
        result.patchedEnsembleCards.push(pick.name);
        console.log(
          `[asset-selfheal] 群像库卡落画布并绑缺口段: ${pick.name} → 段${preGaps.map((i) => i + 1).join("/")}`,
        );
      }
    } catch (e) {
      console.warn(
        `[asset-selfheal] list library ensembles failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // 把（含刚落画布的）群像候选绑进仍缺绑的段（原地 mutate plan.clips 的 videoReferenceNodeIds）。
  if (canvasEnsembleCandidates.length) {
    autoBindEnsembleRefs(input.plan.clips ?? [], canvasEnsembleCandidates);
  }

  // ── 一次性落盘所有新建节点（章节模式 persistChapterCanvasPatch 内部 fresh-read+乐观重试；
  //    flow 模式一次写避免 stale-row 逐个覆盖）。失败只 warn，不阻断起跑。 ──
  if (createNodes.length) {
    try {
      await persistFlowPatch({
        c: input.c,
        row: input.row,
        flowId: input.flowId,
        requestUserId: input.userId,
        devBypass: true,
        patch: { createNodes } as never,
        affectedNodeIds: createNodes.map((n) => String(n.id)),
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      });
    } catch (e) {
      console.warn(
        `[asset-selfheal] persist ${createNodes.length} nodes failed (不阻断起跑): ${e instanceof Error ? e.message : String(e)}`,
      );
      // 画布写失败不清空 result：配音卡已入库(跨章 fallback 仍能绑)，只是画布没落上。
    }
  }

  // ── ③ 群像图缺口（非阻塞诊断）────────────────────────────
  // ②b 已把库群像落画布并 autoBind 绑进缺口段——这里只剩「画布无+库无（或匹配不上）」的候选缺口。
  result.ensembleGapClips = detectEnsembleGaps(
    input.plan,
    new Set(canvasEnsembleCandidates.map((c) => c.id)),
  );

  // ── ④ 说话人角色卡缺口（只认 character-card/v3 的结构化真实资产）────────
  // 本模块不再创建或物化角色卡；缺口必须回到 agents-cli 的角色卡单轨修复。
  const knownCharacterNames = collectKnownCharacterCardNames(nodes);
  result.speakerCardGapClips = detectSpeakerCharacterCardGaps(input.plan, knownCharacterNames);

  return result;
}
