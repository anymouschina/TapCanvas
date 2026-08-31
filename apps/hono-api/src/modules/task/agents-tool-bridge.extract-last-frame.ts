import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  createObjectStorageClientFromConfig,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from "../asset/rustfs.client";
import { streamDownloadToFile } from "../asset/stream-download";
import { extractLastFrameViaMediaWorker } from "../../platform/media-worker/client";
import { FFMPEG_EXEC_OPTS } from "./subprocess-limits";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { putFileToStorage } from "../asset/asset.hosting.stream-upload";
import { createAssetRow } from "../asset/asset.repo";
import { createTaskWorkspace } from "../../platform/node/task-workspace";
import type { AgentVisibleImageReference } from "./agents-tool-bridge.image-reference-ids";

const execFileAsync = promisify(execFile);

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, FFMPEG_EXEC_OPTS);
}


// Resolve a video URL from a node in the current flow by reading its data.videoUrl.
function resolveVideoUrlFromFlowNode(row: FlowRow, nodeId: string): string {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const node = nodes.find((n) => String(n.id ?? "") === nodeId);
  if (!node) return "";
  const nodeData =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};
  const direct = readTrimmedString(nodeData.videoUrl);
  if (direct) return direct;
  // fall back to first videoResults entry
  const videoResults = Array.isArray(nodeData.videoResults) ? nodeData.videoResults : [];
  for (const item of videoResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = readTrimmedString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  return "";
}

export type PublicAgentsExtractLastFrameResult = {
  ok: true;
  reference: AgentVisibleImageReference;
  referenceAssetIds: [string];
};

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function persistExtractedFrameAsset(input: {
  c: AppContext;
  ownerId: string;
  row: FlowRow | null;
  sourceNodeId: string;
  frameUrl: string;
}): Promise<PublicAgentsExtractLastFrameResult> {
  if (!isHttpUrl(input.frameUrl)) {
    throw new AppError("尾帧已抽取，但对象存储没有返回可解析的公开 URL", {
      status: 502,
      code: "agents_tool_extract_frame_public_url_unavailable",
      details: {
        sourceNodeId: input.sourceNodeId || null,
      },
    });
  }

  const name = input.sourceNodeId
    ? `视频尾帧 · ${input.sourceNodeId}`
    : "视频尾帧";
  try {
    const created = await createAssetRow(
      input.c.env.DB,
      input.ownerId,
      {
        name,
        data: {
          kind: "generation",
          type: "image",
          url: input.frameUrl,
          taskKind: "extract_last_frame",
          sourceVideoNodeId: input.sourceNodeId || null,
        },
        projectId: input.row?.project_id ?? null,
      },
      new Date().toISOString(),
    );
    const reference: AgentVisibleImageReference = {
      referenceId: `asset:${created.id}`,
      source: "asset",
      nodeId: null,
      assetId: created.id,
      assetRefId: null,
      name: readTrimmedString(created.name) || name,
      mediaType: "image",
      ready: true,
    };
    return {
      ok: true,
      reference,
      referenceAssetIds: [created.id],
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[extract-last-frame] extracted frame asset persistence failed", {
      ownerId: input.ownerId,
      projectId: input.row?.project_id ?? null,
      sourceNodeId: input.sourceNodeId || null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError("尾帧已抽取，但图片资产登记失败", {
      status: 500,
      code: "agents_tool_extract_frame_asset_persist_failed",
      details: {
        sourceNodeId: input.sourceNodeId || null,
      },
    });
  }
}

/**
 * Download a video, extract the frame ~0.12s before the end as a PNG, upload it
 * to object storage, and return its public URL. Designed as the chaining
 * primitive for storyboard tail-frame continuity (use the extracted frame as the
 * first-frame reference of the next shot). Requires ffmpeg on PATH (baked into
 * the api image).
 */
export async function extractLastFrameToImage(input: {
  c: AppContext;
  ownerId: string;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<PublicAgentsExtractLastFrameResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};
  const explicitVideoUrl = readTrimmedString(args.videoUrl);
  const nodeId = readTrimmedString(args.nodeId);

  let videoUrl = explicitVideoUrl;
  if (!videoUrl && nodeId) {
    if (!input.row) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
      });
    }
    videoUrl = resolveVideoUrlFromFlowNode(input.row, nodeId);
  }
  if (!videoUrl) {
    throw new AppError("videoUrl or nodeId with a video is required", {
      status: 400,
      code: "agents_tool_extract_frame_missing_video",
    });
  }

  const storageConfig = resolveObjectStorageConfig(input.c.env);
  if (!storageConfig) {
    throw new AppError("Object storage is not configured", {
      status: 500,
      code: "agents_tool_extract_frame_storage_unconfigured",
    });
  }
  const client = createObjectStorageClientFromConfig(storageConfig);

  // 优先走 media-worker(Go)；失败回退本地 ffmpeg（下方原实现）。
  const viaWorker = await extractLastFrameViaMediaWorker({ videoUrl });
  if (viaWorker) {
    return persistExtractedFrameAsset({
      c: input.c,
      ownerId: input.ownerId,
      row: input.row,
      sourceNodeId: nodeId,
      frameUrl: viaWorker.frameUrl,
    });
  }

  const workspace = await createTaskWorkspace("extract-last-frame");
  const workDir = workspace.path;
  try {
    const inFile = join(workDir, "in.mp4");
    const outFile = join(workDir, "last.png");
    await streamDownloadToFile(videoUrl, inFile, storageConfig, client);
    await run("ffmpeg", [
      "-y",
      "-sseof",
      "-0.12",
      "-i",
      inFile,
      "-vframes",
      "1",
      "-q:v",
      "2",
      outFile,
    ]);

    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const key = `gen/images/lastframe/${datePrefix}/${randomUUID()}.png`;
    await putFileToStorage({
      client,
      bucket: storageConfig.bucket,
      key,
      filePath: outFile,
      contentType: "image/png",
    });

    const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
    const frameUrl = publicBase ? `${publicBase}/${key}` : `/${key}`;
    return await persistExtractedFrameAsset({
      c: input.c,
      ownerId: input.ownerId,
      row: input.row,
      sourceNodeId: nodeId,
      frameUrl,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("尾帧抽取失败", {
      status: 502,
      code: "agents_tool_extract_frame_failed",
      details: { message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    await workspace.cleanup().catch((error: unknown) => {
      console.error("[extract-last-frame] temporary workspace cleanup failed", {
        workDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
