import type { FilmReviewVerdict } from "./video-orchestrator.film-review";

/**
 * 历史成片审片元数据读取。
 *
 * 自动返工决策与 VIDEO_FILM_REWORK 运行时入口已经删除：供应商已受理或已生成的 clip/成片
 * 不得因语义审片 verdict 被标回 failed、延迟交付或自动产生新的付费任务。历史 attempts 仅作为
 * 可检索审计事实保留；若用户明确授权修订，应创建新的版本化任务，而不是复活旧自动返工链。
 */

export function readFilmReworkAttempts(data: Record<string, unknown> | undefined): number {
  const n = Number((data ?? {}).filmReworkAttempts);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** 把整片审片结果整理为只读诊断；不触发重生成、状态回退或交付阻塞。 */
export function buildFilmReworkClipFeedback(verdict: FilmReviewVerdict): string {
  const lines = [
    "成片审片诊断（不阻塞当前资产交付）：",
    ...verdict.failedCriteria.map((f) => `· ${f.id} ${f.name}：${f.reason}`.trim()),
    ...(verdict.suggestion ? [`修复方向：${verdict.suggestion}`] : []),
  ].filter(Boolean);
  return lines.join("；").slice(0, 2000);
}
