import { z } from "zod";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  PublicFlowCreateTaskNodeSchema,
  PublicFlowGraphSchema,
  PublicFlowPatchResponseSchema,
} from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  createFlowVersion,
  mapFlowRowToDto,
  updateFlow,
  updateFlowByIdUnsafe,
  type FlowRow,
} from "../flow/flow.repo";
import { runPublicTask } from "../apiKey/apiKey.routes";
import { fetchTaskResultForPolling } from "./task.polling";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readTrimmedString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeVideoResolution(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toLowerCase() : "";
}

function buildVideoBillingSpecKey(
  resolution: string,
  durationSeconds: number | null,
): string {
  const normalizedResolution = normalizeVideoResolution(resolution);
  const normalizedDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? Math.trunc(durationSeconds)
      : 0;
  if (!normalizedResolution || normalizedDuration <= 0) return "";
  return `video:${normalizedResolution}:${normalizedDuration}s`;
}

type CanvasAssetInput = {
  assetId?: string;
  assetRefId?: string;
  url?: string;
  role?: string;
  note?: string;
  name?: string;
};

function normalizeAssetInputs(value: unknown): CanvasAssetInput[] {
  if (!Array.isArray(value)) return [];
  const out: CanvasAssetInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const assetId = readTrimmedString(record.assetId);
    const assetRefId = readTrimmedString(record.assetRefId);
    const url = readTrimmedString(record.url);
    const role = readTrimmedString(record.role);
    const note = readTrimmedString(record.note);
    const name = readTrimmedString(record.name);
    if (!assetId && !url) continue;
    out.push({
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
      ...(url ? { url } : {}),
      ...(role ? { role } : {}),
      ...(note ? { note } : {}),
      ...(name ? { name } : {}),
    });
  }
  return out;
}

function extractVideoAssetFromTaskResult(result: unknown): {
	videoUrl: string;
	thumbnailUrl: string | null;
	assetId: string | null;
} {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { videoUrl: "", thumbnailUrl: null, assetId: null };
  }
  const record = result as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const item of assets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const assetRecord = item as Record<string, unknown>;
    const url = readTrimmedString(assetRecord.url);
    if (!url) continue;
    const type = readTrimmedString(assetRecord.type).toLowerCase();
    if (!type || type === "video") {
      return {
        videoUrl: url,
        thumbnailUrl: readTrimmedString(assetRecord.thumbnailUrl) || null,
        assetId: readTrimmedString(assetRecord.assetId) || null,
      };
    }
  }
  const directVideoUrl = readTrimmedString(record.videoUrl);
  if (directVideoUrl) {
    return {
      videoUrl: directVideoUrl,
      thumbnailUrl: readTrimmedString(record.videoThumbnailUrl) || null,
      assetId: null,
    };
  }
  const videoResults = Array.isArray(record.videoResults) ? record.videoResults : [];
  for (const item of videoResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const assetRecord = item as Record<string, unknown>;
    const url = readTrimmedString(assetRecord.url);
    if (!url) continue;
    return {
      videoUrl: url,
      thumbnailUrl: readTrimmedString(assetRecord.thumbnailUrl) || null,
      assetId: readTrimmedString(assetRecord.assetId) || null,
    };
  }
  return { videoUrl: "", thumbnailUrl: null, assetId: null };
}

function buildFailureMessage(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const record = result as Record<string, unknown>;
  const parts = [
    readTrimmedString(record.message),
    readTrimmedString(record.error),
    (() => {
      const nested = record.raw;
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) return "";
      const nestedRecord = nested as Record<string, unknown>;
      return (
        readTrimmedString(nestedRecord.message) ||
        readTrimmedString(nestedRecord.error)
      );
    })(),
  ].filter(Boolean);
  return parts.join(" | ");
}

const VideoCanvasNodeKindSchema = z.enum(["composeVideo", "video"]);

export const PublicAgentsVideoGenerateToCanvasArgsSchema = z.object({
  node: PublicFlowCreateTaskNodeSchema.superRefine((node, ctx) => {
    if (!VideoCanvasNodeKindSchema.safeParse(node.data.kind).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "node.data.kind must be composeVideo or video",
        path: ["data", "kind"],
      });
    }
    const prompt = readTrimmedString((node.data as Record<string, unknown>).prompt);
    if (!prompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "node.data.prompt is required",
        path: ["data", "prompt"],
      });
    }
  }),
  vendorCandidates: z.array(z.string().min(1)).optional(),
});

export type PublicAgentsVideoGenerateToCanvasArgs = z.infer<
  typeof PublicAgentsVideoGenerateToCanvasArgsSchema
>;

export type PublicAgentsVideoGenerateToCanvasResult = {
  ok: true;
  flowId: string;
  updatedAt: string;
  stats: {
    createdNodes: number;
    createdEdges: number;
    patchedNodes: number;
    appendedArrays: number;
  };
  nodeId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  vendor: string;
  taskId: string | null;
};

async function awaitVideoResult(input: {
  c: AppContext;
  userId: string;
  vendor: string;
  initialResult: TaskResultDto;
  prompt: string;
  taskKind: TaskRequestDto["kind"];
}): Promise<{
  vendor: string;
  result: TaskResultDto;
  taskId: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  assetId: string | null;
}> {
  let currentVendor = input.vendor;
  let currentResult = input.initialResult;
  let extracted = extractVideoAssetFromTaskResult(currentResult);
  let status = readTrimmedString(currentResult.status).toLowerCase();
  let taskId = readTrimmedString(currentResult.id) || null;
  if (extracted.videoUrl && status === "succeeded") {
    return {
      vendor: currentVendor,
      result: currentResult,
      taskId,
      videoUrl: extracted.videoUrl,
      thumbnailUrl: extracted.thumbnailUrl,
      assetId: extracted.assetId,
    };
  }

  if ((status === "queued" || status === "running") && taskId) {
    const timeoutMs = 600_000;
    const intervalMs = 3_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const outcome = await fetchTaskResultForPolling(input.c, input.userId, {
        taskId,
        vendor: currentVendor,
        taskKind: input.taskKind,
        prompt: input.prompt,
        mode: "public",
      });
      if (outcome.ok) {
        currentVendor = readTrimmedString(outcome.vendor) || currentVendor;
        currentResult = outcome.result;
        extracted = extractVideoAssetFromTaskResult(currentResult);
        status = readTrimmedString(currentResult.status).toLowerCase();
        if (status === "succeeded" && extracted.videoUrl) {
          return {
            vendor: currentVendor,
            result: currentResult,
            taskId,
            videoUrl: extracted.videoUrl,
            thumbnailUrl: extracted.thumbnailUrl,
            assetId: extracted.assetId,
          };
        }
        if (status === "failed") break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  if (status === "queued" || status === "running") {
    throw new AppError("视频生成超时：任务仍未完成", {
      status: 504,
      code: "agents_tool_video_generate_timeout",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
      },
    });
  }

  if (status !== "succeeded") {
    throw new AppError("视频生成失败", {
      status: 502,
      code: "agents_tool_video_generate_failed",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
        message: buildFailureMessage(currentResult) || null,
      },
    });
  }

  if (!extracted.videoUrl) {
    throw new AppError("视频生成失败：未返回视频 URL", {
      status: 502,
      code: "agents_tool_video_missing_url",
      details: {
        taskId,
        vendor: currentVendor || null,
      },
    });
  }

  return {
    vendor: currentVendor,
    result: currentResult,
    taskId,
    videoUrl: extracted.videoUrl,
    thumbnailUrl: extracted.thumbnailUrl,
    assetId: extracted.assetId,
  };
}

export async function generateVideoToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: unknown;
}): Promise<PublicAgentsVideoGenerateToCanvasResult> {
  const parsedArgs = PublicAgentsVideoGenerateToCanvasArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid video generate to canvas request", {
      status: 400,
      code: "invalid_video_generate_to_canvas_request",
      details: { issues: parsedArgs.error.issues },
    });
  }

  const taskNode = parsedArgs.data.node;
  const nodeData = taskNode.data as Record<string, unknown>;
  const prompt = readTrimmedString(nodeData.prompt);
  const negativePrompt = readTrimmedString(nodeData.negativePrompt);
  const modelAlias = readTrimmedString(nodeData.modelAlias);
  const modelKey =
    readTrimmedString(nodeData.modelKey) || readTrimmedString(nodeData.videoModel);
  const aspectRatio =
    readTrimmedString(nodeData.aspectRatio) || readTrimmedString(nodeData.aspect);
  const size =
    readTrimmedString(nodeData.videoSize) || readTrimmedString(nodeData.size);
  const resolution = normalizeVideoResolution(
    nodeData.videoResolution ?? nodeData.resolution,
  );
  const orientation = readTrimmedString(nodeData.orientation);
  const durationSeconds =
    normalizePositiveInteger(nodeData.durationSeconds) ??
    normalizePositiveInteger(nodeData.videoDurationSeconds);
  const specKey =
    readTrimmedString(nodeData.videoSpecKey) ||
    readTrimmedString(nodeData.specKey) ||
    buildVideoBillingSpecKey(resolution, durationSeconds);
  const firstFrameUrl =
    readTrimmedString(nodeData.firstFrameUrl) ||
    readTrimmedString(nodeData.veoFirstFrameUrl);
  const lastFrameUrl =
    readTrimmedString(nodeData.lastFrameUrl) ||
    readTrimmedString(nodeData.veoLastFrameUrl);
  const referenceImages = normalizeStringList(nodeData.referenceImages);
  const assetInputs = normalizeAssetInputs(nodeData.assetInputs);
  const referenceAssetIds = normalizeStringList(nodeData.referenceAssetIds);
  const firstFrameAssetId = readTrimmedString(nodeData.firstFrameAssetId);
  const lastFrameAssetId = readTrimmedString(nodeData.lastFrameAssetId);
  const inferredVendorCandidate =
    readTrimmedString(nodeData.videoModelVendor) || readTrimmedString(nodeData.vendor);
  const hasReferenceInputs =
    Boolean(firstFrameUrl) ||
    Boolean(lastFrameUrl) ||
    Boolean(firstFrameAssetId) ||
    Boolean(lastFrameAssetId) ||
    referenceImages.length > 0 ||
    assetInputs.length > 0 ||
    referenceAssetIds.length > 0;
  const taskKind: TaskRequestDto["kind"] = hasReferenceInputs
    ? "image_to_video"
    : "text_to_video";
  const taskRequest: TaskRequestDto = {
    kind: taskKind,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    extras: {
      ...(modelAlias ? { modelAlias } : {}),
      ...(modelKey ? { modelKey } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(size ? { size } : {}),
      ...(resolution ? { resolution } : {}),
      ...(specKey ? { specKey, videoSpecKey: specKey } : {}),
      ...(orientation ? { orientation } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(firstFrameUrl ? { firstFrameUrl } : {}),
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(assetInputs.length ? { assetInputs } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(firstFrameAssetId ? { firstFrameAssetId } : {}),
      ...(lastFrameAssetId ? { lastFrameAssetId } : {}),
      persistAssets: true,
    },
  };

  const vendorCandidates =
    parsedArgs.data.vendorCandidates?.length
      ? parsedArgs.data.vendorCandidates
      : inferredVendorCandidate
        ? [inferredVendorCandidate]
        : undefined;

  const created = await runPublicTask(input.c, input.requestUserId, {
    vendor: "auto",
    ...(vendorCandidates ? { vendorCandidates } : {}),
    request: taskRequest,
  });

  const completed = await awaitVideoResult({
    c: input.c,
    userId: input.requestUserId,
    vendor: readTrimmedString(created.vendor) || "auto",
    initialResult: created.result,
    prompt,
    taskKind,
  });

  const nodeId = readTrimmedString(taskNode.id) || crypto.randomUUID();
  const label = readTrimmedString(nodeData.label) || "Generated Video";
  const resolvedVideoModel = readTrimmedString(nodeData.videoModel) || modelKey || modelAlias;
  const finalNode = {
    ...taskNode,
    id: nodeId,
    data: {
      ...nodeData,
      status: "success",
      videoUrl: completed.videoUrl,
      ...(completed.thumbnailUrl ? { videoThumbnailUrl: completed.thumbnailUrl } : {}),
      videoResults: [
        {
          url: completed.videoUrl,
          ...(completed.thumbnailUrl ? { thumbnailUrl: completed.thumbnailUrl } : {}),
          title: label,
          ...(completed.assetId ? { assetId: completed.assetId } : {}),
          ...(durationSeconds ? { duration: durationSeconds } : {}),
        },
      ],
      videoPrimaryIndex: 0,
      ...(completed.assetId ? { assetId: completed.assetId } : {}),
      ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}),
      ...(completed.taskId ? { taskId: completed.taskId, videoTaskId: completed.taskId } : {}),
      ...(completed.vendor
        ? { vendor: completed.vendor, videoModelVendor: completed.vendor }
        : {}),
      ...(resolvedVideoModel ? { videoModel: resolvedVideoModel } : {}),
    },
  };

  const dto = mapFlowRowToDto(input.row);
  const current = sanitizeFlowDataForStorage(dto.data ?? {});
  const applied = applyPublicFlowGraphPatch({
    current,
    patch: {
      createNodes: [finalNode],
    },
  });
  const nowIso = new Date().toISOString();
  const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
  const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
  if (!nextParsed.success) {
    throw new AppError("Flow patch produced invalid data", {
      status: 500,
      code: "flow_patch_invalid",
      details: { issues: nextParsed.error.issues },
    });
  }
  const nextJson = JSON.stringify(sanitizedNext ?? {});
  const updated = input.devBypass
    ? await updateFlowByIdUnsafe(input.c.env.DB, {
        id: input.flowId,
        name: input.row.name,
        data: nextJson,
        nowIso,
      })
    : await updateFlow(input.c.env.DB, {
        id: input.flowId,
        name: input.row.name,
        data: nextJson,
        ownerId: input.requestUserId,
        projectId: input.row.project_id,
        nowIso,
      });
  if (!updated) {
    throw new AppError("Flow not found", {
      status: 404,
      code: "flow_not_found",
    });
  }

  const versionUserId = input.devBypass
    ? readTrimmedString(input.row.owner_id) || input.requestUserId
    : input.requestUserId;
  await createFlowVersion(input.c.env.DB, {
    id: crypto.randomUUID(),
    flowId: updated.id,
    name: updated.name,
    data: updated.data,
    userId: versionUserId,
    nowIso,
  });

  const response = PublicFlowPatchResponseSchema.parse({
    ok: true,
    flowId: updated.id,
    updatedAt: updated.updated_at,
    stats: applied.stats,
    data: nextParsed.data,
  });

  return {
    ok: true,
    flowId: response.flowId,
    updatedAt: response.updatedAt,
    stats: response.stats,
    nodeId,
    videoUrl: completed.videoUrl,
    thumbnailUrl: completed.thumbnailUrl,
    vendor: completed.vendor,
    taskId: completed.taskId,
  };
}
