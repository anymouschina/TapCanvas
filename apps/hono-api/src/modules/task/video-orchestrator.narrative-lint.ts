// 【叙事 linter·确定性告警·喂给评审的"硬"半边】（2026-06-30 用户：本地调试·提升小说→视频质量）
//
// 北极星(观众看懂+被打动)是定性标准，靠 LLM 六维终审判。但有几类问题 LLM 评审天生抓不到——
// 它"读感觉"、不做算术、不主动 diff 非相邻段：
//   ① 对白容量超载（段7 492字塞15s=8倍超·念不完）——要做 字数÷时长 的算术；
//   ② 跨段一致性（同角色不同年龄/描述、季节冷热打架、人名近似变体李佑安vs李佑宁）——要跨段比对。
// 本 linter 确定性算出这些，作为 estimate 响应的 narrativeLintWarning 注入——评审与小T 一眼看见"段7超容8x"，
// 想漏都漏不掉。**这是告警不是硬拦**（去硬闸一致）：算出事实喂给定性评审，由它+小T 决定怎么改。

import type { StoryPlan, StoryPlanClip } from "./video-orchestrator.orchestrate";
import {
  findDialogueOverflowClips,
  DEFAULT_DIALOGUE_CHARS_PER_SEC,
  type DialogueOverflowItem,
} from "./video-orchestrator.dialogue-capacity";

// 冷/热季节标记：同一片里冷热并存＝季节/天气大概率打架（段2盛夏烈日 vs 段3呵气白雾）。
const HOT_MARKERS = /盛夏|酷暑|炎炎|烈日|骄阳|蝉鸣|蝉声|三伏|暑气|挥汗|汗流浃背|炎热/g;
const COLD_MARKERS = /呵气|哈气|呼出白|鼻息.{0,3}白雾|哈出白|严寒|寒冬|数九|飘雪|落雪|大雪|冰霜|结冰|霜花|冻得|呵出白气/g;

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/** CJK 短名编辑距离 ≤1 判定（李佑安/李佑宁、张三/张山）——同长 2~4 字、仅 1 字之差＝近似变体。 */
function isNearDuplicateName(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.length !== b.length) return false;
  if (a.length < 2 || a.length > 4) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff === 1;
}

export type NarrativeLint = {
  dialogueOverloads: DialogueOverflowItem[];
  seasonConflict: { hot: string[]; cold: string[] } | null;
  ageConflicts: Array<{ role: string; ages: string[] }>;
  nameVariants: Array<[string, string]>;
};

export function lintNarrativePlan(
  plan: Pick<StoryPlan, "clips">,
  rate: number = DEFAULT_DIALOGUE_CHARS_PER_SEC,
): NarrativeLint {
  const clips = plan.clips ?? [];
  const allText = clips.map((c) => `${c.clipPrompt || ""}\n${c.storyboardPrompt || ""}`).join("\n");

  // ① 对白容量超载（复用确定性算法）。
  const dialogueOverloads = findDialogueOverflowClips(plan, rate);

  // ② 季节冷热冲突。
  const hot = uniq(allText.match(HOT_MARKERS) || []);
  const cold = uniq(allText.match(COLD_MARKERS) || []);
  const seasonConflict = hot.length > 0 && cold.length > 0 ? { hot, cold } : null;

  // ③ 同角色年龄不一致：roleName 紧邻的「N岁/N-N岁」收集，>1 个不同值＝冲突。
  const roleNames = uniq(
    clips.flatMap((c) =>
      Array.isArray((c as StoryPlanClip).characterRoleNames)
        ? ((c as StoryPlanClip).characterRoleNames as string[])
        : [],
    ).filter(Boolean),
  );
  const ageConflicts: Array<{ role: string; ages: string[] }> = [];
  for (const role of roleNames) {
    const ages = new Set<string>();
    // role 后 0~12 字内出现的「N岁」（含 N-N 岁区间）。
    const re = new RegExp(
      `${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^。\\n]{0,12}?([0-9〇一二三四五六七八九十百两\\d]{1,4}(?:[-~至][0-9一二三四五六七八九十\\d]{1,4})?)\\s*岁`,
      "g",
    );
    for (const m of allText.matchAll(re)) ages.add(m[1].trim());
    if (ages.size > 1) ageConflicts.push({ role, ages: Array.from(ages) });
  }

  // ④ 近似人名变体（角色卡名两两比 + clipPrompt 里出现的近似名）。
  const nameVariants: Array<[string, string]> = [];
  for (let i = 0; i < roleNames.length; i++) {
    for (let j = i + 1; j < roleNames.length; j++) {
      if (isNearDuplicateName(roleNames[i], roleNames[j])) nameVariants.push([roleNames[i], roleNames[j]]);
    }
  }

  return { dialogueOverloads, seasonConflict, ageConflicts, nameVariants };
}

/** 把 lint 结果拼成给 estimate 响应/评审看的告警文案；全清返回 null。 */
export function buildNarrativeLintWarning(lint: NarrativeLint): string | null {
  const lines: string[] = [];

  const tooShort = lint.dialogueOverloads.filter((o) => o.reason === "too_short");
  const missing = lint.dialogueOverloads.filter((o) => o.reason === "missing_duration");
  if (tooShort.length) {
    const detail = tooShort
      .map((o) => {
        const factor = o.durationSeconds ? Math.round((o.requiredSeconds / o.durationSeconds) * 10) / 10 : 0;
        return `clip${o.index}(对白${o.load}字当量·${o.durationSeconds}s只够念${Math.floor((o.durationSeconds || 0) * o.paceRate)}字·需≥${o.requiredSeconds}s·超容${factor}x)`;
      })
      .join("、");
    lines.push(`⚠️对白容量超载[${detail}]——念不完会被碎读/截断。段未到 15s 顶=加时长或拆镜按序念全；已到顶=把尾部台词顺延到下一镜开头跨镜重排（段数不变）；快嘴/急喊情景标 dialoguePaceRate 5~6 字/秒放宽容量；别截断删句。`);
  }
  if (missing.length) {
    const detail = missing.map((o) => `clip${o.index}(${o.load}字当量·需≥${o.requiredSeconds}s)`).join("、");
    lines.push(`⚠️带对白镜缺显式 durationSeconds[${detail}]——按对白字数给每镜写时长。`);
  }
  if (lint.seasonConflict) {
    lines.push(
      `⚠️季节/天气冲突——全片同时出现热标记[${lint.seasonConflict.hot.join("/")}]与冷标记[${lint.seasonConflict.cold.join("/")}]，确认是否同一时节（如盛夏不该有呵气白雾），统一冷暖。`,
    );
  }
  for (const a of lint.ageConflicts) {
    lines.push(`⚠️「${a.role}」年龄不一致：全片出现 ${a.ages.join(" / ")}，统一到一个值。`);
  }
  for (const [a, b] of lint.nameVariants) {
    lines.push(`⚠️人名近似易混：「${a}」vs「${b}」只差一字——确认是否同一人的笔误（TTS/字幕会错），统一 canonical name。`);
  }

  if (!lines.length) return null;
  return (
    `【叙事 linter·确定性告警（喂给叙事终审·非硬拦）】以下是机器逐字算出的硬指标问题，` +
    `LLM 读感觉容易漏、但确凿存在，进 estimate/出片前先在 clipPrompt 文字层修掉：\n` +
    lines.map((l) => `· ${l}`).join("\n")
  );
}
