// 【剧情密度算术·确定性软告警】（2026-07-06 三仓库调研落地，spec docs/superpowers/specs/2026-07-06-shortdrama-prompt-upgrade-design.md）
//
// 病根（痛点2「剧情压缩过密」）：单 clip 承载多少原文全靠 LLM 感觉，critic 维11「一镜一主信息」
// 是定性审，没人做「原文字数 ÷ 镜时长」的算术。本模块复用 source-coverage 的锚点拼图取每 clip
// 覆盖的原文跨度（归一化实义字符），除以该镜实际时长，>阈值（默认 8 字/秒≈正常念白 2 倍）即告警。
// 与全仓一致：**告警不是硬拦**；确因 adaptationStrategy.cuts 删减导致跨度大 → clip 标
// densityReviewed:true 显式豁免（与 timespanReviewed 同款，导演确认非静默）。
// flag VIDEO_SOURCE_DENSITY_WARN 默认 ON；阈值 env VIDEO_SOURCE_DENSITY_CHARS_PER_SEC 可调，夹在 [4,20]。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";
import { computeSourceCoverage } from "./video-orchestrator.source-coverage";

export function isSourceDensityWarnEnabled(env: unknown): boolean {
  const raw = String(
    ((env as Record<string, unknown>)?.VIDEO_SOURCE_DENSITY_WARN ??
      globalThis.process?.env?.VIDEO_SOURCE_DENSITY_WARN ??
      "") as string,
  )
    .trim()
    .toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

export function resolveSourceDensityCharsPerSec(env: unknown): number {
  const raw = Number(
    ((env as Record<string, unknown>)?.VIDEO_SOURCE_DENSITY_CHARS_PER_SEC ??
      globalThis.process?.env?.VIDEO_SOURCE_DENSITY_CHARS_PER_SEC ??
      8) as number,
  );
  if (!Number.isFinite(raw) || raw <= 0) return 8;
  return Math.min(Math.max(raw, 4), 20);
}

export type SourceDensityItem = {
  index: number;
  /** 该镜覆盖原文的归一化实义字符数。 */
  chars: number;
  durationSeconds: number;
  charsPerSec: number;
};

/** 找出剧情压缩过密的 clip：原文跨度字数 ÷ 实际时长 > 阈值。densityReviewed 豁免；无时长/无锚点跳过。 */
export function findOverdenseClips(
  clips: readonly StoryPlanClip[] | undefined,
  chapterText: string,
  realizedDurations: readonly number[],
  charsPerSecThreshold: number,
): SourceDensityItem[] {
  const list = Array.isArray(clips) ? clips : [];
  const cov = computeSourceCoverage(list, chapterText);
  if (!cov.usable) return [];
  const out: SourceDensityItem[] = [];
  for (const span of cov.clipSpans) {
    const clip = list[span.index];
    if (clip?.densityReviewed === true) continue;
    const dur = Number(realizedDurations[span.index]);
    if (!Number.isFinite(dur) || dur <= 0) continue;
    const cps = span.chars / dur;
    if (cps > charsPerSecThreshold) {
      out.push({
        index: span.index,
        chars: span.chars,
        durationSeconds: dur,
        charsPerSec: Math.round(cps * 10) / 10,
      });
    }
  }
  return out;
}

/** 拼给叙事终审/小T 看的密度告警；全清返回 null。 */
export function buildSourceDensityWarning(
  clips: readonly StoryPlanClip[] | undefined,
  chapterText: string,
  realizedDurations: readonly number[],
  charsPerSecThreshold: number,
): string | null {
  const items = findOverdenseClips(clips, chapterText, realizedDurations, charsPerSecThreshold);
  if (!items.length) return null;
  const shown = items.slice(0, 6);
  const detail = shown
    .map(
      (o) => `clip${o.index}(承载原文约${o.chars}字·${o.durationSeconds}s≈${o.charsPerSec}字/秒)`,
    )
    .join("、");
  const more = items.length > 6 ? `（另 ${items.length - 6} 镜）` : "";
  return (
    `【剧情密度机检·确定性告警（喂给叙事终审·非硬拦）】以下镜头按 sourceMarker 回原文算出的` +
    `「原文字数÷镜时长」超过 ${charsPerSecThreshold} 字/秒（正常念白 3.5-4 字/秒，画面动作也承载叙事，超此值≈单镜塞了` +
    `多个节拍→剧情压缩过密/过场突兀）：${detail}${more}。修法：① 拆镜——把该跨度按戏剧节拍拆成多条 clip；` +
    `② 加时长；③ 确因 adaptationStrategy.cuts 删减了该跨度大半内容（画面只承载留存节拍）→ 给该 clip 标 densityReviewed:true 显式豁免。`
  );
}
