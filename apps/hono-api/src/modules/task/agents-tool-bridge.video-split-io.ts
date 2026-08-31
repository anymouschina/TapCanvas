/**
 * 长视频切段 IO（A 视频理解 / B 复刻 decompose 共享）：probe URL 时长 → 下载 → ffmpeg 按
 * planVideoSegments 切 ≤maxSegSec 段 → 上传 TOS → 返回各段公网 URL。纯算法在 video-segment-plan.ts，
 * 本文件只管 IO（ffmpeg/下载/TOS），便于上层 analyze_video / decompose 复用同一套切段。
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  createObjectStorageClientFromConfig,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from "../asset/rustfs.client";
import { putFileToStorage } from "../asset/asset.hosting.stream-upload";
import { streamDownloadToFile } from "../asset/stream-download";
import {
  splitVideoViaMediaWorker,
  transcodeProxyViaMediaWorker,
} from "../../platform/media-worker/client";
import { FFMPEG_EXEC_OPTS } from "./subprocess-limits";
import { planVideoSegments, type VideoSegment } from "./video-segment-plan";
import { createTaskWorkspace } from "../../platform/node/task-workspace";

export type VideoSegmentUrl = VideoSegment & { url: string };

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, FFMPEG_EXEC_OPTS, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

/** ffprobe 直接探 URL 拿时长（不下载整片）。失败/未知返回 0（上层视为不切、走原逻辑）。 */
export async function probeVideoDurationSec(url: string): Promise<number> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      url,
    ]);
    const d = Number(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

/** 探视频文件字节数（HTTP HEAD 的 Content-Length，便宜不下载）。拿不到 → 0（调用方退回纯时长切段）。 */
export async function probeVideoSizeBytes(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return 0;
    const len = Number(res.headers.get("content-length") || "");
    return Number.isFinite(len) && len > 0 ? len : 0;
  } catch {
    return 0;
  }
}


/**
 * 把 sourceUrl 切成 ≤maxSegSec 的多段并上传 TOS，返回各段 {index,startSec,endSec,url}。
 * - durationSec ≤ maxSegSec（或未知）→ 不切，直接返回单段 [{...,url:sourceUrl}]（零额外 IO）。
 * - 否则下载一次 → ffmpeg 逐段 `-ss/-t -c copy` 切 → PutObject 上传 → 拼公网 URL。
 */
export async function splitVideoUrlToSegments(input: {
  c: AppContext;
  sourceUrl: string;
  durationSec: number;
  maxSegSec: number;
}): Promise<VideoSegmentUrl[]> {
  const plan = planVideoSegments(input.durationSec, input.maxSegSec);
  if (plan.length <= 1) {
    // 未知时长 plan 为空 → 仍回一段原 url（让上层照常单段处理）。
    return [{ index: 0, startSec: 0, endSec: input.durationSec || 0, url: input.sourceUrl }];
  }
  const storage = resolveObjectStorageConfig(input.c.env);
  if (!storage) {
    throw new AppError("Object storage is not configured", {
      status: 500,
      code: "object_storage_not_configured",
    });
  }
  // 优先走 media-worker(Go)：分段算法(planVideoSegments)留在 Node，worker 只执行切段。
  // 失败回退本地 ffmpeg（下方原实现）。
  const viaWorker = await splitVideoViaMediaWorker({
    videoUrl: input.sourceUrl,
    segments: plan.map((seg) => ({
      index: seg.index,
      startSec: seg.startSec,
      endSec: seg.endSec,
    })),
  });
  if (viaWorker) {
    return viaWorker.map((seg, i) => ({ ...plan[i], url: seg.url }));
  }

  const s3 = createObjectStorageClientFromConfig(storage);
  const publicBase = storage.publicBase.trim().replace(/\/+$/, "");
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const workspace = await createTaskWorkspace("video-split");
  const workDir = workspace.path;
  try {
    const inFile = join(workDir, "in.mp4");
    await streamDownloadToFile(input.sourceUrl, inFile, storage, s3);
    const out: VideoSegmentUrl[] = [];
    for (const seg of plan) {
      const segFile = join(workDir, `seg${seg.index}.mp4`);
      // -ss 在 -i 前=快速定位；-c copy 不重编码（快、无损）；时长用 endSec-startSec。
      await run("ffmpeg", [
        "-y",
        "-ss",
        String(seg.startSec),
        "-i",
        inFile,
        "-t",
        String(Math.max(0.1, seg.endSec - seg.startSec)),
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        segFile,
      ]);
      const key = `gen/videos/segments/${datePrefix}/${randomUUID()}_s${seg.index}.mp4`;
      // Stream the segment from disk — never readFile the whole clip into heap.
      await putFileToStorage({
        client: s3,
        bucket: storage.bucket,
        key,
        filePath: segFile,
        contentType: "video/mp4",
      });
      out.push({ ...seg, url: publicBase ? `${publicBase}/${key}` : `/${key}` });
    }
    return out;
  } finally {
    await workspace.cleanup().catch((error: unknown) => {
      console.error("[video-split] temporary workspace cleanup failed", {
        workDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * 为视频理解做一个【降分辨率代理片】：下载源 → ffmpeg 缩到 ≤1280 宽 + 重编码(CRF 30) → 上传 TOS，返回小代理 URL。
 *
 * 治本：视频理解模型既有 50MiB 大小硬上限、又会对【超高分辨率/高码率】片(如 3958x1548)拉取+解码超时
 * （实测 "Timeout while processing video_url"）。理解根本不需要原分辨率——一个 ~1280 宽的小代理既不超限、
 * 解码又快，22s 片通常缩到几 MiB、单段即可理解。时长/比例不变（缩放保宽高比），不影响逐镜镜头语言判断。
 */
export async function transcodeToUnderstandingProxy(input: {
  c: AppContext;
  sourceUrl: string;
}): Promise<{ url: string; sizeBytes: number }> {
  const storage = resolveObjectStorageConfig(input.c.env);
  if (!storage) {
    throw new AppError("Object storage is not configured", {
      status: 500,
      code: "object_storage_not_configured",
    });
  }
  // 优先走 media-worker(Go)；失败回退本地 ffmpeg（下方原实现）。
  const viaWorker = await transcodeProxyViaMediaWorker({ videoUrl: input.sourceUrl });
  if (viaWorker) {
    return viaWorker;
  }

  const s3 = createObjectStorageClientFromConfig(storage);
  const publicBase = storage.publicBase.trim().replace(/\/+$/, "");
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const workspace = await createTaskWorkspace("video-proxy");
  const workDir = workspace.path;
  try {
    const inFile = join(workDir, "in.mp4");
    const outFile = join(workDir, "proxy.mp4");
    await streamDownloadToFile(input.sourceUrl, inFile, storage, s3);
    // 缩到宽≤1280(高自动取偶数)，H.264 CRF30 veryfast，音频 64k AAC(保留口播/BGM 给理解)，faststart 利于流式拉取。
    await run("ffmpeg", [
      "-y",
      "-i",
      inFile,
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libx264",
      "-crf",
      "30",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
      outFile,
    ]);
    const sizeBytes = (await stat(outFile)).size;
    const key = `gen/videos/proxies/${datePrefix}/${randomUUID()}_proxy.mp4`;
    // Stream the proxy from disk — never readFile the whole file into heap.
    await putFileToStorage({
      client: s3,
      bucket: storage.bucket,
      key,
      filePath: outFile,
      contentType: "video/mp4",
    });
    return {
      url: publicBase ? `${publicBase}/${key}` : `/${key}`,
      sizeBytes,
    };
  } finally {
    await workspace.cleanup().catch((error: unknown) => {
      console.error("[video-proxy] temporary workspace cleanup failed", {
        workDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
