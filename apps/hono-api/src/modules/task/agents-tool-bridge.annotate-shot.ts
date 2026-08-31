import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolveObjectStorageConfig, createObjectStorageClientFromConfig } from "../asset/rustfs.client";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";

/**
 * 确定性「分镜运镜标注」工具：在一张底图上按**精确归一化坐标**叠加导演运镜示意
 * （轨迹箭头 / 机位框 / 文字标签），服务端 @napi-rs/canvas 合成、上传 TOS、返回新图 URL。
 *
 * 为什么是工具不是生图模型：gpt-image-2 画箭头是生成式"脑补"、不照坐标走、烧额度、可能改画面；
 * 这里坐标精确、毫秒级、零模型额度、可复现、可批量。小T 给坐标 → 工具按坐标精确画。
 * 坐标一律归一化 [0,1]（与图尺寸解耦）。本文件几何为纯函数、便于单测。
 */

export type ShotAnnotation =
  | {
      type: "path";
      points: Array<[number, number]>;
      color?: string;
      width?: number;
      arrowHead?: boolean;
    }
  | { type: "frame"; at: [number, number]; size?: number; color?: string }
  | { type: "label"; at: [number, number]; text: string; color?: string; fontSize?: number };

export function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** 归一化坐标 [0..1] → 像素，按图宽高。 */
export function normToPx(p: [number, number], w: number, h: number): [number, number] {
  return [clamp01(p[0]) * w, clamp01(p[1]) * h];
}

/** 箭头两翼端点：线段从 from 指向 to，箭头开在 to 端、张角约 ±25°、长 size(px)。 */
export function arrowHeadPoints(
  from: [number, number],
  to: [number, number],
  size: number,
): { left: [number, number]; right: [number, number] } {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const a = Math.PI / 7; // ~25.7°
  return {
    left: [to[0] - size * Math.cos(ang - a), to[1] - size * Math.sin(ang - a)],
    right: [to[0] - size * Math.cos(ang + a), to[1] - size * Math.sin(ang + a)],
  };
}

function readPoint(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length >= 2) {
    const x = Number(v[0]);
    const y = Number(v[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return [clamp01(x), clamp01(y)];
  }
  return null;
}

function readColor(v: unknown, fallback: string): string {
  // 只接受简单 hex / 常见色名，挡掉注入。
  const s = typeof v === "string" ? v.trim() : "";
  return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^[a-zA-Z]{3,20}$/.test(s) ? s : fallback;
}

/** 解析入参 annotations 数组为受控 ShotAnnotation[]（丢弃非法项）。纯函数、可单测。 */
export function parseAnnotations(raw: unknown): ShotAnnotation[] {
  if (!Array.isArray(raw)) return [];
  const out: ShotAnnotation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const type = typeof r.type === "string" ? r.type : "";
    if (type === "path") {
      const pts = Array.isArray(r.points)
        ? r.points.map(readPoint).filter((p): p is [number, number] => p !== null)
        : [];
      if (pts.length < 2) continue;
      const width = Number(r.width);
      out.push({
        type: "path",
        points: pts,
        color: readColor(r.color, "#ffffff"),
        width: Number.isFinite(width) && width > 0 ? width : 5,
        arrowHead: r.arrowHead !== false,
      });
    } else if (type === "frame") {
      const at = readPoint(r.at);
      if (!at) continue;
      const size = Number(r.size);
      out.push({
        type: "frame",
        at,
        size: Number.isFinite(size) && size > 0 ? clamp01(size) : 0.06,
        color: readColor(r.color, "#ffffff"),
      });
    } else if (type === "label") {
      const at = readPoint(r.at);
      const text = typeof r.text === "string" ? r.text.trim().slice(0, 80) : "";
      if (!at || !text) continue;
      const fontSize = Number(r.fontSize);
      out.push({
        type: "label",
        at,
        text,
        color: readColor(r.color, "#ffd34d"),
        fontSize: Number.isFinite(fontSize) && fontSize > 0 ? clamp01(fontSize) : 0.035,
      });
    }
  }
  return out;
}

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function strokePath(ctx: Ctx, ann: Extract<ShotAnnotation, { type: "path" }>, w: number, h: number) {
  const pts = ann.points.map((p) => normToPx(p, w, h));
  const width = (ann.width ?? 5) * (Math.min(w, h) / 1000);
  const draw = (lineWidth: number, color: string) => {
    ctx.beginPath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1]!;
      const cur = pts[i]!;
      const mid: [number, number] = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2];
      ctx.quadraticCurveTo(prev[0], prev[1], mid[0], mid[1]);
    }
    ctx.lineTo(pts[pts.length - 1]![0], pts[pts.length - 1]![1]);
    ctx.stroke();
  };
  // 双描边：深色描边作衬底(任意背景都看得见) + 主色细线（导演手绘感）。
  draw(width * 2.0, "rgba(0,0,0,0.55)");
  draw(width, ann.color ?? "#ffffff");
  if (ann.arrowHead) {
    const to = pts[pts.length - 1]!;
    const from = pts[pts.length - 2]!;
    const headLen = width * 6;
    const { left, right } = arrowHeadPoints(from, to, headLen);
    for (const [lw, color] of [
      [width * 2.0, "rgba(0,0,0,0.55)"],
      [width, ann.color ?? "#ffffff"],
    ] as const) {
      ctx.beginPath();
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.moveTo(left[0], left[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.lineTo(right[0], right[1]);
      ctx.stroke();
    }
  }
}

function strokeFrame(ctx: Ctx, ann: Extract<ShotAnnotation, { type: "frame" }>, w: number, h: number) {
  const [cx, cy] = normToPx(ann.at, w, h);
  const s = (ann.size ?? 0.06) * Math.min(w, h);
  const lw = Math.max(2, s * 0.08);
  const corner = s * 0.32;
  const x0 = cx - s / 2;
  const y0 = cy - s / 2;
  const x1 = cx + s / 2;
  const y1 = cy + s / 2;
  const draw = (lineWidth: number, color: string) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    // 四角取景框（电影机位取景框图标）
    const corners: Array<[number, number, number, number]> = [
      [x0, y0 + corner, x0, y0],
      [x0, y0, x0 + corner, y0],
      [x1 - corner, y0, x1, y0],
      [x1, y0, x1, y0 + corner],
      [x1, y1 - corner, x1, y1],
      [x1, y1, x1 - corner, y1],
      [x0 + corner, y1, x0, y1],
      [x0, y1, x0, y1 - corner],
    ];
    ctx.beginPath();
    for (const [ax, ay, bx, by] of corners) {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  };
  draw(lw * 2, "rgba(0,0,0,0.55)");
  draw(lw, ann.color ?? "#ffffff");
}

function fillLabel(ctx: Ctx, ann: Extract<ShotAnnotation, { type: "label" }>, w: number, h: number) {
  const [x, y] = normToPx(ann.at, w, h);
  const fontPx = Math.max(12, (ann.fontSize ?? 0.035) * Math.min(w, h));
  ctx.font = `bold ${Math.round(fontPx)}px sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = Math.max(2, fontPx * 0.14);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(ann.text, x, y);
  ctx.fillStyle = ann.color ?? "#ffd34d";
  ctx.fillText(ann.text, x, y);
}

/** 把底图 + annotations 合成为 PNG buffer。需要 @napi-rs/canvas，不是纯函数。 */
export async function renderAnnotatedImage(
  baseBuffer: Buffer | Uint8Array,
  annotations: ShotAnnotation[],
): Promise<Buffer> {
  const img = await loadImage(Buffer.from(baseBuffer));
  const w = img.width;
  const h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  for (const a of annotations) {
    if (a.type === "path") strokePath(ctx, a, w, h);
    else if (a.type === "frame") strokeFrame(ctx, a, w, h);
    else if (a.type === "label") fillLabel(ctx, a, w, h);
  }
  return canvas.toBuffer("image/png");
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 从 flow 节点解析图片 URL（image/storyboardImage/imageEdit 等）。 */
function resolveImageUrlFromFlowNode(row: FlowRow, nodeId: string): string {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const node = nodes.find((n) => String(n.id ?? "") === nodeId);
  if (!node) return "";
  const nd =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};
  const direct = readTrimmedString(nd.imageUrl) || readTrimmedString(nd.url);
  if (direct) return direct;
  const results = Array.isArray(nd.imageResults) ? nd.imageResults : [];
  for (const item of results) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const u = readTrimmedString((item as Record<string, unknown>).url);
      if (u) return u;
    }
  }
  return "";
}

export type AnnotateShotResult = {
  ok: true;
  imageUrl: string;
  key: string;
  annotationCount: number;
  bytes: number;
};

/**
 * 在底图上确定性叠加运镜标注 → 上传 TOS → 返回新图 URL。调用方再 flow_patch 写画布节点
 * （与 video_concat / extract_last_frame 一致：本函数只产 URL，不直接写节点）。
 */
export async function annotateShotToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<AnnotateShotResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  let sourceUrl = readTrimmedString(args.sourceImageUrl) || readTrimmedString(args.imageUrl);
  const nodeId = readTrimmedString(args.sourceNodeId) || readTrimmedString(args.nodeId);
  if (!sourceUrl && nodeId) {
    if (!input.row) {
      throw new AppError("Flow not found", {
        status: 404,
        code: "flow_not_found",
        terminal: false,
      });
    }
    sourceUrl = resolveImageUrlFromFlowNode(input.row, nodeId);
  }
  if (!sourceUrl) {
    throw new AppError("sourceImageUrl 或 sourceNodeId 必须解析出一张底图 URL", {
      status: 400,
      code: "agents_tool_annotate_missing_source",
      terminal: false,
    });
  }

  const annotations = parseAnnotations(args.annotations);
  if (annotations.length === 0) {
    throw new AppError("annotations 至少需要 1 个合法标注（path/frame/label）", {
      status: 400,
      code: "agents_tool_annotate_missing_annotations",
      terminal: false,
    });
  }

  const storageConfig = resolveObjectStorageConfig(input.c.env);
  if (!storageConfig) {
    throw new AppError("对象存储未配置", {
      status: 500,
      code: "object_storage_unconfigured",
      terminal: false,
    });
  }

  try {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) {
      throw new AppError(`底图下载失败：${resp.status}`, {
        status: 502,
        code: "agents_tool_annotate_source_fetch_failed",
        terminal: false,
      });
    }
    const baseBuffer = Buffer.from(await resp.arrayBuffer());
    const out = await renderAnnotatedImage(baseBuffer, annotations);

    const client = createObjectStorageClientFromConfig(storageConfig);
    const safeUser = input.requestUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const key = `gen/images/${safeUser}/${datePrefix}/${randomUUID()}.png`;
    await client.send(
      new PutObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
        Body: out,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
    const imageUrl = publicBase ? `${publicBase}/${key}` : `/${key}`;
    return {
      ok: true,
      imageUrl,
      key,
      annotationCount: annotations.length,
      bytes: out.byteLength,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("运镜标注合成失败", {
      status: 502,
      code: "agents_tool_annotate_failed",
      details: { message: err instanceof Error ? err.message : String(err) },
      terminal: false,
    });
  }
}
