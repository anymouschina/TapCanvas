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

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const DEFAULT_VISION_PROMPT =
  "请客观描述这张图：主体/产品是什么、颜色与材质、关键卖点、人物外形(年龄/体型/发型/服装)、构图与镜头特征、可推断的拍摄年代/质感。用于后续视频编排锚定同一主体。";

export type AnalyzeImageResult = {
  ok: true;
  text: string;
  reference: AgentVisibleImageReference | null;
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
  const request = buildPublicVisionTaskRequest(
    {} as Parameters<typeof buildPublicVisionTaskRequest>[0],
    { imageUrl, imageData: null, prompt },
  );
  const { result } = await runPublicTask(input.c, input.requestUserId, { request });
  const raw = result?.raw as { text?: unknown } | null | undefined;
  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  if (!text) {
    throw new AppError(`${IMAGE_UNDERSTANDING_MODEL_KEY} 图片理解未返回文本`, {
      status: 502,
      code: "agents_tool_analyze_image_empty",
      details: { modelKey: IMAGE_UNDERSTANDING_MODEL_KEY },
    });
  }
  return {
    ok: true,
    text,
    reference: resolvedReference
      ? describeExecutionImageReference(resolvedReference)
      : null,
  };
}
