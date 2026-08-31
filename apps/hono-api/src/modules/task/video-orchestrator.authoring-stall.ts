/**
 * 【编排层静默停滞闸·2026-07-28】编排驱动此前唯一的运行级闸是"异常连击"（recordDriverExceptionStreak），
 * 它只抓抛错。真实盲区是**不抛错的静默停滞**：状态卡在某一相、每 tick 正常返回、连击计数恒为 0，
 * 没有任何闸会响。单 clip 有 WRITER_TIMEOUT_MS=30min 兜底，但运行级没有墙钟上限——
 * 3 轮重写 × 30min 各自合法，叠起来近两小时无人中断，且若卡在"该派发却没派发"这类不等 writer 的相位
 * （如 beats_committed 静默不动），连 30min 兜底都不会触发，等于无限期挂着。
 *
 * 生产侧早有同构解法（video-run.repo.nextNoProgressDecision 的 no-progress 水位标），但它的进度信号是
 * clips_done，而编排全程 clips_done=0，直接复用会把所有健康写作 run 误杀。所以这里换进度信号：
 * 用「authoring_state + 每个 clip 的状态与稳定执行代际」做进度指纹——任一相位推进、任一 clip 交付、
 * 判失败或带新 agentId 重派，指纹都会变 → 计时清零；同一执行代际一动不动卡满窗口才判死。
 *
 * 窗口必须 > WRITER_TIMEOUT_MS：等 writer 期间指纹本就不变，窗口若更短会在 writer 合法工作时误杀。
 */

/** 运行级停滞窗口。45min = WRITER_TIMEOUT_MS(30min) + 15min 余量，确保只杀真死锁不杀慢 writer。 */
export const AUTHORING_STALL_CANCEL_MS = 45 * 60 * 1000;

export const AUTHORING_STALL_ARTIFACT_KEY = "driver:stall";

/**
 * 只有由后台执行器独占推进的内部阶段才受静默停滞截止时间约束。
 * `asset_repair_required` 明确表示 delivery graph 正在等待画布/agent 提供新的真实资产证据；
 * 等待期间没有 clip 工件变化是正确行为，不能被解释成内部死锁。
 */
export function isAuthoringInternalStallState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.length > 0 && state !== "asset_repair_required";
}

export type AuthoringStallWatermark = { fingerprint: string; since: string };

/**
 * 进度指纹：编排是否"真的动过"的唯一判据。
 * 纳入 authoring_state，以及每个 clip 的 status / agentId / repairAttempt / dispatchedAt / outputHash。
 * 这些字段只在真实派发或交付时变化，不包含轮询时间等每 tick 自增量，因此既能区分新的修复代际，
 * 又不会让慢 writer 靠心跳永久逃过停滞闸。
 */
export function buildAuthoringProgressFingerprint(input: {
  authoringState: string | null | undefined;
  artifacts: ReadonlyArray<{
    artifact_key: string;
    status: string;
    payload?: string | null;
  }>;
}): string {
  const clips = input.artifacts
    .filter((artifact) => artifact.artifact_key.startsWith("clip:"))
    .map((artifact) => {
      let executionIdentity = "";
      if (artifact.payload) {
        try {
          const parsed = JSON.parse(artifact.payload) as Record<string, unknown>;
          executionIdentity = [
            typeof parsed.agentId === "string" ? parsed.agentId : "",
            Number.isInteger(parsed.repairAttempt) ? String(parsed.repairAttempt) : "",
            typeof parsed.dispatchedAt === "string" ? parsed.dispatchedAt : "",
            typeof parsed.outputHash === "string" ? parsed.outputHash : "",
          ].join(":");
        } catch {
          executionIdentity = "invalid-payload";
        }
      }
      return `${artifact.artifact_key}=${String(artifact.status || "unknown")}@${executionIdentity}`;
    })
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .join(",");
  return `${String(input.authoringState ?? "")}|${clips}`;
}

/**
 * 纯函数：依据「当前进度指纹 + 已存水位标」决定本 tick 动作。
 * - 无水位标 / 指纹已变（真前进过）→ mark：以 now 为新停滞窗口起点。
 * - 指纹未变且未满窗口 → hold：保留原起点（绝不刷新，否则永远到不了窗口）。
 * - 指纹未变且卡满窗口 → cancel：判 authoring_failed。
 */
export function nextAuthoringStallDecision(input: {
  fingerprint: string;
  watermark: AuthoringStallWatermark | null | undefined;
  nowIso: string;
  stallCancelMs: number;
}): { action: "mark" | "hold" | "cancel"; watermark: AuthoringStallWatermark; stalledMs: number } {
  const prior = input.watermark;
  if (!prior || !prior.since || prior.fingerprint !== input.fingerprint) {
    return {
      action: "mark",
      watermark: { fingerprint: input.fingerprint, since: input.nowIso },
      stalledMs: 0,
    };
  }
  const elapsed = Date.parse(input.nowIso) - Date.parse(prior.since);
  const stalledMs = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  if (Number.isFinite(elapsed) && elapsed >= input.stallCancelMs) {
    return { action: "cancel", watermark: prior, stalledMs };
  }
  return { action: "hold", watermark: prior, stalledMs };
}

/** 读回水位标；payload 坏/缺当无水位标（下一 tick 重新 mark，绝不因脏数据误杀）。 */
export function parseAuthoringStallWatermark(payload: string | null | undefined): AuthoringStallWatermark | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { fingerprint?: unknown; since?: unknown };
    const fingerprint = typeof parsed.fingerprint === "string" ? parsed.fingerprint : "";
    const since = typeof parsed.since === "string" ? parsed.since : "";
    if (!since) return null;
    return { fingerprint, since };
  } catch {
    return null;
  }
}
