import React from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, useReactFlow } from 'reactflow'
import { useRFStore } from '../store'

function colorFor(t?: string) {
  switch (t) {
    case 'image': return 'rgba(59,130,246,.7)'
    case 'audio': return 'rgba(16,185,129,.7)'
    case 'subtitle': return 'rgba(234,179,8,.7)'
    case 'video': return 'rgba(139,92,246,.7)'
    default: return 'rgba(156,163,175,.7)'
  }
}

function inferType(sourceHandle?: string | null, targetHandle?: string | null) {
  if (sourceHandle && sourceHandle.startsWith('out-')) return sourceHandle.slice(4)
  if (targetHandle && targetHandle.startsWith('in-')) return targetHandle.slice(3)
  return 'any'
}

function orthPathAvoid(sx: number, sy: number, tx: number, ty: number, obstacles: { x: number; y: number; w: number; h: number; id: string }[]) {
  const dir = sx < tx ? 1 : -1
  const steps = [0, 1, -1, 2, -2, 3, -3]
  const blockedVertical = (mx: number, y1: number, y2: number) => {
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    for (const ob of obstacles) {
      if (mx >= ob.x && mx <= ob.x + ob.w) {
        const oy1 = ob.y, oy2 = ob.y + ob.h
        if (!(bottom < oy1 || top > oy2)) return true
      }
    }
    return false
  }
  const centerX = Math.round((sx + tx) / 2)
  // Single-bend try
  for (const s of steps) {
    const mx = centerX + s * 40 * dir
    if (!blockedVertical(mx, sy, ty)) {
      const d1 = `M ${sx},${sy} L ${mx},${sy} L ${mx},${ty} L ${tx},${ty}`
      return [d1, mx, Math.round((sy + ty) / 2)] as const
    }
  }
  // Multi-bend: find two clear verticals near source/target
  let mx1: number | null = null
  let mx2: number | null = null
  for (const s of steps) { const cand = sx + s * 60 * dir; if (!blockedVertical(cand, sy, ty)) { mx1 = cand; break } }
  for (const s of steps) { const cand = tx + s * -60 * dir; if (!blockedVertical(cand, sy, ty)) { mx2 = cand; break } }
  if (mx1 !== null && mx2 !== null) {
    const midY = Math.round((sy + ty) / 2)
    const d2 = `M ${sx},${sy} L ${mx1},${sy} L ${mx1},${midY} L ${mx2},${midY} L ${mx2},${ty} L ${tx},${ty}`
    return [d2, Math.round((mx1 + mx2) / 2), midY] as const
  }
  // Fallback straight orth
  const d = `M ${sx},${sy} L ${centerX},${sy} L ${centerX},${ty} L ${tx},${ty}`
  return [d, centerX, Math.round((sy + ty) / 2)] as const
}

export default function OrthTypedEdge(props: EdgeProps<any>) {
  const t = (props.data && (props.data as any).edgeType) || inferType(props.sourceHandle, props.targetHandle)
  const stroke = colorFor(t)
  const nodes = useRFStore(s => s.nodes)
  const defaultW = 180, defaultH = 96
  const obstacles = nodes.map((n: any) => ({ x: n.positionAbsolute?.x ?? n.position.x, y: n.positionAbsolute?.y ?? n.position.y, w: n.width || defaultW, h: n.height || defaultH, id: n.id }))
  // Adjust Y near source/target to avoid horizontal overlap with obstacles (except endpoints)
  const ignore = new Set([props.source, props.target])
  const intersectsH = (y: number, x1: number, x2: number) => {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
    for (const ob of obstacles) {
      if (ignore.has(ob.id)) continue
      const oy1 = ob.y, oy2 = ob.y + ob.h
      const ox1 = ob.x, ox2 = ob.x + ob.w
      if (y >= oy1 && y <= oy2) {
        if (!(maxX < ox1 || minX > ox2)) return true
      }
    }
    return false
  }
  let sy = props.sourceY, ty = props.targetY
  const steps = [0, 1, -1, 2, -2, 3, -3]
  for (const k of steps) { const y = props.sourceY + k * 30; if (!intersectsH(y, props.sourceX, (props.sourceX + props.targetX)/2)) { sy = y; break } }
  for (const k of steps) { const y = props.targetY + k * 30; if (!intersectsH(y, props.targetX, (props.sourceX + props.targetX)/2)) { ty = y; break } }
  const [edgePath, labelX, labelY] = orthPathAvoid(props.sourceX, sy, props.targetX, ty, obstacles)

  // 不显示 "any" 类型的标签
  if (t === 'any') {
    return (
      <BaseEdge id={props.id} path={edgePath} style={{ stroke, strokeWidth: 3, opacity: 0.95 }} />
    )
  }

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} style={{ stroke, strokeWidth: 3, opacity: 0.95 }} />
      <EdgeLabelRenderer>
        <div style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          pointerEvents: 'none',
          fontSize: 10,
          color: stroke,
          background: 'rgba(15,16,20,.8)',
          WebkitBackdropFilter: 'blur(2px)',
          backdropFilter: 'blur(2px)',
          padding: '2px 6px',
          borderRadius: 999,
          border: `1px solid ${stroke}`,
        }}>
          {t}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
