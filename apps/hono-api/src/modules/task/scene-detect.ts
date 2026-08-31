import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { FFMPEG_EXEC_OPTS } from "./subprocess-limits";

const execFileAsync = promisify(execFile);

/** 默认固定窗口时长（秒）—— scenedetect 不可用或无有效切分时，每 ~3.5s 切一镜。 */
export const DEFAULT_WINDOW_SEC = 3.5;
/**
 * 当 scenedetect 只切出 0/1 个镜头、但视频总时长超过该阈值时，认为「整段一镜」不合理，
 * 降级为固定窗口切分。短于该阈值的整段视频保留为单镜。
 */
export const FALLBACK_MIN_DURATION_SEC = 8;

export type BoundarySource = "scene-detect" | "fallback-window";

export interface DetectedScene {
  /** 0-based 镜头序号 */
  index: number;
  /** 镜头起始时间（秒） */
  startSec: number;
  /** 镜头结束时间（秒） */
  endSec: number;
  /** 镜头时长（秒），= endSec - startSec */
  durationSec: number;
  /** 该边界的来源：真实镜头检测 or 固定窗口降级 */
  boundarySource: BoundarySource;
}

export interface DetectScenesOptions {
  /**
   * 视频总时长（秒）。已知时传入可避免额外 ffprobe；
   * 同时用于判定「0/1 镜 + 长视频」是否需要降级。
   */
  totalDurationSec?: number;
  /** 固定窗口降级时每镜时长（秒），默认 DEFAULT_WINDOW_SEC。 */
  windowSec?: number;
  /** 可选：合并短于该秒数的过碎镜头到相邻镜（0/未设则不合并）。 */
  minSceneSec?: number;
}

interface RawScene {
  startSec: number;
  endSec: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, FFMPEG_EXEC_OPTS);
}

/** 命令缺失/无法启动（dev 环境未安装 scenedetect）。 */
function isSceneDetectUnavailable(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /ENOENT|not found|No such file/i.test(message);
}

function splitCsvLine(line: string): string[] {
  // scenedetect 输出的均为数字 / 时间码字段，不含被引号包裹的逗号，简单切分即可。
  return line.split(",").map((cell) => cell.trim());
}

/**
 * 解析 scenedetect `list-scenes` 导出的 CSV，提取每个镜头的起止秒。
 * 兼容两种格式：
 *  1) 完整格式（带 "Timecode List:" 行 + 多列表头，含 "Start/End Time (seconds)"）
 *  2) 精简格式（表头 `Scene,Start Time (seconds),End Time (seconds),...`）
 * 通过表头列名定位「Start/End Time (seconds)」列，避免依赖固定列序。
 */
export function parseScenesCsv(csv: string): RawScene[] {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rows.length === 0) return [];

  // 定位表头行（含 "Start Time (seconds)" 的那一行）。
  let headerIdx = -1;
  let headerCells: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = splitCsvLine(rows[i]);
    if (cells.some((c) => /start time \(seconds\)/i.test(c))) {
      headerIdx = i;
      headerCells = cells;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const startIdx = headerCells.findIndex((c) => /start time \(seconds\)/i.test(c));
  const endIdx = headerCells.findIndex((c) => /end time \(seconds\)/i.test(c));
  if (startIdx === -1 || endIdx === -1) return [];

  const out: RawScene[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = splitCsvLine(rows[i]);
    const startSec = Number.parseFloat(cells[startIdx]);
    const endSec = Number.parseFloat(cells[endIdx]);
    if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
      out.push({ startSec, endSec });
    }
  }
  return out;
}

function toDetectedScenes(raw: RawScene[], boundarySource: BoundarySource): DetectedScene[] {
  return raw.map((scene, index) => ({
    index,
    startSec: round3(scene.startSec),
    endSec: round3(scene.endSec),
    durationSec: round3(scene.endSec - scene.startSec),
    boundarySource,
  }));
}

/** 固定窗口切分：每 windowSec 一镜，末段补齐到 totalDurationSec。 */
export function fixedWindowSplit(
  totalDurationSec: number,
  windowSec: number = DEFAULT_WINDOW_SEC,
): DetectedScene[] {
  if (!(totalDurationSec > 0) || !(windowSec > 0)) return [];
  const scenes: DetectedScene[] = [];
  let index = 0;
  for (let start = 0; start < totalDurationSec - 1e-6; start += windowSec) {
    const end = Math.min(start + windowSec, totalDurationSec);
    scenes.push({
      index,
      startSec: round3(start),
      endSec: round3(end),
      durationSec: round3(end - start),
      boundarySource: "fallback-window",
    });
    index++;
  }
  return scenes;
}

/**
 * 合并过碎镜头：把短于 minSceneSec 的镜头并入前一镜（首镜则并入后一镜）。
 * 纯函数，重新计算 index / durationSec。
 */
export function mergeTinyScenes(scenes: DetectedScene[], minSceneSec: number): DetectedScene[] {
  if (!(minSceneSec > 0) || scenes.length <= 1) return scenes;
  const merged: DetectedScene[] = [];
  for (const scene of scenes) {
    const tooShort = scene.endSec - scene.startSec < minSceneSec;
    if (tooShort && merged.length > 0) {
      // 并入前一镜：延长前镜的结束时间。
      const prev = merged[merged.length - 1];
      prev.endSec = round3(scene.endSec);
      prev.durationSec = round3(prev.endSec - prev.startSec);
      continue;
    }
    merged.push({ ...scene });
  }
  // 若首镜过碎已被推入 merged，再做一次「首镜并入后镜」修正。
  if (merged.length > 1 && merged[0].endSec - merged[0].startSec < minSceneSec) {
    const first = merged.shift()!;
    merged[0].startSec = round3(first.startSec);
    merged[0].durationSec = round3(merged[0].endSec - merged[0].startSec);
  }
  return merged.map((scene, index) => ({ ...scene, index }));
}

/**
 * 根据检测结果与总时长决定最终镜头序列：
 *  - 0 个镜头 → 固定窗口降级
 *  - 1 个镜头且总时长 > FALLBACK_MIN_DURATION_SEC → 固定窗口降级（避免「长视频一镜」）
 *  - 其余 → 直接采用检测结果
 * 纯函数，便于单测。
 */
export function decideScenes(
  detected: DetectedScene[],
  totalDurationSec: number,
  windowSec: number = DEFAULT_WINDOW_SEC,
): DetectedScene[] {
  const needFallback =
    detected.length === 0 ||
    (detected.length === 1 && totalDurationSec > FALLBACK_MIN_DURATION_SEC);
  if (needFallback && totalDurationSec > 0) {
    return fixedWindowSplit(totalDurationSec, windowSec);
  }
  return detected;
}

/** 通过 ffprobe 读取视频总时长（秒）。失败返回 null。 */
async function probeDurationSec(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** 调用 scenedetect CLI（detect-content + list-scenes → CSV）并解析为镜头序列。 */
async function runSceneDetect(videoPath: string): Promise<DetectedScene[]> {
  const workDir = await mkdtemp(join(tmpdir(), "scenedetect-"));
  try {
    await run("scenedetect", [
      "-i",
      videoPath,
      "-o",
      workDir,
      "detect-content",
      "list-scenes",
      "-f",
      "scenes.csv",
    ]);
    const csv = await readFile(join(workDir, "scenes.csv"), "utf-8");
    return toDetectedScenes(parseScenesCsv(csv), "scene-detect");
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 对视频做镜头切分，返回每镜的起止秒。优先用 PySceneDetect 内容检测；
 * 若 scenedetect 不可用（dev 环境未安装，ENOENT）或切出 0/1 镜且总时长偏长，
 * 自动降级为固定窗口切分（每 ~windowSec 一镜），保证 decompose 始终拿得到分镜。
 *
 * 每个镜头标注 boundarySource（'scene-detect' | 'fallback-window'）以便上游区分质量。
 * 容器内 scenedetect / ffprobe 均已随镜像内置（见 Dockerfile）。
 */
export async function detectScenes(
  videoPath: string,
  options: DetectScenesOptions = {},
): Promise<DetectedScene[]> {
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC;

  let detected: DetectedScene[] | null = null;
  try {
    detected = await runSceneDetect(videoPath);
  } catch (err) {
    if (!isSceneDetectUnavailable(err)) {
      // 非「未安装」类错误（损坏视频、解码失败等）也降级处理，避免中断 decompose。
      console.warn(
        `[scene-detect] scenedetect failed, falling back to fixed window: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } else {
      console.warn(
        "[scene-detect] scenedetect CLI not found, falling back to fixed window split",
      );
    }
    detected = null;
  }

  let totalDurationSec = options.totalDurationSec;
  if (totalDurationSec == null) {
    totalDurationSec =
      detected && detected.length > 0
        ? detected[detected.length - 1].endSec
        : (await probeDurationSec(videoPath)) ?? 0;
  }

  let result = decideScenes(detected ?? [], totalDurationSec, windowSec);
  if (options.minSceneSec && options.minSceneSec > 0) {
    result = mergeTinyScenes(result, options.minSceneSec);
  }
  return result;
}
