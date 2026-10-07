import { z } from "zod";
import { AppError } from "../../middleware/error";
import type { FlowRow } from "../flow/flow.repo";
import { generateVideoToCanvas, reconcileVideoNodesForFlow } from "./agents-tool-bridge.generate-video-to-canvas";
import { findFlowNode, freshReadFlowRow, readDurableNodeVideoUrl, type VideoFlowNode } from "./video-orchestrator.flow-io";
import { stableContentHash } from "./video-orchestrator.authoring.repo";
import {
  buildWorkflowVideoEffectRetryV2Identity,
  buildWorkflowVideoEffectV2Identity,
  WORKFLOW_VIDEO_EFFECT_OPERATION,
  type WorkflowVideoRetryAuthorization,
} from "./workflow-video-effect-claim";

export const CanvasVideoRetryArgsSchema = z.object({
  nodeId: z.string().trim().min(1),
  retryIndex: z.number().safe().int().min(1),
  idempotencyKey: z.string().trim().min(1),
}).strict();

type GenerateInput = Parameters<typeof generateVideoToCanvas>[0] & Readonly<{
  workflowRetryAuthorization?: WorkflowVideoRetryAuthorization;
}>;

const ATTEMPT_FIELDS = new Set([
  "taskId", "videoTaskId", "videoUrl", "videoResults", "thumbnailUrl", "videoPrimaryIndex",
  "assetId", "serverAssetId", "generatedAssetId", "errorCode", "errorMessage",
  "clipRunId", "runId", "clipId", "clipIndex", "orchestrated",
  "workflowSubmissionState", "workflowSubmissionClaimedAt", "workflowSubmissionAcceptedAt",
  "workflowSubmissionFailedAt", "workflowSubmissionError", "workflowMaterializedAt",
  "providerAcceptedAt", "videoPosterBackfillStatus", "videoPosterBackfillError",
]);

export function buildStoredVideoRetryNode(
  source: VideoFlowNode,
  flowId: string,
  retryIndex: number,
  workflowRetryAuthorization?: WorkflowVideoRetryAuthorization,
): VideoFlowNode {
  const identity = stableContentHash({ flowId, sourceNodeId: source.id, retryIndex });
  const executionFamilyId = typeof source.data.workflowExecutionFamilyId === "string" ? source.data.workflowExecutionFamilyId.trim() : "";
  const clipId = typeof source.data.workflowClipId === "string" ? source.data.workflowClipId.trim() : "";
  const effectOperation = typeof source.data.workflowEffectOperation === "string" ? source.data.workflowEffectOperation.trim() : "";
  const isWorkflowVideoEffectV2 = Boolean(executionFamilyId || clipId || effectOperation);
  if (isWorkflowVideoEffectV2 && (!executionFamilyId || !clipId || effectOperation !== WORKFLOW_VIDEO_EFFECT_OPERATION)) {
    throw new AppError("Workflow V2 video retry source identity is incomplete", {
      status: 409, code: "workflow_video_effect_identity_incomplete",
      details: { sourceCanvasNodeId: source.id, executionFamilyId: executionFamilyId || null, clipId: clipId || null, effectOperation: effectOperation || null },
    });
  }
  if (isWorkflowVideoEffectV2 && !workflowRetryAuthorization) {
    throw new AppError("Workflow V2 retries require an exact server-authorized failed media receipt", {
      status: 409, code: "workflow_video_retry_authorization_required",
      details: { sourceCanvasNodeId: source.id },
    });
  }
  const v2Identity = isWorkflowVideoEffectV2 && workflowRetryAuthorization
    ? buildWorkflowVideoEffectRetryV2Identity({ executionFamilyId, clipId, sourceCanvasNodeId: source.id,
      retryKey: workflowRetryAuthorization.retryKey })
    : null;
  if (workflowRetryAuthorization && (workflowRetryAuthorization.sourceCanvasNodeId !== source.id
    || workflowRetryAuthorization.retryIndex !== retryIndex)) {
    throw new AppError("Workflow video retry authorization does not match its append-only attempt", {
      status: 409, code: "workflow_video_retry_identity_conflict",
      details: { sourceCanvasNodeId: source.id, retryIndex },
    });
  }
  if (v2Identity && source.id !== buildWorkflowVideoEffectV2Identity({ executionFamilyId, clipId }).canvasNodeId) {
    throw new AppError("Workflow V2 retry source does not match its stable clip identity", {
      status: 409, code: "workflow_video_effect_identity_conflict",
      details: { sourceCanvasNodeId: source.id, executionFamilyId, clipId },
    });
  }
  const nodeId = v2Identity?.canvasNodeId ?? `video-retry-${identity}`;
  const effectId = v2Identity?.effectId ?? `video-retry-effect-${identity}`;
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
      workflowEffectId: effectId,
      workflowRuntimeNodeId: nodeId,
      videoRetrySourceNodeId: source.id,
      videoRetryIndex: retryIndex,
      ...(workflowRetryAuthorization ? {
        workflowVideoRetryAttempt: {
          sourceCanvasNodeId: workflowRetryAuthorization.sourceCanvasNodeId,
          failedCanvasNodeId: workflowRetryAuthorization.failedCanvasNodeId,
          failedTaskId: workflowRetryAuthorization.failedTaskId,
          executionId: workflowRetryAuthorization.executionId,
          runtimeNodeId: workflowRetryAuthorization.runtimeNodeId,
          retryKey: workflowRetryAuthorization.retryKey,
          retryIndex: workflowRetryAuthorization.retryIndex,
          idempotencyKey: workflowRetryAuthorization.idempotencyKey,
          preUpstreamRejected: workflowRetryAuthorization.preUpstreamRejected,
        },
        workflowExecutionId: workflowRetryAuthorization.executionId,
      } : {}),
    },
  };
}

export function matchesStoredVideoRetryNode(
  source: VideoFlowNode,
  candidate: VideoFlowNode,
  flowId: string,
): boolean {
  if (candidate.data.videoRetrySourceNodeId !== source.id || !Number.isSafeInteger(candidate.data.videoRetryIndex)
    || Number(candidate.data.videoRetryIndex) < 1) return false;
  const retryIndex = Number(candidate.data.videoRetryIndex);
  const executionFamilyId = typeof source.data.workflowExecutionFamilyId === "string" ? source.data.workflowExecutionFamilyId.trim() : "";
  const clipId = typeof source.data.workflowClipId === "string" ? source.data.workflowClipId.trim() : "";
  const effectOperation = typeof source.data.workflowEffectOperation === "string" ? source.data.workflowEffectOperation.trim() : "";
  if (executionFamilyId || clipId || effectOperation) {
    const attempt = candidate.data.workflowVideoRetryAttempt;
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
    const authorization = attempt as Record<string, unknown>;
    const idempotencyKey = typeof authorization.idempotencyKey === "string" ? authorization.idempotencyKey.trim() : "";
    const executionId = typeof authorization.executionId === "string" ? authorization.executionId.trim() : "";
    const failedCanvasNodeId = typeof authorization.failedCanvasNodeId === "string" ? authorization.failedCanvasNodeId.trim() : "";
    const retryKey = typeof authorization.retryKey === "string" ? authorization.retryKey.trim() : "";
    const runtimeNodeId = typeof authorization.runtimeNodeId === "string" ? authorization.runtimeNodeId.trim() : "";
    const failedTaskId = authorization.failedTaskId === null ? null
      : typeof authorization.failedTaskId === "string" ? authorization.failedTaskId.trim() : undefined;
    if (authorization.sourceCanvasNodeId !== source.id || !failedCanvasNodeId
      || authorization.retryIndex !== retryIndex || !retryKey || !runtimeNodeId || !executionId || !idempotencyKey
      || failedTaskId === undefined || authorization.preUpstreamRejected !== (failedTaskId === null)
      || candidate.data.videoRetryIdempotencyKey !== idempotencyKey
      || candidate.data.workflowExecutionId !== executionId
      || (retryIndex === 1 && failedCanvasNodeId !== source.id)) return false;
    try {
      const expected = buildWorkflowVideoEffectRetryV2Identity({ executionFamilyId, clipId,
        sourceCanvasNodeId: source.id, retryKey });
      return candidate.id === expected.canvasNodeId && candidate.data.workflowEffectId === expected.effectId;
    } catch {
      return false;
    }
  }
  try {
    return candidate.id === buildStoredVideoRetryNode(source, flowId, retryIndex).id;
  } catch {
    return false;
  }
}

export function findStoredVideoRetryAtIndex(
  row: FlowRow,
  source: VideoFlowNode,
  flowId: string,
  retryIndex: number,
): VideoFlowNode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const nodes = (parsed as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return null;
  const matches = nodes.filter((value): value is VideoFlowNode => Boolean(value) && typeof value === "object"
    && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string"
    && Boolean((value as Record<string, unknown>).data) && typeof (value as Record<string, unknown>).data === "object"
    && Number(((value as { data: Record<string, unknown> }).data).videoRetryIndex) === retryIndex
    && matchesStoredVideoRetryNode(source, value as VideoFlowNode, flowId));
  return matches.length === 1 ? matches[0] ?? null : null;
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
  const workflowRetryAuthorization = input.workflowRetryAuthorization;
  if (workflowRetryAuthorization && (workflowRetryAuthorization.sourceCanvasNodeId !== args.nodeId
    || workflowRetryAuthorization.retryIndex !== args.retryIndex
    || workflowRetryAuthorization.idempotencyKey !== args.idempotencyKey)) {
    throw new AppError("Workflow media retry authorization does not match the stored retry request", {
      status: 409, code: "workflow_video_retry_identity_conflict",
      details: { nodeId: args.nodeId, retryIndex: args.retryIndex },
    });
  }
  let row = await freshReadFlowRow(input);
  const source = findFlowNode(row, args.nodeId);
  if (!source || (source.data.kind !== "video" && source.data.kind !== "composeVideo")) {
    throw new AppError("Video retry source does not exist", { status: 404, code: "video_retry_source_missing" });
  }
  if (source.data.videoRetrySourceNodeId) throw new AppError("Retry must reference the original video node", {
    status: 400, code: "video_retry_original_required", details: { nodeId: source.data.videoRetrySourceNodeId },
  });
  const retryNode = buildStoredVideoRetryNode(source, input.flowId, args.retryIndex, workflowRetryAuthorization);
  retryNode.data.videoRetryIdempotencyKey = args.idempotencyKey;
  const existing = findFlowNode(row, retryNode.id);
  // A stable source/index pair cannot be multiplied by changing the request key.
  if (existing) {
    const existingIdempotencyKey = typeof existing.data.videoRetryIdempotencyKey === "string" ? existing.data.videoRetryIdempotencyKey.trim() : "";
    if (existingIdempotencyKey && existingIdempotencyKey !== args.idempotencyKey) {
      throw new AppError("The stored retry attempt is already bound to another idempotency key", {
        status: 409, code: "video_retry_idempotency_conflict",
        details: { nodeId: existing.id, retryIndex: args.retryIndex },
      });
    }
    return generateVideoToCanvas({ ...input, row, bodyArgs: { node: existing },
      ...(workflowRetryAuthorization ? { workflowRetryAuthorization } : {}) });
  }

  const predecessor = args.retryIndex === 1 ? source : findStoredVideoRetryAtIndex(row, source, input.flowId, args.retryIndex - 1);
  if (!predecessor) throw new AppError("Previous video attempt is missing", {
    status: 409, code: "video_retry_previous_attempt_missing",
  });
  if (workflowRetryAuthorization && workflowRetryAuthorization.failedCanvasNodeId !== predecessor.id) {
    throw new AppError("The authorized retry receipt is not the immediately preceding video attempt", {
      status: 409, code: "media_retry_failed_canvas_receipt_changed",
      details: { expectedFailedCanvasNodeId: predecessor.id, authorizedFailedCanvasNodeId: workflowRetryAuthorization.failedCanvasNodeId },
    });
  }
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
  } else if (predecessor.data.workflowSubmissionState !== "rejected_pre_upstream"
    && !(workflowRetryAuthorization?.preUpstreamRejected === true
      && workflowRetryAuthorization.failedCanvasNodeId === predecessor.id
      && workflowRetryAuthorization.failedTaskId === null
      && predecessor.data.workflowPreparedOnly === true
      && predecessor.data.status === "idle")) {
    throw new AppError("Prior submission has no confirmed rejection or receipt; duplicate submission is unsafe", {
      status: 409, code: "video_retry_submission_uncertain", details: { nodeId: predecessor.id },
    });
  }
  return generateVideoToCanvas({ ...input, row, bodyArgs: { node: retryNode },
    ...(workflowRetryAuthorization ? { workflowRetryAuthorization } : {}) });
}
