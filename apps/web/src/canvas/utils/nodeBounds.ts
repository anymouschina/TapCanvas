import type { Node } from '@xyflow/react'
import { getTaskNodeCoreType } from '../nodes/taskNodeSchema'

export type XY = { x: number; y: number }
export type NodeSize = { w: number; h: number }
export type NodeRect = { x: number; y: number; w: number; h: number }

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function fallbackSizeForNode(node: Node): NodeSize {
  const type = String((node as any)?.type || '')
  const kind = String((node as Record<string, unknown> & { data?: Record<string, unknown> })?.data?.kind || '')
  if (type === 'taskNode') {
    const coreType = getTaskNodeCoreType(kind)
    if (coreType === 'text') return { w: 380, h: 360 }
    if (kind === 'imageEdit') return { w: 320, h: 220 }
    if (coreType === 'storyboard') return { w: 560, h: 470 }
    return { w: 420, h: 240 }
  }
  if (type === 'groupNode') return { w: 240, h: 160 }
  if (type === 'ioNode') return { w: 104, h: 36 }
  return { w: 220, h: 120 }
}

export function getNodeSize(node: Node, fallback?: NodeSize): NodeSize {
  const anyNode = node as any
  const data = (anyNode?.data || {}) as any

  const measuredW =
    typeof anyNode?.measured?.width === 'number' && Number.isFinite(anyNode.measured.width)
      ? anyNode.measured.width
      : undefined
  const measuredH =
    typeof anyNode?.measured?.height === 'number' && Number.isFinite(anyNode.measured.height)
      ? anyNode.measured.height
      : undefined

  const widthProp = typeof anyNode?.width === 'number' && Number.isFinite(anyNode.width) ? anyNode.width : undefined
  const heightProp = typeof anyNode?.height === 'number' && Number.isFinite(anyNode.height) ? anyNode.height : undefined

  const dataW = typeof data?.nodeWidth === 'number' && Number.isFinite(data.nodeWidth) ? data.nodeWidth : undefined
  const dataH = typeof data?.nodeHeight === 'number' && Number.isFinite(data.nodeHeight) ? data.nodeHeight : undefined

  const styleW = parseNumeric(anyNode?.style?.width)
  const styleH = parseNumeric(anyNode?.style?.height)

  const resolvedFallback = fallback ?? fallbackSizeForNode(node)
  const w = measuredW ?? widthProp ?? dataW ?? styleW ?? resolvedFallback.w
  const h = measuredH ?? heightProp ?? dataH ?? styleH ?? resolvedFallback.h
  return { w, h }
}

export function getNodeAbsPosition(node: Node, nodesById: Map<string, Node>): XY {
  const visiting = new Set<string>()

  const resolve = (cur: Node): XY => {
    const id = typeof cur?.id === 'string' ? cur.id : ''
    if (id) {
      if (visiting.has(id)) return { x: (cur as any)?.position?.x || 0, y: (cur as any)?.position?.y || 0 }
      visiting.add(id)
    }

    const base = { x: (cur as any)?.position?.x || 0, y: (cur as any)?.position?.y || 0 }
    const parentId =
      typeof (cur as any)?.parentId === 'string'
        ? ((cur as any).parentId as string)
        : typeof (cur as any)?.parentNode === 'string'
          ? ((cur as any).parentNode as string)
          : null
    if (!parentId) return base
    const parent = nodesById.get(parentId)
    if (!parent) return base
    const p = resolve(parent)
    return { x: p.x + base.x, y: p.y + base.y }
  }

  return resolve(node)
}

export function getNodeAbsRect(node: Node, nodesById: Map<string, Node>, fallback?: NodeSize): NodeRect {
  const pos = getNodeAbsPosition(node, nodesById)
  const size = getNodeSize(node, fallback)
  return { x: pos.x, y: pos.y, w: size.w, h: size.h }
}
