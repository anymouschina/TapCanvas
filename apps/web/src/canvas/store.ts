import { create } from 'zustand'
import type { Edge, Node, OnConnect, OnEdgesChange, OnNodesChange, Connection } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { runNodeMock } from '../runner/mockRunner'
import { runNodeRemote } from '../runner/remoteRunner'
import { runFlowDag } from '../runner/dag'
import { getTaskNodeSchema } from './nodes/taskNodeSchema'
import { CANVAS_CONFIG } from './utils/constants'

type GroupRec = { id: string; name: string; nodeIds: string[] }

type RFState = {
  nodes: Node[]
  edges: Edge[]
  nextId: number
  groups: GroupRec[]
  nextGroupId: number
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (type: string, label?: string, extra?: Record<string, any>) => void
  reset: () => void
  load: (data: { nodes: Node[]; edges: Edge[] } | null) => void
  removeSelected: () => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeData: (id: string, patch: Record<string, any>) => void
  copySelected: () => void
  pasteFromClipboard: () => void
  clipboard: { nodes: Node[]; edges: Edge[] } | null
  // history
  historyPast: { nodes: Node[]; edges: Edge[] }[]
  historyFuture: { nodes: Node[]; edges: Edge[] }[]
  undo: () => void
  redo: () => void
  // mock run
  runSelected: () => Promise<void>
  runDag: (concurrency: number) => Promise<void>
  setNodeStatus: (id: string, status: 'idle'|'queued'|'running'|'success'|'error', patch?: Partial<any>) => void
  appendLog: (id: string, line: string) => void
  beginRunToken: (id: string) => void
  endRunToken: (id: string) => void
  cancelNode: (id: string) => void
  isCanceled: (id: string) => boolean
  deleteNode: (id: string) => void
  deleteEdge: (id: string) => void
  duplicateNode: (id: string) => void
  pasteFromClipboardAt: (pos: { x: number; y: number }) => void
  importWorkflow: (workflowData: { nodes: Node[], edges: Edge[] }, position?: { x: number; y: number }) => void
  selectAll: () => void
  clearSelection: () => void
  invertSelection: () => void
  // groups
  addGroupForSelection: (name?: string) => void
  removeGroupById: (id: string) => void
  findGroupMatchingSelection: () => GroupRec | null
  renameGroup: (id: string, name: string) => void
  ungroupGroupNode: (id: string) => void
  runSelectedGroup: () => Promise<void>
  renameSelectedGroup: () => void
  formatTree: () => void
  autoLayoutAllDagVertical: () => void
  autoLayoutForParent: (parentId: string|null) => void
}

// 生成节点唯一 ID，优先使用浏览器原生 UUID
function genNodeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID() as string
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function genGroupId(n: number) {
  return `g${n}`
}

function cloneGraph(nodes: Node[], edges: Edge[]) {
  return JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: Node[]; edges: Edge[] }
}

type TreeLayoutPoint = { x: number; y: number }
type TreeLayoutSize = { w: number; h: number }

// 允许图像类节点可选中（用于展示提示词/模型等面板与交互）。
// 若未来有确实需要禁用选择的 taskNode kind，可再加入该集合。
const UNSELECTABLE_TASK_NODE_KINDS = new Set<string>()

function parseNumericStyle(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function getNodeSizeForLayout(node: Node): TreeLayoutSize {
  const anyNode = node as any
  const measuredW =
    typeof anyNode?.measured?.width === 'number' && Number.isFinite(anyNode.measured.width) && anyNode.measured.width > 0
      ? anyNode.measured.width
      : typeof anyNode?.width === 'number' && Number.isFinite(anyNode.width) && anyNode.width > 0
        ? anyNode.width
        : undefined
  const measuredH =
    typeof anyNode?.measured?.height === 'number' && Number.isFinite(anyNode.measured.height) && anyNode.measured.height > 0
      ? anyNode.measured.height
      : typeof anyNode?.height === 'number' && Number.isFinite(anyNode.height) && anyNode.height > 0
        ? anyNode.height
        : undefined
  const styleW = parseNumericStyle(anyNode?.style?.width)
  const styleH = parseNumericStyle(anyNode?.style?.height)
  const dataW = parseNumericStyle(anyNode?.data?.nodeWidth)
  const dataH = parseNumericStyle(anyNode?.data?.nodeHeight)
  const fallbackW = 220
  const fallbackH = 120
  return {
    w: measuredW ?? styleW ?? dataW ?? fallbackW,
    h: measuredH ?? styleH ?? dataH ?? fallbackH
  }
}

const GROUP_PADDING = 8
const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90

function getNodeParentId(node: Node): string | undefined {
  const anyNode = node as any
  const parentId = anyNode?.parentId
  if (typeof parentId === 'string' && parentId) return parentId
  const legacyParentNode = anyNode?.parentNode
  if (typeof legacyParentNode === 'string' && legacyParentNode) return legacyParentNode
  return undefined
}

// React Flow v12 uses `parentId` (v11 used `parentNode`). Normalize legacy data for compatibility.
export function normalizeNodesParentId(nodes: Node[]): Node[] {
  let changed = false
  const normalized = nodes.map((n: any) => {
    if (!n || typeof n !== 'object') return n

    const parentId = typeof n.parentId === 'string' ? n.parentId : undefined
    const legacyParentNode = typeof n.parentNode === 'string' ? n.parentNode : undefined

    if (parentId) {
      if ('parentNode' in n) {
        const { parentNode: _parentNode, ...rest } = n
        changed = true
        return rest
      }
      return n
    }

    if (legacyParentNode) {
      const { parentNode: _parentNode, ...rest } = n
      changed = true
      return { ...rest, parentId: legacyParentNode }
    }

    if ('parentNode' in n) {
      const { parentNode: _parentNode, ...rest } = n
      changed = true
      return rest
    }

    return n
  })

  return changed ? (normalized as Node[]) : nodes
}

function autoFitGroupNodes(nodes: Node[]): Node[] {
  const groupNodes = nodes.filter(n => n.type === 'groupNode')
  if (!groupNodes.length) return nodes

  const byId = new Map(nodes.map(n => [n.id, n] as const))
  const updates = new Map<string, Node>()
  let changed = false

  const updateNode = (id: string, patch: Partial<Node>) => {
    const base = updates.get(id) || byId.get(id)
    if (!base) return
    updates.set(id, { ...base, ...patch })
    changed = true
  }

  for (const group of groupNodes) {
    const children = nodes.filter(n => getNodeParentId(n) === group.id)
    if (!children.length) continue

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const child of children) {
      const { w, h } = getNodeSizeForLayout(child)
      const cx = child.position?.x ?? 0
      const cy = child.position?.y ?? 0
      minX = Math.min(minX, cx)
      minY = Math.min(minY, cy)
      maxX = Math.max(maxX, cx + w)
      maxY = Math.max(maxY, cy + h)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue

    const manualW = parseNumericStyle((group as any)?.data?.manualWidth)
    const manualH = parseNumericStyle((group as any)?.data?.manualHeight)
    const desiredPos = {
      x: (group.position?.x ?? 0) + ((Number.isFinite(manualW) && manualW! > 0) ? Math.min(0, minX - GROUP_PADDING) : (minX - GROUP_PADDING)),
      y: (group.position?.y ?? 0) + ((Number.isFinite(manualH) && manualH! > 0) ? Math.min(0, minY - GROUP_PADDING) : (minY - GROUP_PADDING)),
    }
    const minW = Math.max(GROUP_MIN_WIDTH, Number.isFinite(manualW) && manualW! > 0 ? manualW! : 0)
    const minH = Math.max(GROUP_MIN_HEIGHT, Number.isFinite(manualH) && manualH! > 0 ? manualH! : 0)
    const desiredSize = {
      w: Math.max(minW, (maxX - minX) + GROUP_PADDING * 2),
      h: Math.max(minH, (maxY - minY) + GROUP_PADDING * 2),
    }

    const currentW =
      typeof (group as any)?.width === 'number'
        ? (group as any).width
        : parseNumericStyle((group as any)?.style?.width) ?? desiredSize.w
    const currentH =
      typeof (group as any)?.height === 'number'
        ? (group as any).height
        : parseNumericStyle((group as any)?.style?.height) ?? desiredSize.h

    const dx = desiredPos.x - (group.position?.x ?? 0)
    const dy = desiredPos.y - (group.position?.y ?? 0)
    const posChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1
    const sizeChanged = Math.abs(desiredSize.w - currentW) > 0.1 || Math.abs(desiredSize.h - currentH) > 0.1

    if (!posChanged && !sizeChanged) continue

    updateNode(group.id, {
      position: { x: desiredPos.x, y: desiredPos.y },
      style: {
        ...(group.style || {}),
        width: desiredSize.w,
        height: desiredSize.h,
        zIndex: -10,
      },
    })

    if (posChanged) {
      for (const child of children) {
        updateNode(child.id, {
          position: {
            x: (child.position?.x ?? 0) - dx,
            y: (child.position?.y ?? 0) - dy,
          },
        })
      }
    }
  }

  if (!changed) return nodes
  return nodes.map(n => updates.get(n.id) || n)
}

function getNodeAbsPosition(node: Node, nodeById: Map<string, Node>): { x: number; y: number } {
  const visiting = new Set<string>()
  let x = node.position?.x ?? 0
  let y = node.position?.y ?? 0
  let parentId = getNodeParentId(node)
  while (parentId) {
    if (visiting.has(parentId)) break
    visiting.add(parentId)
    const parent = nodeById.get(parentId)
    if (!parent) break
    x += parent.position?.x ?? 0
    y += parent.position?.y ?? 0
    parentId = getNodeParentId(parent)
  }
  return { x, y }
}

function getAncestorChain(node: Node, nodeById: Map<string, Node>): string[] {
  const out: string[] = []
  const visiting = new Set<string>()
  let parentId = getNodeParentId(node)
  while (parentId) {
    if (visiting.has(parentId)) break
    visiting.add(parentId)
    out.push(parentId)
    const parent = nodeById.get(parentId)
    parentId = parent ? getNodeParentId(parent) : undefined
  }
  return out
}

type AbsRect = { id: string; x: number; y: number; w: number; h: number; area: number }

function computeGroupAbsRects(nodes: Node[], nodeById: Map<string, Node>): AbsRect[] {
  const out: AbsRect[] = []
  for (const n of nodes) {
    if (n.type !== 'groupNode') continue
    const abs = getNodeAbsPosition(n, nodeById)
    const { w, h } = getNodeSizeForLayout(n)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue
    out.push({ id: n.id, x: abs.x, y: abs.y, w, h, area: w * h })
  }
  return out
}

function pickBestGroupIdForPoint(point: { x: number; y: number }, groupRects: AbsRect[]): string | null {
  let bestId: string | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const g of groupRects) {
    const inside =
      point.x >= g.x &&
      point.x <= g.x + g.w &&
      point.y >= g.y &&
      point.y <= g.y + g.h
    if (!inside) continue
    if (bestId === null || g.area < bestArea || (g.area === bestArea && g.id < bestId)) {
      bestId = g.id
      bestArea = g.area
    }
  }
  return bestId
}

function applyDragDropGrouping(nodes: Node[], dragEndNodeIds: Set<string>): Node[] {
  if (!dragEndNodeIds.size) return nodes

  const nodeById = new Map(nodes.map(n => [n.id, n] as const))
  const groupRects = computeGroupAbsRects(nodes, nodeById)
  if (!groupRects.length) return nodes

  const updates = new Map<string, Partial<Node>>()

  for (const id of dragEndNodeIds) {
    const node = nodeById.get(id)
    if (!node) continue
    if (node.type === 'groupNode' || node.type === 'ioNode') continue

    const abs = getNodeAbsPosition(node, nodeById)
    const { w, h } = getNodeSizeForLayout(node)
    const center = { x: abs.x + w / 2, y: abs.y + h / 2 }

    const bestGroupId = pickBestGroupIdForPoint(center, groupRects)
    const currentParentId = getNodeParentId(node)
    const nextParentId = bestGroupId || undefined
    if ((currentParentId || undefined) === (nextParentId || undefined)) continue

    if (!nextParentId) {
      updates.set(id, { parentId: undefined, extent: undefined, position: { x: abs.x, y: abs.y } })
      continue
    }

    const group = nodeById.get(nextParentId)
    if (!group) continue
    const gAbs = getNodeAbsPosition(group, nodeById)
    const rel = { x: abs.x - gAbs.x, y: abs.y - gAbs.y }
    updates.set(id, { parentId: nextParentId, extent: undefined, position: rel })
  }

  if (!updates.size) return nodes
  return nodes.map(n => {
    const patch = updates.get(n.id)
    return patch ? { ...n, ...patch } : n
  })
}

function computeTreeLayout(
  nodesInScope: Node[],
  edgesInScope: Edge[],
  gapX: number,
  gapY: number
): { positions: Map<string, TreeLayoutPoint>; sizes: Map<string, TreeLayoutSize> } {
  const idSet = new Set(nodesInScope.map(n => n.id))
  const nodeById = new Map(nodesInScope.map(n => [n.id, n] as const))
  const positions = new Map<string, TreeLayoutPoint>()
  const sizes = new Map<string, TreeLayoutSize>()

  const incoming = new Map<string, string[]>()
  nodesInScope.forEach(n => incoming.set(n.id, []))
  edgesInScope.forEach(e => {
    if (!idSet.has(e.source) || !idSet.has(e.target)) return
    if (e.source === e.target) return
    incoming.get(e.target)!.push(e.source)
  })

  // Spanning tree: each node has at most one parent (first incoming edge wins)
  const parentOf = new Map<string, string>()
  nodesInScope.forEach(n => {
    const ins = incoming.get(n.id) || []
    if (ins.length) parentOf.set(n.id, ins[0])
  })

  const childrenOf = new Map<string, string[]>()
  nodesInScope.forEach(n => childrenOf.set(n.id, []))
  parentOf.forEach((p, child) => {
    if (!childrenOf.has(p)) return
    childrenOf.get(p)!.push(child)
  })

  const roots = nodesInScope
    .filter(n => !parentOf.has(n.id))
    .sort((a, b) => a.position.x - b.position.x)
    .map(n => n.id)
  if (!roots.length && nodesInScope.length) roots.push(nodesInScope[nodesInScope.length - 1].id)

  const depthOf = new Map<string, number>()
  const seen = new Set<string>()
  const queue = roots.map(r => ({ id: r, depth: 0 }))
  while (queue.length) {
    const cur = queue.shift()!
    if (seen.has(cur.id)) continue
    seen.add(cur.id)
    depthOf.set(cur.id, cur.depth)
    const kids = (childrenOf.get(cur.id) || []).slice().sort((a, b) => {
      const na = nodeById.get(a)
      const nb = nodeById.get(b)
      return (na?.position.x || 0) - (nb?.position.x || 0)
    })
    kids.forEach(k => queue.push({ id: k, depth: cur.depth + 1 }))
  }
  nodesInScope.forEach(n => { if (!depthOf.has(n.id)) depthOf.set(n.id, 0) })

  // Base sizes from measurement/style; then compute per-level max sizes (cell sizes)
  const baseSizes = new Map<string, TreeLayoutSize>()
  nodesInScope.forEach(n => baseSizes.set(n.id, getNodeSizeForLayout(n)))

  const maxDepth = Math.max(0, ...nodesInScope.map(n => depthOf.get(n.id) || 0))
  const levelHeights: number[] = Array.from({ length: maxDepth + 1 }, () => 0)
  const levelWidths: number[] = Array.from({ length: maxDepth + 1 }, () => 0)
  nodesInScope.forEach(n => {
    const d = depthOf.get(n.id) || 0
    const sz = baseSizes.get(n.id)!
    levelHeights[d] = Math.max(levelHeights[d], sz.h)
    levelWidths[d] = Math.max(levelWidths[d], sz.w)
  })

  const minX = Math.min(...nodesInScope.map(n => n.position.x))
  const minY = Math.min(...nodesInScope.map(n => n.position.y))
  const levelY: number[] = []
  for (let d = 0; d <= maxDepth; d++) {
    levelY[d] = d === 0 ? minY : levelY[d - 1] + levelHeights[d - 1] + gapY
  }

  // Cell sizes per node based on its depth (use max width/height within that level)
  nodesInScope.forEach(n => {
    const d = depthOf.get(n.id) || 0
    sizes.set(n.id, { w: levelWidths[d] || baseSizes.get(n.id)!.w, h: levelHeights[d] || baseSizes.get(n.id)!.h })
  })

  const subtreeWidth = new Map<string, number>()
  const computeSubtreeWidth = (id: string): number => {
    if (subtreeWidth.has(id)) return subtreeWidth.get(id)!
    const node = nodeById.get(id)
    if (!node) { subtreeWidth.set(id, 0); return 0 }
    const selfW = sizes.get(id)!.w
    const kids = (childrenOf.get(id) || []).slice().sort((a, b) => {
      const na = nodeById.get(a)
      const nb = nodeById.get(b)
      return (na?.position.x || 0) - (nb?.position.x || 0)
    })
    if (!kids.length) { subtreeWidth.set(id, selfW); return selfW }
    const kidsTotal = kids.reduce((sum, k) => sum + computeSubtreeWidth(k), 0) + gapX * Math.max(0, kids.length - 1)
    const total = Math.max(selfW, kidsTotal)
    subtreeWidth.set(id, total)
    return total
  }
  roots.forEach(r => computeSubtreeWidth(r))

  const place = (id: string, leftX: number) => {
    const node = nodeById.get(id)
    if (!node) return
    const sw = computeSubtreeWidth(id)
    const w = sizes.get(id)!.w
    const x = leftX + (sw - w) / 2
    const y = levelY[depthOf.get(id) || 0] ?? minY
    positions.set(id, { x, y })

    const kids = (childrenOf.get(id) || []).slice().sort((a, b) => {
      const na = nodeById.get(a)
      const nb = nodeById.get(b)
      return (na?.position.x || 0) - (nb?.position.x || 0)
    })
    const kidsWidth = kids.reduce((sum, k) => sum + computeSubtreeWidth(k), 0) + gapX * Math.max(0, kids.length - 1)
    let cursor = leftX + (sw - kidsWidth) / 2
    kids.forEach(k => {
      place(k, cursor)
      cursor += computeSubtreeWidth(k) + gapX
    })
  }

  let forestCursor = minX
  roots.forEach(r => {
    place(r, forestCursor)
    forestCursor += computeSubtreeWidth(r) + gapX
  })

  return { positions, sizes }
}

function upgradeVideoKind(node: Node): Node {
  const data: any = node.data || {}
  const upgradedKind = data.kind === 'video' ? 'composeVideo' : data.kind
  const isVideoKind = upgradedKind === 'composeVideo' || upgradedKind === 'storyboard' || upgradedKind === 'video'
  if (!isVideoKind) {
    if (upgradedKind === data.kind) return node
    return { ...node, data: { ...data, kind: upgradedKind } }
  }

  const rawVideoDuration = Number(data.videoDurationSeconds)
  const rawDuration = Number(data.durationSeconds)
  const hasVideoDurationSeconds = Number.isFinite(rawVideoDuration) && rawVideoDuration > 0
  const hasDurationSeconds = Number.isFinite(rawDuration) && rawDuration > 0
  const defaultSeconds = 15
  const nextData = {
    ...data,
    kind: upgradedKind,
    ...(hasVideoDurationSeconds ? null : { videoDurationSeconds: defaultSeconds }),
    ...(hasDurationSeconds ? null : { durationSeconds: defaultSeconds }),
  }
  return { ...node, data: nextData }
}

function upgradeImageFissionModel(node: Node): Node {
  if (node.type !== 'taskNode') return node
  const data: any = node.data || {}
  const kind = typeof data.kind === 'string' ? data.kind.trim() : ''
  if (kind !== 'imageFission') return node
  const hasModel = typeof data.imageModel === 'string' && data.imageModel.trim()
  if (hasModel) return node
  return { ...node, data: { ...data, imageModel: 'nano-banana-pro' } }
}

function enforceNodeSelectability(node: Node): Node {
  if (node.type !== 'taskNode') return node
  const kind = typeof (node.data as any)?.kind === 'string' ? String((node.data as any).kind).trim() : ''
  if (!kind) return node
  if (UNSELECTABLE_TASK_NODE_KINDS.has(kind)) {
    return {
      ...node,
      selectable: false,
      focusable: false,
      selected: false,
    }
  }

  // 兼容旧数据：之前部分节点会被强制设置为不可选中；这里在加载/创建时恢复可选中状态。
  const nextSelectable = node.selectable === false ? true : undefined
  const nextFocusable = (node as any).focusable === false ? true : undefined
  if (nextSelectable == null && nextFocusable == null) return node
  return {
    ...node,
    ...(nextSelectable != null ? { selectable: nextSelectable } : null),
    ...(nextFocusable != null ? { focusable: nextFocusable } : null),
  }
}

function getRemixTargetIdFromNode(node?: Node) {
  const data = node?.data as any
  if (!data) return null
  const kind = String(data.kind || '').toLowerCase()
  const isVideoKind = kind === 'composevideo' || kind === 'video' || kind === 'storyboard'
  if (!isVideoKind) return null

  const sanitize = (val: any) => {
    if (typeof val !== 'string') return null
    const trimmed = val.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('s_') || lower.startsWith('p/')) return trimmed
    return null
  }

  const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
  const primaryIndex =
    typeof data.videoPrimaryIndex === 'number' &&
    data.videoPrimaryIndex >= 0 &&
    data.videoPrimaryIndex < videoResults.length
      ? data.videoPrimaryIndex
      : videoResults.length > 0
        ? 0
        : -1
  const primaryResult = primaryIndex >= 0 ? videoResults[primaryIndex] : null

  const candidates = [
    sanitize(data.videoPostId),
    sanitize(primaryResult?.remixTargetId),
    sanitize(primaryResult?.pid),
    sanitize(primaryResult?.postId),
    sanitize(primaryResult?.post_id),
  ]

  for (const cand of candidates) {
    if (cand) return cand
  }
  return null
}

// Dragging generates high-frequency `position` updates. Track active drag node IDs so we can:
// - snapshot history only once per drag (better perf + better undo UX)
// - avoid expensive group auto-fit work during drag moves
const activeDragNodeIds = new Set<string>()

export const useRFStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  nextId: 1,
  groups: [],
  nextGroupId: 1,
  historyPast: [],
  historyFuture: [],
  clipboard: null,
  onNodesChange: (changes) => set((s) => {
    const dimChanges = new Map<string, { width?: number; height?: number; isResizeEvent?: boolean }>()
    let hasDragMove = false
    let hasDragStop = false
    let isDragStart = false
    let hasNonDragRelatedChange = false
    const dragEndNodeIds = new Set<string>()

    for (const change of changes as any[]) {
      if (!change || typeof change !== 'object') continue
      const id = typeof change.id === 'string' ? change.id : ''

      if (change.type === 'position') {
        const draggingFlag = (change as any).dragging
        if (draggingFlag === true) {
          hasDragMove = true
          if (id && !activeDragNodeIds.has(id)) {
            activeDragNodeIds.add(id)
            isDragStart = true
          }
          continue
        }
        if (draggingFlag === false) {
          hasDragStop = true
          if (id) activeDragNodeIds.delete(id)
          if (id) dragEndNodeIds.add(id)
          continue
        }
        // Programmatic or non-drag position change: treat as normal update.
        hasNonDragRelatedChange = true
        continue
      }

      // Any non-position change is not part of drag ticks.
      hasNonDragRelatedChange = true

      if (change.type === 'dimensions') {
        if (!id) continue
        const width = Number(change.dimensions?.width)
        const height = Number(change.dimensions?.height)
        const resizingFlag = (change as any)?.resizing
        const isResizeEvent = typeof resizingFlag === 'boolean'
        dimChanges.set(id, {
          ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : null),
          ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : null),
          isResizeEvent,
        })
      }
    }

    const rawUpdated = applyNodeChanges(changes, s.nodes)
    const updatedWithDims = rawUpdated.map((node) => {
      const dims = dimChanges.get(node.id)
      if (!dims) return node
      const kind = typeof (node.data as any)?.kind === 'string' ? String((node.data as any).kind) : ''
      if (node.type === 'groupNode' && dims.isResizeEvent) {
        return {
          ...node,
          data: {
            ...(node.data || {}),
            ...(typeof dims.width === 'number' ? { manualWidth: dims.width } : null),
            ...(typeof dims.height === 'number' ? { manualHeight: dims.height } : null),
          },
        }
      }
      const isCanvasMediaKind =
        kind === 'image' ||
        kind === 'textToImage' ||
        kind === 'storyboardImage' ||
        kind === 'imageFission'
      if (!isCanvasMediaKind) return node

      return {
        ...node,
        data: {
          ...node.data,
          ...(typeof dims.width === 'number' ? { nodeWidth: dims.width } : null),
          ...(typeof dims.height === 'number' ? { nodeHeight: dims.height } : null),
        },
      }
    })

    const updatedWithDrop = dragEndNodeIds.size ? applyDragDropGrouping(updatedWithDims, dragEndNodeIds) : updatedWithDims
    const shouldAutoFitGroups = !hasDragMove
    const updated = shouldAutoFitGroups
      ? autoFitGroupNodes(updatedWithDrop).map(enforceNodeSelectability)
      : updatedWithDrop

    const isDragRelated = hasDragMove || hasDragStop
    const shouldCaptureHistory = hasNonDragRelatedChange || !isDragRelated || isDragStart
    if (!shouldCaptureHistory) return { nodes: updated }

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  onEdgesChange: (changes) => set((s) => {
    const updated = applyEdgeChanges(changes, s.edges)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { edges: updated, historyPast: past, historyFuture: [] }
  }),
  onConnect: (connection: Connection) => set((s) => {
    const exists = s.edges.some((e) =>
      e.source === connection.source &&
      e.target === connection.target &&
      e.sourceHandle === connection.sourceHandle &&
      e.targetHandle === connection.targetHandle
    )
    const nextEdges = exists
      ? s.edges
      : addEdge(
          {
            ...connection,
            animated: (connection as any)?.animated ?? false,
            type: (connection as any)?.type || 'typed',
          },
          s.edges,
        )
    const past = exists ? s.historyPast : [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    if (exists) {
      return { edges: nextEdges }
    }

    let updatedNodes = s.nodes
    if (
      connection.target &&
      connection.source &&
      connection.targetHandle === 'in-video'
    ) {
      const targetNode = s.nodes.find((n) => n.id === connection.target)
      const sourceNode = s.nodes.find((n) => n.id === connection.source)
      if (
        targetNode &&
        ['composeVideo', 'storyboard', 'video'].includes(String((targetNode.data as any)?.kind))
      ) {
        const remixId = getRemixTargetIdFromNode(sourceNode)
        if (remixId) {
          updatedNodes = s.nodes.map((n) =>
            n.id === connection.target
              ? { ...n, data: { ...n.data, remixTargetId: remixId } }
              : n,
          )
        }
      }
    }

    return {
      nodes: updatedNodes,
      edges: nextEdges,
      historyPast: past,
      historyFuture: [],
    }
  }),
  addNode: (type, label, extra) => set((s) => {
    const id = genNodeId()
    const rawExtra = extra || {}
    const { label: extraLabel, autoLabel, position: preferredPosition, ...restExtra } = rawExtra
    let finalLabel = label ?? extraLabel ?? type
    const allowAutoLabel = type === 'taskNode' && autoLabel !== false
    if (allowAutoLabel) {
      const kind = typeof restExtra.kind === 'string' && restExtra.kind.trim() ? restExtra.kind.trim() : null
      const schema = getTaskNodeSchema(kind)
      const schemaLabel = schema.label || kind || '节点'
      const sameKindCount = s.nodes.filter((n) => n.type === 'taskNode' && (((n.data as any)?.kind || null) === kind)).length
      const autoGeneratedLabel = `${schemaLabel}-${sameKindCount + 1}`
      const normalizedLabel = typeof finalLabel === 'string' ? finalLabel.trim() : ''
      const normalizedLabelLower = normalizedLabel.toLowerCase()
      const kindLower = typeof kind === 'string' ? kind.toLowerCase() : null
      const shouldUseAutoLabel =
        !normalizedLabel ||
        normalizedLabel === type ||
        normalizedLabel === schemaLabel ||
        (kindLower ? normalizedLabelLower === kindLower : false)
      if (shouldUseAutoLabel) {
        finalLabel = autoGeneratedLabel
      }
    }
    const index = Math.max(0, s.nextId - 1)
    const cols = 4
    const spacingX = CANVAS_CONFIG.NODE_SPACING_X
    const spacingY = CANVAS_CONFIG.NODE_SPACING_Y
    const defaultPosition = {
      x: 80 + (index % cols) * spacingX,
      y: 80 + Math.floor(index / cols) * spacingY,
    }
    const hasPreferred =
      preferredPosition &&
      typeof preferredPosition.x === 'number' &&
      typeof preferredPosition.y === 'number' &&
      Number.isFinite(preferredPosition.x) &&
      Number.isFinite(preferredPosition.y)
    const position = hasPreferred ? preferredPosition : defaultPosition

    let dataExtra = restExtra
    if (type === 'taskNode') {
      const kindValue =
        typeof dataExtra.kind === 'string' && dataExtra.kind.trim()
          ? dataExtra.kind.trim()
          : null
      if (
        (kindValue === 'composeVideo' ||
          kindValue === 'storyboard' ||
          kindValue === 'video') &&
        (dataExtra as any).videoModel == null
      ) {
        dataExtra = {
          ...dataExtra,
          videoModel: 'sora-2',
          videoModelVendor:
            (dataExtra as any).videoModelVendor ?? 'sora2api',
        }
      }

      if (kindValue === 'composeVideo' || kindValue === 'storyboard' || kindValue === 'video') {
        const rawVideoDuration = Number((dataExtra as any).videoDurationSeconds)
        const rawDuration = Number((dataExtra as any).durationSeconds)
        const hasVideoDurationSeconds = Number.isFinite(rawVideoDuration) && rawVideoDuration > 0
        const hasDurationSeconds = Number.isFinite(rawDuration) && rawDuration > 0
        const defaultSeconds = 15
        if (!hasVideoDurationSeconds || !hasDurationSeconds) {
          dataExtra = {
            ...dataExtra,
            ...(!hasVideoDurationSeconds ? { videoDurationSeconds: defaultSeconds } : null),
            ...(!hasDurationSeconds ? { durationSeconds: defaultSeconds } : null),
          }
        }
      }

      if (kindValue === 'storyboardImage') {
        const hasCount = typeof (dataExtra as any).storyboardCount === 'number' && Number.isFinite((dataExtra as any).storyboardCount)
        const hasAspect = typeof (dataExtra as any).storyboardAspectRatio === 'string' && (dataExtra as any).storyboardAspectRatio.trim()
        const hasStyle = typeof (dataExtra as any).storyboardStyle === 'string' && (dataExtra as any).storyboardStyle.trim()
        const hasModel = typeof (dataExtra as any).imageModel === 'string' && (dataExtra as any).imageModel.trim()
        dataExtra = {
          ...dataExtra,
          ...(hasCount ? null : { storyboardCount: 4 }),
          ...(hasAspect ? null : { storyboardAspectRatio: '16:9' }),
          ...(hasStyle ? null : { storyboardStyle: 'realistic' }),
          ...(hasModel ? null : { imageModel: 'nano-banana-pro' }),
        }
      }

      if (kindValue === 'imageFission') {
        const hasFission = !!(dataExtra as any).imageFission && typeof (dataExtra as any).imageFission === 'object'
        const hasAspect = typeof (dataExtra as any).aspect === 'string' && (dataExtra as any).aspect.trim()
        const hasSampleCount = typeof (dataExtra as any).sampleCount === 'number' && Number.isFinite((dataExtra as any).sampleCount)
        const hasImageSize = typeof (dataExtra as any).imageSize === 'string' && (dataExtra as any).imageSize.trim()
        const hasModel = typeof (dataExtra as any).imageModel === 'string' && (dataExtra as any).imageModel.trim()
        dataExtra = {
          ...dataExtra,
          ...(hasFission
            ? null
            : { imageFission: { mode: 'creative', count: 1, aspectRatio: '3:4', hd: false } }),
          ...(hasAspect ? null : { aspect: '3:4' }),
          ...(hasSampleCount ? null : { sampleCount: 1 }),
          ...(hasImageSize ? null : { imageSize: '2K' }),
          ...(hasModel ? null : { imageModel: 'nano-banana-pro' }),
        }
      }

      const isCanvasMediaKind =
        kindValue === 'image' ||
        kindValue === 'textToImage' ||
        kindValue === 'storyboardImage' ||
        kindValue === 'imageFission'
      if (isCanvasMediaKind) {
        const hasNodeWidth =
          typeof (dataExtra as any).nodeWidth === 'number' && Number.isFinite((dataExtra as any).nodeWidth)
        const hasNodeHeight =
          typeof (dataExtra as any).nodeHeight === 'number' && Number.isFinite((dataExtra as any).nodeHeight)
        const defaults =
          kindValue === 'storyboardImage'
            ? { nodeWidth: 210, nodeHeight: 118 }
            : { nodeWidth: 120, nodeHeight: 210 }
        dataExtra = {
          ...dataExtra,
          ...(hasNodeWidth ? null : { nodeWidth: defaults.nodeWidth }),
          ...(hasNodeHeight ? null : { nodeHeight: defaults.nodeHeight }),
        }
      }
    }

    const node: Node = {
      id,
      type: type as any,
      position,
      data: { label: finalLabel, ...dataExtra },
    }
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: [...s.nodes, enforceNodeSelectability(node)], nextId: s.nextId + 1, historyPast: past, historyFuture: [] }
  }),
  reset: () => set({ nodes: [], edges: [], nextId: 1 }),
  load: (data) => {
    if (!data) return
    // support optional groups in payload
    const anyData = data as any
    const upgradedNodes = (data.nodes || [])
      .map(upgradeVideoKind)
      .map(upgradeImageFissionModel)
      .map(enforceNodeSelectability)
    const parentNormalizedNodes = normalizeNodesParentId(upgradedNodes)
    const groupIds = new Set(parentNormalizedNodes.filter(n => n.type === 'groupNode').map(n => n.id))
    const normalizedNodes = parentNormalizedNodes.map((n) => {
      const p = (n as any)?.parentId as string | undefined
      if (!p || !groupIds.has(p)) return n
      return { ...n, extent: undefined }
    })
    const legacyNextGroupId = Array.isArray(anyData.groups) ? anyData.groups.length + 1 : 1
    const maxGroupNum = normalizedNodes.reduce((acc, n) => {
      if (n.type !== 'groupNode') return acc
      const m = /^g(\d+)$/.exec(String(n.id || ''))
      if (!m) return acc
      const num = Number(m[1])
      return Number.isFinite(num) ? Math.max(acc, num) : acc
    }, 0)
    set((s) => ({
      nodes: normalizedNodes,
      edges: data.edges,
      nextId: normalizedNodes.length + 1,
      groups: Array.isArray(anyData.groups) ? anyData.groups : [],
      nextGroupId: Math.max(legacyNextGroupId, maxGroupNum + 1),
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }))
  },
  removeSelected: () => set((s) => {
    const selectedNodes = s.nodes.filter(n => n.selected)
    const selectedIds = new Set(selectedNodes.map(n => n.id))

    // 收集所有需要删除的节点ID：包括选中的节点和它们的子节点
    const idsToDelete = new Set<string>()
    selectedIds.forEach(id => {
      idsToDelete.add(id)

      // 如果选中的是组节点，添加所有子节点
      const node = selectedNodes.find(n => n.id === id)
      if (node?.type === 'groupNode') {
        const childNodes = s.nodes.filter(n => (n as any).parentId === id)
        childNodes.forEach(child => idsToDelete.add(child.id))
      }
    })

    // 如果选中的是子节点，也检查是否需要删除父节点（如果父节点的所有子节点都被选中）
    const selectedChildNodes = selectedNodes.filter(n => (n as any).parentId && selectedIds.has((n as any).parentId))
    selectedChildNodes.forEach(child => {
      const parentNode = s.nodes.find(n => n.id === (child as any).parentId)
      if (parentNode && parentNode.type === 'groupNode') {
        const allChildren = s.nodes.filter(n => (n as any).parentId === parentNode.id)
        const allChildrenSelected = allChildren.every(child => selectedIds.has(child.id))

        // 如果所有子节点都被选中，也删除父节点
        if (allChildrenSelected) {
          idsToDelete.add(parentNode.id)
        }
      }
    })

    // 删除节点和相关边
    const remainingNodes = s.nodes.filter(n => !idsToDelete.has(n.id))
    const remainingEdges = s.edges.filter(e =>
      !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
    )

    return {
      nodes: remainingNodes,
      edges: remainingEdges,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  updateNodeLabel: (id, label) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  updateNodeData: (id, patch) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  setNodeStatus: (id, status, patch) => {
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status, ...(patch||{}) } } : n))
    }))

    // 当任务成功完成时，静默保存项目状态
    if (status === 'success') {
      // 延迟一小段时间确保数据已更新
      setTimeout(() => {
        if ((window as any).silentSaveProject) {
          (window as any).silentSaveProject()
        }
      }, 100)
    }
  },
  appendLog: (id, line) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, logs: [...((n.data as any)?.logs || []), line] } } : n))
  })),
  beginRunToken: (id) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, canceled: false } } : n))
  })),
  endRunToken: (id) => set((s) => s),
  cancelNode: (id) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, canceled: true } } : n))
  })),
  isCanceled: (id) => {
    const n = get().nodes.find((x) => x.id === id)
    return Boolean((n?.data as any)?.canceled)
  },
  runSelected: async () => {
    const s = get()
    const selected = s.nodes.find((n) => n.selected)
    if (!selected) return
    const kind = (selected.data as any)?.kind as string | undefined
    if (kind === 'mosaic') {
      const { runNodeMosaic } = await import('../runner/mosaicRunner')
      await runNodeMosaic(selected.id, get, set)
    } else if (kind === 'composeVideo' || kind === 'storyboard' || kind === 'video' || kind === 'tts' || kind === 'subtitleAlign' || kind === 'image' || kind === 'textToImage' || kind === 'storyboardImage' || kind === 'imageFission') {
      await runNodeRemote(selected.id, get, set)
    } else {
      await runNodeMock(selected.id, get, set)
    }
  },
  runDag: async (concurrency: number) => {
    await runFlowDag(Math.max(1, Math.min(8, Math.floor(concurrency || 2))), get, set)
  },
  copySelected: () => set((s) => {
    const selNodes = s.nodes.filter((n) => n.selected)
    if (!selNodes.length) return { clipboard: null }
    const selIds = new Set(selNodes.map((n) => n.id))
    const selEdges = s.edges.filter((e) => selIds.has(e.source) && selIds.has(e.target) && e.selected)
    const graph = { nodes: selNodes, edges: selEdges }
    // 尝试同时复制到系统剪贴板，便于粘贴到外部文档
    try {
      const text = JSON.stringify(graph, null, 2)
      void navigator.clipboard?.writeText(text)
    } catch {
      // ignore clipboard errors
    }
    return { clipboard: graph }
  }),
  pasteFromClipboard: () => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const offset = { x: 24, y: 24 }
    const idMap = new Map<string, string>()
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        selected: false,
        position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      }
    })
    const newEdges: Edge[] = s.clipboard.edges
      .map((e) => ({
        ...e,
        id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        selected: false,
      }))
      .filter((e) => e.source !== e.target)

    return {
      nodes: [...s.nodes, ...newNodes.map(enforceNodeSelectability)],
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  undo: () => set((s) => {
    if (!s.historyPast.length) return {}
    const previous = s.historyPast[s.historyPast.length - 1]
    const rest = s.historyPast.slice(0, -1)
    const future = [cloneGraph(s.nodes, s.edges), ...s.historyFuture].slice(0, 50)
    return { nodes: previous.nodes, edges: previous.edges, historyPast: rest, historyFuture: future }
  }),
  redo: () => set((s) => {
    if (!s.historyFuture.length) return {}
    const next = s.historyFuture[0]
    const future = s.historyFuture.slice(1)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: next.nodes, edges: next.edges, historyPast: past, historyFuture: future }
  }),
  deleteNode: (id) => set((s) => ({
    nodes: s.nodes.filter(n => n.id !== id),
    edges: s.edges.filter(e => e.source !== id && e.target !== id),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  deleteEdge: (id) => set((s) => ({
    edges: s.edges.filter(e => e.id !== id),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  duplicateNode: (id) => set((s) => {
    const n = s.nodes.find(n => n.id === id)
    if (!n) return {}
    const newId = genNodeId()
    const dup: Node = {
      ...n,
      id: newId,
      position: { x: n.position.x + 24, y: n.position.y + 24 },
      selected: false,
    }
    return { nodes: [...s.nodes, enforceNodeSelectability(dup)], nextId: s.nextId + 1, historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50), historyFuture: [] }
  }),
  pasteFromClipboardAt: (pos) => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const minX = Math.min(...s.clipboard.nodes.map(n => n.position.x))
    const minY = Math.min(...s.clipboard.nodes.map(n => n.position.y))
    const shift = { x: pos.x - minX, y: pos.y - minY }
    const idMap = new Map<string, string>()
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      const upgraded = upgradeVideoKind(n)
      return enforceNodeSelectability({ ...upgraded, id: newId, selected: false, position: { x: n.position.x + shift.x, y: n.position.y + shift.y } })
    })
    const newEdges: Edge[] = s.clipboard.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
    }))
    return {
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  importWorkflow: (workflowData, position) => set((s) => {
    if (!workflowData?.nodes?.length) return {}

    // 确定导入位置
    const pos = position || { x: 100, y: 100 }
    const minX = Math.min(...workflowData.nodes.map(n => n.position.x))
    const minY = Math.min(...workflowData.nodes.map(n => n.position.y))
    const shift = { x: pos.x - minX, y: pos.y - minY }

    const idMap = new Map<string, string>()
    const newNodes: Node[] = workflowData.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      const upgraded = upgradeVideoKind(n)
      return enforceNodeSelectability({
        ...upgraded,
        id: newId,
        selected: false,
        dragging: false,
        position: { x: n.position.x + shift.x, y: n.position.y + shift.y },
        // 清理状态相关的数据
        data: {
          ...upgraded.data,
          status: undefined,
          progress: undefined,
          logs: undefined,
          canceled: undefined,
          lastError: undefined
        }
      })
    })
    const newEdges: Edge[] = workflowData.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
      animated: false
    }))
    return {
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  selectAll: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: n.selectable === false ? false : true })),
    edges: s.edges.map(e => ({ ...e, selected: true })),
  })),
  clearSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: false })),
    edges: s.edges.map(e => ({ ...e, selected: false })),
  })),
  invertSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: n.selectable === false ? false : !n.selected })),
    edges: s.edges.map(e => ({ ...e, selected: !e.selected })),
  })),
  addGroupForSelection: (name) => set((s) => {
    const selectedNodes = s.nodes.filter(n => n.selected && n.type !== 'groupNode' && n.type !== 'ioNode')
    if (selectedNodes.length < 2) return {}

    const nodeById = new Map(s.nodes.map(n => [n.id, n] as const))
    const chains = selectedNodes.map(n => getAncestorChain(n, nodeById))
    let common = new Set(chains[0] || [])
    for (let i = 1; i < chains.length; i++) {
      common = new Set((chains[i] || []).filter(id => common.has(id)))
    }
    const commonParentId = (chains[0] || []).find(id => common.has(id)) || null
    const commonParentAbs = commonParentId ? getNodeAbsPosition(nodeById.get(commonParentId)!, nodeById) : { x: 0, y: 0 }

    // compute bbox in absolute flow coords
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const absById = new Map<string, { x: number; y: number }>()
    for (const n of selectedNodes) {
      const abs = getNodeAbsPosition(n, nodeById)
      absById.set(n.id, abs)
      const { w, h } = getNodeSizeForLayout(n)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return {}

    const gid = genGroupId(s.nextGroupId)
    const groupAbsPos = { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING }
    const groupSize = {
      w: Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2),
      h: Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2),
    }
    const groupNode: Node = {
      id: gid,
      type: 'groupNode' as any,
      position: { x: groupAbsPos.x - commonParentAbs.x, y: groupAbsPos.y - commonParentAbs.y },
      ...(commonParentId ? { parentId: commonParentId } : null),
      data: { label: name || '新建组' },
      style: { width: groupSize.w, height: groupSize.h, zIndex: -10, background: 'transparent' },
      draggable: true,
      selectable: true,
    }

    // reparent children to this group; convert positions to relative to groupAbsPos
    const members = new Set(selectedNodes.map(n => n.id))
    const newNodes: Node[] = s.nodes.map((n) => {
      if (!members.has(n.id)) return { ...n, selected: false }
      const abs = absById.get(n.id) || getNodeAbsPosition(n, nodeById)
      const rel = { x: abs.x - groupAbsPos.x, y: abs.y - groupAbsPos.y }
      return { ...n, parentId: gid, position: rel, extent: undefined, selected: false }
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: [{ ...groupNode, selected: true }, ...newNodes],
      nextGroupId: s.nextGroupId + 1,
      historyPast: past,
      historyFuture: []
    }
  }),
  removeGroupById: (id) => set((s) => {
    // if it's a legacy record, drop it; if there's a group node, ungroup it
    const hasGroupNode = s.nodes.some(n => n.id === id && n.type === 'groupNode')
    if (hasGroupNode) {
      const group = s.nodes.find(n => n.id === id)!
      const nodeById = new Map(s.nodes.map(n => [n.id, n] as const))
      const groupAbs = getNodeAbsPosition(group, nodeById)
      const children = s.nodes.filter(n => (n as any).parentId === id)
      const restored = s.nodes
        .filter(n => n.id !== id)
        .map(n => (n as any).parentId === id ? { ...n, parentId: undefined, extent: undefined, position: { x: groupAbs.x + n.position.x, y: groupAbs.y + n.position.y } } : n)
      const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
      return { nodes: restored, historyPast: past, historyFuture: [] }
    }
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { groups: s.groups.filter(g => g.id !== id), historyPast: past, historyFuture: [] }
  }),
  findGroupMatchingSelection: () => {
    const s = get()
    const selected = s.nodes.filter(n => n.selected).map(n => n.id)
    if (selected.length < 2) return null
    return s.groups.find(g => g.nodeIds.length === selected.length && g.nodeIds.every(id => selected.includes(id))) || null
  },
  renameGroup: (id, name) => set((s) => ({ groups: s.groups.map(g => g.id === id ? { ...g, name } : g) })),
  ungroupGroupNode: (id) => set((s) => {
    const group = s.nodes.find(n => n.id === id && n.type === 'groupNode')
    if (!group) return {}
    const nodeById = new Map(s.nodes.map(n => [n.id, n] as const))
    const groupAbs = getNodeAbsPosition(group, nodeById)
    const children = s.nodes.filter(n => (n as any).parentId === id)
    const restored = s.nodes
      .filter(n => n.id !== id)
      .map(n => (n as any).parentId === id ? { ...n, parentId: undefined, extent: undefined, position: { x: groupAbs.x + n.position.x, y: groupAbs.y + n.position.y } } : n)
    // select children after ungroup
    const childIds = new Set(children.map(c => c.id))
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: restored.map(n => ({ ...n, selected: childIds.has(n.id) })), historyPast: past, historyFuture: [] }
  }),
  formatTree: () => {
    const s = get()
    const sel = s.nodes.filter(n => n.selected)
    if (sel.length < 2) {
      s.autoLayoutAllDagVertical()
      return
    }
    set((state) => {
      const selected = state.nodes.filter(n => n.selected)
      if (selected.length < 2) return {}
      const byParent = new Map<string, Node[]>()
      selected.forEach(n => {
        const p = ((n as any).parentId as string) || ''
        if (!byParent.has(p)) byParent.set(p, [])
        byParent.get(p)!.push(n)
      })
      const selectedIds = new Set(selected.map(n => n.id))
      const edgesBySel = state.edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target))
      const updated = [...state.nodes]
      const gapX = 32, gapY = 32
      byParent.forEach(nodesInParent => {
        const idSet = new Set(nodesInParent.map(n => n.id))
        const edgesInScope = edgesBySel.filter(e => idSet.has(e.source) && idSet.has(e.target))
        const { positions, sizes } = computeTreeLayout(nodesInParent, edgesInScope, gapX, gapY)
        nodesInParent.forEach(n => {
          const p = positions.get(n.id)
          if (!p) return
          const i = updated.findIndex(x => x.id === n.id)
          if (i < 0) return
          const { positionAbsolute: _pa, dragging: _dragging, ...rest } = updated[i] as any
          updated[i] = {
            ...rest,
            position: { x: p.x, y: p.y },
            // Do not overwrite node size here; layout is adaptive based on current measurements.
          }
        })
      })
      const past = [...state.historyPast, cloneGraph(state.nodes, state.edges)].slice(-50)
      return { nodes: updated, historyPast: past, historyFuture: [] }
    })
  },
  // DAG auto layout (top-down tree style) for the whole graph
  autoLayoutAllDagVertical: () => set((s) => {
    const byParent = new Map<string, Node[]>()
    s.nodes.forEach(n => { const p=((n as any).parentId as string)||''; if(!byParent.has(p)) byParent.set(p, []); byParent.get(p)!.push(n) })
    const updated = [...s.nodes]
    byParent.forEach(nodesInParent => {
      const idSet = new Set(nodesInParent.map(n => n.id))
      const edgesInScope = s.edges.filter(e => idSet.has(e.source) && idSet.has(e.target))
      const { positions } = computeTreeLayout(nodesInParent, edgesInScope, 32, 32)
      nodesInParent.forEach(n => {
        const p = positions.get(n.id)
        if (!p) return
        const i = updated.findIndex(x => x.id === n.id)
        if (i < 0) return
        const { positionAbsolute: _pa, dragging: _dragging, ...rest } = updated[i] as any
        updated[i] = {
          ...rest,
          position: { x: p.x, y: p.y },
        }
      })
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  autoLayoutForParent: (parentId) => set((s) => {
    const nodesInParent = s.nodes.filter(n => (((n as any).parentId as string | undefined) || null) === parentId)
    if (!nodesInParent.length) return {}
    const updated = [...s.nodes]
    const idSet = new Set(nodesInParent.map(n => n.id))
    const edgesInScope = s.edges.filter(e => idSet.has(e.source) && idSet.has(e.target))
    const { positions, sizes } = computeTreeLayout(nodesInParent, edgesInScope, 32, 32)
    nodesInParent.forEach(n => {
      const p = positions.get(n.id)
      if (!p) return
      const i = updated.findIndex(x => x.id === n.id)
      if (i < 0) return
      const { positionAbsolute: _pa, dragging: _dragging, ...rest } = updated[i] as any
      updated[i] = {
        ...rest,
        position: { x: p.x, y: p.y },
        // Do not overwrite node size here; layout is adaptive based on current measurements.
      }
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  runSelectedGroup: async () => {
    const s = get()
    const g = s.nodes.find((n: any) => n.type === 'groupNode' && n.selected)
    if (!g) return
    const only = new Set(s.nodes.filter((n: any) => (n as any).parentId === g.id).map((n:any)=>n.id))
    await runFlowDag(2, get, set, { only })
  },
  renameSelectedGroup: () => set((s) => {
    const g = s.nodes.find((n: any) => n.type === 'groupNode' && n.selected)
    if (!g) return {}
    return { nodes: s.nodes.map(n => n.id === g.id ? { ...n, data: { ...(n.data||{}), editing: true } } : n) }
  }),
}))

export function persistToLocalStorage(key = 'tapcanvas-flow') {
  const state = useRFStore.getState()
  // Never persist `dragHandle`: it can make nodes appear "undraggable" if the selector is missing.
  const rawNodes = (state.nodes || []).map((n: any) => {
    if (!n || typeof n !== 'object') return n
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dragHandle: _dragHandle, ...rest } = n
    return rest
  }) as Node[]
  const nodes = normalizeNodesParentId(rawNodes)
  const payload = JSON.stringify({ nodes, edges: state.edges, groups: state.groups })
  localStorage.setItem(key, payload)
}

export function restoreFromLocalStorage(key = 'tapcanvas-flow') {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { nodes: Node[]; edges: Edge[]; groups?: GroupRec[] }
    // Backward-compat: older saves may contain `dragHandle` which restricts dragging to a selector.
    // Strip it so "dragging a node" always drags the node.
    const nodes = (parsed.nodes || []).map((n: any) => {
      if (!n || typeof n !== 'object') return n
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { dragHandle: _dragHandle, ...rest } = n
      return rest
    }) as Node[]
    return { ...parsed, nodes: normalizeNodesParentId(nodes) }
  } catch {
    return null
  }
}
