// 【空间 blocking 软告警】（设计 docs/superpowers/specs/2026-06-12-director-blocking-pipeline-design.md）
//
// ch2 成片实证：视频模型对「穿越门框」类拓扑动作空间推理弱——"推门进屋"被生成为
// "人物瞬移到门框正中双手扶门"。确定性解法是导演台 blocking 帧（机位/人物/门的相对
// 位置在 3D 里钉死），本模块只核对 agents 已输出的结构化 spatialBlocking 决策：
// spatialBlocking:true 但缺 blockingFrameNodeId 时附 `spatialBlockingWarning`。
//
// 纯只读软告警，照搬 pacingCarpetWarning 模式：不拦、不改行为，flag OFF 逐字等价。
// flag `VIDEO_SPATIAL_BLOCKING_WARN` 默认 ON。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";

export function isSpatialBlockingWarnEnabled(env: unknown): boolean {
  const raw = String(
    ((env as Record<string, unknown>)?.VIDEO_SPATIAL_BLOCKING_WARN ??
      globalThis.process?.env?.VIDEO_SPATIAL_BLOCKING_WARN ??
      "") as string,
  )
    .trim()
    .toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off");
}

/**
 * 构建空间 blocking 软告警文案：任一 clip 明确需要空间调度但缺真实站位引用时返回告警。
 */
export function buildSpatialBlockingWarning(clips: readonly StoryPlanClip[]): string | null {
  const flagged: string[] = [];
  clips.forEach((clip, index) => {
    if (clip.spatialBlocking !== true || clip.blockingFrameNodeId) return;
    flagged.push(`clip${index}`);
  });
  if (!flagged.length) return null;
  return (
    `已声明空间调度但无 blockingFrameNodeId：${flagged.join("、")}。` +
    "请先生成或复用与该 clip.sceneName 精确一致的真实站位图，再回填 blockingFrameNodeId。"
  );
}
