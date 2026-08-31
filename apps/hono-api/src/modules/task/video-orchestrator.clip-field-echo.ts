// 【Echo 检测诊断】（吸收 LumenX model_echo：输出≈输入=没把素材 transform 成可执行提示词）
//
// LumenX 用 SequenceMatcher(output, sourceText)≥0.95 判模型没干活。TapCanvas 闸层拿不到 chapter 原文
// （StoryPlan 仅透传 chapterId 占位），无法直接比"输出 vs 原文"。但能比同一 clip 内的两个字段：
// clipPrompt 与 storyboardPrompt 几乎一字不差【且 clipPrompt 本身没写任何运镜/动作】= 小T 把故事板
// 静帧描述照搬当运动提示词、没把散文 transform 成可执行运动 → 记录 diagnostics 供同链改写。
//
// 双条件去误伤（关键）：相似度高【必须叠加】clipPrompt 无运镜/动作信号——合法的"首尾帧同构图、靠运镜
// 动起来"的镜，clipPrompt 会写"镜头推近/他挥剑"等运动词 → 不命中。仅两字段一字不差且 clipPrompt 也没
// 写任何运动 = 真偷懒。检测结果不得阻止起跑、提交、持久化或交付。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";
import { CAMERA_MOVE_PATTERN, ACTION_PATTERN } from "./video-orchestrator.clip-motion";

/** 相似度阈值：≥ 视为字段互抄。bigram Dice 对 CJK 比 SequenceMatcher 稳。 */
export const FIELD_ECHO_DICE_THRESHOLD = 0.92;

/** 去空白 / 中英标点 / 大小写归一，便于比"实质内容"是否一致。 */
export function normalizeForEcho(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[，。、；：！？“”‘’「」『』（）【】,.;:!?"'()\[\]…—\-~·]/g, "");
}

/** 中文 bigram Dice 相似度 [0,1]：dice = 2*|A∩B| / (|A|+|B|)，A/B 为相邻二字 gram 多重集。 */
export function bigramDice(a: string, b: string): number {
  const na = normalizeForEcho(a);
  const nb = normalizeForEcho(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(na);
  const gb = grams(nb);
  let inter = 0;
  let totalA = 0;
  let totalB = 0;
  for (const c of ga.values()) totalA += c;
  for (const c of gb.values()) totalB += c;
  for (const [g, ca] of ga) {
    const cb = gb.get(g);
    if (cb) inter += Math.min(ca, cb);
  }
  return (2 * inter) / (totalA + totalB);
}

export type FieldEchoClip = { index: number; ratio: number };

/**
 * 找出"字段互抄"镜：跳过 echoReviewed===true 的 clip；clipPrompt 与 storyboardPrompt 都非空、
 * normalize 后 bigramDice ≥ 阈值、【且】clipPrompt 不含任何运镜/动作信号 → 命中（真偷懒）。
 */
export function findFieldEchoClips(clips: readonly StoryPlanClip[]): FieldEchoClip[] {
  const out: FieldEchoClip[] = [];
  clips.forEach((clip, index) => {
    if ((clip as { echoReviewed?: boolean }).echoReviewed === true) return;
    const cp = String(clip.clipPrompt || "");
    const sb = String(clip.storyboardPrompt || "");
    if (!cp.trim() || !sb.trim()) return; // 任一为空交别的校验，不在本闸误报
    const ratio = bigramDice(cp, sb);
    if (ratio < FIELD_ECHO_DICE_THRESHOLD) return;
    // 叠加条件：clipPrompt 自身没写任何运镜/动作 = 没 transform 成运动 → 命中。
    const hasMotion = CAMERA_MOVE_PATTERN.test(cp) || ACTION_PATTERN.test(cp);
    if (hasMotion) return;
    out.push({ index, ratio });
  });
  return out;
}

/**
 * 构建字段互抄【软告警】文案；无命中返回 null。
 * 软告警非硬拦（faithful to LumenX：model_echo 是 warning 非 fail；且 MEMORY「别加预防性硬闸」）——
 * 提示导演该镜可能偷懒、可改可标 echoReviewed，但不阻断起跑。
 */
export function buildClipFieldEchoWarning(clips: readonly StoryPlanClip[]): string | null {
  const hits = findFieldEchoClips(clips);
  if (!hits.length) return null;
  const list = hits.map((h) => `clip${h.index}`).join("、");
  return (
    `字段互抄提醒：检测到镜 [${list}] 的 clipPrompt 与 storyboardPrompt 几乎一字不差、且 clipPrompt 无运镜/动作信号——` +
    `等于只写了静帧、没把素材 transform 成可执行运动（PPT 化的根因之一，吸收自 LumenX model_echo）。` +
    `建议改写：clipPrompt 写【运动】（机位移动 推/拉/摇/移/跟/环绕… + 物理动作动词），与故事板的静态构图明确区分；` +
    `storyboardPrompt 描静帧、clipPrompt 描运动，二者不该雷同。确属有意的纯定格镜给该 clip 标 echoReviewed:true。`
  );
}
