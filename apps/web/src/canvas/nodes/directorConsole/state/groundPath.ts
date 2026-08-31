import type { Vec2 } from '../types'

export type GroundPath = {
  waypoints: Vec2[]
  mode: 'linear' | 'curve'  // 折线 / Catmull-Rom 平滑曲线
  closed?: boolean
}
export type PathSample = { pos: Vec2; tangent: Vec2 } // tangent 已归一

const CURVE_SUBDIV = 16 // 每曲线段细分步数

/** 把 path 展开成稠密折线点（linear 直接用路点；curve 经 Catmull-Rom 细分）。 */
function densePolyline(path: GroundPath): Vec2[] {
  const pts = path.closed && path.waypoints.length > 1
    ? [...path.waypoints, path.waypoints[0]]
    : path.waypoints
  if (pts.length <= 2 || path.mode === 'linear') return pts.map((p) => [p[0], p[1]] as Vec2)
  // Catmull-Rom：每相邻段用 4 控制点（端点夹紧复制）插值
  const out: Vec2[] = []
  const get = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    const steps = CURVE_SUBDIV
    for (let s = 0; s < steps; s++) {
      const u = s / steps
      out.push(catmullRom(p0, p1, p2, p3, u))
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]])
  return out
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  const u2 = u * u, u3 = u2 * u
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3)
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]
}

/** 累积弧长表（与稠密折线点一一对应）。 */
function arcTable(poly: Vec2[]): number[] {
  const acc = [0]
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i][0] - poly[i - 1][0], dz = poly[i][1] - poly[i - 1][1]
    acc.push(acc[i - 1] + Math.hypot(dx, dz))
  }
  return acc
}

export function pathLength(path: GroundPath): number {
  const poly = densePolyline(path)
  if (poly.length < 2) return 0
  const acc = arcTable(poly)
  return acc[acc.length - 1]
}

/** s∈[0,1] 弧长归一化 → 位置 + 归一切线。匀速行进（按弧长非按段）。 */
export function samplePathAt(path: GroundPath, s: number): PathSample {
  const poly = densePolyline(path)
  if (poly.length === 0) return { pos: [0, 0], tangent: [0, 1] }
  if (poly.length === 1) return { pos: [poly[0][0], poly[0][1]], tangent: [0, 1] }
  const acc = arcTable(poly)
  const total = acc[acc.length - 1]
  if (total <= 1e-9) return { pos: [poly[0][0], poly[0][1]], tangent: [0, 1] }
  const target = Math.max(0, Math.min(1, s)) * total
  // 二分定位区段
  let lo = 0, hi = acc.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (acc[mid] < target) lo = mid + 1
    else hi = mid
  }
  const i = Math.max(1, lo)
  const segLen = acc[i] - acc[i - 1]
  const k = segLen > 1e-9 ? (target - acc[i - 1]) / segLen : 0
  const a = poly[i - 1], b = poly[i]
  const pos: Vec2 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  const tx = b[0] - a[0], tz = b[1] - a[1]
  const tl = Math.hypot(tx, tz)
  const tangent: Vec2 = tl > 1e-9 ? [tx / tl, tz / tl] : [0, 1]
  return { pos, tangent }
}
