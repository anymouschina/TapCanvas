import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { buildPublicVisionTaskRequest, runPublicTask } from "../apiKey/apiKey.routes";
import type { FlowRow } from "../flow/flow.repo";
import { isUsableImageRef } from "./agents-tool-bridge.image-ref";
import {
  describeExecutionImageReference,
  resolveExecutionImageReferences,
  type AgentVisibleImageReference,
} from "./agents-tool-bridge.image-reference-ids";
import { IMAGE_UNDERSTANDING_MODEL_KEY } from "./media-understanding-model";
import { createHash } from "node:crypto";
import { loadImageUnderstandingEvidence } from "./image-understanding-evidence";
import { readImageUnderstandingContent } from "./image-understanding-content";
import { imageAnalysisCacheKey, shareImageAnalysis } from "./image-understanding-cache";
import { imageAnalysisCacheStore } from "./image-understanding-cache.repo";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const DEFAULT_VISION_PROMPT =
  "客观读取图片中可见的对象、外观、结构、文字、空间关系和动作。分别说明直接观察、图中文字声称、推断和无法确认的信息，并指出各项依据。不能把文件名、生成提示词或外观推测当作已验证事实。返回文字分析，不返回媒体 URL。";

export type AnalyzeImageResult = {
  ok: true;
  text: string;
  reference: AgentVisibleImageReference | null;
  provenance: {
    version: 1;
    mediaType: "image";
    modelKey: string;
    taskId: string;
    referenceId: string | null;
    promptHash: string;
    analysisHash: string;
    analyzedAt: string;
  };
};

/**
 * Image understanding for the in-canvas agent (the video workflow's S1 needs to
 * "看懂组内图" but /public/vision was only an HTTP endpoint, not a bridge tool —
 * so analyze_image was unreachable and runs stalled). Wraps the same vision task
 * (image_to_prompt) and returns the description text. Agent calls accept only a
 * nodeId or assetId; an internalImageUrl is reserved for server-owned pipelines
 * that just created an ephemeral frame and never exposes that URL to the model.
 */
export async function analyzeImageForAgent(input: {
  c: AppContext;
  requestUserId: string;
  row: FlowRow | null;
  bodyArgs: unknown;
  internalImageUrl?: string;
}): Promise<AnalyzeImageResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  const nodeId = readTrimmedString(args.nodeId);
  const assetId = readTrimmedString(args.assetId);
  const internalImageUrl = readTrimmedString(input.internalImageUrl);
  if (!internalImageUrl && Boolean(nodeId) === Boolean(assetId)) {
    throw new AppError("nodeId 与 assetId 必须且只能提供一个", {
      status: 400,
      code: "agents_tool_analyze_image_reference_required",
    });
  }
  const resolved = internalImageUrl
    ? []
    : await resolveExecutionImageReferences({
        c: input.c,
        ownerId: input.requestUserId,
        row: input.row,
        nodeIds: nodeId ? [nodeId] : [],
        assetIds: assetId ? [assetId] : [],
      });
  const resolvedReference = resolved[0] ?? null;
  const imageUrl = internalImageUrl || resolvedReference?.url || "";
  if (!isUsableImageRef(imageUrl)) {
    throw new AppError(
      "图片引用无法解析为可供视觉模型读取的真实 http(s) 图片资产",
      {
        status: 400,
        code: "agents_tool_analyze_image_invalid_ref",
        details: { nodeId: nodeId || null, assetId: assetId || null },
      },
    );
  }

  const prompt = readTrimmedString(args.prompt) || readTrimmedString(args.question) || DEFAULT_VISION_PROMPT;
  const { contentHash, imageData } = await readImageUnderstandingContent(imageUrl);
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const analysisContext = {
    event: "media_understanding",
    projectId: input.row?.project_id ?? null,
    flowId: input.row?.id ?? null,
    userId: input.requestUserId,
    mediaType: "image",
    modelKey: IMAGE_UNDERSTANDING_MODEL_KEY,
    referenceId: resolvedReference?.referenceId ?? null,
    promptHash,
  };
  const key = imageAnalysisCacheKey({
    ownerId: input.requestUserId,
    billingScope: readTrimmedString(input.c.get("apiKeyBillingTeamId")) || readTrimmedString(input.c.get("activeTeamId")) || input.requestUserId,
    contentHash, promptHash, modelKey: IMAGE_UNDERSTANDING_MODEL_KEY,
  });
  const analysis = await shareImageAnalysis({
    key, store: imageAnalysisCacheStore(input.c.env.DB, input.requestUserId, key),
    recover: async () => {
      const evidence = await loadImageUnderstandingEvidence({
        db: input.c.env.DB, ownerId: input.requestUserId, contentKey: key,
        requestedAnalysis: { promptHash, modelKey: IMAGE_UNDERSTANDING_MODEL_KEY },
        references: [{ referenceId: resolvedReference?.referenceId ?? `image-sha256:${contentHash}`, url: imageUrl }],
      });
      const receipt = evidence[0];
      return receipt ? { text: receipt.text, provenance: receipt.provenance } : null;
    },
    execute: async () => {
      const visionRequest = buildPublicVisionTaskRequest(
        {} as Parameters<typeof buildPublicVisionTaskRequest>[0],
        { imageUrl, imageData, prompt },
      );
      const request = { ...visionRequest, extras: { ...visionRequest.extras, imageUnderstandingKey: key, imageContentHash: contentHash } };
      const { result } = await runPublicTask(input.c, input.requestUserId, { request }).catch((error: unknown) => {
        console.error(JSON.stringify({
          ...analysisContext,
          status: "failed",
          errorCode: error instanceof AppError ? error.code : "media_understanding_request_failed",
        }));
        throw error;
      });
      if (result?.status !== "succeeded" || !result.id) {
        console.error(JSON.stringify({ ...analysisContext, status: "failed", taskId: result?.id ?? null, taskStatus: result?.status ?? null }));
        throw new AppError("图片理解任务没有成功回执，不能作为视觉事实使用", {
          status: 502,
          code: "agents_tool_analyze_image_unsatisfied",
          details: { taskId: result?.id ?? null, taskStatus: result?.status ?? null, modelKey: IMAGE_UNDERSTANDING_MODEL_KEY },
        });
      }
      const raw = result?.raw as { text?: unknown } | null | undefined;
      const text = typeof raw?.text === "string" ? raw.text.trim() : "";
      if (!text) {
        console.error(JSON.stringify({ ...analysisContext, status: "failed", taskId: result.id, errorCode: "agents_tool_analyze_image_empty" }));
        throw new AppError(`${IMAGE_UNDERSTANDING_MODEL_KEY} 图片理解未返回文本`, {
          status: 502,
          code: "agents_tool_analyze_image_empty",
          details: { modelKey: IMAGE_UNDERSTANDING_MODEL_KEY },
        });
      }
      const provenance = {
        version: 1 as const,
        mediaType: "image" as const,
        modelKey: IMAGE_UNDERSTANDING_MODEL_KEY,
        taskId: result.id,
        referenceId: resolvedReference?.referenceId ?? null,
        promptHash,
        analysisHash: createHash("sha256").update(text).digest("hex"),
        analyzedAt: new Date().toISOString(),
      };
      console.info(JSON.stringify({ ...analysisContext, status: "succeeded", ...provenance }));
      return { text, provenance };
    },
  });
  return {
    ok: true,
    text: analysis.text,
    provenance: { ...analysis.provenance, referenceId: resolvedReference?.referenceId ?? null },
    reference: resolvedReference ? describeExecutionImageReference(resolvedReference) : null,
  };
}
