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
  const measuredW = typeof anyNode?.width === 'number' && Number.isFinite(anyNode.width) ? anyNode.width : undefined
  const measuredH = typeof anyNode?.height === 'number' && Number.isFinite(anyNode.height) ? anyNode.height : undefined
  const styleW = parseNumericStyle(anyNode?.style?.width)
  const styleH = parseNumericStyle(anyNode?.style?.height)
  const fallbackW = 220
  const fallbackH = 120
  return { w: measuredW ?? styleW ?? fallbackW, h: measuredH ?? styleH ?? fallbackH }
}

const GROUP_PADDING = 8
const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90

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
    const children = nodes.filter(n => n.parentNode === group.id)
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

    const desiredPos = {
      x: (group.position?.x ?? 0) + (minX - GROUP_PADDING),
      y: (group.position?.y ?? 0) + (minY - GROUP_PADDING),
    }
    const desiredSize = {
      w: Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2),
      h: Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2),
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
    const updated = autoFitGroupNodes(applyNodeChanges(changes, s.nodes))
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
        dataExtra = {
          ...dataExtra,
          ...(hasCount ? null : { storyboardCount: 4 }),
          ...(hasAspect ? null : { storyboardAspectRatio: '16:9' }),
          ...(hasStyle ? null : { storyboardStyle: 'realistic' }),
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
    return { nodes: [...s.nodes, node], nextId: s.nextId + 1, historyPast: past, historyFuture: [] }
  }),
  reset: () => set({ nodes: [], edges: [], nextId: 1 }),
  load: (data) => {
    if (!data) return
    // support optional groups in payload
    const anyData = data as any
    const upgradedNodes = (data.nodes || []).map(upgradeVideoKind)
    set((s) => ({
      nodes: upgradedNodes,
      edges: data.edges,
      nextId: upgradedNodes.length + 1,
      groups: Array.isArray(anyData.groups) ? anyData.groups : [],
      nextGroupId: Array.isArray(anyData.groups) ? anyData.groups.length + 1 : 1,
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
        const childNodes = s.nodes.filter(n => n.parentNode === id)
        childNodes.forEach(child => idsToDelete.add(child.id))
      }
    })

    // 如果选中的是子节点，也检查是否需要删除父节点（如果父节点的所有子节点都被选中）
    const selectedChildNodes = selectedNodes.filter(n => n.parentNode && selectedIds.has(n.parentNode))
    selectedChildNodes.forEach(child => {
      const parentNode = s.nodes.find(n => n.id === child.parentNode)
      if (parentNode && parentNode.type === 'groupNode') {
        const allChildren = s.nodes.filter(n => n.parentNode === parentNode.id)
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
      nodes: [...s.nodes, ...newNodes],
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
    return { nodes: [...s.nodes, dup], nextId: s.nextId + 1, historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50), historyFuture: [] }
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
      return { ...upgraded, id: newId, selected: false, position: { x: n.position.x + shift.x, y: n.position.y + shift.y } }
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
      return {
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
      }
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
    nodes: s.nodes.map(n => ({ ...n, selected: true })),
    edges: s.edges.map(e => ({ ...e, selected: true })),
  })),
  clearSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: false })),
    edges: s.edges.map(e => ({ ...e, selected: false })),
  })),
  invertSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: !n.selected })),
    edges: s.edges.map(e => ({ ...e, selected: !e.selected })),
  })),
  addGroupForSelection: (name) => set((s) => {
    const selectedNodes = s.nodes.filter(n => n.selected && n.type !== 'groupNode')
    if (selectedNodes.length < 2) return {}
    // ensure all selected share same parent (or no parent)
    const parents = new Set(selectedNodes.map(n => n.parentNode || ''))
    if (parents.size > 1) return {}
    // compute bbox in absolute coordinates (assume current parent is same)
    const padding = 8
    const minX = Math.min(...selectedNodes.map(n => n.position.x + (0)))
    const minY = Math.min(...selectedNodes.map(n => n.position.y + (0)))
    const defaultW = 180, defaultH = 96
    const maxX = Math.max(...selectedNodes.map(n => n.position.x + (((n as any).width) || defaultW)))
    const maxY = Math.max(...selectedNodes.map(n => n.position.y + (((n as any).height) || defaultH)))
    const gid = genGroupId(s.nextGroupId)
    const groupNode: Node = {
      id: gid,
      type: 'groupNode' as any,
      position: { x: minX - padding, y: minY - padding },
      data: { label: name || '新建组' },
      style: { width: (maxX - minX) + padding * 2, height: (maxY - minY) + padding * 2, zIndex: 0, background: 'transparent' },
      draggable: true,
      selectable: true,
    }
    // reparent children to this group; convert positions to relative
    const members = new Set(selectedNodes.map(n => n.id))
    const newNodes: Node[] = s.nodes.map((n) => {
      if (!members.has(n.id)) return n
      const rel = { x: n.position.x - groupNode.position.x, y: n.position.y - groupNode.position.y }
      return { ...n, parentNode: gid, position: rel, extent: 'parent' as any, selected: false }
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: [...newNodes, groupNode].map(n => n.id === gid ? { ...n, selected: true } : n), nextGroupId: s.nextGroupId + 1, historyPast: past, historyFuture: [] }
  }),
  removeGroupById: (id) => set((s) => {
    // if it's a legacy record, drop it; if there's a group node, ungroup it
    const hasGroupNode = s.nodes.some(n => n.id === id && n.type === 'groupNode')
    if (hasGroupNode) {
      const group = s.nodes.find(n => n.id === id)!
      const children = s.nodes.filter(n => n.parentNode === id)
      const restored = s.nodes
        .filter(n => n.id !== id)
        .map(n => n.parentNode === id ? { ...n, parentNode: undefined, extent: undefined, position: { x: (group.position as any).x + n.position.x, y: (group.position as any).y + n.position.y } } : n)
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
    const children = s.nodes.filter(n => n.parentNode === id)
    const restored = s.nodes
      .filter(n => n.id !== id)
      .map(n => n.parentNode === id ? { ...n, parentNode: undefined, extent: undefined, position: { x: (group.position as any).x + n.position.x, y: (group.position as any).y + n.position.y } } : n)
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
        const p = (n.parentNode as string) || ''
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
    s.nodes.forEach(n => { const p=(n.parentNode as string)||''; if(!byParent.has(p)) byParent.set(p, []); byParent.get(p)!.push(n) })
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
    const nodesInParent = s.nodes.filter(n => (n.parentNode||null) === parentId)
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
    const only = new Set(s.nodes.filter((n: any) => n.parentNode === g.id).map((n:any)=>n.id))
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
  const nodes = (state.nodes || []).map((n: any) => {
    if (!n || typeof n !== 'object') return n
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dragHandle: _dragHandle, ...rest } = n
    return rest
  })
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
    return { ...parsed, nodes }
  } catch {
    return null
  }
}
