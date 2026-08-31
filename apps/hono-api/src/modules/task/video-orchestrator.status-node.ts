import type { AppContext } from "../../types";
import { VIDEO_RUN_STATUS_PROJECTION_OWNER } from "@tapcanvas/video-orchestrator-protocol";
import {
  findFlowNode,
  freshReadFlowRow,
  persistFlowPatch,
} from "./video-orchestrator.flow-io";
import type { VideoAssetRepairDeclaration } from "./video-orchestrator.asset-repair";

export const VIDEO_RUN_STATUS_NODE_ID = "video-run-status";
export { VIDEO_RUN_STATUS_PROJECTION_OWNER };

export type VideoRunStatusNodeInput = {
  c: AppContext;
  runId: string;
  runCreatedAt: string;
  ownerId: string;
  flowId?: string | null;
  chapterId?: string | null;
  authoringState?: string | null;
  statusLine: string;
  productionState?: string;
  videoUrl?: string;
  /**
   * 后台状态机在确实缺少用户事实、范围或权限时写入的可恢复动作合同。
   * 视频 estimate/start 不使用此字段做二次确认。
   */
  pendingUserInput?: {
    requestId: string;
    questions: Array<{
      id: string;
      header: string;
      question: string;
      options: Array<{ label: string; description?: string }>;
    }>;
  };
  /** 同一 authoring run 的前置身份资产修复合同。 */
  assetRepair?: VideoAssetRepairDeclaration;
};

export type VideoRunStatusProjection =
  | { status: "updated" }
  | { status: "unchanged" }
  | { status: "ignored_stale"; currentRunId: string }
  | { status: "not_applicable"; reason: "flow_and_chapter_missing" }
  | { status: "flow_not_found"; reason: string }
  | { status: "failed"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectionValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => projectionValueEquals(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] && projectionValueEquals(left[key], right[key]),
  );
}

function hasIdenticalManagedProjection(
  existingData: Record<string, unknown>,
  nextData: Record<string, unknown>,
): boolean {
  return Object.entries(nextData).every(([key, value]) =>
    projectionValueEquals(existingData[key], value),
  );
}

/** 将 authoring 与 production 的事实投影到同一个幂等画布状态节点。 */
export async function upsertVideoRunStatusNode(
  input: VideoRunStatusNodeInput,
): Promise<VideoRunStatusProjection> {
  if (!input.flowId && !input.chapterId) {
    return { status: "not_applicable", reason: "flow_and_chapter_missing" };
  }
  try {
    const nodeId = VIDEO_RUN_STATUS_NODE_ID;
    const row = await freshReadFlowRow({
      c: input.c,
      flowId: input.flowId ?? "",
      requestUserId: input.ownerId,
      devBypass: true,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
    if (!row) {
      return {
        status: "flow_not_found",
        reason: `无法读取 run ${input.runId} 对应的 flow/chapter`,
      };
    }
    const existingNode = findFlowNode(row, nodeId);
    const existingData = existingNode?.data && typeof existingNode.data === "object"
      ? existingNode.data
      : {};
    const currentRunId = typeof existingData.runId === "string"
      ? existingData.runId.trim()
      : "";
    const currentRunCreatedAt = typeof existingData.runCreatedAt === "string"
      ? existingData.runCreatedAt.trim()
      : "";
    if (
      currentRunId &&
      currentRunId !== input.runId &&
      currentRunCreatedAt &&
      currentRunCreatedAt > input.runCreatedAt
    ) {
      return { status: "ignored_stale", currentRunId };
    }
    const data: Record<string, unknown> = {
      kind: "text",
      label: "整片生成",
      prompt: input.statusLine,
      managedProjection: VIDEO_RUN_STATUS_PROJECTION_OWNER,
      runId: input.runId,
      runCreatedAt: input.runCreatedAt,
      authoringState: input.authoringState ?? null,
      productionState: input.productionState ?? null,
      videoUrl: input.videoUrl ?? null,
      pendingUserInput: input.pendingUserInput ?? null,
      assetRepairRequired: input.assetRepair ? true : false,
      assetRepair: input.assetRepair ?? null,
    };
    const exists = Boolean(existingNode);
    if (exists && hasIdenticalManagedProjection(existingData, data)) {
      return { status: "unchanged" };
    }
    await persistFlowPatch({
      c: input.c,
      row,
      flowId: input.flowId ?? "",
      requestUserId: input.ownerId,
      devBypass: true,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      affectedNodeIds: [nodeId],
      patch: exists
        ? { patchNodeData: [{ id: nodeId, data }], allowOverwrite: true }
        : { createNodes: [{ id: nodeId, type: "taskNode", position: { x: -420, y: 0 }, data }] },
    });
    return { status: "updated" };
  } catch (error) {
    const reason = String((error as Error).message || error).slice(0, 300);
    console.error(`[video-run-status] 画布状态投影失败: ${reason}`);
    return { status: "failed", reason };
  }
}
