import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  createObjectStorageClientFromConfig,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from "../asset/rustfs.client";
import { streamDownloadToFile } from "../asset/stream-download";
import { extractFramesAtViaMediaWorker } from "../../platform/media-worker/client";
import { FFMPEG_EXEC_OPTS } from "./subprocess-limits";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { putFileToStorage } from "../asset/asset.hosting.stream-upload";
import { createTaskWorkspace } from "../../platform/node/task-workspace";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Promise-based execFile wrapper that always resolves { stdout, stderr }.
// (We avoid util.promisify so the helper is trivially mockable in tests and the
// callback contract stays explicit regardless of the custom-promisify symbol.)
async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, FFMPEG_EXEC_OPTS, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
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

// Probe the source video dimensions once (same for every extracted frame).
// Non-fatal: any failure simply leaves width/height undefined.
async function probeDimensions(inFile: string): Promise<{ width?: number; height?: number }> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      inFile,
    ]);
    const match = stdout.trim().split(/\r?\n/)[0] ?? "";
    const [w, h] = match.split("x").map((part) => Number(part.trim()));
    const width = Number.isFinite(w) && w > 0 ? w : undefined;
    const height = Number.isFinite(h) && h > 0 ? h : undefined;
    return { width, height };
  } catch {
    return {};
  }
}

export type ExtractedFrame = {
  time: number;
  url: string;
  width?: number;
  height?: number;
};

export type PublicAgentsExtractFramesAtResult = {
  ok: true;
  frames: ExtractedFrame[];
};

/**
 * Download a video, extract one frame at each requested timestamp (seconds) as a
 * WebP image, upload them to object storage, and return their public URLs in
 * ascending time order. Generalizes extractLastFrameToImage from "tail frame
 * only" to "arbitrary timestamps" — the building block for keyframe sampling and
 * multi-point storyboard continuity. Requires ffmpeg/ffprobe on PATH (baked into
 * the api image).
 */
export async function extractFramesAtForAgent(input: {
  c: AppContext;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<PublicAgentsExtractFramesAtResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};
  const explicitVideoUrl = readTrimmedString(args.videoUrl);
  const nodeId = readTrimmedString(args.nodeId);

  // Parse, validate, dedupe and sort the requested timestamps.
  const rawTimes = Array.isArray(args.times) ? (args.times as unknown[]) : [];
  const times = Array.from(
    new Set(
      rawTimes
        .map((t) => {
          const num = Number(t);
          return Number.isFinite(num) && num >= 0 ? num : null;
        })
        .filter((t): t is number => t !== null),
    ),
  ).sort((a, b) => a - b);

  if (times.length === 0) {
    throw new AppError("times array must contain at least 1 timestamp (in seconds)", {
      status: 400,
      code: "agents_tool_extract_frames_missing_times",
    });
  }
  if (times.length > 24) {
    throw new AppError("times array cannot contain more than 24 timestamps", {
      status: 400,
      code: "agents_tool_extract_frames_too_many_times",
      details: { count: times.length, max: 24 },
    });
  }

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
      code: "agents_tool_extract_frames_missing_video",
    });
  }

  const storageConfig = resolveObjectStorageConfig(input.c.env);
  if (!storageConfig) {
    throw new AppError("Object storage is not configured", {
      status: 500,
      code: "agents_tool_extract_frames_storage_unconfigured",
    });
  }
  const client = createObjectStorageClientFromConfig(storageConfig);

  // 优先走 media-worker(Go)；失败回退本地 ffmpeg（下方原实现）。
  const viaWorker = await extractFramesAtViaMediaWorker({ videoUrl, timesSec: times });
  if (viaWorker) {
    return { ok: true, frames: viaWorker };
  }

  const workspace = await createTaskWorkspace("extract-frames");
  const workDir = workspace.path;
  try {
    const inFile = join(workDir, "in.mp4");
    await streamDownloadToFile(videoUrl, inFile, storageConfig, client);

    const { width, height } = await probeDimensions(inFile);

    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");

    const frames: ExtractedFrame[] = [];
    for (const [idx, timeSeconds] of times.entries()) {
      const outFile = join(workDir, `frame_${idx}.webp`);
      await run("ffmpeg", [
        "-y",
        "-ss",
        String(timeSeconds),
        "-i",
        inFile,
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "90",
        outFile,
      ]);

      const key = `gen/images/framesat/${datePrefix}/${randomUUID()}_t${idx}.webp`;
      await putFileToStorage({
        client,
        bucket: storageConfig.bucket,
        key,
        filePath: outFile,
        contentType: "image/webp",
      });

      const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
      frames.push({ time: timeSeconds, url, ...(width ? { width } : {}), ...(height ? { height } : {}) });
    }

    return { ok: true, frames };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("按时间戳抽帧失败", {
      status: 502,
      code: "agents_tool_extract_frames_failed",
      details: { message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    await workspace.cleanup().catch((error: unknown) => {
      console.error("[extract-frames] temporary workspace cleanup failed", {
        workDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
