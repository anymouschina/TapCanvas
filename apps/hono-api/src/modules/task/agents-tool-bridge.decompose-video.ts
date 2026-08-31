import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  createObjectStorageClientFromConfig,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from "../asset/rustfs.client";
import { streamDownloadToFile } from "../asset/stream-download";
import { FFMPEG_EXEC_OPTS } from "./subprocess-limits";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { detectScenes, type DetectedScene } from "./scene-detect";
import { extractFramesAtForAgent } from "./agents-tool-bridge.extract-frames-at";
import { analyzeImageForAgent } from "./agents-tool-bridge.analyze-image";
import { DECOMPOSE_MAX_SEGMENT_SEC, needsSegmentSplit } from "./video-segment-plan";
import { probeVideoDurationSec, splitVideoUrlToSegments } from "./agents-tool-bridge.video-split-io";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Promise-based execFile wrapper (mirrors extract-frames-at). Avoids util.promisify
// so the helper is trivially mockable and the callback contract stays explicit.
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


// Resolve a video URL from a node in the current flow (data.videoUrl, else first
// videoResults[].url). Mirrors extract-frames-at.
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
  const videoResults = Array.isArray(nodeData.videoResults) ? nodeData.videoResults : [];
  for (const item of videoResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = readTrimmedString((item as Record<string, unknown>).url);
    if (url) return url;
  }
  return "";
}

interface VideoMeta {
  durationSec: number;
  fps: number | null;
  width: number | null;
  height: number | null;
}

// One ffprobe call → duration (format) + width/height/r_frame_rate (first video stream).
// Non-fatal per field: any missing/unparseable value degrades to null/0.
async function probeVideoMeta(inFile: string): Promise<VideoMeta> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      inFile,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: unknown; height?: unknown; r_frame_rate?: unknown }>;
      format?: { duration?: unknown };
    };
    const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : undefined;
    const w = Number(stream?.width);
    const h = Number(stream?.height);
    const durationRaw = Number(parsed.format?.duration);
    let fps: number | null = null;
    const rate = typeof stream?.r_frame_rate === "string" ? stream.r_frame_rate : "";
    if (rate.includes("/")) {
      const [num, den] = rate.split("/").map((part) => Number(part));
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) fps = round3(num / den);
    } else if (Number.isFinite(Number(rate))) {
      fps = round3(Number(rate));
    }
    return {
      durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? round3(durationRaw) : 0,
      fps: fps && fps > 0 ? fps : null,
      width: Number.isFinite(w) && w > 0 ? w : null,
      height: Number.isFinite(h) && h > 0 ? h : null,
    };
  } catch {
    return { durationSec: 0, fps: null, width: null, height: null };
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// Compute a human ratio string ("16:9") from dimensions; snaps to common presets
// within a small tolerance, otherwise returns the reduced W:H. Null dims → "".
function aspectRatioFromDims(width: number | null, height: number | null): string {
  if (!width || !height || width <= 0 || height <= 0) return "";
  const presets: Array<{ label: string; ratio: number }> = [
    { label: "16:9", ratio: 16 / 9 },
    { label: "9:16", ratio: 9 / 16 },
    { label: "4:3", ratio: 4 / 3 },
    { label: "3:4", ratio: 3 / 4 },
    { label: "1:1", ratio: 1 },
    { label: "21:9", ratio: 21 / 9 },
    { label: "3:2", ratio: 3 / 2 },
    { label: "2:3", ratio: 2 / 3 },
  ];
  const actual = width / height;
  for (const preset of presets) {
    if (Math.abs(actual - preset.ratio) / preset.ratio < 0.03) return preset.label;
  }
  const divisor = gcd(width, height) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export type ReplicateMode = "exact" | "swap";

export type ShotCaption = {
  shotSize: string;
  cameraAngle: string;
  cameraMove: string;
  focalLength: string;
  subject: string;
  action: string;
  sceneEnv: string;
  lighting: string;
  composition: string;
};

export type ShotKeyFrameRole = "in" | "mid" | "out";

export type ShotKeyFrame = {
  timeSec: number;
  url: string;
  role: ShotKeyFrameRole;
};

export type ShotCut = {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  boundarySource: DetectedScene["boundarySource"];
  keyFrames: ShotKeyFrame[];
  caption: ShotCaption;
  /** Raw vision text when the 9-dim JSON could not be parsed (debug aid; omitted on success). */
  captionRaw?: string;
  replicateMode: ReplicateMode;
};

export type ShotTable = {
  version: 1;
  sourceVideoUrl: string;
  totalDurationSec: number;
  aspectRatio: string;
  fps: number | null;
  mode: ReplicateMode;
  detectMethod: "scenedetect" | "fixed-window-fallback";
  shotCount: number;
  cuts: ShotCut[];
};

export type DecomposeVideoResult = { ok: true; shotTable: ShotTable };

const EMPTY_CAPTION: ShotCaption = {
  shotSize: "",
  cameraAngle: "",
  cameraMove: "",
  focalLength: "",
  subject: "",
  action: "",
  sceneEnv: "",
  lighting: "",
  composition: "",
};

const CAPTION_PROMPT =
  "请以严格 JSON 返回这一镜画面的镜头语言分析，键名固定且全部为字符串值，不要输出任何额外文字、解释或 markdown 代码块：" +
  '{"shotSize":"景别(远景/全景/中景/中近景/特写)","cameraAngle":"机位角度(平视/俯视/仰视 及大致度数)",' +
  '"cameraMove":"运镜(固定/推/拉/摇/移/跟/环绕)","focalLength":"焦段感(广角/35mm/标准/长焦)",' +
  '"subject":"主体(人物外形:年龄体型发型服装 / 产品)","action":"主体正在做的动作",' +
  '"sceneEnv":"场景环境与背景","lighting":"光线(方向/色温/软硬)","composition":"构图(法则/主体位置/留白)"}';

// Pull the 9-dim caption out of the vision model's free text. Tolerates ```json
// fences and surrounding prose by slicing the first {...last } span.
function parseCaption(text: string): { caption: ShotCaption; raw?: string } {
  const trimmed = readTrimmedString(text);
  if (!trimmed) return { caption: { ...EMPTY_CAPTION }, raw: "" };
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice) as Record<string, unknown>;
      const pick = (key: keyof ShotCaption): string => readTrimmedString(obj[key]);
      return {
        caption: {
          shotSize: pick("shotSize"),
          cameraAngle: pick("cameraAngle"),
          cameraMove: pick("cameraMove"),
          focalLength: pick("focalLength"),
          subject: pick("subject"),
          action: pick("action"),
          sceneEnv: pick("sceneEnv"),
          lighting: pick("lighting"),
          composition: pick("composition"),
        },
      };
    } catch {
      // fall through to raw
    }
  }
  return { caption: { ...EMPTY_CAPTION }, raw: trimmed };
}

function findFrameUrl(
  frames: Array<{ time: number; url: string }>,
  timeSec: number,
): string {
  const exact = frames.find((f) => Math.abs(f.time - timeSec) < 1e-3);
  if (exact) return exact.url;
  // closest fallback (timestamps may collapse via extract dedupe)
  let best: { time: number; url: string } | null = null;
  for (const frame of frames) {
    if (!best || Math.abs(frame.time - timeSec) < Math.abs(best.time - timeSec)) best = frame;
  }
  return best?.url ?? "";
}

/**
 * Decompose a source video into a ShotTable (v0): ffprobe duration/aspect/fps →
 * PySceneDetect (with fixed-window fallback) for shot boundaries → per-shot keyframe
 * sampling (in/mid/out via extractFramesAtForAgent, uploaded to TOS) → per-shot vision
 * captioning (9-dim shot language via analyzeImageForAgent). The returned ShotTable is
 * the single source of truth driving downstream exact/swap replication. Per-shot
 * extract+caption run concurrently. Requires ffprobe + (ideally) scenedetect on PATH.
 *
 * v0: ShotTable is returned as JSON to live in the agent's conversation context only —
 * it is NOT persisted to Prisma or written back to a canvas node here.
 */
// 复刻 decompose 的时长上限：复刻要逐镜抽帧 + 逐镜视觉打标，长片极重。实测 271s 片跑 301s 撞 ~300s
// 工具超时 → fetch failed（白等 5 分钟才失败）。超阈值快速失败 + 清晰引导，远好于跑到超时。
export const MAX_DECOMPOSE_DURATION_SEC = 120;

/** 参考视频是否超过复刻可处理时长（durationSec<=0 视为未知，不拦，交由后续真实处理）。 */
export function isVideoTooLongToDecompose(durationSec: number): boolean {
  return Number.isFinite(durationSec) && durationSec > MAX_DECOMPOSE_DURATION_SEC;
}

// 逐镜处理（抽帧 + 视觉打标）的并发上限。快剪广告会被切成 10+ 镜，若一次性 Promise.all 全发，
// 会瞬时打爆视觉上游(gpt-5.5 /v1/responses)：429 限流 + reasoning 过载 500(单次拖 17-20s) + 3 次重试，
// 整个 Promise.all 被最慢镜拖到 ~250s 撞连接预算 → fetch failed，ShotTable 永远回不来(实测 22s/11 镜)。
// 限并发把突发压平、消除 429。
export const DECOMPOSE_SHOT_CONCURRENCY = 4;
// 单镜视觉打标超时：caption 是次要信息(swap 复刻真正的锚是 keyFrames 真帧)，已支持降级为空。
// 给每镜打标一道硬上限，单镜过载重试(可达 40-60s)也不会拖垮整批；超时即留空 caption、保留帧。
export const DECOMPOSE_CAPTION_TIMEOUT_MS = 30_000;

/** 限并发 map：最多 concurrency 个 worker 并行消费 items，保持结果顺序。镜像 asset.routes 的同名实现。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.trunc(concurrency || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** 给一个 promise 套硬超时：超时则 reject（调用方按失败处理）。always 清定时器，不留悬挂句柄。 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * B：把逐窗 decompose 的 ShotTable 按窗口起始偏移合并成一张全片 ShotTable（纯函数）。
 * 每窗的 cut/关键帧时间是【段内相对】→ 加 startOffset 还原全局；镜号 index 连续重编；
 * detectMethod 任一窗回退即整体回退；aspect/fps 取首个有效窗。
 */
export function mergeSegmentShotTables(input: {
  sourceVideoUrl: string;
  totalDurationSec: number;
  mode: ReplicateMode;
  partials: Array<{ startOffset: number; shotTable: ShotTable }>;
}): ShotTable {
  const cuts: ShotCut[] = [];
  let allSceneDetect = true;
  let aspectRatio = "";
  let fps: number | null = null;
  for (const p of input.partials) {
    if (p.shotTable.detectMethod !== "scenedetect") allSceneDetect = false;
    if (!aspectRatio) aspectRatio = p.shotTable.aspectRatio;
    if (fps == null) fps = p.shotTable.fps;
    for (const cut of p.shotTable.cuts) {
      cuts.push({
        ...cut,
        index: cuts.length,
        startSec: round3(cut.startSec + p.startOffset),
        endSec: round3(cut.endSec + p.startOffset),
        keyFrames: cut.keyFrames.map((kf) => ({
          ...kf,
          timeSec: round3(kf.timeSec + p.startOffset),
        })),
      });
    }
  }
  return {
    version: 1,
    sourceVideoUrl: input.sourceVideoUrl,
    totalDurationSec: input.totalDurationSec,
    aspectRatio,
    fps,
    mode: input.mode,
    detectMethod: allSceneDetect ? "scenedetect" : "fixed-window-fallback",
    shotCount: cuts.length,
    cuts,
  };
}

export async function decomposeVideoForAgent(input: {
  c: AppContext;
  requestUserId: string;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<DecomposeVideoResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  const mode: ReplicateMode =
    readTrimmedString(args.mode).toLowerCase() === "swap" ? "swap" : "exact";

  // Resolve the source video URL: explicit sourceUrl/videoUrl wins, else a flow node id.
  let videoUrl = readTrimmedString(args.sourceUrl) || readTrimmedString(args.videoUrl);
  const nodeId = readTrimmedString(args.nodeId);
  if (!videoUrl && nodeId) {
    if (!input.row) {
      throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
    }
    videoUrl = resolveVideoUrlFromFlowNode(input.row, nodeId);
  }
  if (!videoUrl) {
    throw new AppError("sourceUrl/videoUrl 或含视频的 nodeId 必须提供一个", {
      status: 400,
      code: "agents_tool_decompose_video_missing_video",
    });
  }

  // B：复刻拆解长片(逐镜抽帧+视觉打标)极重,单次会撞 ~300s 工具超时。先 ffprobe 探 URL 时长 → >120s 则
  // 物理切 ≤120s 窗口、逐窗递归 decompose(段内相对时间)、再按窗口偏移合并 ShotTable(全局时间+镜号连续)。
  // 探不到时长(0)→不切,落到下方原流程,由 meta.durationSec>120 的快速失败兜底(URL 不可探的极少数)。
  const probedDurationSec = await probeVideoDurationSec(videoUrl);
  if (needsSegmentSplit(probedDurationSec, DECOMPOSE_MAX_SEGMENT_SEC)) {
    const segments = await splitVideoUrlToSegments({
      c: input.c,
      sourceUrl: videoUrl,
      durationSec: probedDurationSec,
      maxSegSec: DECOMPOSE_MAX_SEGMENT_SEC,
    });
    const partials: Array<{ startOffset: number; shotTable: ShotTable }> = [];
    for (const seg of segments) {
      // 段 ≤120s → 递归命中下方原流程、不再二次切;mode 透传。
      const r = await decomposeVideoForAgent({
        ...input,
        bodyArgs: { sourceUrl: seg.url, mode },
      });
      partials.push({ startOffset: seg.startSec, shotTable: r.shotTable });
    }
    return {
      ok: true,
      shotTable: mergeSegmentShotTables({
        sourceVideoUrl: videoUrl,
        totalDurationSec: probedDurationSec,
        mode,
        partials,
      }),
    };
  }

  const storageConfig = resolveObjectStorageConfig(input.c.env);
  if (!storageConfig) {
    throw new AppError("Object storage is not configured", {
      status: 500,
      code: "agents_tool_decompose_video_storage_unconfigured",
    });
  }
  const client = createObjectStorageClientFromConfig(storageConfig);

  const workDir = await mkdtemp(join(tmpdir(), "decompose-"));
  let meta: VideoMeta;
  let scenes: DetectedScene[];
  try {
    const inFile = join(workDir, "in.mp4");
    await streamDownloadToFile(videoUrl, inFile, storageConfig, client);
    meta = await probeVideoMeta(inFile);
    // 时长闸：超上限直接快速失败（probe 后、重活前），不让逐镜抽帧+打标跑到 ~300s 工具超时。
    if (isVideoTooLongToDecompose(meta.durationSec)) {
      throw new AppError(
        `参考视频时长 ${Math.round(meta.durationSec)}s 超过复刻上限 ${MAX_DECOMPOSE_DURATION_SEC}s：复刻要逐镜抽帧+视觉打标，长片会跑到超时失败。请改用 ≤${MAX_DECOMPOSE_DURATION_SEC}s 的短片段（漫剧名场面/预告/精彩切片），或先截取片段再复刻。`,
        {
          status: 422,
          code: "agents_tool_decompose_video_too_long",
          details: { durationSec: meta.durationSec, maxSec: MAX_DECOMPOSE_DURATION_SEC },
        },
      );
    }
    scenes = await detectScenes(inFile, {
      ...(meta.durationSec > 0 ? { totalDurationSec: meta.durationSec } : {}),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("视频分解失败", {
      status: 502,
      code: "agents_tool_decompose_video_failed",
      details: { message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  // Empty split degradation: treat the whole clip as a single shot so the ShotTable
  // is never empty (downstream always gets at least one cut).
  if (scenes.length === 0) {
    const endSec = meta.durationSec > 0 ? meta.durationSec : 0;
    scenes = [
      {
        index: 0,
        startSec: 0,
        endSec,
        durationSec: endSec,
        boundarySource: "fallback-window",
      },
    ];
  }

  const aspectRatio = aspectRatioFromDims(meta.width, meta.height);

  // Per-shot: sample in/mid/out keyframes (→ TOS) then caption the representative frame.
  // Independent across shots → run with BOUNDED concurrency (not a single Promise.all):
  // a fast-cut ad splits into 10+ shots, and firing every shot's vision caption at once
  // bursts the upstream into 429/overload-500 + retry storms that drag the whole tool past
  // the ~250s connection budget → "fetch failed". A single shot failing (or its caption
  // timing out) degrades to an empty-caption cut rather than aborting the decomposition.
  const cuts = await mapWithConcurrency(
    scenes,
    DECOMPOSE_SHOT_CONCURRENCY,
    async (scene): Promise<ShotCut> => {
      const startSec = round3(scene.startSec);
      const endSec = round3(scene.endSec);
      // "out" pulled slightly earlier than the boundary to dodge black/transition frames.
      const outSec = round3(Math.max(startSec, endSec - 0.1));
      const midSec = round3((startSec + endSec) / 2);
      const roleTimes: Array<{ time: number; role: ShotKeyFrameRole }> = [
        { time: startSec, role: "in" },
        { time: midSec, role: "mid" },
        { time: outSec, role: "out" },
      ];
      const requestedTimes = Array.from(new Set(roleTimes.map((r) => r.time)));

      const base: ShotCut = {
        index: scene.index,
        startSec,
        endSec,
        durationSec: round3(endSec - startSec),
        boundarySource: scene.boundarySource,
        keyFrames: [],
        caption: { ...EMPTY_CAPTION },
        replicateMode: mode,
      };

      try {
        const extracted = await extractFramesAtForAgent({
          c: input.c,
          row: input.row,
          bodyArgs: { videoUrl, times: requestedTimes },
        });
        const keyFrames: ShotKeyFrame[] = roleTimes
          .map((rt) => ({ timeSec: rt.time, url: findFrameUrl(extracted.frames, rt.time), role: rt.role }))
          .filter((kf) => kf.url.length > 0);
        base.keyFrames = keyFrames;

        const representative =
          keyFrames.find((kf) => kf.role === "mid")?.url || keyFrames[0]?.url || "";
        if (representative) {
          try {
            const analyzed = await withTimeout(
              analyzeImageForAgent({
                c: input.c,
                requestUserId: input.requestUserId,
                row: input.row,
                bodyArgs: { prompt: CAPTION_PROMPT },
                internalImageUrl: representative,
              }),
              DECOMPOSE_CAPTION_TIMEOUT_MS,
              `decompose caption shot#${scene.index}`,
            );
            const { caption, raw } = parseCaption(analyzed.text);
            base.caption = caption;
            if (typeof raw === "string" && raw.length > 0) base.captionRaw = raw;
          } catch (err) {
            // Vision failure on one shot is non-fatal: keep frames, leave caption empty.
            base.captionRaw = `analyze_image failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      } catch (err) {
        // Frame extraction failure on one shot is non-fatal: emit the cut without frames.
        base.captionRaw = `extract_frames failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      return base;
    },
  );

  const detectMethod: ShotTable["detectMethod"] = cuts.every(
    (cut) => cut.boundarySource === "scene-detect",
  )
    ? "scenedetect"
    : "fixed-window-fallback";

  const shotTable: ShotTable = {
    version: 1,
    sourceVideoUrl: videoUrl,
    totalDurationSec: meta.durationSec,
    aspectRatio,
    fps: meta.fps,
    mode,
    detectMethod,
    shotCount: cuts.length,
    cuts,
  };

  return { ok: true, shotTable };
}
