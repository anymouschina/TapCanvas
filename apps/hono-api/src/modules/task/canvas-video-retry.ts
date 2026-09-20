import { z } from "zod";
import { AppError } from "../../middleware/error";
import { generateVideoToCanvas, reconcileVideoNodesForFlow } from "./agents-tool-bridge.generate-video-to-canvas";
import { findFlowNode, freshReadFlowRow, readDurableNodeVideoUrl, type VideoFlowNode } from "./video-orchestrator.flow-io";
import { stableContentHash } from "./video-orchestrator.authoring.repo";

export const CanvasVideoRetryArgsSchema = z.object({
  nodeId: z.string().trim().min(1),
  retryIndex: z.number().int().min(1).max(2),
  idempotencyKey: z.string().trim().min(1),
}).strict();

type GenerateInput = Parameters<typeof generateVideoToCanvas>[0];

const ATTEMPT_FIELDS = new Set([
  "taskId", "videoTaskId", "videoUrl", "videoResults", "thumbnailUrl", "videoPrimaryIndex",
  "assetId", "serverAssetId", "generatedAssetId", "errorCode", "errorMessage",
  "clipRunId", "runId", "clipId", "clipIndex", "orchestrated",
  "workflowSubmissionState", "workflowSubmissionClaimedAt", "workflowSubmissionAcceptedAt",
  "workflowSubmissionFailedAt", "workflowSubmissionError", "workflowMaterializedAt",
  "providerAcceptedAt", "videoPosterBackfillStatus", "videoPosterBackfillError",
]);

export function buildStoredVideoRetryNode(source: VideoFlowNode, flowId: string, retryIndex: number): VideoFlowNode {
  const identity = stableContentHash({ flowId, sourceNodeId: source.id, retryIndex });
  const nodeId = `video-retry-${identity}`;
  const position = source.position as { x?: unknown; y?: unknown } | undefined;
  const data = Object.fromEntries(Object.entries(source.data).filter(([key]) => !ATTEMPT_FIELDS.has(key)));
  return {
    ...source,
    id: nodeId,
    ...(position && typeof position.x === "number" && typeof position.y === "number" ? { position: { x: position.x, y: position.y + 280 * retryIndex } } : {}),
    data: {
      ...data,
      kind: "video",
      status: "queued",
      workflowEffectId: `video-retry-effect-${identity}`,
      workflowRuntimeNodeId: nodeId,
      videoRetrySourceNodeId: source.id,
      videoRetryIndex: retryIndex,
    },
  };
}

/** Replays persisted generation inputs; it never asks an LLM to recreate a shot plan. */
export async function retryCanvasVideo(input: GenerateInput) {
  const result = await executeStoredVideoRetry(input);
  return {
    ...result,
    deliveryKind: "video" as const,
    ...("taskId" in result && result.taskId ? {
      inspection: { toolName: "tapcanvas_video_reconcile", args: { nodeId: result.nodeId, taskId: result.taskId } },
    } : {}),
  };
}

async function executeStoredVideoRetry(input: GenerateInput) {
  const parsed = CanvasVideoRetryArgsSchema.safeParse(input.bodyArgs);
  if (!parsed.success) throw new AppError("Invalid stored video retry request", {
    status: 400, code: "invalid_video_retry_request", details: { issues: parsed.error.issues },
  });
  const args = parsed.data;
  let row = await freshReadFlowRow(input);
  const source = findFlowNode(row, args.nodeId);
  if (!source || (source.data.kind !== "video" && source.data.kind !== "composeVideo")) {
    throw new AppError("Video retry source does not exist", { status: 404, code: "video_retry_source_missing" });
  }
  if (source.data.videoRetrySourceNodeId) throw new AppError("Retry must reference the original video node", {
    status: 400, code: "video_retry_original_required", details: { nodeId: source.data.videoRetrySourceNodeId },
  });
  const retryNode = buildStoredVideoRetryNode(source, input.flowId, args.retryIndex);
  retryNode.data.videoRetryIdempotencyKey = args.idempotencyKey;
  const existing = findFlowNode(row, retryNode.id);
  // A stable source/index pair cannot be multiplied by changing the request key.
  if (existing) return generateVideoToCanvas({ ...input, row, bodyArgs: { node: existing } });

  const predecessor = args.retryIndex === 1 ? source : findFlowNode(row,
    buildStoredVideoRetryNode(source, input.flowId, args.retryIndex - 1).id);
  if (!predecessor) throw new AppError("Previous video attempt is missing", {
    status: 409, code: "video_retry_previous_attempt_missing",
  });
  const previousUrl = readDurableNodeVideoUrl(predecessor);
  if (previousUrl) return { ok: true, reused: true, status: "success", nodeId: predecessor.id, videoUrl: previousUrl };
  const taskId = typeof predecessor.data.taskId === "string" ? predecessor.data.taskId
    : typeof predecessor.data.videoTaskId === "string" ? predecessor.data.videoTaskId : "";
  if (taskId) {
    const receipt = await reconcileVideoNodesForFlow({ ...input, row, target: { nodeId: predecessor.id, taskId } });
    row = await freshReadFlowRow(input);
    const current = findFlowNode(row, predecessor.id);
    const recoveredUrl = readDurableNodeVideoUrl(current);
    if (recoveredUrl) return { ok: true, reused: true, status: "success", nodeId: predecessor.id, taskId, videoUrl: recoveredUrl };
    const confirmedFailed = receipt.details.some(detail => detail.nodeId === predecessor.id && detail.taskId === taskId && detail.providerConfirmedFailure === true);
    if (!confirmedFailed) return { ok: true, reused: true, status: receipt.details.some(detail => detail.status === "running") ? "running" : "awaiting_receipt_confirmation", nodeId: predecessor.id, taskId, receipt };
  } else if (predecessor.data.workflowSubmissionState !== "rejected_pre_upstream") {
    throw new AppError("Prior submission has no confirmed rejection or receipt; duplicate submission is unsafe", {
      status: 409, code: "video_retry_submission_uncertain", details: { nodeId: predecessor.id },
    });
  }
  return generateVideoToCanvas({ ...input, row, bodyArgs: { node: retryNode } });
}
