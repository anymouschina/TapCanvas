// 【分段剧本时空过载诊断】
//
// ch3 成片复盘实证：单条 14s clipPrompt 横跨「落不下笔→喝奶关灯睡着→两天后清晨→第三天来电」
// 4 个叙事时间段，「睡着」被压成 3s 无缓冲过场 → 观感突兀。根因=单 clip 塞了多个时间跳迁，
// 节奏门禁(hasPacingDecision)只管镜头时长、不管"一条 clip 能横跨多少叙事时间"。
//
// 检测单条 clipPrompt 含 ≥2 个不同叙事时间跳迁标记，结果用于创作诊断与修订；
// 不得以任何环境开关重新升级为起跑、提交或交付硬闸。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";

// 叙事时间跳迁标记：命中表示"画面切到另一个时间"。按语义分组——同组内多个词只算一次跳迁
// （如"清晨"和"早晨"是同一个时间锚，不重复计数），跨组才算多次跳迁。
const TIME_JUMP_GROUPS: Array<{ key: string; pattern: RegExp }> = [
  { key: "next-day", pattern: /次日|第二天|翌日|隔天|隔日|第二日/ },
  { key: "days-later", pattern: /两天后|三天后|几天后|数日后|多日后|第三天|过了几天/ },
  { key: "hours-later", pattern: /几小时后|许久后|过了许久|不知过了多久|半晌后/ },
  { key: "fall-asleep", pattern: /睡着|睡去|入睡|睡下|沉沉睡|昏睡|睡了过去/ },
  { key: "wake-up", pattern: /醒来|睡醒|醒过来|睁开眼|一觉醒/ },
  { key: "morning", pattern: /清晨|早晨|天亮|破晓|晨光|次日清晨|第二天早/ },
  { key: "nightfall", pattern: /入夜|夜幕|天黑下来|入了夜|夜深/ },
];

/** 返回 clipPrompt 命中的叙事时间跳迁组 key（去重）；不命中返回空数组。 */
export function detectTimeJumpMarkers(clipPrompt: string): string[] {
  const text = String(clipPrompt || "");
  if (!text) return [];
  const hits: string[] = [];
  for (const group of TIME_JUMP_GROUPS) {
    if (group.pattern.test(text) && !hits.includes(group.key)) hits.push(group.key);
  }
  return hits;
}

export type OverloadedClip = { index: number; markers: string[] };

/**
 * 找出时空过载的 clip：单条 clipPrompt（含 storyboardPrompt）命中 ≥2 个不同时间跳迁组。
 * 带 timespanReviewed:true 的 clip 视为导演已确认的跨时空蒙太奇，豁免。
 */
export function findOverloadedClips(clips: readonly StoryPlanClip[]): OverloadedClip[] {
  const out: OverloadedClip[] = [];
  clips.forEach((clip, index) => {
    // 2026-06-22 用户定调：叙事片（本 clip 绑了具名角色卡）跨时空必须拆成独立 clip + 加过渡，
    // 不许 小T 用 timespanReviewed 静默自我豁免把"破晓→数日后"压一条。仅"无具名角色"的纯蒙太奇
    // (MV/B-roll/转场)才允许 timespanReviewed 豁免。
    const isNarrativeClip =
      Array.isArray(clip.characterRoleNames) && clip.characterRoleNames.length > 0;
    if (clip.timespanReviewed === true && !isNarrativeClip) return;
    const markers = detectTimeJumpMarkers(`${clip.clipPrompt || ""}\n${clip.storyboardPrompt || ""}`);
    if (markers.length >= 2) out.push({ index, markers });
  });
  return out;
}

/** 构建时空过载拦截文案（start 闸用）；无过载返回 null。 */
export function buildClipTimespanBlockMessage(clips: readonly StoryPlanClip[]): string | null {
  const overloaded = findOverloadedClips(clips);
  if (!overloaded.length) return null;
  const detail = overloaded
    .map((o) => `clip${o.index}(跨${o.markers.length}个时间段:${o.markers.join("/")})`)
    .join("、");
  return (
    `拒绝起跑：分段剧本时空过载 [${detail}]。单条 clip 在十几秒内横跨多个叙事时间段（如"睡着→两天后→第三天"）` +
    "会把关键动作（如入睡）压成无缓冲的突兀过场（ch3 实测）。修法：① 把跨时空的 clip 拆成多条独立 clip，每条只承载一个时间段；" +
    "② 或把隔夜/跳日交给独立转场镜（黑场渐隐→晨光渐显），不在单镜内压多个时间段；" +
    "③ 若确属有意为之的时空蒙太奇，给该 clip 标 timespanReviewed:true 显式豁免。改完再 start。"
  );
}
