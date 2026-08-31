import { execFile } from "node:child_process";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { readNewApiRelay } from "../agents/agents-llm-proxy";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  ANALYZE_VIDEO_MAX_SEGMENT_SEC,
  needsSegmentSplit,
  sizeAwareMaxSegSec,
  VIDEO_UNDERSTAND_MAX_BYTES,
} from "./video-segment-plan";
import {
  probeVideoDurationSec,
  probeVideoSizeBytes,
  splitVideoUrlToSegments,
  transcodeToUnderstandingProxy,
} from "./agents-tool-bridge.video-split-io";
import { analyzeOneVideoUrl } from "./agents-tool-bridge.analyze-video";
import { VIDEO_UNDERSTANDING_MODEL_KEY } from "./media-understanding-model";

// 理解层用的视频理解模型（与 analyze-video 同款）。
const DEFAULT_VIDEO_UNDERSTAND_MODEL = VIDEO_UNDERSTANDING_MODEL_KEY;
// 15 秒片段彼此独立；并发 10 可显著缩短长片等待。15 秒是上游 input_video
// 的硬上限，不能为了减少段数改成 30 秒；30 秒请求必须在协议边界被压回 15 秒。
const DIRECTOR_SEGMENT_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const limit = Math.max(1, Math.trunc(concurrency));
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

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Promise 化 execFile（镜像 decompose / extract-frames-at），便于 mock。
async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// 由宽高算人类比例字符串（snap 到常见档，否则约分 W:H）。空维度 → ""。镜像 decompose 的同名逻辑。
function aspectRatioFromDims(width: number | null, height: number | null): string {
  if (!width || !height || width <= 0 || height <= 0) return "";
  const presets: Array<{ label: string; ratio: number }> = [
    { label: "16:9", ratio: 16 / 9 },
    { label: "9:16", ratio: 9 / 16 },
    { label: "4:3", ratio: 4 / 3 },
    { label: "3:4", ratio: 3 / 4 },
    { label: "1:1", ratio: 1 },
    { label: "21:9", ratio: 21 / 9 },
    { label: "2.39:1", ratio: 2.39 },
    { label: "3:2", ratio: 3 / 2 },
    { label: "2:3", ratio: 2 / 3 },
  ];
  const actual = width / height;
  for (const preset of presets) {
    if (Math.abs(actual - preset.ratio) / preset.ratio < 0.04) return preset.label;
  }
  const divisor = gcd(width, height) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

interface VideoMeta {
  durationSec: number;
  fps: number | null;
  aspectRatio: string;
}

// 一次 URL 级 ffprobe（不下载整片）→ 时长 + fps + 比例。任一字段失败降级（0/null/""）。
async function probeVideoMetaFromUrl(url: string): Promise<VideoMeta> {
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
      url,
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
      aspectRatio: aspectRatioFromDims(
        Number.isFinite(w) && w > 0 ? w : null,
        Number.isFinite(h) && h > 0 ? h : null,
      ),
    };
  } catch {
    return { durationSec: 0, fps: null, aspectRatio: "" };
  }
}

export type DirectorShot = {
  index: number;
  approxStartSec: number;
  approxEndSec: number;
  approxDurationSec: number;
  shotSize: string;
  cameraAngle: string;
  cameraMove: string;
  focalLength: string;
  subject: string;
  action: string;
  sceneEnv: string;
  lighting: string;
  composition: string;
  /** 与上一镜的剪辑关系（硬切/转场/匹配剪辑/叠化…）。 */
  editRelation: string;
  /** 这镜为什么这么拍（导演意图）—— 学习的核心，0→1 创作复用的就是这套判断。 */
  directorIntent: string;
};

/** 反复出现的角色（漫剧一致性锚定的依据；蒙太奇广告通常为空/各镜不同人）。 */
export type DirectorCastMember = {
  /** 角色名/代号（建角色卡时作 roleName，逐镜用 characterRoleNames 绑定）。 */
  roleName: string;
  /** 外形事实（年龄/体型/发型/服装/特征）——交给 tapcanvas-character-card 的输入证据。 */
  appearance: string;
};

/** 反复出现的场景（建场景卡的依据）。 */
export type DirectorLocation = {
  name: string;
  description: string;
};

export type DirectorAnalysisSegment = {
  /** 1-based 展示序号，便于画布中按 S01/S02… 对照原片。 */
  sequence: number;
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  status: "analyzed" | "unparseable";
  /** 本段在合并后 shots 数组中的闭区间；没有可解析镜头时为 null。 */
  firstShotIndex: number | null;
  lastShotIndex: number | null;
};

export type DirectorAnalysisGroup = {
  /** 30 秒逻辑组序号；组内仍由若干 ≤15 秒物理片段组成。 */
  sequence: number;
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  segmentSequences: number[];
  firstShotIndex: number | null;
  lastShotIndex: number | null;
};

export type DirectorBreakdown = {
  version: 1;
  sourceVideoUrl: string;
  totalDurationSec: number;
  aspectRatio: string;
  fps: number | null;
  logline: string;
  narrativeStructure: string;
  pacingMode: "montage" | "continuous";
  visualMotif: { light: string; color: string; motion: string };
  signatureShot: string;
  /**
   * 角色花名册（去重·全片级）：反复出现的角色。**一致性内容(漫剧)据此先建角色卡再逐镜绑定**；
   * 空或都是"路人/各镜不同人"=蒙太奇片，无需角色锚。
   */
  cast: DirectorCastMember[];
  /** 场景册（去重·全片级）：反复出现的场景，据此建场景卡。 */
  locations: DirectorLocation[];
  /** 物理切段与全片镜号的映射，保证拆分后可追溯、可组装。 */
  segments: DirectorAnalysisSegment[];
  /** 30 秒逻辑组与物理片段/全片镜号的组装映射。 */
  groups: DirectorAnalysisGroup[];
  shotCount: number;
  shots: DirectorShot[];
};

export type DistillDirectorBreakdownResult = { ok: true; breakdown: DirectorBreakdown };

// 导演拆解 prompt：让视频理解模型以严格 JSON 回逐镜镜头语言 + 整片导演判断。
// 不要 markdown/解释，键名固定。时间用相对本段秒（切段时由 startOffset 还原全局）。
const DIRECTOR_BREAKDOWN_PROMPT =
  "你是资深导演与剪辑师。请只看画面与声音，以严格 JSON 拆解这段视频的导演与镜头语言，" +
  "不要输出任何额外文字、解释或 markdown 代码块。键名固定、值为字符串（shots 为数组）：" +
  '{"logline":"一句话这片在讲什么/给人什么感觉",' +
  '"narrativeStructure":"叙事结构(钩子→…→落点的节拍)",' +
  '"pacingMode":"montage 或 continuous（快切蒙太奇=montage，连续长镜/连贯运镜=continuous）",' +
  '"visualMotif":{"light":"光的方向/质感母题","color":"主色对话/调色基调","motion":"运动母题(如一镜到底缓环绕)"},' +
  '"signatureShot":"最记忆点的那一眼是哪镜、什么画面",' +
  '"cast":[{"roleName":"反复出现的角色名/代号(给固定主角/配角；若全片各镜是不同路人、无贯穿角色则留空数组)","appearance":"外形:年龄/体型/发型/服装/特征"}],' +
  '"locations":[{"name":"反复出现的场景名","description":"环境/背景描述"}],' +
  '"shots":[{"approxStartSec":数字,"approxEndSec":数字,' +
  '"shotSize":"景别(远景/全景/中景/中近景/特写)","cameraAngle":"机位角度(平视/俯视/仰视及大致度数)",' +
  '"cameraMove":"运镜(固定/推/拉/摇/移/跟/环绕)","focalLength":"焦段感(广角/35mm/标准/长焦)",' +
  '"subject":"主体(人物外形:年龄体型发型服装/产品)","action":"主体动作",' +
  '"sceneEnv":"场景环境与背景","lighting":"光线(方向/色温/软硬)","composition":"构图(法则/主体位置/留白)",' +
  '"editRelation":"与上一镜的剪辑关系(硬切/转场/匹配剪辑/叠化)",' +
  '"directorIntent":"这一镜为什么这么拍——它在整片里起什么作用、想让观众感受到什么"}]}';

function pickStr(obj: Record<string, unknown>, key: string): string {
  return readTrimmedString(obj[key]);
}

function pickNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round3(n) : 0;
}

function normalizePacing(value: unknown): "montage" | "continuous" {
  return readTrimmedString(value).toLowerCase() === "montage" ? "montage" : "continuous";
}

type PartialBreakdown = {
  logline: string;
  narrativeStructure: string;
  pacingMode: "montage" | "continuous";
  visualMotif: { light: string; color: string; motion: string };
  signatureShot: string;
  cast: DirectorCastMember[];
  locations: DirectorLocation[];
  shots: Array<Omit<DirectorShot, "index" | "approxDurationSec">>;
};

/** 从视频理解自由文本里抠出导演拆解 JSON（容忍 ```json 围栏与前后散文：切第一个 { 到最后一个 }）。 */
export function parseDirectorBreakdown(text: string): PartialBreakdown | null {
  const trimmed = readTrimmedString(text);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const motifRaw =
    obj.visualMotif && typeof obj.visualMotif === "object" && !Array.isArray(obj.visualMotif)
      ? (obj.visualMotif as Record<string, unknown>)
      : {};
  const shotsRaw = Array.isArray(obj.shots) ? obj.shots : [];
  const shots = shotsRaw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && !Array.isArray(s))
    .map((s) => ({
      approxStartSec: pickNum(s.approxStartSec),
      approxEndSec: pickNum(s.approxEndSec),
      shotSize: pickStr(s, "shotSize"),
      cameraAngle: pickStr(s, "cameraAngle"),
      cameraMove: pickStr(s, "cameraMove"),
      focalLength: pickStr(s, "focalLength"),
      subject: pickStr(s, "subject"),
      action: pickStr(s, "action"),
      sceneEnv: pickStr(s, "sceneEnv"),
      lighting: pickStr(s, "lighting"),
      composition: pickStr(s, "composition"),
      editRelation: pickStr(s, "editRelation"),
      directorIntent: pickStr(s, "directorIntent"),
    }));
  const castRaw = Array.isArray(obj.cast) ? obj.cast : [];
  const cast = castRaw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && !Array.isArray(c))
    .map((c) => ({ roleName: pickStr(c, "roleName"), appearance: pickStr(c, "appearance") }))
    .filter((c) => c.roleName.length > 0);
  const locRaw = Array.isArray(obj.locations) ? obj.locations : [];
  const locations = locRaw
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object" && !Array.isArray(l))
    .map((l) => ({ name: pickStr(l, "name"), description: pickStr(l, "description") }))
    .filter((l) => l.name.length > 0);
  return {
    logline: pickStr(obj, "logline"),
    narrativeStructure: pickStr(obj, "narrativeStructure"),
    pacingMode: normalizePacing(obj.pacingMode),
    visualMotif: {
      light: pickStr(motifRaw, "light"),
      color: pickStr(motifRaw, "color"),
      motion: pickStr(motifRaw, "motion"),
    },
    signatureShot: pickStr(obj, "signatureShot"),
    cast,
    locations,
    shots,
  };
}

/** 跨段去重合并花名册（按归一化 roleName）；保留首个非空 appearance。 */
export function mergeCast(partials: PartialBreakdown[]): DirectorCastMember[] {
  const byKey = new Map<string, DirectorCastMember>();
  for (const p of partials) {
    for (const c of p.cast) {
      const key = c.roleName.trim().toLowerCase();
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) byKey.set(key, { ...c });
      else if (!existing.appearance && c.appearance) existing.appearance = c.appearance;
    }
  }
  return Array.from(byKey.values());
}

/** 跨段去重合并场景册（按归一化 name）。 */
export function mergeLocations(partials: PartialBreakdown[]): DirectorLocation[] {
  const byKey = new Map<string, DirectorLocation>();
  for (const p of partials) {
    for (const l of p.locations) {
      const key = l.name.trim().toLowerCase();
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) byKey.set(key, { ...l });
      else if (!existing.description && l.description) existing.description = l.description;
    }
  }
  return Array.from(byKey.values());
}

/** 把逐段 partial 合并成全片 shots（段内相对时间 + startOffset → 全局；镜号连续重编）。 */
export function mergePartialBreakdowns(
  partials: Array<{ startOffset: number; partial: PartialBreakdown }>,
): DirectorShot[] {
  const shots: DirectorShot[] = [];
  for (const { startOffset, partial } of partials) {
    for (const s of partial.shots) {
      const startSec = round3(s.approxStartSec + startOffset);
      const endSec = round3(Math.max(s.approxEndSec + startOffset, startSec));
      shots.push({
        ...s,
        index: shots.length,
        approxStartSec: startSec,
        approxEndSec: endSec,
        approxDurationSec: round3(endSec - startSec),
      });
    }
  }
  return shots;
}

function resolveVideoUrlFromFlowNode(row: FlowRow, nodeId: string): string {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const node = nodes.find((n) => String(n.id ?? "") === nodeId);
  if (!node) return "";
  const d =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};
  const direct = readTrimmedString(d.videoUrl) || readTrimmedString(d.video);
  if (direct) return direct;
  const vr = Array.isArray(d.videoResults) ? d.videoResults : [];
  for (const item of vr) {
    if (item && typeof item === "object") {
      const u = readTrimmedString((item as Record<string, unknown>).url);
      if (u) return u;
    }
  }
  return "";
}

/**
 * 理解层（复刻=学习闭环 ①）：对一条参考片做**一次视频理解**，产出结构化「导演拆解卡」DirectorBreakdown
 * （整片 logline/叙事/节奏语态/视觉母题/signature + 逐镜镜头语言 + 导演意图）。
 *
 * 取代旧 decompose 的「逐镜抽帧 + 逐帧视觉打标」：
 *  - 根除多镜快剪一次性并发打爆视觉上游(429/500/重试 → 254s → fetch failed)；
 *  - 贴合「原片只作对照、绝不进生成」——这里不抽帧、不碰原片像素，只产可迁移的方法论文本。
 *
 * 长片(>15s)复用 analyze-video 的物理切段 + 逐段理解，再按 startOffset 合并镜号/时间为全片。
 * ffprobe 补精确总时长/比例/fps（便宜、不靠视觉），覆盖模型对时长/比例的估值。
 */
/**
 * 【拆片卡落画布 v1·2026-07-07】把导演拆解渲染成人读 markdown（写进画布 text 节点 prompt 字段）。
 * 结构化真值仍在节点 data.directorBreakdown（JSON），本渲染只为画布可读展示；逐镜行超过 maxShots
 * 截断并注明（防 258 镜长片把节点 prompt 撑爆）。纯函数，可单测。
 */
export function renderDirectorBreakdownMarkdown(
  b: DirectorBreakdown,
  opts?: { maxShots?: number },
): string {
  const maxShots = Math.max(1, opts?.maxShots ?? 60);
  const lines: string[] = [];
  lines.push(`# 拆片卡（导演拆解）`);
  lines.push(``);
  lines.push(`- 源片：${b.sourceVideoUrl}`);
  lines.push(`- 时长 ${Math.round(b.totalDurationSec)}s · ${b.aspectRatio || "?"} · ${b.shotCount} 镜 · 节奏 ${b.pacingMode}`);
  lines.push(`- logline：${b.logline || "（无）"}`);
  lines.push(`- 叙事结构：${b.narrativeStructure || "（无）"}`);
  const motif = [b.visualMotif?.light, b.visualMotif?.color, b.visualMotif?.motion]
    .map((v) => readTrimmedString(v))
    .filter(Boolean)
    .join(" / ");
  lines.push(`- 视觉母题：${motif || "（无）"}`);
  lines.push(`- 签名镜：${b.signatureShot || "（无）"}`);
  if (b.cast.length) {
    lines.push(``);
    lines.push(`## 花名册`);
    for (const m of b.cast) lines.push(`- ${m.roleName}：${m.appearance || ""}`.trimEnd());
  }
  if (b.locations.length) {
    lines.push(``);
    lines.push(`## 场景册`);
    for (const l of b.locations) lines.push(`- ${l.name}：${l.description || ""}`.trimEnd());
  }
  const segments = Array.isArray(b.segments) ? b.segments : [];
  if (segments.length > 1) {
    lines.push(``);
    lines.push(`## 分段组装索引`);
    lines.push(`- 共 ${segments.length} 段；每段 ≤${ANALYZE_VIDEO_MAX_SEGMENT_SEC}s，按 sequence 对齐原片，shots 已按 startOffset 还原为全局镜号。`);
    for (const segment of segments) {
      const shotRange = segment.firstShotIndex === null
        ? "无可解析镜头"
        : `全片镜号 ${segment.firstShotIndex + 1}-${(segment.lastShotIndex ?? segment.firstShotIndex) + 1}`;
      lines.push(`- ${segment.label}｜${segment.status}｜${shotRange}`);
    }
    const groups = Array.isArray(b.groups) ? b.groups : [];
    if (groups.length > 1) {
      lines.push(`- 逻辑组（每组约 30s，仅用于组织与交付；模型仍只接收 ≤${ANALYZE_VIDEO_MAX_SEGMENT_SEC}s 物理片段）：`);
      for (const group of groups) {
        const shotRange = group.firstShotIndex === null
          ? "无可解析镜头"
          : `全片镜号 ${group.firstShotIndex + 1}-${(group.lastShotIndex ?? group.firstShotIndex) + 1}`;
        lines.push(`  - ${group.label}｜物理段 ${group.segmentSequences.map((n) => `S${String(n).padStart(2, "0")}`).join("+")}｜${shotRange}`);
      }
    }
  }
  lines.push(``);
  lines.push(`## 逐镜（镜号｜起止｜景别/机位/运镜｜画面）`);
  for (const s of b.shots.slice(0, maxShots)) {
    const range = `${s.approxStartSec.toFixed(1)}-${s.approxEndSec.toFixed(1)}s`;
    const lang = [s.shotSize, s.cameraAngle, s.cameraMove].map((v) => readTrimmedString(v)).filter(Boolean).join("/");
    const what = readTrimmedString(s.subject) && readTrimmedString(s.action)
      ? `${s.subject}：${s.action}`
      : readTrimmedString(s.action) || readTrimmedString(s.subject);
    lines.push(`${s.index + 1}｜${range}｜${lang || "?"}｜${what || "?"}${readTrimmedString(s.directorIntent) ? `（意图：${s.directorIntent}）` : ""}`);
  }
  if (b.shots.length > maxShots) {
    lines.push(`…（共 ${b.shots.length} 镜，此处截断展示前 ${maxShots} 镜；完整数据在本节点 directorBreakdown 字段）`);
  }
  return lines.join("\n");
}

export async function distillDirectorBreakdownForAgent(input: {
  c: AppContext;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<DistillDirectorBreakdownResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  let videoUrl = readTrimmedString(args.sourceUrl) || readTrimmedString(args.videoUrl) || readTrimmedString(args.url);
  const nodeId = readTrimmedString(args.nodeId);
  if (!videoUrl && nodeId) {
    if (!input.row) throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
    videoUrl = resolveVideoUrlFromFlowNode(input.row, nodeId);
  }
  if (!videoUrl) {
    throw new AppError("sourceUrl/videoUrl 或含视频的 nodeId 必须提供一个", {
      status: 400,
      code: "agents_tool_distill_breakdown_missing_video",
    });
  }

  const relay = readNewApiRelay(input.c);
  if (!relay) {
    throw new AppError("NEW_API 中转未配置", { status: 500, code: "new_api_not_configured" });
  }

  const model = readTrimmedString(args.model) || readTrimmedString(args.modelKey) || DEFAULT_VIDEO_UNDERSTAND_MODEL;
  const fps = typeof args.fps === "number" && args.fps > 0 ? args.fps : 1;

  // 原片 meta（比例/帧率/时长）始终取自原片——代理片只用于喂模型、不改写拆解卡的真值。
  const meta = await probeVideoMetaFromUrl(videoUrl);
  const durationForSplit = meta.durationSec > 0 ? meta.durationSec : await probeVideoDurationSec(videoUrl);
  const sizeBytes = await probeVideoSizeBytes(videoUrl);

  // 超高分辨率/大文件(>38MiB)先转【降分辨率代理片】再喂理解——治模型 50MiB 上限 + 超宽 4K 拉取/解码超时。
  let understandUrl = videoUrl;
  let understandSize = sizeBytes;
  if (sizeBytes > VIDEO_UNDERSTAND_MAX_BYTES) {
    try {
      const proxy = await transcodeToUnderstandingProxy({ c: input.c, sourceUrl: videoUrl });
      understandUrl = proxy.url;
      understandSize = proxy.sizeBytes;
    } catch {
      // 转码失败 → 退回原片，由下方 size-aware 切段兜底（至少不超 50MiB 大小上限）。
    }
  }

	// 切段上限同时受【时长 ≤15s】与【大小 ≤38MiB】约束（代理后通常单段即可）。
  const maxSegSec = sizeAwareMaxSegSec(durationForSplit, understandSize, ANALYZE_VIDEO_MAX_SEGMENT_SEC);

  // 逐段（或单段）拿到 partial breakdown，再合并 shots。
  const partials: Array<{ startOffset: number; partial: PartialBreakdown }> = [];
  const segmentResults: Array<{
    sequence: number;
    startSec: number;
    endSec: number;
    partial: PartialBreakdown | null;
  }> = [];
  if (needsSegmentSplit(durationForSplit, maxSegSec)) {
    const segments = await splitVideoUrlToSegments({
      c: input.c,
      sourceUrl: understandUrl,
      durationSec: durationForSplit,
      maxSegSec,
    });
		const analyzedSegments = await mapWithConcurrency(segments, DIRECTOR_SEGMENT_CONCURRENCY, async (seg, segmentIndex) => {
			const text = await analyzeOneVideoUrl({
				c: input.c,
				relay,
				videoUrl: seg.url,
				model,
				prompt: DIRECTOR_BREAKDOWN_PROMPT,
				fps,
			});
			return {
				sequence: (Number.isInteger(seg.index) ? seg.index : segmentIndex) + 1,
        startOffset: seg.startSec,
        endSec: seg.endSec,
        partial: parseDirectorBreakdown(text),
      };
		});
		for (const item of analyzedSegments) {
			segmentResults.push({
        sequence: item.sequence,
        startSec: item.startOffset,
        endSec: item.endSec,
        partial: item.partial,
      });
			if (item.partial) partials.push({ startOffset: item.startOffset, partial: item.partial });
		}
  } else {
    const text = await analyzeOneVideoUrl({
      c: input.c,
      relay,
      videoUrl: understandUrl,
      model,
      prompt: DIRECTOR_BREAKDOWN_PROMPT,
      fps,
    });
    const partial = parseDirectorBreakdown(text);
    segmentResults.push({ sequence: 1, startSec: 0, endSec: durationForSplit, partial });
    if (partial) partials.push({ startOffset: 0, partial });
  }

  if (partials.length === 0) {
    throw new AppError("视频理解未返回可解析的导演拆解（上游空响应或非 JSON）", {
      status: 502,
      code: "agents_tool_distill_breakdown_unparseable",
    });
  }

  const shots = mergePartialBreakdowns(partials);
  // 整片级字段取首段（首段通常含开场立意）；节奏语态多段取多数，单段直接用。
  const head = partials[0]!.partial;
  const pacingVotes = partials.filter((p) => p.partial.pacingMode === "montage").length;
  const pacingMode: "montage" | "continuous" =
    partials.length > 1 ? (pacingVotes * 2 > partials.length ? "montage" : "continuous") : head.pacingMode;
  // 花名册/场景册跨段去重合并（漫剧一致性据此先建角色卡/场景卡再逐镜绑定）。
  const partialList = partials.map((p) => p.partial);
  const cast = mergeCast(partialList);
  const locations = mergeLocations(partialList);
  let shotCursor = 0;
  const segments: DirectorAnalysisSegment[] = segmentResults.map((segment) => {
    const shotCount = segment.partial?.shots.length ?? 0;
    const firstShotIndex = shotCount > 0 ? shotCursor : null;
    const lastShotIndex = shotCount > 0 ? shotCursor + shotCount - 1 : null;
    shotCursor += shotCount;
    const startSec = round3(segment.startSec);
    const endSec = round3(Math.max(segment.endSec, startSec));
    return {
      sequence: segment.sequence,
      label: `S${String(segment.sequence).padStart(2, "0")} ${startSec.toFixed(1)}-${endSec.toFixed(1)}s`,
      startSec,
      endSec,
      durationSec: round3(endSec - startSec),
      status: segment.partial ? "analyzed" : "unparseable",
      firstShotIndex,
      lastShotIndex,
    };
  });
  const groupMap = new Map<number, DirectorAnalysisGroup>();
  for (const segment of segments) {
    const sequence = Math.floor(segment.startSec / 30) + 1;
    const existing = groupMap.get(sequence);
    if (!existing) {
      groupMap.set(sequence, {
        sequence,
        label: `G${String(sequence).padStart(2, "0")} ${segment.startSec.toFixed(1)}-${segment.endSec.toFixed(1)}s`,
        startSec: segment.startSec,
        endSec: segment.endSec,
        durationSec: segment.durationSec,
        segmentSequences: [segment.sequence],
        firstShotIndex: segment.firstShotIndex,
        lastShotIndex: segment.lastShotIndex,
      });
      continue;
    }
    existing.endSec = segment.endSec;
    existing.durationSec = round3(existing.endSec - existing.startSec);
    existing.label = `G${String(sequence).padStart(2, "0")} ${existing.startSec.toFixed(1)}-${existing.endSec.toFixed(1)}s`;
    existing.segmentSequences.push(segment.sequence);
    if (existing.firstShotIndex === null) existing.firstShotIndex = segment.firstShotIndex;
    if (segment.lastShotIndex !== null) existing.lastShotIndex = segment.lastShotIndex;
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.sequence - b.sequence);

  const breakdown: DirectorBreakdown = {
    version: 1,
    sourceVideoUrl: videoUrl,
    totalDurationSec: durationForSplit,
    aspectRatio: meta.aspectRatio,
    fps: meta.fps,
    logline: head.logline,
    narrativeStructure: head.narrativeStructure,
    pacingMode,
    visualMotif: head.visualMotif,
    signatureShot: head.signatureShot,
    cast,
    locations,
    segments,
    groups,
    shotCount: shots.length,
    shots,
  };

  return { ok: true, breakdown };
}
