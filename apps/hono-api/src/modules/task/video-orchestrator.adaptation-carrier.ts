/**
 * 【改编承载合同核对·检测纠正非硬闸】2026-07-11 两次实证同病：
 * - ch12「紫霄宫听道」：cuts 声明"由 clip3 镜1 VO 承载"，成品镜却标「无台词」——声明落空零核验。
 * - ch15「捏碎第一枚骨片」：adaptationStrategy 自己登记的 reversal+hook（镜8 揭晓两枚骨片设定），
 *   重切后末段压成 7s、唯一台词只剩「失算了」，捏碎/第一枚/祖地零命中——揭晓被自己切没了。
 * 根因：reversals/cuts/hook 是编剧对「信息点去哪了」的书面声明，此前只靠 SKILL 纪律+critic 主观审，
 * 没有任何确定性核对（锚点 coverage 只查原文区间归属，查不了信息是否以观众可感知形式落地）。
 * 本模块在 estimate 时做确定性核对，产出软告警（不拦 start——Hermes 序：正确默认>检测纠正>硬闸，
 * 硬闸只留失败循环/不可逆伤害两类）。匹配基于归一化 2-gram 命中率，阈值放保守防误报。
 */

const CJK_RUN = /[一-鿿㐀-䶿]+/g;

/** 声明文本里的结构噪音词——出现在几乎所有声明里，命中它们不代表内容被承载。 */
const STOP_BIGRAMS = new Set([
  "预埋",
  "揭晓",
  "揭曉",
  "下章",
  "上章",
  "结尾",
  "結尾",
  "开场",
  "開場",
  "钩子",
  "鉤子",
  "钩住",
  "承载",
  "承載",
  "凝练",
  "凝練",
  "原文",
  "内心",
  "內心",
  "独白",
  "獨白",
  "旁白",
  "台词",
  "台詞",
  "自语",
  "自語",
  "画面",
  "畫面",
  "视觉",
  "視覺",
  "本章",
  "本片",
  "一句",
  "一话",
  "一幕",
  "绝境",
  "絕境",
]);

/** 声明是否主张用「台词/VO」通道承载。 */
const VOICE_CLAIM = /(VO|旁白|独白|獨白|自语|自語|台词|台詞|口播|念白)/;

/** clip 文本里是否存在台词/VO 行（`@角色（…）：「…」` 或 shots.dialogue 汇入的引号行）。 */
const DIALOGUE_LINE = /@[^\n]{0,60}[:：][^\n]{0,10}[「“]/;

export function normalizeCjkForCarrierMatch(text: string): string {
  return (String(text || "").match(CJK_RUN) || []).join("");
}

/** 提取声明文本的去重 2-gram（剔结构噪音词）。 */
export function extractDeclarationBigrams(decl: string): string[] {
  const norm = normalizeCjkForCarrierMatch(decl);
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= norm.length; i += 1) {
    const g = norm.slice(i, i + 2);
    if (!STOP_BIGRAMS.has(g)) grams.add(g);
  }
  return [...grams];
}

/** 声明 2-gram 在承载文本里的命中率（0-1）。声明过短（<4 个有效 gram）时退化为「至少命中 1 个」。 */
export function carrierHitRatio(decl: string, carrierText: string): number {
  const grams = extractDeclarationBigrams(decl);
  if (!grams.length) return 1;
  const hay = normalizeCjkForCarrierMatch(carrierText);
  const hit = grams.filter((g) => hay.includes(g)).length;
  if (grams.length < 4) return hit > 0 ? 1 : 0;
  return hit / grams.length;
}

/**
 * 命中率低于此阈值 = 承载声明疑似落空。用 ch15 真实数据校准（2026-07-11 金样本回放）：
 * 真丢失案例实测 18%（reveal）/29%（hook）；措辞 paraphrase 但画面真承载的案例实测 32%
 * （「金斗清光滞敌→血影遁」：清光→光柱、滞敌→一滞，2-gram 对 paraphrase 天然打折）。
 * 取 0.30 恰好分割两簇；再收紧会把 paraphrase 承载误伤成告警（检测纠正层宁漏勿扰）。
 */
export const CARRIER_RATIO_FLOOR = 0.3;

type ClipLike = {
  clipPrompt?: unknown;
  logline?: unknown;
  title?: unknown;
};

function readClipText(clip: ClipLike | undefined): string {
  if (!clip) return "";
  return [clip.clipPrompt, clip.logline, clip.title]
    .map((v) => (typeof v === "string" ? v : ""))
    .join("\n");
}

type ReversalDecl = { plantClipIndex?: unknown; revealClipIndex?: unknown; desc?: unknown };
type CutDecl = { what?: unknown; why?: unknown };
type StrategyShape = { reversals?: unknown; cuts?: unknown; hook?: unknown };

function toIndex(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 核对 adaptationStrategy 声明的承载镜是否真含对应内容。
 * clips 传 estimate 时的最终形态（clipPrompt 字符串）；strategyText 传落库的 JSON 文本。
 * 返回软告警数组（空数组 = 全部核对通过或无声明可核）。
 */
export function buildAdaptationCarrierWarnings(input: {
  strategyText: string | null | undefined;
  clips: ClipLike[];
}): string[] {
  const warnings: string[] = [];
  if (!input.strategyText || !Array.isArray(input.clips) || !input.clips.length) return warnings;
  let strategy: StrategyShape;
  try {
    strategy = JSON.parse(input.strategyText) as StrategyShape;
  } catch {
    return warnings;
  }
  const clips = input.clips;
  const lastIdx = clips.length - 1;

  // ── reversals：揭晓镜必须真含声明内容 ──
  const reversals = Array.isArray(strategy.reversals) ? (strategy.reversals as ReversalDecl[]) : [];
  for (const rev of reversals) {
    const desc = typeof rev?.desc === "string" ? rev.desc : "";
    if (!desc.trim()) continue;
    const revealIdx = toIndex(rev.revealClipIndex);
    if (revealIdx === null) continue;
    if (revealIdx > lastIdx) {
      warnings.push(
        `reversal 声明的揭晓镜 clipIndex=${revealIdx} 超出当前分段范围（共 ${clips.length} 段）——重切/重编号后声明没跟着更新，揭晓内容可能已无镜承载。`,
      );
      continue;
    }
    const carrierText = readClipText(clips[revealIdx]);
    const ratio = carrierHitRatio(desc, carrierText);
    const voiceClaim = VOICE_CLAIM.test(desc);
    const missingVoice = voiceClaim && !DIALOGUE_LINE.test(carrierText);
    if (ratio < CARRIER_RATIO_FLOOR || missingVoice) {
      warnings.push(
        `reversal 承载疑似落空：声明「${desc.slice(0, 60)}…」由镜 ${revealIdx} 揭晓，但该镜文本与声明关键词命中率仅 ${(ratio * 100).toFixed(0)}%` +
          (missingVoice ? "，且声明主张 VO/台词承载、该镜却无任何台词行" : "") +
          `。揭晓必须是观众可感知的内容（台词/VO/特写拍），写进注释不算——用 add_clips{replaceAtIndex:${revealIdx}} 把揭晓拍补进该镜。`,
      );
    }
  }

  // ── hook：末镜（或倒数第二镜）必须真含钩子内容 ──
  const hook = typeof strategy.hook === "string" ? strategy.hook : "";
  if (hook.trim() && lastIdx >= 0) {
    const lastText = readClipText(clips[lastIdx]);
    const prevText = lastIdx >= 1 ? readClipText(clips[lastIdx - 1]) : "";
    const ratio = Math.max(carrierHitRatio(hook, lastText), carrierHitRatio(hook, prevText));
    if (ratio < CARRIER_RATIO_FLOOR) {
      warnings.push(
        `hook 承载疑似落空：声明的结尾钩子「${hook.slice(0, 60)}…」在末两镜文本中关键词命中率仅 ${(ratio * 100).toFixed(0)}%——钩子被重切压没了？观众看不到的钩子等于没有，用 add_clips{replaceAtIndex:${lastIdx}} 把钩子拍（台词/VO/特写）补进末镜。`,
      );
    }
  }

  // ── cuts：声明「镜N 用 VO/台词 承载」的，镜 N 必须真有台词行 ──
  const cuts = Array.isArray(strategy.cuts) ? (strategy.cuts as CutDecl[]) : [];
  for (const cut of cuts) {
    const why = typeof cut?.why === "string" ? cut.why : "";
    if (!why.trim() || !VOICE_CLAIM.test(why)) continue;
    const refs = [...why.matchAll(/[镜鏡]\s*(\d+)/g)].map((m) => Number(m[1]));
    if (!refs.length) continue;
    // 声明里的「镜N」历史上 0/1-based 混用：N 与 N-1 任一有台词行即算过，防误报。
    const anyCarried = refs.some((n) => {
      const cands = [clips[n], n >= 1 ? clips[n - 1] : undefined];
      return cands.some((c) => DIALOGUE_LINE.test(readClipText(c)));
    });
    if (!anyCarried) {
      warnings.push(
        `cuts 承载疑似落空：声明「${why.slice(0, 60)}…」主张由镜 ${refs.join("/")} 的 VO/台词承载被删内容，但对应镜（含相邻编号位）没有任何台词行——被删信息实际无人承载（ch12「紫霄宫听道」同型事故）。补台词/VO 后重发该段。`,
      );
    }
  }

  return warnings;
}
