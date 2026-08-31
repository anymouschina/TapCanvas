// 【clip 结构诊断】确定性识别"欠拆镜"——一条 clip 塞了一整张多格设计板（多个独立镜头节拍 +
// 多句对白 + 远超模型单镜上限的时长）。根治 ch1051：22 个节拍只用 5 条 clip、单镜 5 句对白、规划 36s
// 被 snapToNearestOption 静默砍成 15s 后更挤。三道确定性判据，任一超标即拒绝起跑（与现有
// clip_dialogue_overflow 同款机制：start 前 ok:false、不计费、退回让导演按格拆成多条 clip）。
//
// 注：本闸只数「确定性可见的结构信号」（显式时长 / 引号对白句数 / 显式节拍枚举），不靠模型自觉。
// 续写链/montage 自动拆段路径下没有显式 durationSeconds 的 clip 不触发时长判据（那条路按档位天然 ≤ 上限）。
// 结果只用于 diagnostics 与同链创作修订，不得阻止起跑、提交、持久化或交付。

import type { StoryPlan, StoryPlanClip } from "./video-orchestrator.orchestrate";
import { countClipDialogueLines } from "./video-orchestrator.dialogue-capacity";

/** 单条 clip 最多承载几句独立对白（超出=一镜塞太多来回→必拆）。 */
export const DEFAULT_MAX_DIALOGUE_LINES = 2;
/** 单条 clip 显式时长上限（秒）：当前 seedance/pixverse 单镜均 ≤ ~15s，超出=规划脱离模型能力、会被静默砍。 */
export const DEFAULT_MAX_CLIP_DURATION_SEC = 15;
/** 单条 clip 最多承载几个显式节拍枚举（"按设计板 N 格连续演出 / 01 02 03 …"）。超出=把整张多格板塞一条 clip。 */
export const DEFAULT_MAX_CLIP_BEATS = 3;

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function resolveMaxClipDuration(env: unknown): number {
  const raw = Number(
    ((env as Record<string, unknown>)?.VIDEO_CLIP_MAX_DURATION_SEC ??
      globalThis.process?.env?.VIDEO_CLIP_MAX_DURATION_SEC ??
      NaN) as number,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CLIP_DURATION_SEC;
}

/**
 * 数一条 clip 描述了几个独立节拍：取「N 格连续演出」的 N 与「01 02 03 …」枚举标记数的较大者。
 * 这是确定性文本信号（导演自己在 prompt 里写的分格/枚举），不是语义判断。
 */
export function countClipBeats(clip: StoryPlanClip): number {
  const text = String(clip.clipPrompt || "");
  let gridN = 0;
  // 只取紧贴"格"前的计数（CN 或 阿拉伯数字，二选一不混用，避免把设计板编号"04"和"五格"连成"04五"）。
  const grid = text.match(/([一二三四五六七八九十]+|\d+)\s*格(?:连续|分镜|演出)/);
  if (grid) {
    const tok = grid[1];
    gridN = /^\d+$/.test(tok) ? Number(tok) : (CN_NUM[tok] ?? 0);
  }
  // 枚举节拍标记：行内 "01 " "02 " … 或 "①②③"（取去重计数）
  const enumMarkers = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^0-9])(0[1-9])(?=[\s、：:])/g)) enumMarkers.add(m[1]);
  for (const m of text.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩]/g)) enumMarkers.add(m[0]);
  return Math.max(gridN, enumMarkers.size);
}

export type ClipStructureViolation = {
  index: number;
  dialogueLines: number;
  durationSeconds: number | null;
  beats: number;
  reasons: string[];
};

export function findClipStructureViolations(
  plan: Pick<StoryPlan, "clips">,
  opts: { maxDuration: number; maxDialogueLines?: number; maxBeats?: number },
): ClipStructureViolation[] {
  const maxDialogueLines = opts.maxDialogueLines ?? DEFAULT_MAX_DIALOGUE_LINES;
  const maxBeats = opts.maxBeats ?? DEFAULT_MAX_CLIP_BEATS;
  const out: ClipStructureViolation[] = [];
  (plan.clips ?? []).forEach((clip, index) => {
    if ((clip as { structureReviewed?: boolean }).structureReviewed === true) return;
    const reasons: string[] = [];
    const dialogueLines = countClipDialogueLines(clip);
    const beats = countClipBeats(clip);
    const durRaw = (clip as { durationSeconds?: number }).durationSeconds;
    const durationSeconds = typeof durRaw === "number" && durRaw > 0 ? durRaw : null;

    if (durationSeconds !== null && durationSeconds > opts.maxDuration) {
      reasons.push(
        `规划时长 ${durationSeconds}s 超过单镜上限 ${opts.maxDuration}s（会被静默砍档、内容更挤）→ 按节拍拆成多条 ≤${opts.maxDuration}s 的 clip`,
      );
    }
    if (dialogueLines > maxDialogueLines) {
      reasons.push(
        `${dialogueLines} 句独立对白 > ${maxDialogueLines}（一镜塞太多来回，配不出/糊）→ 拆成同场景连续多镜，每镜 ≤${maxDialogueLines} 句、按序念全`,
      );
    }
    if (beats > maxBeats) {
      reasons.push(
        `承载 ${beats} 个独立节拍 > ${maxBeats}（把一整张多格设计板塞进一条 clip = 欠拆镜）→ 按格拆成多条 clip（一格/一节拍一条）`,
      );
    }
    if (reasons.length > 0) {
      out.push({ index, dialogueLines, durationSeconds, beats, reasons });
    }
  });
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 【共享桥接帧·双参考】(2026-06-22 用户拍板·零运行时尾帧的跨镜连续动作)
//
// 默认走故事板独立并发(cut)：每镜锚自己的多机位关键帧、clipPrompt 状态接力，镜间无依赖→并发。
// 唯一例外：单一连续动作(长跑/长镜运动)单镜上限(~15s)装不下、必须跨镜当一个连续运动时——
// 在故事板阶段【预生成】一张「桥接帧」，让前镜 lastFrameImageNodeId === 后镜 storyboardImageNodeId
// (指向同一张预生成图节点)。这样：① 两镜在桥接帧处严丝合缝咬合；② 桥接帧是预生成图、两镜都【提前】
// 拿到 → cut 仍可并发(不必等上一镜跑完抽运行时尾帧)；③ 非 re-encode 运行时尾帧 → 不累积漂移
// (规避 2026-06-22 否掉运行时尾帧续写的全部理由)。
//
// 本模块只做【确定性识别 + 提示词补强】：识别桥接对、给前/后镜注入「同一连续动作继续/收束到桥接帧」
// 的提示词。识别靠节点 id 相等(=导演有意声明)，不靠 URL，故与「逐镜板自动关键帧」(各镜不同板)无冲突。
// ───────────────────────────────────────────────────────────────────────────

export type BridgeFrameRole = {
  /** 本镜尾帧=与「下一镜」共享的桥接帧（本镜是连续动作的前半段）。 */
  isBridgeTail: boolean;
  /** 本镜首帧=与「上一镜」共享的桥接帧（本镜是连续动作的后半段）。 */
  isBridgeHead: boolean;
};

const trimmedId = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * 逐 clip 判定其在「桥接帧对」中的角色。桥接对 = 相邻两镜共享同一张预生成桥接帧节点：
 * 前镜 `lastFrameImageNodeId` === 后镜 `storyboardImageNodeId`（均非空）。
 * 纯函数、无 IO，便于单测。
 */
export function detectBridgeFrameRoles(
  clips: ReadonlyArray<
    Pick<
      StoryPlanClip,
      "continuityMode" | "storyboardImageNodeId" | "lastFrameImageNodeId"
    >
  >,
): BridgeFrameRole[] {
  return clips.map((clip, i) => {
    const next = clips[i + 1];
    const prev = clips[i - 1];
    const tail = trimmedId(clip.lastFrameImageNodeId);
    const head = trimmedId(clip.storyboardImageNodeId);
    const isBridgeTail = Boolean(
      next &&
        next.continuityMode === "bridge_frames" &&
        tail &&
        trimmedId(next.storyboardImageNodeId) === tail,
    );
    const isBridgeHead = Boolean(
      clip.continuityMode === "bridge_frames" &&
        prev &&
        head &&
        trimmedId(prev.lastFrameImageNodeId) === head,
    );
    return { isBridgeTail, isBridgeHead };
  });
}

/**
 * 给桥接对的前/后镜构建「同一连续动作跨镜咬合」的提示词补强；非桥接镜返回空串。
 * - 后半段镜(isBridgeHead)：从共享桥接帧【继续】上一镜的同一连续动作（不重新起势）。
 * - 前半段镜(isBridgeTail)：结尾收束到共享桥接帧姿态、动作进行中（不稳定落幅），下一镜接演。
 */
export function buildBridgeContinuityNote(role: BridgeFrameRole): string {
  const parts: string[] = [];
  if (role.isBridgeHead) {
    parts.push(
      "本镜首帧=与上一镜共享的【桥接帧】：从该帧的姿态/运动继续上一镜的同一个连续动作（continue，绝不重新起势、不从静止重启），在桥接帧处与上一镜严丝合缝咬合，运镜可换景别/角度但动作方向与惯性连续。",
    );
  }
  if (role.isBridgeTail) {
    parts.push(
      "本镜结尾收束到与下一镜共享的【桥接帧】姿态：在动作进行中收尾、保留动作残势（不要稳定落幅定格），下一镜从该桥接帧继续同一连续动作。",
    );
  }
  return parts.join(" ");
}

/**
 * 【前情提要·确定性注入（2026-07-10 用户拍板「不要真尾帧拉长耗时，加个前情提要就行」）】
 * 渲染第 N 镜提示词时，把前面各镜 logline 拼成一段剧情语境注解——纯文字、零 LLM、零等待，
 * cut 恒并发不变。与 exitState 接力互补：exitState 管「上一镜收尾的物理状态」，前情提要管
 * 「到目前为止发生了什么」的全局剧情语境（语气/情绪/因果不再只看孤立一镜）。
 * 预算控制：从最近往前累加，单条截 48 字、总预算 ~240 字，更早的镜折叠成「（更早：镜1-镜M 略）」。
 * 防重演：明示这些都已发生，禁在本镜画出/回放任何前情画面（与 relay note 的禁重演口径一致）。
 * 首镜/无 logline 返回空串，逐字不影响存量行为。
 */
export function buildStoryRecapNote(clips: readonly unknown[], currentIndex: number): string {
  if (!Array.isArray(clips) || !Number.isInteger(currentIndex) || currentIndex <= 0) return "";
  const PER_ITEM_CHARS = 48;
  const TOTAL_BUDGET = 240;
  const entries: string[] = [];
  let used = 0;
  let earliestIncluded = currentIndex;
  for (let i = currentIndex - 1; i >= 0; i -= 1) {
    const c = (clips[i] ?? {}) as { logline?: unknown; title?: unknown };
    const raw =
      (typeof c.logline === "string" ? c.logline.trim() : "") ||
      (typeof c.title === "string" ? c.title.trim() : "");
    if (!raw) continue;
    const one = raw.replace(/\s+/g, " ").slice(0, PER_ITEM_CHARS);
    const line = `镜${i + 1}:${one}`;
    if (used + line.length > TOTAL_BUDGET && entries.length > 0) break;
    entries.unshift(line);
    used += line.length;
    earliestIncluded = i;
  }
  if (!entries.length) return "";
  const omitted = earliestIncluded > 0 ? `（更早：镜1-镜${earliestIncluded} 略）` : "";
  return (
    `【前情提要·仅剧情语境（以下均已发生，⛔禁在本镜画出/回放任何前情画面，只用于理解情绪与因果）】` +
    `${omitted}${entries.join("；")}。`
  );
}

/**
 * 【exitState 状态接力·确定性注入】渲染第 N+1 镜提示词时，把第 N 镜的 exitState 前置成
 * 承接注解——cut 并发不变（注入的是文字不是帧），把「这镜开场=上镜收尾」从自律变成机制。
 * 上镜无 exitState 返回空串，逐字不影响存量行为。
 */
export function buildExitStateRelayNote(
  prevExitState: unknown,
  opts?: {
    /**
     * 场景切换（2026-07-06 seedance-2.0 竞品调研 continuation-handoff："A scene boundary defaults
     * to intentional_next_shot... Do not promise seamless continuation across a scene boundary"）：
     * 跨场景是有意剪切点——只承接剧情与角色状态，不逼模型对齐上镜的光线/构图/姿态帧级细节。
     */
    sceneChanged?: boolean;
    /**
     * 时间跳跃说明（如「半月后」「三日后」，来自 clip.timeJumpNote·2026-07-07 ch6 复盘）：
     * 两镜之间隔了叙事时间——姿态精确连续模板是错的（ch6 实测「半月后」被套「与上镜浮水喘气
     * 姿态一致」）。只承接长期状态，残势不延续。**优先级高于 sceneChanged**（时间都跳了，
     * 环境细节自然也不对齐）。
     */
    timeJump?: string;
  },
): string {
  const s = typeof prevExitState === "string" ? prevExitState.trim() : "";
  if (!s) return "";
  const timeJump = typeof opts?.timeJump === "string" ? opts.timeJump.trim() : "";
  if (timeJump) {
    return (
      `【承接上镜（时间跳跃：${timeJump}）】上镜结束时：${s}。本镜与上镜之间已隔「${timeJump}」——` +
      `只承接剧情事实与角色的长期状态（修为境界/伤况愈合程度/关系/持有物/服装造型的持续变化），` +
      `不对齐上镜的姿态、位置、光线与未完成动作（时间已过，动作早已结束、残势不延续），` +
      `从本镜镜头表自身的开场状态起画。禁止重演/回放上镜已发生的动作与事件，也禁止提前演出后续拍点。`
    );
  }
  if (opts?.sceneChanged) {
    return (
      `【承接上镜（场景已切换）】上镜结束时：${s}。本镜是切至新场景的剪辑点——从本镜场景卡与角色卡重新开画，` +
      `只承接剧情进展与角色的身体/情绪/道具状态（伤况/持物/情绪延续），不必对齐上镜的光线、构图或姿态细节。` +
      `禁止重演/回放上镜已发生的动作与事件，也禁止把上镜场景的环境元素带进本镜。`
    );
  }
  // 2026-07-06 防重演措辞（ch2 实测：模型把承接描述当剧情演一遍→相邻两段开头几秒重复上镜结尾）：
  // 明确「既成状态」语义 + 允许换机位视角（各段并发独立生成，衔接只在状态层不在画面层）。
  // 2026-07-17 ch1 补条款（视线反打镜实证）：承接态点名的角色若本镜镜头表未拍到（镜头顺视线
  // 转向他处），旧措辞「人物位置/姿态与此一致」会被读成「把他们保持在画面里」→ 模型硬塞不该
  // 入画的角色。明确承接只约束【入画角色】与世界状态，不入画的只存在于画外。
  return (
    `【承接上镜退出态】${s}——这是本镜开场的既成状态：人物位置/姿态/视线/手中道具/伤况/光线与此一致，` +
    `画面从该状态直接向前推进新剧情（含上镜收尾时未完成的运动残势：谁在往哪动、镜头在做什么运动，顺势续推）。` +
    `禁止重演/回放上镜已发生的动作与事件（上镜已完成的走位/施法/爆发/台词不得再演一遍）。` +
    `机位与视角允许与上镜不同（换角度拍同一现场），不要重置状态、不要让人物凭空出现或消失。` +
    `承接态里被点名、但本镜镜头表没有拍到的角色＝镜头已转离他们：他们留在画外原位即可，` +
    `禁止为满足承接把不入画的角色硬塞进本镜画面。`
  );
}

/** 构建 clip 结构拦截文案；无违规返回 null。 */
export function buildClipStructureBlockMessage(
  plan: Pick<StoryPlan, "clips">,
  opts: { maxDuration: number; maxDialogueLines?: number; maxBeats?: number },
): string | null {
  const violations = findClipStructureViolations(plan, opts);
  if (!violations.length) return null;
  const lines = violations.map((v) => `· clip${v.index}: ${v.reasons.join("；")}`);
  return (
    `拒绝起跑：clip 结构欠拆镜（把多个独立镜头节拍/多句对白/超时长塞进一条 clip → 欠拆、对白丢、PPT 化，ch1051 实测）。\n` +
    lines.join("\n") +
    `\n修法：一个连续节拍 ↔ 一条 clip；一张多格设计板若各格是不同机位/不同角色对白的独立镜头，按格拆成多条 clip（一格一条），` +
    `每条 ≤ 单镜上限、对白 ≤${opts.maxDialogueLines ?? DEFAULT_MAX_DIALOGUE_LINES} 句。与「镜数=节拍数」一致——节拍多就 clip 多。` +
    `改完重新 start；确属有意的连续 match-cut 长镜给该 clip 标 structureReviewed:true 豁免。`
  );
}

/**
 * 【承接模板的场景判定·显式字段优先（2026-07-07 ch6 复盘）】旧逻辑只从 videoReferenceNodeIds ∩
 * 场景类节点推导两镜是否同场景——场景卡绑错（ch6 clip2 潭底戏绑了水面场景卡）会连带把承接模板
 * 也带错。clip 显式声明 sceneCardNodeId 时以声明为准（两镜都声明才生效）；任一缺省回退推导值。
 * 纯函数、无 IO。
 */
export function resolveRelaySceneChanged(input: {
  prevSceneCardNodeId?: string | null;
  currSceneCardNodeId?: string | null;
  /** 旧路径的推导结果（场景类参考节点集合无交集）。 */
  inferredChanged: boolean;
}): boolean {
  const prev = String(input.prevSceneCardNodeId ?? "").trim();
  const curr = String(input.currSceneCardNodeId ?? "").trim();
  if (prev && curr) return prev !== curr;
  return input.inferredChanged;
}
