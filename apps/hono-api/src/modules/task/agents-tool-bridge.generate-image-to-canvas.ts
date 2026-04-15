import { z } from "zod";
import { loadImageViewControlsModule } from "../../platform/node/shared-schema-loader";

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

const DEFAULT_IMAGE_GENERATE_MODEL_ALIAS = "gemini-3.1-flash-image-preview";
const { appendImageViewPrompt } = loadImageViewControlsModule();

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

function extractImageUrlFromTaskResult(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const record = result as Record<string, unknown>;
  const direct = readTrimmedString(record.imageUrl);
  if (direct) return direct;
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : [];
  for (const item of imageResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = readTrimmedString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const item of assets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = readTrimmedString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  return "";
}

function extractImageAssetIdFromTaskResult(result: unknown, imageUrl: string): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const normalizedUrl = readTrimmedString(imageUrl);
  const record = result as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const item of assets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const assetRecord = item as Record<string, unknown>;
    const url = readTrimmedString(assetRecord.url);
    if (normalizedUrl && url !== normalizedUrl) continue;
    return readTrimmedString(assetRecord.assetId);
  }
  return "";
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

const ImageCanvasNodeKindSchema = z.enum(["image", "imageEdit", "storyboardImage"]);

export const PublicAgentsImageGenerateToCanvasArgsSchema = z.object({
  node: PublicFlowCreateTaskNodeSchema.superRefine((node, ctx) => {
    if (!ImageCanvasNodeKindSchema.safeParse(node.data.kind).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "node.data.kind must be image, imageEdit, or storyboardImage",
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

export type PublicAgentsImageGenerateToCanvasArgs = z.infer<
  typeof PublicAgentsImageGenerateToCanvasArgsSchema
>;

export type PublicAgentsImageGenerateToCanvasResult = {
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
  imageUrl: string;
  vendor: string;
  taskId: string | null;
};

async function awaitImageResult(input: {
  c: AppContext;
  userId: string;
  vendor: string;
  initialResult: TaskResultDto;
  prompt: string;
  taskKind: TaskRequestDto["kind"];
}): Promise<{ vendor: string; result: TaskResultDto; taskId: string | null; imageUrl: string }> {
  let currentVendor = input.vendor;
  let currentResult = input.initialResult;
  let imageUrl = extractImageUrlFromTaskResult(currentResult);
  let status = readTrimmedString(currentResult.status).toLowerCase();
  let taskId = readTrimmedString(currentResult.id) || null;
  if (imageUrl && status === "succeeded") {
    return { vendor: currentVendor, result: currentResult, taskId, imageUrl };
  }

  if ((status === "queued" || status === "running") && taskId) {
    const timeoutMs = 180_000;
    const intervalMs = 1_500;
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
        imageUrl = extractImageUrlFromTaskResult(currentResult);
        status = readTrimmedString(currentResult.status).toLowerCase();
        if (status === "succeeded" && imageUrl) {
          return { vendor: currentVendor, result: currentResult, taskId, imageUrl };
        }
        if (status === "failed") break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  if (status === "queued" || status === "running") {
    throw new AppError("图片生成超时：任务仍未完成", {
      status: 504,
      code: "agents_tool_image_generate_timeout",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
      },
    });
  }

  if (status !== "succeeded") {
    throw new AppError("图片生成失败", {
      status: 502,
      code: "agents_tool_image_generate_failed",
      details: {
        taskId,
        vendor: currentVendor || null,
        status: status || null,
        message: buildFailureMessage(currentResult) || null,
      },
    });
  }

  if (!imageUrl) {
    throw new AppError("图片生成失败：未返回图片 URL", {
      status: 502,
      code: "agents_tool_image_missing_url",
      details: {
        taskId,
        vendor: currentVendor || null,
      },
    });
  }

  return { vendor: currentVendor, result: currentResult, taskId, imageUrl };
}

export async function generateImageToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: unknown;
}): Promise<PublicAgentsImageGenerateToCanvasResult> {
  const parsedArgs = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) {
    throw new AppError("Invalid image generate to canvas request", {
      status: 400,
      code: "invalid_image_generate_to_canvas_request",
      details: { issues: parsedArgs.error.issues },
    });
  }

  const taskNode = parsedArgs.data.node;
  const nodeData = taskNode.data as Record<string, unknown>;
  const prompt = appendImageViewPrompt(readTrimmedString(nodeData.prompt), {
    cameraControl: nodeData.imageCameraControl,
    lightingRig: nodeData.imageLightingRig,
  });
  const negativePrompt = readTrimmedString(nodeData.negativePrompt);
  const systemPrompt = readTrimmedString(nodeData.systemPrompt);
  const modelAlias =
    readTrimmedString(nodeData.modelAlias) ||
    readTrimmedString(nodeData.imageModel) ||
    DEFAULT_IMAGE_GENERATE_MODEL_ALIAS;
  const modelKey = readTrimmedString(nodeData.modelKey);
  const aspectRatio = readTrimmedString(nodeData.aspectRatio);
  const referenceImages = normalizeStringList(nodeData.referenceImages);
  const assetInputs = normalizeAssetInputs(nodeData.assetInputs);
  const taskKind: TaskRequestDto["kind"] =
    referenceImages.length > 0 || assetInputs.length > 0 ? "image_edit" : "text_to_image";
  const taskRequest: TaskRequestDto = {
    kind: taskKind,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    extras: {
      ...(modelAlias ? { modelAlias } : {}),
      ...(modelKey ? { modelKey } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(assetInputs.length ? { assetInputs } : {}),
      persistAssets: true,
    },
  };

  const created = await runPublicTask(input.c, input.requestUserId, {
    vendor: "auto",
    ...(parsedArgs.data.vendorCandidates?.length
      ? { vendorCandidates: parsedArgs.data.vendorCandidates }
      : {}),
    request: taskRequest,
  });

  const completed = await awaitImageResult({
    c: input.c,
    userId: input.requestUserId,
    vendor: readTrimmedString(created.vendor) || "auto",
    initialResult: created.result,
    prompt,
    taskKind,
  });

  const nodeId = readTrimmedString(taskNode.id) || crypto.randomUUID();
  const label = readTrimmedString(nodeData.label) || "Generated Image";
  const generatedAssetId = extractImageAssetIdFromTaskResult(
    completed.result,
    completed.imageUrl,
  );
  const finalNode = {
    ...taskNode,
    id: nodeId,
    data: {
      ...nodeData,
      status: "success",
      imageUrl: completed.imageUrl,
      imageResults: [
        {
          url: completed.imageUrl,
          title: label,
          ...(generatedAssetId ? { assetId: generatedAssetId } : {}),
        },
      ],
      imagePrimaryIndex: 0,
      ...(generatedAssetId ? { assetId: generatedAssetId } : {}),
      ...(completed.taskId ? { taskId: completed.taskId } : {}),
      ...(completed.vendor ? { vendor: completed.vendor } : {}),
      ...(modelAlias && !readTrimmedString(nodeData.imageModel)
        ? { imageModel: modelAlias }
        : {}),
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
    imageUrl: completed.imageUrl,
    vendor: completed.vendor,
    taskId: completed.taskId,
  };
}
