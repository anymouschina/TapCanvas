import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createCanvas, GlobalFonts, loadImage, type Image } from "@napi-rs/canvas";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolveObjectStorageConfig, createObjectStorageClientFromConfig } from "../asset/rustfs.client";
import {
  parseKeyframeCompositionContract,
  renderKeyframeCompositionFacts,
  validateCompositionSubjectCoverage,
  type KeyframeCompositionContract,
  type KeyframeCompositionSubject,
} from "./keyframe-composition-contract";

/**
 * 确定性「俯视站位图（blocking diagram）」渲染工具：把分镜师给的**结构化站位数据**
 * （角色站位/朝向/走位 + 场景地标(墙/门/区域) + 机位/轴线 + 本镜时长）渲染成一张
 * **从正上方看的平面调度示意图**（线稿纸感），服务端 @napi-rs/canvas 绘制、上传对象存储、返回 { imageUrl }。
 *
 * 为什么是工具不是生图模型：站位图的全部价值在**空间真值**（谁在画左/画右、面朝谁、走向哪、机位在轴线哪侧）。
 * gpt-image-2 画平面调度是生成式"脑补"——位置会乱、轴线会反、对不上镜头表，等于把"防漂移的锚"画成噪声。
 * 这里坐标精确、零模型额度、毫秒级、可复现、可批量。它是 3D 导演台（S5.05）的**轻量常驻版**：
 * 不依赖浏览器在线，任何镜头随时能出一张准确的调度图，既作分镜交付文档、又作 role=context 一致性参考、
 * 又是 clipPrompt 里"画左/画右/面朝向/银幕方向"措辞的唯一真源。
 *
 * 坐标一律归一化 [0,1]，原点左上、x 向右、y 向下（俯视平面：x=银幕左右，y=纵深远近/上下）。本文件几何为纯函数、便于单测。
 */

// ——— CJK 字体注册（@napi-rs/canvas 默认 sans-serif 无中文字形 → 中文角色名会渲成 □ 豆腐块）———
// 站位图标签全是中文角色名/地标，必须挂一个含 CJK 字形的字体。容器内有 Noto Sans CJK；
// 注册一次、起个稳定别名，绘制时优先用它、回退 sans-serif（注册失败时英文/数字仍可读，中文降级豆腐块）。
const CJK_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
];
const CJK_ALIAS = "TapBlockingCJK";
let cjkRegistered: boolean | null = null;
function ensureCjkFont(): boolean {
  if (cjkRegistered !== null) return cjkRegistered;
  cjkRegistered = false;
  for (const p of CJK_FONT_CANDIDATES) {
    try {
      if (existsSync(p) && GlobalFonts.registerFromPath(p, CJK_ALIAS)) {
        cjkRegistered = true;
        break;
      }
    } catch {
      // 单个字体注册失败不致命，继续试下一个候选。
    }
  }
  return cjkRegistered;
}
/** 绘制用 font-family：注册成功用 CJK 别名兜底 sans-serif，否则纯 sans-serif。 */
function fontFamily(): string {
  return ensureCjkFont() ? `"${CJK_ALIAS}", sans-serif` : "sans-serif";
}

// ——— 纯几何 / 解析（可单测，无 canvas 依赖）———

export function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function normToPx(p: [number, number], w: number, h: number): [number, number] {
  return [clamp01(p[0]) * w, clamp01(p[1]) * h];
}

/** 角度(度，0=右/东，顺时针为正，与 canvas y 向下一致)转单位方向向量。 */
export function degToUnit(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
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
  const s = typeof v === "string" ? v.trim() : "";
  return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^[a-zA-Z]{3,20}$/.test(s) ? s : fallback;
}

function readText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export type BlockingCharacter = {
  name: string;
  at: [number, number];
  /** 朝向：优先用 facingTo(看向某点，如对手/门)；否则用 facingDeg(度)。两者皆无则不画朝向箭头。 */
  facingTo?: [number, number];
  facingDeg?: number;
  /** 走位终点(虚线箭头)。 */
  moveTo?: [number, number];
  color?: string;
};

export type BlockingLandmark =
  | { kind: "wall"; from: [number, number]; to: [number, number]; label?: string }
  | { kind: "door"; at: [number, number]; orient: "h" | "v"; lengthN: number; label?: string; swing?: "in" | "out" | "none" }
  | { kind: "area"; at: [number, number]; label: string };

export type BlockingCamera = {
  at: [number, number];
  /** 机位朝向：优先 lookAt(看向某点)；否则 facingDeg。 */
  lookAt?: [number, number];
  facingDeg?: number;
  fovDeg?: number;
  label?: string;
};

export type BlockingDiagram = {
  title: string;
  durationSeconds?: number;
  /**
   * 户型底图 URL（2026-07-06 用户拍板）：场景卡先图生图转「俯视平面示意图」，本图叠画在其上——
   * 站位/走位/机位符号有了真实场景几何可对应（否则抽象白纸图与场景卡之间缺视觉桥）。
   * 仅 http(s)；一旦显式提供，下载或解码失败必须终止，禁止退回抽象纸底掩盖场景几何缺失。
   */
  backgroundImageUrl?: string;
  bg: string;
  width: number;
  height: number;
  landmarks: BlockingLandmark[];
  characters: BlockingCharacter[];
  camera?: BlockingCamera;
  /** agents 声明的本镜视觉职责；服务端只做结构校验与证据贯穿，不推断剧情主角。 */
  compositionContract?: KeyframeCompositionContract;
  compositionContractHash?: string;
  /** 180° 轴线（虚线）；缺省时若恰有 2 个角色则自动取两者连线。 */
  axisLine?: { from: [number, number]; to: [number, number] };
};

function parseLandmark(raw: unknown): BlockingLandmark | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === "string" ? r.kind : "";
  if (kind === "wall") {
    const from = readPoint(r.from);
    const to = readPoint(r.to);
    if (!from || !to) return null;
    const label = readText(r.label, 24);
    return { kind: "wall", from, to, ...(label ? { label } : {}) };
  }
  if (kind === "door") {
    const at = readPoint(r.at);
    if (!at) return null;
    const orient = r.orient === "v" ? "v" : "h";
    const lenRaw = Number(r.lengthN);
    const lengthN = Number.isFinite(lenRaw) && lenRaw > 0 ? clamp01(lenRaw) : 0.12;
    const label = readText(r.label, 24);
    const swing = r.swing === "out" || r.swing === "none" ? r.swing : "in";
    return { kind: "door", at, orient, lengthN, swing, ...(label ? { label } : {}) };
  }
  if (kind === "area") {
    const at = readPoint(r.at);
    const label = readText(r.label, 24);
    if (!at || !label) return null;
    return { kind: "area", at, label };
  }
  return null;
}

function parseCharacter(raw: unknown): BlockingCharacter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = readText(r.name, 16);
  const at = readPoint(r.at);
  if (!name || !at) return null;
  const facingTo = readPoint(r.facingTo);
  const moveTo = readPoint(r.moveTo);
  const facingDegRaw = Number(r.facingDeg);
  const out: BlockingCharacter = { name, at, color: readColor(r.color, "#1f6feb") };
  if (facingTo) out.facingTo = facingTo;
  else if (Number.isFinite(facingDegRaw)) out.facingDeg = facingDegRaw;
  if (moveTo) out.moveTo = moveTo;
  return out;
}

function parseCamera(raw: unknown): BlockingCamera | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const at = readPoint(r.at);
  if (!at) return null;
  const lookAt = readPoint(r.lookAt);
  const facingDegRaw = Number(r.facingDeg);
  const fovRaw = Number(r.fovDeg);
  const label = readText(r.label, 16);
  const out: BlockingCamera = { at };
  if (lookAt) out.lookAt = lookAt;
  else if (Number.isFinite(facingDegRaw)) out.facingDeg = facingDegRaw;
  out.fovDeg = Number.isFinite(fovRaw) && fovRaw > 5 && fovRaw < 170 ? fovRaw : 50;
  if (label) out.label = label;
  return out;
}

/** 解析入参为受控 BlockingDiagram（丢弃非法项）。纯函数、可单测。 */
export function parseBlockingDiagram(raw: unknown): BlockingDiagram {
  const r =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const characters = (Array.isArray(r.characters) ? r.characters : [])
    .map(parseCharacter)
    .filter((c): c is BlockingCharacter => c !== null);
  const landmarks = (Array.isArray(r.landmarks) ? r.landmarks : [])
    .map(parseLandmark)
    .filter((l): l is BlockingLandmark => l !== null);
  const camera = parseCamera(r.camera);
  const durRaw = Number(r.durationSeconds);
  const durationSeconds = Number.isFinite(durRaw) && durRaw > 0 ? durRaw : undefined;
  const baseTitle = readText(r.title, 60) || "俯视站位图";
  const title = durationSeconds ? `${baseTitle}（本镜时长: ${durationSeconds}s）` : baseTitle;
  const wRaw = Number(r.width);
  const hRaw = Number(r.height);
  const width = Number.isFinite(wRaw) && wRaw >= 320 && wRaw <= 2048 ? Math.round(wRaw) : 800;
  const height = Number.isFinite(hRaw) && hRaw >= 240 && hRaw <= 2048 ? Math.round(hRaw) : 600;

  let axisLine: BlockingDiagram["axisLine"];
  const rawAxis =
    r.axisLine && typeof r.axisLine === "object" && !Array.isArray(r.axisLine)
      ? (r.axisLine as Record<string, unknown>)
      : null;
  const af = rawAxis ? readPoint(rawAxis.from) : null;
  const at = rawAxis ? readPoint(rawAxis.to) : null;
  if (af && at) axisLine = { from: af, to: at };
  else if (characters.length === 2) axisLine = { from: characters[0]!.at, to: characters[1]!.at };

  const bgUrlRaw = readText(r.backgroundImageUrl, 2048);
  if (r.backgroundImageUrl !== undefined && !/^https?:\/\//i.test(bgUrlRaw)) {
    throw new AppError("backgroundImageUrl 必须是可下载的 http(s) URL", {
      status: 400,
      code: "agents_tool_blocking_background_url_invalid",
      terminal: false,
    });
  }
  const backgroundImageUrl = bgUrlRaw;
  const parsedComposition =
    r.compositionContract === undefined
      ? null
      : parseKeyframeCompositionContract(r.compositionContract);
  if (parsedComposition && !parsedComposition.ok) {
    throw new AppError("关键帧构图合同无效", {
      status: 400,
      code: "agents_tool_blocking_composition_contract_invalid",
      details: { issues: parsedComposition.issues },
      terminal: false,
    });
  }
  if (parsedComposition?.ok) {
    const coverageIssues = validateCompositionSubjectCoverage({
      contract: parsedComposition.contract,
      characterNames: characters.map((character) => character.name),
    });
    if (coverageIssues.length > 0) {
      throw new AppError("关键帧构图合同未逐项覆盖站位角色", {
        status: 400,
        code: "agents_tool_blocking_composition_subject_coverage_invalid",
        details: { issues: coverageIssues },
        terminal: false,
      });
    }
  }
  return {
    title,
    ...(durationSeconds ? { durationSeconds } : {}),
    ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
    bg: readColor(r.bg, "#f6f4ef"),
    width,
    height,
    landmarks,
    characters,
    ...(camera ? { camera } : {}),
    ...(axisLine ? { axisLine } : {}),
    ...(parsedComposition?.ok
      ? {
          compositionContract: parsedComposition.contract,
          compositionContractHash: parsedComposition.hash,
        }
      : {}),
  };
}

// ——— canvas 绘制（非纯函数）———

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

const INK = "#2b2b2b";
const INK_SOFT = "#6b6b6b";

function drawArrow(
  ctx: Ctx,
  from: [number, number],
  to: [number, number],
  opts: { color: string; width: number; dashed?: boolean; headLen?: number },
) {
  const headLen = opts.headLen ?? opts.width * 5;
  ctx.save();
  ctx.lineWidth = opts.width;
  ctx.strokeStyle = opts.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (opts.dashed) ctx.setLineDash([opts.width * 3, opts.width * 2.5]);
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  const { left, right } = arrowHeadPoints(from, to, headLen);
  ctx.beginPath();
  ctx.moveTo(left[0], left[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.stroke();
  ctx.restore();
}

function drawWall(ctx: Ctx, l: Extract<BlockingLandmark, { kind: "wall" }>, w: number, h: number) {
  const a = normToPx(l.from, w, h);
  const b = normToPx(l.to, w, h);
  const lw = Math.max(3, Math.min(w, h) * 0.012);
  ctx.save();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.restore();
  if (l.label) {
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    fillText(ctx, l.label, mid, Math.max(11, Math.min(w, h) * 0.026), INK_SOFT, "center");
  }
}

function drawDoor(ctx: Ctx, l: Extract<BlockingLandmark, { kind: "door" }>, w: number, h: number) {
  const c = normToPx(l.at, w, h);
  const len = l.lengthN * (l.orient === "h" ? w : h);
  const lw = Math.max(3, Math.min(w, h) * 0.012);
  // 门洞两侧框柱(短粗) + 门板(细线，从一侧框柱按 swing 张开) + 摆动弧
  const half = len / 2;
  const jamb = Math.max(6, lw * 1.6);
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  const p0: [number, number] = l.orient === "h" ? [c[0] - half, c[1]] : [c[0], c[1] - half];
  const p1: [number, number] = l.orient === "h" ? [c[0] + half, c[1]] : [c[0], c[1] + half];
  // 框柱
  for (const p of [p0, p1]) {
    ctx.lineWidth = lw;
    ctx.beginPath();
    if (l.orient === "h") {
      ctx.moveTo(p[0], p[1] - jamb);
      ctx.lineTo(p[0], p[1] + jamb);
    } else {
      ctx.moveTo(p[0] - jamb, p[1]);
      ctx.lineTo(p[0] + jamb, p[1]);
    }
    ctx.stroke();
  }
  if (l.swing !== "none") {
    const dir = l.swing === "out" ? -1 : 1;
    // 门板：从 p0 出发，垂直于门洞方向张开 ~门洞长度
    const leafEnd: [number, number] =
      l.orient === "h" ? [p0[0], p0[1] + dir * len] : [p0[0] + dir * len, p0[1]];
    ctx.lineWidth = Math.max(2, lw * 0.6);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(leafEnd[0], leafEnd[1]);
    ctx.stroke();
    // 摆动弧
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = Math.max(1.5, lw * 0.4);
    ctx.beginPath();
    const a0 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const a1 = Math.atan2(leafEnd[1] - p0[1], leafEnd[0] - p0[0]);
    ctx.arc(p0[0], p0[1], len, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  if (l.label) {
    const off = jamb + Math.max(13, Math.min(w, h) * 0.03);
    const lp: [number, number] = l.orient === "h" ? [c[0], c[1] - off] : [c[0] + off, c[1]];
    fillText(ctx, l.label, lp, Math.max(12, Math.min(w, h) * 0.028), INK, "center");
  }
}

function fillText(
  ctx: Ctx,
  text: string,
  at: [number, number],
  fontPx: number,
  color: string,
  align: "left" | "center" | "right",
  opts?: { bold?: boolean; halo?: boolean },
) {
  ctx.save();
  ctx.font = `${opts?.bold ? "bold " : ""}${Math.round(fontPx)}px ${fontFamily()}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (opts?.halo) {
    ctx.lineWidth = Math.max(2, fontPx * 0.22);
    ctx.strokeStyle = "rgba(246,244,239,0.95)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, at[0], at[1]);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, at[0], at[1]);
  ctx.restore();
}

function drawCharacter(
  ctx: Ctx,
  ch: BlockingCharacter,
  w: number,
  h: number,
  composition?: KeyframeCompositionSubject,
) {
  const c = normToPx(ch.at, w, h);
  const R = Math.max(8, Math.min(w, h) * 0.026);
  const color = ch.color ?? "#1f6feb";
  // 朝向终点
  let facePt: [number, number] | null = null;
  if (ch.facingTo) facePt = normToPx(ch.facingTo, w, h);
  else if (typeof ch.facingDeg === "number") {
    const u = degToUnit(ch.facingDeg);
    facePt = [c[0] + u[0] * R * 3, c[1] + u[1] * R * 3];
  }
  // 走位（虚线，先画在底层）
  if (ch.moveTo) {
    const m = normToPx(ch.moveTo, w, h);
    drawArrow(ctx, c, m, { color: INK_SOFT, width: Math.max(2, R * 0.18), dashed: true });
  }
  // 站位标记：填充圆点 + 深色描边
  ctx.save();
  ctx.beginPath();
  ctx.arc(c[0], c[1], R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, R * 0.16);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  if (composition) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c[0], c[1], R * 1.35, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(
      2,
      R * (composition.visualWeight === "primary" ? 0.28 : composition.visualWeight === "secondary" ? 0.18 : 0.12),
    );
    ctx.strokeStyle =
      composition.visualWeight === "primary"
        ? "#14804a"
        : composition.visualWeight === "secondary"
          ? "#9a6700"
          : "#6b6b6b";
    if (composition.visualWeight === "context") ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  }
  // 朝向箭头（实线，短）
  if (facePt) {
    const dx = facePt[0] - c[0];
    const dy = facePt[1] - c[1];
    const d = Math.hypot(dx, dy) || 1;
    const start: [number, number] = [c[0] + (dx / d) * R, c[1] + (dy / d) * R];
    const end: [number, number] = [c[0] + (dx / d) * R * 2.6, c[1] + (dy / d) * R * 2.6];
    drawArrow(ctx, start, end, { color: INK, width: Math.max(2.5, R * 0.22), headLen: R * 1.1 });
  }
  // 名字标签（带 halo，放在标记下方）
  const placementLabel = composition
    ? `${ch.name} · ${composition.visualWeight}/${composition.depthLayer} · center:${composition.centerPlacement} · ≤${Math.round(composition.maxFrameHeightRatio * 100)}%H`
    : ch.name;
  fillText(ctx, placementLabel, [c[0], c[1] + R + Math.max(12, R * 0.95)], Math.max(11, R * 0.82), INK, "center", {
    bold: true,
    halo: true,
  });
}

function drawCompositionOverlay(
  ctx: Ctx,
  contract: KeyframeCompositionContract,
  w: number,
  h: number,
) {
  const focal = normToPx(contract.focalPoint, w, h);
  const radius = Math.max(9, Math.min(w, h) * 0.022);
  ctx.save();
  ctx.strokeStyle = "#14804a";
  ctx.lineWidth = Math.max(2, radius * 0.18);
  ctx.beginPath();
  ctx.arc(focal[0], focal[1], radius, 0, Math.PI * 2);
  ctx.moveTo(focal[0] - radius * 1.5, focal[1]);
  ctx.lineTo(focal[0] + radius * 1.5, focal[1]);
  ctx.moveTo(focal[0], focal[1] - radius * 1.5);
  ctx.lineTo(focal[0], focal[1] + radius * 1.5);
  ctx.stroke();
  ctx.restore();
  const facts = renderKeyframeCompositionFacts(contract);
  fillText(
    ctx,
    facts.slice(0, 190),
    [w / 2, h - Math.max(18, Math.min(w, h) * 0.035)],
    Math.max(10, Math.min(w, h) * 0.018),
    INK,
    "center",
    { halo: true },
  );
}

function drawCamera(ctx: Ctx, cam: BlockingCamera, w: number, h: number) {
  const c = normToPx(cam.at, w, h);
  let dir: [number, number] = [0, -1];
  if (cam.lookAt) {
    const t = normToPx(cam.lookAt, w, h);
    const dx = t[0] - c[0];
    const dy = t[1] - c[1];
    const d = Math.hypot(dx, dy) || 1;
    dir = [dx / d, dy / d];
  } else if (typeof cam.facingDeg === "number") {
    dir = degToUnit(cam.facingDeg);
  }
  const baseAng = Math.atan2(dir[1], dir[0]);
  const fov = ((cam.fovDeg ?? 50) * Math.PI) / 180;
  const reach = Math.min(w, h) * 0.22;
  const R = Math.max(7, Math.min(w, h) * 0.02);
  // 视锥（半透明扇形 + 虚线边）
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c[0], c[1]);
  ctx.arc(c[0], c[1], reach, baseAng - fov / 2, baseAng + fov / 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(43,43,43,0.08)";
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(1.5, R * 0.18);
  ctx.stroke();
  ctx.setLineDash([]);
  // 机位三角图标
  const left: [number, number] = [c[0] + Math.cos(baseAng + Math.PI * 0.6) * R, c[1] + Math.sin(baseAng + Math.PI * 0.6) * R];
  const right: [number, number] = [c[0] + Math.cos(baseAng - Math.PI * 0.6) * R, c[1] + Math.sin(baseAng - Math.PI * 0.6) * R];
  const tip: [number, number] = [c[0] + dir[0] * R * 1.3, c[1] + dir[1] * R * 1.3];
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(left[0], left[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.closePath();
  ctx.fillStyle = "#c0392b";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, R * 0.16);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  fillText(ctx, cam.label || "机位", [c[0], c[1] + R + Math.max(11, R * 1.0)], Math.max(11, R * 0.95), "#c0392b", "center", {
    halo: true,
  });
}

/** 渲染俯视站位图为 PNG buffer。需要 @napi-rs/canvas，不是纯函数。
 * bgImage（可选）=已加载的户型底图：cover 铺满后盖一层半透明纸色（压暗底图保符号可读），符号层叠其上。 */
export function renderBlockingDiagram(plan: BlockingDiagram, bgImage?: Image): Buffer {
  const { width: w, height: h } = plan;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  // 纸感背景 + 外框
  ctx.fillStyle = plan.bg;
  ctx.fillRect(0, 0, w, h);
  if (bgImage) {
    // cover 铺满（保持宽高比裁边），再压一层半透明纸色让符号/文字可读。
    const iw = bgImage.width || 1;
    const ih = bgImage.height || 1;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.fillStyle = "rgba(246,244,239,0.55)";
    ctx.fillRect(0, 0, w, h);
  }
  const pad = Math.min(w, h) * 0.04;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  // 标题
  fillText(ctx, plan.title, [w / 2, pad * 1.7], Math.max(14, Math.min(w, h) * 0.034), INK, "center", {
    bold: true,
  });
  // 轴线（最底层，虚线灰）
  if (plan.axisLine) {
    const a = normToPx(plan.axisLine.from, w, h);
    const b = normToPx(plan.axisLine.to, w, h);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(192,57,43,0.5)";
    ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.004);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  }
  // 地标
  for (const l of plan.landmarks) {
    if (l.kind === "wall") drawWall(ctx, l, w, h);
    else if (l.kind === "door") drawDoor(ctx, l, w, h);
    else if (l.kind === "area") fillText(ctx, l.label, normToPx(l.at, w, h), Math.max(12, Math.min(w, h) * 0.03), INK_SOFT, "center");
  }
  // 机位
  if (plan.camera) drawCamera(ctx, plan.camera, w, h);
  if (plan.compositionContract) drawCompositionOverlay(ctx, plan.compositionContract, w, h);
  // 角色（最上层）
  const compositionByName = new Map(
    plan.compositionContract?.subjects.map((subject) => [subject.name, subject] as const) ?? [],
  );
  for (const ch of plan.characters) drawCharacter(ctx, ch, w, h, compositionByName.get(ch.name));
  return canvas.toBuffer("image/png");
}

export type BlockingDiagramResult = {
  ok: true;
  imageUrl: string;
  key: string;
  characterCount: number;
  bytes: number;
  compositionContract: KeyframeCompositionContract;
  compositionContractHash: string;
};

/**
 * 渲染俯视站位图 → 上传 TOS → 返回新图 URL（与 annotate_shot / video_concat 一致：只产 URL，不直接写节点，
 * 调用方再 flow_patch 写画布 image 节点，建议 data.productionLayer="blocking_diagram"）。
 */
export async function renderBlockingDiagramToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  bodyArgs: unknown;
}): Promise<BlockingDiagramResult> {
  const plan = parseBlockingDiagram(input.bodyArgs);
  if (plan.characters.length === 0) {
    throw new AppError("characters 至少需要 1 个合法角色（含 name + at[x,y]）", {
      status: 400,
      code: "agents_tool_blocking_missing_characters",
    });
  }
  if (!plan.compositionContract || !plan.compositionContractHash) {
    throw new AppError("俯视站位图必须携带完整关键帧构图合同", {
      status: 400,
      code: "agents_tool_blocking_composition_contract_required",
      terminal: false,
    });
  }

  const storageConfig = resolveObjectStorageConfig(input.c.env);
  if (!storageConfig) {
    throw new AppError("对象存储未配置", { status: 500, code: "object_storage_unconfigured" });
  }

  // 显式底图属于场景几何事实。获取失败时必须在绘制前终止，不能退回抽象纸底。
  let bgImage: Image | undefined;
  if (plan.backgroundImageUrl) {
    try {
      const resp = await fetch(plan.backgroundImageUrl, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const contentType = resp.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!contentType.startsWith("image/")) {
        throw new Error(`Content-Type ${contentType || "missing"}`);
      }
      bgImage = await loadImage(Buffer.from(await resp.arrayBuffer()));
    } catch (error) {
      throw new AppError("俯视站位图的场景底图不可用，禁止退回抽象纸底", {
        status: 409,
        code: "agents_tool_blocking_background_unavailable",
        details: {
          backgroundImageUrl: plan.backgroundImageUrl,
          reason: error instanceof Error ? error.message : String(error),
        },
        terminal: false,
      });
    }
  }
  try {
    const out = renderBlockingDiagram(plan, bgImage);
    const client = createObjectStorageClientFromConfig(storageConfig);
    const safeUser = input.requestUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const key = `gen/images/${safeUser}/${datePrefix}/${plan.compositionContractHash}-${randomUUID()}.png`;
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
      characterCount: plan.characters.length,
      bytes: out.byteLength,
      compositionContract: plan.compositionContract,
      compositionContractHash: plan.compositionContractHash,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("俯视站位图渲染失败", {
      status: 502,
      code: "agents_tool_blocking_failed",
      details: { message: err instanceof Error ? err.message : String(err) },
    });
  }
}
