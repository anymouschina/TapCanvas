// 【对白容量诊断】检查镜头时长是否装得下该镜的口播对白——按"电视电影自然语速 ≈5 字/秒"
// 反推每镜下限，而不是"固定 2s 一镜"或自动均匀拆段把长对白塞进短镜念不完。
//
// 背景（用户定调 2026-06-14）：设计故事板时镜长要由【对白字数】决定，不是拍脑袋固定时长。
// 电视电影自然念白 ~5 字/秒（快讯播报 ~6、抒情慢镜 ~3~4），取 5 作硬容量上限：一镜能念的
// 字数 ≤ durationSeconds × 5；超了就念不完 → 必须加时长或把整段对白拆成同场景连续多镜。
//
// 为什么必须落在【显式 durationSeconds】路径：自动拆段（editingStyle=montage/continuous）下
// 服务端按 target÷档位算段数，渲染段与故事 clip 不是 1:1，无法把"这镜多少字"映射到"这段多长"。
// 只有全片每镜都写了 durationSeconds 时 clip↔段 才 1:1，按字数定长才生效。因此带对白的片，
// 一旦缺显式时长就拦下，逼导演按字数把每镜时长定出来（与 SKILL「故事板详细设计用显式时长」一致）。
//
// 该结果只服务创作修订与 diagnostics，不得取得运行时终止权。

import { extractClipDialogueLines } from "./video-orchestrator.dialog-audio";
import type { StoryPlan, StoryPlanClip } from "./video-orchestrator.orchestrate";

/**
 * 念白语速缺省值（字当量/秒）：当 Agent 未显式提交数值 dialoguePaceRate 时的结构性回退基准。
 * 语境判断属于 Agent；本地只消费其数值结论，不根据提示词或形容词二次猜测语义。
 */
export const DEFAULT_DIALOGUE_CHARS_PER_SEC = 4;
/**
 * 物理上限（字当量/秒）：无论导演声明多快，校验时按此封顶——防止瞎报高值绕过闸门。
 * 中文可念极限≈新闻联播/急喊 ~5-6/秒，取 6 作硬天花板。
 */
export const DIALOGUE_PACE_CEILING = 6;

/**
 * dialoguePaceRate 是数值协议，不是自然语言语义入口。硬切后拒绝根据“急喊/快嘴/低语”等
 * 本地关键词推断语速，避免 Hono 抢走 Agent 的表演判断并制造不可追溯的容量漂移。
 */
export function parseDialoguePaceRate(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * 本镜生效语速：Agent 声明的数值 dialoguePaceRate 优先、
 * 按物理上限 6 封顶；未声明/解析不出则回退 defaultRate。
 * 语速越慢 → 需要的时长越长 → 闸越严（治"凝重句却只给4s念得赶"）；越快越宽，但封顶 6。
 */
export function resolveClipPaceRate(clip: StoryPlanClip, defaultRate: number): number {
  const declared = parseDialoguePaceRate(
    (clip as { dialoguePaceRate?: unknown }).dialoguePaceRate,
  );
  const base = declared && declared > 0 ? declared : defaultRate;
  return Math.min(base, DIALOGUE_PACE_CEILING);
}

/** 硬容量语速（字/秒）；可经 env VIDEO_DIALOGUE_CHARS_PER_SEC 覆盖，缺省 5。 */
export function resolveDialogueCharsPerSec(env: unknown): number {
  const raw = Number(
    ((env as Record<string, unknown>)?.VIDEO_DIALOGUE_CHARS_PER_SEC ??
      globalThis.process?.env?.VIDEO_DIALOGUE_CHARS_PER_SEC ??
      NaN) as number,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DIALOGUE_CHARS_PER_SEC;
}

// 提取"被引号包住的口播对白"原文段：中文弯引号 “”、直角引号 「」『』、英文直引号。
// 只算引号内的台词（确定性可念内容），不把动作/旁白描写算进语速容量。
export const QUOTED_DIALOGUE_PATTERN =
  /[“]([^”]{1,})[”]|[「]([^」]{1,})[」]|[『]([^』]{1,})[』]|"([^"]{2,})"|'([^']{2,})'/g;

function clipCombinedText(clip: StoryPlanClip): string {
  return `${clip.clipPrompt || ""}\n${clip.storyboardPrompt || ""}`;
}

/** 结构化 shots 路径的台词声明字段（shots[].dialogue）合并文本；无 shots 返回 null。 */
function clipShotDialogueCells(clip: StoryPlanClip): string | null {
  const shots = (clip as { shots?: unknown }).shots;
  if (!Array.isArray(shots) || !shots.length) return null;
  return shots
    .map((s) => String((s as { dialogue?: unknown })?.dialogue ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function countQuotedMatches(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(QUOTED_DIALOGUE_PATTERN)) n += 1;
  return n;
}

function sumQuotedLoad(text: string): number {
  let load = 0;
  for (const m of text.matchAll(QUOTED_DIALOGUE_PATTERN)) {
    const captured = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
    load += countSpokenLoad(captured);
  }
  return load;
}

/** 统计一个 clip 里对白「句数/来回数」（不是字当量）：供结构闸判"一镜塞太多句对白"。口径同 extractClipDialogueLoad。 */
export function countClipDialogueLines(clip: StoryPlanClip): number {
  const text = clipCombinedText(clip);
  const lines = extractClipDialogueLines(text);
  if (lines.length) return lines.length;
  const cells = clipShotDialogueCells(clip);
  if (cells !== null) {
    const cellLines = extractClipDialogueLines(cells);
    return cellLines.length || countQuotedMatches(cells);
  }
  return countQuotedMatches(text);
}

/**
 * 统计一段文本里的"口播字当量"：中日韩表意字符各算 1；连续英文单词/数字串各算 2（英文语速
 * ~2.5 词/秒 ≈ 中文 5 字/秒，故 1 词 ≈ 2 字当量）。标点、空格不计。
 */
export function countSpokenLoad(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words * 2;
}

/**
 * 一个 clip 的口播字当量——语义口径（2026-07-17 根治「引号超集假超容」）：
 * ① `@角色：「台词」` 结构化台词行优先，与配音链路 dialog-audio 同一提取函数——只算真的会被
 *    合成语音/对口型念出来的字；action/sound 里的引号（招式名/歌词/字卡）不再计入。
 * ② 结构化 shots 路径无台词行时，只看台词声明字段 shots[].dialogue（兜住无说话人的「台词」写法）。
 * ③ 存量自由文本 clip（无 shots）维持旧引号口径，零回归。
 */
export function extractClipDialogueLoad(clip: StoryPlanClip): number {
  const text = clipCombinedText(clip);
  const lines = extractClipDialogueLines(text);
  if (lines.length) return lines.reduce((sum, l) => sum + countSpokenLoad(l.text), 0);
  const cells = clipShotDialogueCells(clip);
  if (cells !== null) {
    const cellLines = extractClipDialogueLines(cells);
    if (cellLines.length) return cellLines.reduce((sum, l) => sum + countSpokenLoad(l.text), 0);
    return sumQuotedLoad(cells);
  }
  return sumQuotedLoad(text);
}

export type DialogueOverflowItem = {
  index: number;
  /** 该镜对白字当量。 */
  load: number;
  /** 该镜显式时长（秒）；缺显式时长时为 null。 */
  durationSeconds: number | null;
  /** 装得下需要的最小时长（按本镜生效语速 ceil(load/paceRate)）。 */
  requiredSeconds: number;
  /** 本镜生效语速（字当量/秒）：导演自报值或缺省回退，已按物理上限封顶。 */
  paceRate: number;
  /** 缺显式时长 vs 时长不足，两类原因。 */
  reason: "missing_duration" | "too_short";
};

/**
 * 找出"对白装不下"的镜。判据：
 *  - 该镜有引号对白（load>0）且未标 dialogueDurationReviewed。
 *  - 全片**未**给齐显式逐镜 durationSeconds（clip↔段非 1:1，按字数定长失效）→ 该对白镜记 missing_duration。
 *  - 已给齐显式时长，但本镜 load > durationSeconds × rate（念不完）→ 记 too_short。
 */
export function findDialogueOverflowClips(
  plan: Pick<StoryPlan, "clips">,
  rate: number,
): DialogueOverflowItem[] {
  const clips = plan.clips ?? [];
  // 全片是否给齐显式逐镜时长（与 extractExplicitClipDurations 同口径：all-or-nothing）。
  const hasFullExplicit =
    clips.length > 0 &&
    clips.every(
      (c) => typeof c.durationSeconds === "number" && (c.durationSeconds as number) > 0,
    );
  const out: DialogueOverflowItem[] = [];
  clips.forEach((clip, index) => {
    if ((clip as { dialogueDurationReviewed?: boolean }).dialogueDurationReviewed === true) return;
    const load = extractClipDialogueLoad(clip);
    if (load <= 0) return;
    // 按本镜生效语速（导演自报 dialoguePaceRate 优先、物理上限 6 封顶；未报回退 rate）校验。
    const effectiveRate = resolveClipPaceRate(clip, rate);
    const requiredSeconds = Math.ceil(load / effectiveRate);
    if (!hasFullExplicit) {
      out.push({
        index,
        load,
        durationSeconds: null,
        requiredSeconds,
        paceRate: effectiveRate,
        reason: "missing_duration",
      });
      return;
    }
    const dur = clip.durationSeconds as number;
    if (load > dur * effectiveRate) {
      out.push({
        index,
        load,
        durationSeconds: dur,
        requiredSeconds,
        paceRate: effectiveRate,
        reason: "too_short",
      });
    }
  });
  return out;
}

/** 构建对白容量拦截文案；无超载镜返回 null。 */
export function buildDialogueCapacityBlockMessage(
  plan: Pick<StoryPlan, "clips">,
  rate: number = DEFAULT_DIALOGUE_CHARS_PER_SEC,
): string | null {
  const overflow = findDialogueOverflowClips(plan, rate);
  if (!overflow.length) return null;

  const missing = overflow.filter((o) => o.reason === "missing_duration");
  const tooShort = overflow.filter((o) => o.reason === "too_short");
  const lines: string[] = [];

  if (missing.length) {
    const detail = missing
      .map((o) => `clip${o.index}(${o.load}字当量·按${o.paceRate}字/秒需≥${o.requiredSeconds}s)`)
      .join("、");
    lines.push(
      `带对白的镜没给显式时长 [${detail}]——自动拆段(montage/continuous)会按档位均匀切，` +
        `把长对白塞进固定短镜念不完。请给全片每个 clip 都写 durationSeconds，按对白字数定镜长。`,
    );
  }
  if (tooShort.length) {
    const detail = tooShort
      .map(
        (o) =>
          `clip${o.index}(对白${o.load}字当量·当前${o.durationSeconds}s按${o.paceRate}字/秒只够念${
            Math.floor((o.durationSeconds as number) * o.paceRate)
          }字·需≥${o.requiredSeconds}s)`,
      )
      .join("、");
    lines.push(`镜长装不下对白 [${detail}]——时长不够会被截断/语速失真。`);
  }

  return (
    `拒绝起跑：对白容量不足。念白语速随语境而定（凝重~3、日常3.5-4、激动4.5-5、急喊~6 字/秒，缺省 ${rate}），` +
    `每镜时长须由对白字数÷该镜语速反推、不是固定 2s 一镜。按句子情绪给该镜写 dialoguePaceRate 可调快慢（上限 ${DIALOGUE_PACE_CEILING}）。\n` +
    lines.map((l) => `· ${l}`).join("\n") +
    `\n修法：① 给该镜加时长到 ≥ 需要值；② 或把整段长对白拆成同场景连续多镜(continuous 续写链承接、不跳场)按序念全——` +
    `绝不为塞进时长而截断/删句/缩写对白。改完重新 start；确属无需念全的镜给该 clip 标 dialogueDurationReviewed:true 豁免。`
  );
}
