import {
  type VideoAuthoringState,
} from "@tapcanvas/video-orchestrator-protocol";

/**
 * commit_beats 创作半场与花钱半场之间的结构性边界。
 *
 * 只要 run.authoring_state 非空，estimate/start 就不能再把它当作旧 add_clips run：
 * - driver 仅可在 speaker coverage 已 ready 后从 script_approved/assets_ready 做 estimate；
 * - 外部调用仅可在 estimate_ready（或已经完整交棒的 authoring_done）重估/起跑；
 * - 任何其它状态原地失败，禁止用历史 story_plan 或 estimate 缓存绕过前置资产验真。
 */

export const SPEAKER_COVERAGE_ARTIFACT_KEY = "asset:speaker-coverage";
export const AUTHORING_PRODUCTION_CONFLICT_ARTIFACT_KEY = "authoring:production-state-conflict";

export const PRE_HANDOFF_AUTHORING_STATES = [
  "beats_committed",
  "writing_dispatched",
  "assembled",
  "script_approved",
  "deriving_assets",
  "asset_repair_required",
  "assets_ready",
] as const satisfies readonly VideoAuthoringState[];

export function isPreHandoffAuthoringState(value: unknown): value is VideoAuthoringState {
  return typeof value === "string" &&
    (PRE_HANDOFF_AUTHORING_STATES as readonly string[]).includes(value);
}

/**
 * 读取 authoring driver 因 productionState 意外离开 collecting 而归档前一态时写下的事实。
 * 这是恢复合同的一部分：只接受 ready 的结构化 artifact 和 protocol authoring state，
 * 不从错误文案或画布内容猜测应回到哪一阶段。
 */
export function readProductionConflictRecoveryState(input: {
  artifactKey: string;
  status: string;
  payload: string | null;
}): VideoAuthoringState | null {
  if (
    input.artifactKey !== AUTHORING_PRODUCTION_CONFLICT_ARTIFACT_KEY ||
    input.status !== "ready" ||
    !input.payload
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(input.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      record.code !== "authoring_production_state_conflict" ||
      record.productionState !== "cancelled"
    ) {
      return null;
    }
    return isPreHandoffAuthoringState(record.authoringState)
      ? record.authoringState
      : null;
  } catch {
    return null;
  }
}

export type AuthoringProductionStateGateDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "authoring_production_state_conflict";
      message: string;
    };

/**
 * authoring 尚未完成 estimate/交棒时，生产态只能是 collecting。
 *
 * 该结构闸防止非法的手工 estimate/start 已把生产推进后，writer/装配器/资产 builder 仍回灌并
 * 覆盖正在生成的视频计划。冲突只会终止 authoring 写入并留痕；不会取消生产、删除或覆盖资产。
 */
export function evaluateAuthoringProductionStateGate(input: {
  authoringState: string | null;
  productionState: string | null;
}): AuthoringProductionStateGateDecision {
  const authoringState = String(input.authoringState ?? "").trim();
  const productionState = String(input.productionState ?? "").trim();
  if (!isPreHandoffAuthoringState(authoringState) || productionState === "collecting") {
    return { allowed: true };
  }
  return {
    allowed: false,
    code: "authoring_production_state_conflict",
    message:
      `authoringState=${authoringState} 尚未交棒，但 productionState=${productionState || "missing"} 已离开 collecting。` +
      "已停止后续 authoring 回灌以保护正在生成或已生成资产；不会自动取消生产，也不会覆盖 storyPlan。",
  };
}

export type AuthoringPaidOperation = "estimate" | "start";

export type AuthoringPaidOperationGateInput = {
  operation: AuthoringPaidOperation;
  authoringState: string | null;
  speakerCoverageStatus: string | null;
  speakerCoveragePlanFingerprint: string | null;
  actualPlanFingerprint: string;
  invokedByAuthoringDriver?: boolean;
};

export type AuthoringPaidOperationGateDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export function evaluateAuthoringPaidOperationGate(
  input: AuthoringPaidOperationGateInput,
): AuthoringPaidOperationGateDecision {
  const state = String(input.authoringState ?? "").trim();
  if (!state) return { allowed: true };

  const operationReady =
    input.operation === "estimate"
      ? input.invokedByAuthoringDriver === true
        ? state === "script_approved" || state === "assets_ready"
        : state === "estimate_ready" || state === "authoring_done"
      : state === "estimate_ready" || state === "authoring_done";

  if (!operationReady) {
    return {
      allowed: false,
      code: `authoring_not_ready_for_${input.operation}`,
      message:
        `Run 已由 commit_beats 状态机接管，当前 authoringState=${state}，禁止手工 ${input.operation} ` +
        "绕过单 clip 写作、确定性装配与前置资产验真。只查询 mode:\"status\"；修复失败须显式提交完整 Keyframe BeatSheet v2，" +
        "不得回填历史 storyPlan、旧 BeatSheet 或空 clips。",
    };
  }

  if (input.speakerCoverageStatus !== "ready") {
    return {
      allowed: false,
      code: "speaker_coverage_not_ready",
      message:
        `Run 的 ${SPEAKER_COVERAGE_ARTIFACT_KEY} 状态为 ${input.speakerCoverageStatus ?? "missing"}，` +
        `禁止 ${input.operation}。角色图与配音 coverage 必须在 authoring 前置资产阶段以真实 URL/voiceId 验真并写成 ready。`,
    };
  }

  if (
    !input.speakerCoveragePlanFingerprint ||
    input.speakerCoveragePlanFingerprint !== input.actualPlanFingerprint
  ) {
    return {
      allowed: false,
      code: "speaker_coverage_plan_mismatch",
      message:
        `Run 的 speaker coverage 证据不属于本次实际执行计划（artifact=${input.speakerCoveragePlanFingerprint ?? "missing"}, actual=${input.actualPlanFingerprint}）。` +
        "计划或说话人合同发生变化后必须回到 commit_beats authoring 重新验真，禁止沿用旧 ready 工件。",
    };
  }

  return { allowed: true };
}
