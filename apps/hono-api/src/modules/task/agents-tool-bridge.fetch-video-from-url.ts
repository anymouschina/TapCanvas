import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PutObjectCommand } from "@aws-sdk/client-s3";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { createObjectStorageClientFromConfig, resolveObjectStorageConfig } from "../asset/rustfs.client";
import type { FlowRow } from "../flow/flow.repo";
import {
  downloadDouyinVideoToFile,
  isDouyinPageUrl,
} from "./agents-tool-bridge.fetch-video-douyin";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type ExecCapture = {
  stdout: string;
  stderr: string;
  /** true when the process spawned but exited non-zero (download/parse failure). */
  failed: boolean;
  /** ENOENT (binary missing) or any other spawn-level error; null when the process actually ran. */
  spawnError: NodeJS.ErrnoException | null;
};

// execFile wrapper that NEVER rejects: it captures stdout/stderr/exit so the caller
// can distinguish a missing binary from a process-level failure without interpreting
// human-readable stderr as a semantic DRM/provider signal.
async function execCapture(cmd: string, args: string[], timeoutMs: number): Promise<ExecCapture> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs }, (err, stdout, stderr) => {
      const e = (err ?? null) as NodeJS.ErrnoException | null;
      const spawnError = e && e.code === "ENOENT" ? e : null;
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        failed: Boolean(e),
        spawnError,
      });
    });
  });
}

function readPageOrigin(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return "invalid-url";
  }
}

// Metadata is optional in the public tool contract. A probe failure therefore keeps
// the already downloaded asset, but it is always recorded as a factual diagnostic.
async function probeMetadata(
  pageUrl: string,
  timeoutMs: number,
): Promise<{ title?: string; durationSec?: number }> {
  try {
    const { stdout, stderr, failed, spawnError } = await execCapture(
      "yt-dlp",
      ["--no-playlist", "--skip-download", "--print", "%(title)s\n%(duration)s", pageUrl],
      timeoutMs,
    );
    if (spawnError || failed) {
      console.warn("[fetch-video] ytdlp_metadata_probe_failed", {
        pageOrigin: readPageOrigin(pageUrl),
        failureKind: spawnError ? "binary_missing" : "process_failed",
        stderrChars: stderr.length,
      });
      return {};
    }
    const [titleLine, durationLine] = stdout.split(/\r?\n/);
    const title = readTrimmedString(titleLine);
    const durationRaw = Number(readTrimmedString(durationLine));
    const metadata = {
      ...(title && title !== "NA" ? { title } : {}),
      ...(Number.isFinite(durationRaw) && durationRaw > 0 ? { durationSec: Math.round(durationRaw) } : {}),
    };
    if (!metadata.title && metadata.durationSec === undefined) {
      console.warn("[fetch-video] ytdlp_metadata_probe_empty", {
        pageOrigin: readPageOrigin(pageUrl),
        stdoutChars: stdout.length,
      });
    }
    return metadata;
  } catch (error) {
    console.warn("[fetch-video] ytdlp_metadata_probe_exception", {
      pageOrigin: readPageOrigin(pageUrl),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return {};
  }
}

export type FetchVideoFromUrlResult = {
  ok: true;
  videoUrl: string;
  sourcePage: string;
  title?: string;
  durationSec?: number;
};

/**
 * Fetch the best-quality video stream off an arbitrary watch/play page (the kind a
 * web_search returns — Bilibili / YouTube / official site / …) with yt-dlp, re-host the
 * resulting mp4 to TOS, and return a stable direct URL that downstream
 * tools (decompose_video / analyze_video) can actually pull. web_search yields a *link*,
 * not a file; this tool is the bridge that lands it as a TOS mp4 so decomposition works.
 *
 * Douyin has one explicit provider path: resolve the public share SSR payload, validate
 * its exact work id and ByteDance media URL, then stream the public MP4 to disk. It does
 * not fall through to yt-dlp when that provider path fails. Other sites use yt-dlp,
 * which drives ffmpeg (already baked into the api image) to merge video + audio.
 * yt-dlp stderr is preserved as diagnostic evidence but is not interpreted with local
 * keyword heuristics. Copyright/compliance of fetching third-party works is the user's
 * responsibility.
 */
export async function fetchVideoFromUrlForAgent(input: {
  c: AppContext;
  row?: FlowRow | null;
  requestUserId?: string;
  bodyArgs: unknown;
}): Promise<FetchVideoFromUrlResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  const pageUrl = readTrimmedString(args.pageUrl);
  if (!pageUrl) {
    throw new AppError("pageUrl（视频播放页 URL）必须提供", {
      status: 400,
      code: "agents_tool_fetch_video_missing_url",
    });
  }

  const storageConfig = resolveObjectStorageConfig(input.c.env);
  if (!storageConfig) {
    throw new AppError("Object storage is not configured", {
      status: 500,
      code: "agents_tool_fetch_video_storage_unconfigured",
    });
  }
  const client = createObjectStorageClientFromConfig(storageConfig);

  // yt-dlp can be slow on big files; allow up to 5 min, metadata probe much less.
  const downloadTimeoutMs = 5 * 60 * 1000;
  const metaTimeoutMs = 45 * 1000;

  const workDir = await mkdtemp(join(tmpdir(), "fetchvid-"));
  try {
    const outFile = join(workDir, "v.mp4");
    let meta: { title?: string; durationSec?: number };
    if (isDouyinPageUrl(pageUrl)) {
      const douyin = await downloadDouyinVideoToFile({ pageUrl, outputFile: outFile });
      meta = {
        ...(douyin.title ? { title: douyin.title } : {}),
        durationSec: douyin.durationSec,
      };
    } else {
      // bv*+ba/b = best video+audio, fall back to best single file. --merge-output-format mp4
      // makes yt-dlp invoke ffmpeg to remux into the exact outFile we read back.
      const dl = await execCapture(
        "yt-dlp",
        [
          "-f",
          "bv*+ba/b",
          "--merge-output-format",
          "mp4",
          "--no-playlist",
          "--no-warnings",
          "-o",
          outFile,
          pageUrl,
        ],
        downloadTimeoutMs,
      );

      if (dl.spawnError) {
        throw new AppError("容器未安装 yt-dlp，需重建镜像", {
          status: 500,
          code: "agents_tool_fetch_video_ytdlp_missing",
        });
      }
      if (dl.failed) {
        throw new AppError("yt-dlp 抓取视频失败", {
          status: 502,
          code: "agents_tool_fetch_video_ytdlp_failed",
          details: { stderr: dl.stderr.slice(-2000) },
        });
      }
      meta = await probeMetadata(pageUrl, metaTimeoutMs);
    }

    const bytes = await readFile(outFile);

    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const key = `gen/videos/fetched/${datePrefix}/${randomUUID()}.mp4`;
    await client.send(
      new PutObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
        Body: bytes,
        ContentType: "video/mp4",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
    const videoUrl = publicBase ? `${publicBase}/${key}` : `/${key}`;

    return {
      ok: true,
      videoUrl,
      sourcePage: pageUrl,
      ...(meta.title ? { title: meta.title } : {}),
      ...(typeof meta.durationSec === "number" ? { durationSec: meta.durationSec } : {}),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("抓取视频失败", {
      status: 502,
      code: "agents_tool_fetch_video_failed",
      details: { message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn("[fetch-video] temporary_directory_cleanup_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }
}
