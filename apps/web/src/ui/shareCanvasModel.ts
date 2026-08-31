import type { Edge, Node } from '@xyflow/react'
import type { FlowDto, ProjectDto } from '../api/server'

const SHARE_GROUP_PADDING = 24
const SHARE_GROUP_MIN_WIDTH = 240
const SHARE_GROUP_MIN_HEIGHT = 160

type CanvasNodeData = Record<string, unknown>
type ReadonlyCanvasNode = Node<CanvasNodeData>
type ReadonlyCanvasEdge = Edge<Record<string, unknown>>

export type SharePromptEntry = {
  id: string
  label: string
  items: Array<{ label: string; value: string }>
}

export function pickInitialPublicFlowId(flows: readonly FlowDto[]): string | null {
  const populated = flows.find((flow) => flow.data.nodes.length > 0 || flow.data.edges.length > 0)
  return populated?.id ?? flows[0]?.id ?? null
}

export function buildSharePath(input: {
  projectId?: string | null
  flowId?: string | null
}): string {
  const base = input.projectId
    ? input.flowId
      ? `/share/${encodeURIComponent(input.projectId)}/${encodeURIComponent(input.flowId)}`
      : `/share/${encodeURIComponent(input.projectId)}`
    : '/share'
  return base
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function readNodeSize(node: ReadonlyCanvasNode): { width: number; height: number } {
  const data = node.data
  const width = toFiniteNumber(node.width)
    ?? toFiniteNumber(node.style?.width)
    ?? toFiniteNumber(data.nodeWidth)
  const height = toFiniteNumber(node.height)
    ?? toFiniteNumber(node.style?.height)
    ?? toFiniteNumber(data.nodeHeight)
  const fallback = node.type === 'groupNode'
    ? { width: SHARE_GROUP_MIN_WIDTH, height: SHARE_GROUP_MIN_HEIGHT }
    : node.type === 'ioNode'
      ? { width: 88, height: 40 }
      : { width: 120, height: 210 }
  return {
    width: Math.max(24, width ?? fallback.width),
    height: Math.max(24, height ?? fallback.height),
  }
}

function getGroupDepth(groupId: string, nodesById: Map<string, ReadonlyCanvasNode>): number {
  let depth = 0
  let current = nodesById.get(groupId)
  while (current) {
    const parentId = typeof current.parentId === 'string' ? current.parentId.trim() : ''
    if (!parentId) break
    const parent = nodesById.get(parentId)
    if (!parent || parent.type !== 'groupNode') break
    depth += 1
    current = parent
  }
  return depth
}

function normalizeReadonlyGroupLayout(rawNodes: ReadonlyCanvasNode[]): ReadonlyCanvasNode[] {
  let nodes = rawNodes.map((node) => ({ ...node }))
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    const groupIds = nodes
      .filter((node) => node.type === 'groupNode')
      .map((node) => node.id)
      .sort((left, right) => getGroupDepth(right, nodesById) - getGroupDepth(left, nodesById))

    if (groupIds.length === 0) break

    for (const groupId of groupIds) {
      const group = nodesById.get(groupId)
      if (!group) continue
      const children = nodes.filter((node) => node.parentId === groupId)
      if (children.length === 0) continue

      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const child of children) {
        const { width, height } = readNodeSize(child)
        minX = Math.min(minX, child.position.x)
        minY = Math.min(minY, child.position.y)
        maxX = Math.max(maxX, child.position.x + width)
        maxY = Math.max(maxY, child.position.y + height)
      }
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue

      const offsetX = minX < SHARE_GROUP_PADDING ? SHARE_GROUP_PADDING - minX : 0
      const offsetY = minY < SHARE_GROUP_PADDING ? SHARE_GROUP_PADDING - minY : 0
      if (offsetX > 0 || offsetY > 0) {
        nodes = nodes.map((node) => node.parentId === groupId
          ? {
            ...node,
            position: {
              x: node.position.x + offsetX,
              y: node.position.y + offsetY,
            },
          }
          : node)
        changed = true
      }

      const desiredWidth = Math.max(SHARE_GROUP_MIN_WIDTH, Math.ceil(maxX + offsetX + SHARE_GROUP_PADDING))
      const desiredHeight = Math.max(SHARE_GROUP_MIN_HEIGHT, Math.ceil(maxY + offsetY + SHARE_GROUP_PADDING))
      const currentSize = readNodeSize(group)
      if (desiredWidth > currentSize.width + 0.1 || desiredHeight > currentSize.height + 0.1) {
        nodes = nodes.map((node) => node.id === groupId
          ? {
            ...node,
            width: desiredWidth,
            height: desiredHeight,
            style: { ...node.style, width: desiredWidth, height: desiredHeight },
            data: { ...node.data, nodeWidth: desiredWidth, nodeHeight: desiredHeight },
          }
          : node)
        changed = true
      }
    }
    if (!changed) break
  }
  return nodes
}

export function sanitizeReadonlyGraph(payload: {
  nodes: ReadonlyCanvasNode[]
  edges: ReadonlyCanvasEdge[]
}): { nodes: ReadonlyCanvasNode[]; edges: ReadonlyCanvasEdge[] } {
  const nodes = normalizeReadonlyGroupLayout(payload.nodes).map((node) => ({
    ...node,
    selected: false,
    dragging: false,
    draggable: false,
    selectable: false,
    focusable: false,
    connectable: false,
  }))
  const edges = payload.edges.map((edge) => ({
    ...edge,
    selected: false,
    selectable: false,
    focusable: false,
  }))
  return { nodes, edges }
}

function readText(data: CanvasNodeData, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function listSharePromptEntries(flow: FlowDto | null): SharePromptEntry[] {
  if (!flow) return []
  return flow.data.nodes.flatMap((node): SharePromptEntry[] => {
    const data = node.data && typeof node.data === 'object'
      ? node.data as CanvasNodeData
      : {}
    const label = readText(data, 'label') || readText(data, 'name') || node.id || '未命名节点'
    const items: SharePromptEntry['items'] = []
    const prompt = readText(data, 'prompt')
    const systemPrompt = readText(data, 'systemPrompt')
    const storyboard = readText(data, 'storyboard')
    if (prompt) items.push({ label: '提示词', value: prompt })
    if (systemPrompt) items.push({ label: '系统提示词', value: systemPrompt })
    if (storyboard && storyboard !== prompt) items.push({ label: '分镜脚本', value: storyboard })
    return items.length > 0 ? [{ id: node.id || label, label, items }] : []
  })
}

export function canCopySharedProject(project: ProjectDto | null, authToken: string | null): boolean {
  return project?.isPublic === true && Boolean(authToken)
}
