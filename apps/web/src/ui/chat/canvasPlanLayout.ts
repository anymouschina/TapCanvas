import type { Node } from '@xyflow/react'
import { getNodeAbsRect } from '../../canvas/utils/nodeBounds'
import {
  inferProductionNodeMeta,
  normalizeProductionLayer,
  type ProductionLayer,
} from '../../canvas/productionMeta'

export type LayoutPlanPosition = { x: number; y: number }

export type LayoutPlanNode = {
  clientId: string
  kind: string
  label: string
  nodeType?: string
  position?: LayoutPlanPosition
  groupId?: string
  groupLabel?: string
  config?: Record<string, unknown>
}

export type LayoutPlanEdge = {
  sourceClientId: string
  targetClientId: string
  sourceHandle?: string
  targetHandle?: string
}

export type LayoutPlan = {
  action: 'create_canvas_workflow'
  summary?: string
  reason?: string
  nodes: LayoutPlanNode[]
  edges?: LayoutPlanEdge[]
}

export type LayoutPlanGroup = {
  key: string
  label: string
  nodeClientIds: string[]
}

type LayoutRect = { x: number; y: number; w: number; h: number }
type SizedNode = LayoutPlanNode & { layoutSize: { w: number; h: number } }

type PositionedGroup = {
  key: string
  label: string
  nodes: SizedNode[]
  edges: LayoutPlanEdge[]
  rect: LayoutRect
}

type GroupLevelLayoutItem = {
  key: string
  width: number
  height: number
}

const DEFAULT_NODE_SIZE = { w: 420, h: 240 }
const TEXTUAL_NODE_SIZE = { w: 420, h: 240 }
const IMAGE_NODE_SIZE = { w: 420, h: 280 }
const VIDEO_NODE_SIZE = { w: 460, h: 260 }
const SMALL_NODE_SIZE = { w: 320, h: 180 }
const INTERNAL_GAP_X = 56
const INTERNAL_GAP_Y = 40
const GROUP_OUTER_PADDING = 16
const GROUP_GAP_X = 140
const GROUP_GAP_Y = 120
const MIN_DISTANCE_X = 220
const MIN_DISTANCE_Y = 140

const PLAN_TEXTUAL_KINDS = new Set(['text'])
const PLAN_INPUT_KINDS = new Set(['input', 'text', 'prompt'])
const PLAN_OUTPUT_KINDS = new Set(['image', 'video', 'composeVideo'])
const PLAN_IMAGE_KINDS = new Set(['image'])
const PLAN_VIDEO_KINDS = new Set(['video', 'composeVideo'])
const PRODUCTION_LAYER_ORDER: Record<ProductionLayer, number> = {
  evidence: 0,
  constraints: 1,
  anchors: 2,
  expansion: 3,
  execution: 4,
  results: 5,
}

function getNodeKind(node: LayoutPlanNode): string {
  const configKind = typeof node.config?.kind === 'string' ? node.config.kind.trim() : ''
  return (configKind || node.kind || '').trim()
}

function getGroupKey(node: LayoutPlanNode): string {
  const topLevel = typeof node.groupId === 'string' ? node.groupId.trim() : ''
  const configValue = typeof node.config?.groupId === 'string' ? node.config.groupId.trim() : ''
  return topLevel || configValue
}

function getGroupLabel(node: LayoutPlanNode): string {
  const topLevel = typeof node.groupLabel === 'string' ? node.groupLabel.trim() : ''
  const configValue = typeof node.config?.groupLabel === 'string' ? node.config.groupLabel.trim() : ''
  return topLevel || configValue
}

function estimateNodeSize(node: LayoutPlanNode): { w: number; h: number } {
  const kind = getNodeKind(node)
  if (PLAN_VIDEO_KINDS.has(kind)) return VIDEO_NODE_SIZE
  if (PLAN_IMAGE_KINDS.has(kind)) return IMAGE_NODE_SIZE
  if (PLAN_TEXTUAL_KINDS.has(kind)) return TEXTUAL_NODE_SIZE
  if (kind === 'reference' || kind === 'character') return SMALL_NODE_SIZE
  return DEFAULT_NODE_SIZE
}

function getNodeProductionLayer(node: LayoutPlanNode): ProductionLayer | undefined {
  const explicit = normalizeProductionLayer(node.config?.productionLayer)
  if (explicit) return explicit
  return inferProductionNodeMeta(getNodeKind(node)).productionLayer
}

function getNodePriority(node: LayoutPlanNode): number {
  const productionLayer = getNodeProductionLayer(node)
  if (productionLayer) return PRODUCTION_LAYER_ORDER[productionLayer]
  const kind = getNodeKind(node)
  if (PLAN_INPUT_KINDS.has(kind)) return 0
  if (PLAN_OUTPUT_KINDS.has(kind)) return 2
  return 1
}

function comparePlanNodes(a: LayoutPlanNode, b: LayoutPlanNode): number {
  const priorityDelta = getNodePriority(a) - getNodePriority(b)
  if (priorityDelta !== 0) return priorityDelta
  return a.clientId.localeCompare(b.clientId)
}

function hasDenseOrMissingPositions(nodes: LayoutPlanNode[]): boolean {
  if (nodes.length <= 1) return false
  const positions = nodes.map((node) => node.position)
  if (positions.some((position) => !position || !Number.isFinite(position.x) || !Number.isFinite(position.y))) return true

  for (let i = 0; i < positions.length; i += 1) {
    const left = positions[i]
    if (!left) continue
    for (let j = i + 1; j < positions.length; j += 1) {
      const right = positions[j]
      if (!right) continue
      const dx = Math.abs(left.x - right.x)
      const dy = Math.abs(left.y - right.y)
      if (dx < MIN_DISTANCE_X && dy < MIN_DISTANCE_Y) return true
    }
  }
  return false
}

function normalizeRelativePositions(nodes: LayoutPlanNode[]): SizedNode[] {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const x = Number(node.position?.x ?? 0)
    const y = Number(node.position?.y ?? 0)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
  }
  const offsetX = Number.isFinite(minX) ? minX : 0
  const offsetY = Number.isFinite(minY) ? minY : 0
  return nodes.map((node) => ({
    ...node,
    layoutSize: estimateNodeSize(node),
    position: {
      x: Number(node.position?.x ?? 0) - offsetX,
      y: Number(node.position?.y ?? 0) - offsetY,
    },
  }))
}

function applyGridLayout(nodes: LayoutPlanNode[]): SizedNode[] {
  const sorted = [...nodes].sort(comparePlanNodes)
  const cols = Math.max(2, Math.ceil(Math.sqrt(sorted.length)))
  return sorted.map((node, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    return {
      ...node,
      layoutSize: estimateNodeSize(node),
      position: {
        x: col * (DEFAULT_NODE_SIZE.w + INTERNAL_GAP_X),
        y: row * (DEFAULT_NODE_SIZE.h + INTERNAL_GAP_Y),
      },
    }
  })
}

function applyDirectedLayout(nodes: LayoutPlanNode[], edges: LayoutPlanEdge[]): SizedNode[] | null {
  if (!edges.length || nodes.length <= 1) return null

  const nodeIds = new Set(nodes.map((node) => node.clientId))
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const reverseAdjacency = new Map<string, string[]>()
  const levels = new Map<string, number>()

  for (const node of nodes) {
    inDegree.set(node.clientId, 0)
    adjacency.set(node.clientId, [])
    reverseAdjacency.set(node.clientId, [])
    levels.set(node.clientId, 0)
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceClientId) || !nodeIds.has(edge.targetClientId)) continue
    adjacency.get(edge.sourceClientId)?.push(edge.targetClientId)
    reverseAdjacency.get(edge.targetClientId)?.push(edge.sourceClientId)
    inDegree.set(edge.targetClientId, (inDegree.get(edge.targetClientId) ?? 0) + 1)
  }

  const queue = nodes.filter((node) => (inDegree.get(node.clientId) ?? 0) === 0).map((node) => node.clientId)
  if (!queue.length) return null

  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    const currentLevel = levels.get(current) ?? 0
    for (const next of adjacency.get(current) ?? []) {
      levels.set(next, Math.max(levels.get(next) ?? 0, currentLevel + 1))
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      if ((inDegree.get(next) ?? 0) === 0) queue.push(next)
    }
  }

  if (visited.size !== nodes.length) return null

  const columns = new Map<number, LayoutPlanNode[]>()
  for (const node of [...nodes].sort(comparePlanNodes)) {
    const level = levels.get(node.clientId) ?? 0
    const list = columns.get(level) ?? []
    list.push(node)
    columns.set(level, list)
  }

  const rowById = new Map<string, number>()
  const barycenter = (ids: string[]): number => {
    const rows = ids.map((id) => rowById.get(id)).filter((value): value is number => typeof value === 'number')
    if (!rows.length) return Number.POSITIVE_INFINITY
    return rows.reduce((sum, value) => sum + value, 0) / rows.length
  }

  const maxLevel = Math.max(...Array.from(levels.values()))
  for (let level = 0; level <= maxLevel; level += 1) {
    const current = [...(columns.get(level) ?? [])]
    current.sort((left, right) => {
      const leftPred = barycenter(reverseAdjacency.get(left.clientId) ?? [])
      const rightPred = barycenter(reverseAdjacency.get(right.clientId) ?? [])
      if (Number.isFinite(leftPred) || Number.isFinite(rightPred)) {
        const delta = leftPred - rightPred
        if (Math.abs(delta) > 0.01) return delta
      }
      return comparePlanNodes(left, right)
    })
    current.forEach((node, index) => rowById.set(node.clientId, index))
    columns.set(level, current)
  }

  const sizedNodes = nodes.map((node) => ({ ...node, layoutSize: estimateNodeSize(node) }))
  const sizedById = new Map(sizedNodes.map((node) => [node.clientId, node] as const))
  const rowHeights = new Map<number, number>()
  for (const row of rowById.values()) {
    rowHeights.set(row, 0)
  }
  for (const node of sizedNodes) {
    const row = rowById.get(node.clientId) ?? 0
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, node.layoutSize.h))
  }
  const rowOffsets = new Map<number, number>()
  let cursorY = 0
  const maxRow = Math.max(...Array.from(rowHeights.keys()))
  for (let row = 0; row <= maxRow; row += 1) {
    rowOffsets.set(row, cursorY)
    cursorY += (rowHeights.get(row) ?? DEFAULT_NODE_SIZE.h) + INTERNAL_GAP_Y
  }

  const levelWidths = new Map<number, number>()
  for (let level = 0; level <= maxLevel; level += 1) {
    const width = Math.max(...(columns.get(level) ?? []).map((node) => sizedById.get(node.clientId)?.layoutSize.w ?? DEFAULT_NODE_SIZE.w), DEFAULT_NODE_SIZE.w)
    levelWidths.set(level, width)
  }
  const levelOffsets = new Map<number, number>()
  let cursorX = 0
  for (let level = 0; level <= maxLevel; level += 1) {
    levelOffsets.set(level, cursorX)
    cursorX += (levelWidths.get(level) ?? DEFAULT_NODE_SIZE.w) + INTERNAL_GAP_X
  }

  return sizedNodes.map((node) => {
    const level = levels.get(node.clientId) ?? 0
    const row = rowById.get(node.clientId) ?? 0
    return {
      ...node,
      position: {
        x: levelOffsets.get(level) ?? 0,
        y: rowOffsets.get(row) ?? 0,
      },
    }
  })
}

function applyColumnLayout(nodes: LayoutPlanNode[]): SizedNode[] {
  const sorted = [...nodes].sort(comparePlanNodes)
  let cursorY = 0
  return sorted.map((node) => {
    const layoutSize = estimateNodeSize(node)
    const positioned: SizedNode = {
      ...node,
      layoutSize,
      position: { x: 0, y: cursorY },
    }
    cursorY += layoutSize.h + INTERNAL_GAP_Y
    return positioned
  })
}

function applyStoryboardStripLayout(nodes: LayoutPlanNode[]): SizedNode[] {
  const sorted = [...nodes].sort(comparePlanNodes)
  let cursorX = 0
  let maxHeight = 0
  return sorted.map((node) => {
    const layoutSize = estimateNodeSize(node)
    maxHeight = Math.max(maxHeight, layoutSize.h)
    const positioned: SizedNode = {
      ...node,
      layoutSize,
      position: { x: cursorX, y: 0 },
    }
    cursorX += layoutSize.w + INTERNAL_GAP_X
    return positioned
  }).map((node) => ({
    ...node,
    position: { x: Number(node.position?.x ?? 0), y: Math.max(0, (maxHeight - node.layoutSize.h) / 2) },
  }))
}

function applyHybridLaneLayout(nodes: LayoutPlanNode[]): SizedNode[] {
  const inputs = nodes.filter((node) => getNodePriority(node) === 0)
  const middles = nodes.filter((node) => getNodePriority(node) === 1)
  const outputs = nodes.filter((node) => getNodePriority(node) === 2)
  const lanes = [inputs, middles, outputs].filter((lane) => lane.length > 0)
  let cursorX = 0
  const positioned: SizedNode[] = []
  for (const lane of lanes) {
    let cursorY = 0
    let laneWidth = 0
    for (const node of lane.sort(comparePlanNodes)) {
      const layoutSize = estimateNodeSize(node)
      laneWidth = Math.max(laneWidth, layoutSize.w)
      positioned.push({
        ...node,
        layoutSize,
        position: { x: cursorX, y: cursorY },
      })
      cursorY += layoutSize.h + INTERNAL_GAP_Y
    }
    cursorX += laneWidth + INTERNAL_GAP_X
  }
  return positioned
}

function layoutGroupNodes(nodes: LayoutPlanNode[], edges: LayoutPlanEdge[]): SizedNode[] {
  const kinds = nodes.map(getNodeKind)
  const allTextual = kinds.every((kind) => PLAN_TEXTUAL_KINDS.has(kind))
  const allStoryboardShots = false
  if (allTextual) return applyColumnLayout(nodes)
  if (allStoryboardShots) return applyStoryboardStripLayout(nodes)
  return applyDirectedLayout(nodes, edges) ?? applyHybridLaneLayout(nodes)
}

function buildWeaklyConnectedGroups(plan: LayoutPlan): LayoutPlanGroup[] {
  const nodeIds = new Set(plan.nodes.map((node) => node.clientId))
  const explicitKeys = plan.nodes.map(getGroupKey).filter(Boolean)
  if (explicitKeys.length > 0) {
    const grouped = new Map<string, LayoutPlanGroup>()
    const ungrouped: LayoutPlanNode[] = []
    for (const node of plan.nodes) {
      const key = getGroupKey(node)
      if (!key) {
        ungrouped.push(node)
        continue
      }
      const existing = grouped.get(key)
      if (existing) {
        existing.nodeClientIds.push(node.clientId)
        if (!existing.label && getGroupLabel(node)) existing.label = getGroupLabel(node)
      } else {
        grouped.set(key, {
          key,
          label: getGroupLabel(node) || key,
          nodeClientIds: [node.clientId],
        })
      }
    }
    for (const node of ungrouped) {
      grouped.set(node.clientId, {
        key: node.clientId,
        label: node.label,
        nodeClientIds: [node.clientId],
      })
    }
    return Array.from(grouped.values())
  }

  const adjacency = new Map<string, Set<string>>()
  for (const node of plan.nodes) {
    adjacency.set(node.clientId, new Set())
  }
  for (const edge of plan.edges ?? []) {
    if (!nodeIds.has(edge.sourceClientId) || !nodeIds.has(edge.targetClientId)) continue
    adjacency.get(edge.sourceClientId)?.add(edge.targetClientId)
    adjacency.get(edge.targetClientId)?.add(edge.sourceClientId)
  }

  const visited = new Set<string>()
  const groups: LayoutPlanGroup[] = []
  for (const node of plan.nodes) {
    if (visited.has(node.clientId)) continue
    const queue = [node.clientId]
    const ids: string[] = []
    while (queue.length) {
      const current = queue.shift()
      if (!current || visited.has(current)) continue
      visited.add(current)
      ids.push(current)
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next)
      }
    }
    groups.push({
      key: ids[0] || node.clientId,
      label: ids.length > 1 ? `${node.label} 工作流` : node.label,
      nodeClientIds: ids,
    })
  }
  return groups
}

function toRect(node: SizedNode): LayoutRect {
  return {
    x: Number(node.position?.x ?? 0),
    y: Number(node.position?.y ?? 0),
    w: node.layoutSize.w,
    h: node.layoutSize.h,
  }
}

function unionRects(rects: LayoutRect[]): LayoutRect {
  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function inflateRect(rect: LayoutRect, dx: number, dy: number): LayoutRect {
  return { x: rect.x - dx, y: rect.y - dy, w: rect.w + dx * 2, h: rect.h + dy * 2 }
}

function rectsOverlap(left: LayoutRect, right: LayoutRect): boolean {
  return !(left.x + left.w <= right.x || right.x + right.w <= left.x || left.y + left.h <= right.y || right.y + right.h <= left.y)
}

function collectOccupiedRects(existingNodes: Node[]): LayoutRect[] {
  const nodesById = new Map(existingNodes.map((node) => [node.id, node] as const))
  return existingNodes
    .filter((node) => {
      const parentId = typeof (node as { parentId?: string }).parentId === 'string' ? (node as { parentId?: string }).parentId?.trim() : ''
      if (node.type === 'groupNode') return true
      return !parentId
    })
    .map((node) => getNodeAbsRect(node, nodesById))
}

function findAvailableOrigin(preferred: LayoutPlanPosition, size: { w: number; h: number }, occupiedRects: LayoutRect[]): LayoutPlanPosition {
  const strideX = Math.max(240, size.w + GROUP_GAP_X)
  const strideY = Math.max(180, size.h + GROUP_GAP_Y)
  for (let row = 0; row < 24; row += 1) {
    for (let col = 0; col < 24; col += 1) {
      const candidate = {
        x: preferred.x + col * strideX,
        y: preferred.y + row * strideY,
      }
      const candidateRect = inflateRect({ x: candidate.x, y: candidate.y, w: size.w, h: size.h }, GROUP_OUTER_PADDING, GROUP_OUTER_PADDING)
      const blocked = occupiedRects.some((rect) => rectsOverlap(candidateRect, inflateRect(rect, GROUP_GAP_X / 2, GROUP_GAP_Y / 2)))
      if (!blocked) return candidate
    }
  }
  return preferred
}

function buildPositionedGroup(plan: LayoutPlan, group: LayoutPlanGroup): PositionedGroup {
  const nodeIds = new Set(group.nodeClientIds)
  const nodes = plan.nodes.filter((node) => nodeIds.has(node.clientId))
  const edges = (plan.edges ?? []).filter((edge) => nodeIds.has(edge.sourceClientId) && nodeIds.has(edge.targetClientId))
  const laidOutNodes = layoutGroupNodes(nodes, edges)
  const groupRect = unionRects(laidOutNodes.map(toRect))
  return {
    key: group.key,
    label: group.label,
    nodes: laidOutNodes,
    edges,
    rect: {
      x: 0,
      y: 0,
      w: groupRect.w + GROUP_OUTER_PADDING * 2,
      h: groupRect.h + GROUP_OUTER_PADDING * 2,
    },
  }
}

function buildGroupLevelEdges(input: {
  plan: LayoutPlan
  groups: PositionedGroup[]
}): LayoutPlanEdge[] {
  const nodeIdToGroupKey = new Map<string, string>()
  for (const group of input.groups) {
    for (const node of group.nodes) {
      nodeIdToGroupKey.set(node.clientId, group.key)
    }
  }

  const dedup = new Set<string>()
  const edges: LayoutPlanEdge[] = []
  for (const edge of input.plan.edges ?? []) {
    const sourceGroupKey = nodeIdToGroupKey.get(edge.sourceClientId) || ''
    const targetGroupKey = nodeIdToGroupKey.get(edge.targetClientId) || ''
    if (!sourceGroupKey || !targetGroupKey || sourceGroupKey === targetGroupKey) continue
    const dedupKey = `${sourceGroupKey}=>${targetGroupKey}`
    if (dedup.has(dedupKey)) continue
    dedup.add(dedupKey)
    edges.push({
      sourceClientId: sourceGroupKey,
      targetClientId: targetGroupKey,
    })
  }
  return edges
}

function resolveDirectedGroupOrigins(input: {
  groups: PositionedGroup[]
  plan: LayoutPlan
  anchor: LayoutPlanPosition
}): Map<string, LayoutPlanPosition> | null {
  if (input.groups.length <= 1) return null

  const items: GroupLevelLayoutItem[] = input.groups.map((group) => ({
    key: group.key,
    width: group.rect.w,
    height: group.rect.h,
  }))
  const groupIds = new Set(items.map((item) => item.key))
  const edges = buildGroupLevelEdges({
    plan: input.plan,
    groups: input.groups,
  }).filter((edge) => groupIds.has(edge.sourceClientId) && groupIds.has(edge.targetClientId))

  if (!edges.length) return null

  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const reverseAdjacency = new Map<string, string[]>()
  const levels = new Map<string, number>()

  for (const item of items) {
    inDegree.set(item.key, 0)
    adjacency.set(item.key, [])
    reverseAdjacency.set(item.key, [])
    levels.set(item.key, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceClientId)?.push(edge.targetClientId)
    reverseAdjacency.get(edge.targetClientId)?.push(edge.sourceClientId)
    inDegree.set(edge.targetClientId, (inDegree.get(edge.targetClientId) ?? 0) + 1)
  }

  const queue = items
    .filter((item) => (inDegree.get(item.key) ?? 0) === 0)
    .map((item) => item.key)
  if (!queue.length) return null

  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    const currentLevel = levels.get(current) ?? 0
    for (const next of adjacency.get(current) ?? []) {
      levels.set(next, Math.max(levels.get(next) ?? 0, currentLevel + 1))
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      if ((inDegree.get(next) ?? 0) === 0) queue.push(next)
    }
  }

  if (visited.size !== items.length) return null

  const columns = new Map<number, GroupLevelLayoutItem[]>()
  const compareItems = (left: GroupLevelLayoutItem, right: GroupLevelLayoutItem) => left.key.localeCompare(right.key)
  for (const item of [...items].sort(compareItems)) {
    const level = levels.get(item.key) ?? 0
    const list = columns.get(level) ?? []
    list.push(item)
    columns.set(level, list)
  }

  const rowById = new Map<string, number>()
  const barycenter = (ids: string[]): number => {
    const rows = ids.map((id) => rowById.get(id)).filter((value): value is number => typeof value === 'number')
    if (!rows.length) return Number.POSITIVE_INFINITY
    return rows.reduce((sum, value) => sum + value, 0) / rows.length
  }

  const maxLevel = Math.max(...Array.from(levels.values()))
  for (let level = 0; level <= maxLevel; level += 1) {
    const current = [...(columns.get(level) ?? [])]
    current.sort((left, right) => {
      const leftPred = barycenter(reverseAdjacency.get(left.key) ?? [])
      const rightPred = barycenter(reverseAdjacency.get(right.key) ?? [])
      if (Number.isFinite(leftPred) || Number.isFinite(rightPred)) {
        const delta = leftPred - rightPred
        if (Math.abs(delta) > 0.01) return delta
      }
      return compareItems(left, right)
    })
    current.forEach((item, row) => rowById.set(item.key, row))
    columns.set(level, current)
  }

  const rowHeights = new Map<number, number>()
  for (const item of items) {
    const row = rowById.get(item.key) ?? 0
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, item.height))
  }

  const rowOffsets = new Map<number, number>()
  let cursorY = input.anchor.y
  const maxRow = Math.max(...Array.from(rowHeights.keys()))
  for (let row = 0; row <= maxRow; row += 1) {
    rowOffsets.set(row, cursorY)
    cursorY += (rowHeights.get(row) ?? DEFAULT_NODE_SIZE.h) + GROUP_GAP_Y
  }

  const levelWidths = new Map<number, number>()
  for (let level = 0; level <= maxLevel; level += 1) {
    const width = Math.max(...(columns.get(level) ?? []).map((item) => item.width), DEFAULT_NODE_SIZE.w)
    levelWidths.set(level, width)
  }

  const levelOffsets = new Map<number, number>()
  let cursorX = input.anchor.x
  for (let level = 0; level <= maxLevel; level += 1) {
    levelOffsets.set(level, cursorX)
    cursorX += (levelWidths.get(level) ?? DEFAULT_NODE_SIZE.w) + GROUP_GAP_X
  }

  const origins = new Map<string, LayoutPlanPosition>()
  for (const item of items) {
    const level = levels.get(item.key) ?? 0
    const row = rowById.get(item.key) ?? 0
    origins.set(item.key, {
      x: levelOffsets.get(level) ?? input.anchor.x,
      y: rowOffsets.get(row) ?? input.anchor.y,
    })
  }
  return origins
}

export function resolveCanvasPlanLayout(input: {
  plan: LayoutPlan
  existingNodes: Node[]
  anchor: LayoutPlanPosition
}): { plan: LayoutPlan; groups: LayoutPlanGroup[]; usesDirectedGroupLayout: boolean } {
  const groups = buildWeaklyConnectedGroups(input.plan)
  const positionedGroups = groups.map((group) => buildPositionedGroup(input.plan, group))
  const occupiedRects = collectOccupiedRects(input.existingNodes)
  const placedRects: LayoutRect[] = [...occupiedRects]
  let preferred = { ...input.anchor }
  const directedOrigins = resolveDirectedGroupOrigins({
    groups: positionedGroups,
    plan: input.plan,
    anchor: input.anchor,
  })

  const positionedNodes = new Map<string, LayoutPlanNode>()
  const groupResults: LayoutPlanGroup[] = []

  for (const group of positionedGroups) {
    const preferredOrigin = directedOrigins?.get(group.key) ?? preferred
    const origin = findAvailableOrigin(preferredOrigin, { w: group.rect.w, h: group.rect.h }, placedRects)
    for (const node of group.nodes) {
      positionedNodes.set(node.clientId, {
        ...node,
        position: {
          x: origin.x + GROUP_OUTER_PADDING + Number(node.position?.x ?? 0),
          y: origin.y + GROUP_OUTER_PADDING + Number(node.position?.y ?? 0),
        },
      })
    }
    const placed = { x: origin.x, y: origin.y, w: group.rect.w, h: group.rect.h }
    placedRects.push(placed)
    preferred = directedOrigins
      ? { x: preferredOrigin.x + group.rect.w + GROUP_GAP_X, y: input.anchor.y }
      : { x: origin.x + group.rect.w + GROUP_GAP_X, y: input.anchor.y }
    groupResults.push({
      key: group.key,
      label: group.label,
      nodeClientIds: group.nodes.map((node) => node.clientId),
    })
  }

  const finalNodes = input.plan.nodes.map((node) => positionedNodes.get(node.clientId) ?? node)
  return {
    plan: {
      ...input.plan,
      nodes: finalNodes,
    },
    groups: groupResults,
    usesDirectedGroupLayout: Boolean(directedOrigins),
  }
}
