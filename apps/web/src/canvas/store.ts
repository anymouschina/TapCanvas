import { create } from 'zustand'
import type { Edge, Node, OnConnect, OnEdgesChange, OnNodesChange, Connection } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { runNodeMock } from '../runner/mockRunner'
import { runNodeDagToTarget } from '../runner/dag'
import { runFlowDag } from '../runner/dag'
import { getTaskNodeCoreType, getTaskNodeSchema, normalizeTaskNodeKind } from './nodes/taskNodeSchema'
import { formatErrorMessage } from './utils/formatErrorMessage'
import { getNodeAbsPosition, getNodeSize } from './utils/nodeBounds'
import type { NodeRect, NodeSize, XY } from './utils/nodeBounds'
import { validateWorkflowIoForRun } from './workflowIo'
import { normalizeWorkflowEdgeMeta, normalizeWorkflowNodeMeta } from './workflowMeta'
import { normalizeProductionNodeMeta, normalizeProductionNodeMetaRecord } from './productionMeta'
import { sanitizeFlowValueForPersistence } from './utils/persistenceSanitizer'
import { useUIStore } from '../ui/uiStore'
import { extractCanvasGraph, type CanvasImportData, type SerializedCanvas } from './utils/serialization'
import { normalizeStoryboardNodeData } from './nodes/taskNode/storyboardEditor'
import { getDefaultModel } from '../config/models'
import { buildVideoDurationPatch, readVideoDurationSeconds } from '../utils/videoDuration'

type GroupArrangeDirection = 'grid' | 'column' | 'flow'

type RFState = {
  nodes: Node[]
  edges: Edge[]
  nextId: number
  nextGroupId: number
  lastGroupArrangeDirection: GroupArrangeDirection
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
  setNodeStatus: (id: string, status: 'idle'|'queued'|'running'|'success'|'error', patch?: Record<string, unknown>) => void
  appendLog: (id: string, line: string) => void
  beginRunToken: (id: string) => string
  endRunToken: (id: string) => void
  cancelNode: (id: string) => void
  isCanceled: (id: string, runToken?: string | null) => boolean
  deleteNode: (id: string) => void
  deleteEdge: (id: string) => void
  reorderEdgeForTarget: (edgeId: string, direction: 'left' | 'right') => void
  duplicateNode: (id: string) => void
  pasteFromClipboardAt: (pos: { x: number; y: number }) => void
  importWorkflow: (workflowData: CanvasImportData | SerializedCanvas | null | undefined, position?: { x: number; y: number }) => void
  selectAll: () => void
  clearSelection: () => void
  invertSelection: () => void
  // group actions (parentId-based model)
  addGroupForSelection: (name?: string) => void
  createGroupForNodeIds: (nodeIds: string[], name?: string, options?: { preserveLayout?: boolean }) => string | null
  fitGroupToChildren: (groupId: string, nodeIds?: string[]) => void
  createScriptBundleFromSelection: (name?: string) => void
  removeGroupById: (id: string) => void
  findGroupMatchingSelection: () => { id: string; name: string; nodeIds: string[] } | null
  renameGroup: (id: string, name: string) => void
  ungroupGroupNode: (id: string) => void
  arrangeGroupChildren: (groupId: string, direction: GroupArrangeDirection, nodeIds?: string[]) => void
  arrangeGroupChildrenByLastDirection: (groupId: string, nodeIds?: string[]) => void
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

function genRunToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID() as string
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function genGroupId(n: number) {
  return `g${n}`
}

function cloneGraph(nodes: Node[], edges: Edge[]) {
  const snapshot = { nodes, edges }
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot) as { nodes: Node[]; edges: Edge[] }
  }
  return JSON.parse(JSON.stringify(snapshot)) as { nodes: Node[]; edges: Edge[] }
}

function computeNextGroupId(nodes: Node[]): number {
  let maxId = 0
  for (const node of nodes) {
    if (!node || node.type !== 'groupNode') continue
    const rawId = typeof node.id === 'string' ? node.id : ''
    const match = /^g(\d+)$/.exec(rawId)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value)) maxId = Math.max(maxId, value)
  }
  return maxId + 1
}

const SCRIPT_BUNDLE_KINDS = new Set(['text'])

function getNodeDataRecord(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

function getNodeTextField(node: Node, key: string): string {
  const value = getNodeDataRecord(node)[key]
  return typeof value === 'string' ? value.trim() : ''
}

function getScriptBundleNodeContent(node: Node): string {
  const prompt = getNodeTextField(node, 'prompt')
  if (prompt) return prompt
  const text = getNodeTextField(node, 'text')
  if (text) return text
  return ''
}

function escapeScriptBundleHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function convertScriptBundlePlainTextToHtml(value: string): string {
  return value
    .split('\n')
    .map((line) => `<p>${escapeScriptBundleHtml(line)}</p>`)
    .join('')
}

function stripBundleLabelPrefix(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return ''
  const parts = trimmed.split('｜')
  return parts.length > 1 ? parts.slice(1).join('｜').trim() : trimmed
}

function compareNodesByCanvasPosition(left: Node, right: Node, nodesById: Map<string, Node>): number {
  const leftPos = getNodeAbsPosition(left, nodesById)
  const rightPos = getNodeAbsPosition(right, nodesById)
  if (leftPos.y !== rightPos.y) return leftPos.y - rightPos.y
  if (leftPos.x !== rightPos.x) return leftPos.x - rightPos.x
  return String(getNodeDataRecord(left).label || left.id).localeCompare(String(getNodeDataRecord(right).label || right.id))
}

function compareNodesByHorizontalPriority(left: Node, right: Node, nodesById: Map<string, Node>): number {
  const leftPos = getNodeAbsPosition(left, nodesById)
  const rightPos = getNodeAbsPosition(right, nodesById)
  if (leftPos.x !== rightPos.x) return leftPos.x - rightPos.x
  if (leftPos.y !== rightPos.y) return leftPos.y - rightPos.y
  return String(getNodeDataRecord(left).label || left.id).localeCompare(String(getNodeDataRecord(right).label || right.id))
}

function orderScriptBundleNodes(nodes: Node[], edges: Edge[]): Node[] {
  const selectedIds = new Set(nodes.map((node) => node.id))
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()

  for (const node of nodes) {
    adjacency.set(node.id, [])
    indegree.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!selectedIds.has(edge.source) || !selectedIds.has(edge.target)) continue
    adjacency.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
  }

  const pending = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort((left, right) => compareNodesByCanvasPosition(left, right, nodesById))
  const ordered: Node[] = []

  while (pending.length > 0) {
    const current = pending.shift()
    if (!current) break
    ordered.push(current)
    const nextIds = adjacency.get(current.id) || []
    for (const nextId of nextIds) {
      const nextDegree = (indegree.get(nextId) || 0) - 1
      indegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        const nextNode = nodesById.get(nextId)
        if (nextNode) {
          pending.push(nextNode)
          pending.sort((left, right) => compareNodesByCanvasPosition(left, right, nodesById))
        }
      }
    }
  }

  if (ordered.length === nodes.length) return ordered

  const remaining = nodes
    .filter((node) => !ordered.some((item) => item.id === node.id))
    .sort((left, right) => compareNodesByCanvasPosition(left, right, nodesById))
  return [...ordered, ...remaining]
}

function buildScriptBundleLabel(nodes: Node[]): string {
  const labels = nodes
    .map((node) => getNodeTextField(node, 'label'))
    .filter(Boolean)
  if (!labels.length) return '脚本合集'
  const prefixParts = labels.map((label) => label.split('｜')[0]?.trim() || '')
  const sharedPrefix = prefixParts.every((item) => item && item === prefixParts[0]) ? prefixParts[0] : ''
  return sharedPrefix ? `${sharedPrefix}｜合集` : '脚本合集'
}

function buildScriptBundlePrompt(nodes: Node[]): string {
  return nodes
    .map((node) => {
      const label = stripBundleLabelPrefix(getNodeTextField(node, 'label')) || getNodeTextField(node, 'label') || '未命名段落'
      const content = getScriptBundleNodeContent(node)
      return `## ${label}\n${content}`.trim()
    })
    .filter(Boolean)
    .join('\n\n')
}

function getTaskNodeHandles(node: Node): { targets: Set<string>; sources: Set<string> } | null {
  if (!node || node.type !== 'taskNode') return null
  const data = (node as { data?: Record<string, unknown> }).data
  const kind = typeof data?.kind === 'string' ? data.kind : null
  const schema = getTaskNodeSchema(kind)
  const handles = schema.handles
  if (!handles || (typeof handles === 'object' && 'dynamic' in handles && handles.dynamic)) {
    return null
  }
  const targets = Array.isArray(handles.targets) ? handles.targets : []
  const sources = Array.isArray(handles.sources) ? handles.sources : []
  const targetIds = new Set<string>(targets.map((h) => String(h.id || '').trim()).filter(Boolean))
  const sourceIds = new Set<string>(sources.map((h) => String(h.id || '').trim()).filter(Boolean))
  const defaultInputType = String(targets[0]?.type || 'any').trim() || 'any'
  const defaultOutputType = String(sources[0]?.type || 'any').trim() || 'any'
  targetIds.add(`in-${defaultInputType}-wide`)
  sourceIds.add(`out-${defaultOutputType}-wide`)
  return { targets: targetIds, sources: sourceIds }
}

function pickLegacyCompatibleHandle(
  knownHandles: Set<string>,
  prefix: 'in-' | 'out-',
): string | null {
  const wideHandle = Array.from(knownHandles).find((handleId) => handleId.startsWith(prefix) && handleId.endsWith('-wide'))
  if (wideHandle) return wideHandle
  const firstKnown = Array.from(knownHandles).find((handleId) => handleId.startsWith(prefix))
  return firstKnown ?? null
}

function normalizeLegacyImportedEdgeHandle(
  handleId: string,
  known: { targets: Set<string>; sources: Set<string> } | null,
  direction: 'source' | 'target',
): string {
  const trimmed = handleId.trim()
  if (!trimmed || !known) return trimmed

  const handleSet = direction === 'source' ? known.sources : known.targets
  if (handleSet.has(trimmed)) return trimmed

  if (direction === 'source' && (trimmed === 'right' || trimmed === 'bottom' || trimmed === 'source')) {
    return pickLegacyCompatibleHandle(known.sources, 'out-') ?? trimmed
  }

  if (direction === 'target' && (trimmed === 'left' || trimmed === 'top' || trimmed === 'target')) {
    return pickLegacyCompatibleHandle(known.targets, 'in-') ?? trimmed
  }

  return trimmed
}

function normalizeImportedEdgeHandles(nodes: Node[], edges: Edge[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  return (Array.isArray(edges) ? edges : []).map((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    const sourceKnown = sourceNode ? getTaskNodeHandles(sourceNode) : null
    const targetKnown = targetNode ? getTaskNodeHandles(targetNode) : null
    const nextSourceHandle =
      typeof edge.sourceHandle === 'string'
        ? normalizeLegacyImportedEdgeHandle(edge.sourceHandle, sourceKnown, 'source')
        : edge.sourceHandle
    const nextTargetHandle =
      typeof edge.targetHandle === 'string'
        ? normalizeLegacyImportedEdgeHandle(edge.targetHandle, targetKnown, 'target')
        : edge.targetHandle
    const targetKind =
      targetNode && targetNode.type === 'taskNode'
        ? getTaskNodeCoreType(typeof (targetNode.data as Record<string, unknown> | undefined)?.kind === 'string' ? String((targetNode.data as Record<string, unknown>).kind) : null)
        : null
    const normalizedTargetHandle =
      targetKind === 'video' &&
      typeof nextTargetHandle === 'string' &&
      (nextTargetHandle === 'in-image' || nextTargetHandle === 'in-video')
        ? 'in-any'
        : nextTargetHandle

    if (nextSourceHandle === edge.sourceHandle && normalizedTargetHandle === edge.targetHandle) return edge

    return {
      ...edge,
      ...(typeof nextSourceHandle === 'string' ? { sourceHandle: nextSourceHandle } : {}),
      ...(typeof normalizedTargetHandle === 'string' ? { targetHandle: normalizedTargetHandle } : {}),
    }
  })
}

function sanitizeEdgesForNodes(nodes: Node[], edges: Edge[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  return (Array.isArray(edges) ? edges : []).filter((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) return false
    const sourceHandle = typeof edge.sourceHandle === 'string' ? edge.sourceHandle.trim() : ''
    const targetHandle = typeof edge.targetHandle === 'string' ? edge.targetHandle.trim() : ''
    const sourceKnown = getTaskNodeHandles(sourceNode)
    const targetKnown = getTaskNodeHandles(targetNode)
    if (sourceHandle && sourceKnown && !sourceKnown.sources.has(sourceHandle)) return false
    if (targetHandle && targetKnown && !targetKnown.targets.has(targetHandle)) return false
    return true
  })
}

function normalizeImportedNodeType(node: Node): Node {
  if (node.type !== 'group') return node
  return { ...node, type: 'groupNode' }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFirstString(values: unknown[]): string {
  for (const value of values) {
    const trimmed = readTrimmedString(value)
    if (trimmed) return trimmed
  }
  return ''
}

function readStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => readTrimmedString(item))
    .filter(Boolean)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCoordinateExtentLike(
  value: unknown,
): value is [[number, number], [number, number]] {
  if (!Array.isArray(value) || value.length !== 2) return false
  const first = value[0]
  const second = value[1]
  if (!Array.isArray(first) || first.length !== 2) return false
  if (!Array.isArray(second) || second.length !== 2) return false
  return isFiniteNumber(first[0]) && isFiniteNumber(first[1]) && isFiniteNumber(second[0]) && isFiniteNumber(second[1])
}

function normalizeImportedNodeShape(node: Node): Node {
  const rawSourcePosition = typeof node.sourcePosition === 'string' ? node.sourcePosition.trim() : ''
  const rawTargetPosition = typeof node.targetPosition === 'string' ? node.targetPosition.trim() : ''
  const extent = node.extent === 'parent' || isCoordinateExtentLike(node.extent) ? node.extent : undefined
  const positionX = isFiniteNumber(node.position?.x) ? node.position.x : 0
  const positionY = isFiniteNumber(node.position?.y) ? node.position.y : 0

  return {
    ...node,
    extent,
    position: { x: positionX, y: positionY },
    sourcePosition:
      rawSourcePosition === 'left' ||
      rawSourcePosition === 'right' ||
      rawSourcePosition === 'top' ||
      rawSourcePosition === 'bottom'
        ? node.sourcePosition
        : undefined,
    targetPosition:
      rawTargetPosition === 'left' ||
      rawTargetPosition === 'right' ||
      rawTargetPosition === 'top' ||
      rawTargetPosition === 'bottom'
        ? node.targetPosition
        : undefined,
  }
}

type ImportedAssetResult = { url: string; title?: string }

function normalizeImportedAssetResults(
  urls: string[],
  existing: unknown,
  fallbackTitle: string,
): ImportedAssetResult[] {
  const existingItems = Array.isArray(existing) ? existing : []
  const results: ImportedAssetResult[] = []
  const seen = new Set<string>()

  for (const item of existingItems) {
    const record = readRecord(item)
    const url = readFirstString([record?.url])
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = readFirstString([record?.title])
    results.push(title ? { url, title } : { url })
  }

  for (const [index, url] of urls.entries()) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push(index === 0 ? { url, title: fallbackTitle } : { url })
  }

  return results
}

function adaptImportedCanvasNode(node: Node): Node {
  if (node.type === 'groupNode' || node.type === 'taskNode' || node.type === 'ioNode') return node

  const externalType = readTrimmedString(node.type)
  if (!['image', 'video', 'text'].includes(externalType)) return node

  const data = getNodeDataRecord(node)
  const metadata = readRecord(data.__metadata)
  const label = readFirstString([data.label, data.title, node.id]) || node.id
  const prompt = readFirstString([data.prompt])
  const base = {
    ...node,
    type: 'taskNode' as const,
    data: {
      ...data,
      label,
      kind: externalType,
      prompt,
      nodeWidth: isFiniteNumber(node.measured?.width) ? node.measured.width : undefined,
      nodeHeight: isFiniteNumber(node.measured?.height) ? node.measured.height : undefined,
    },
  }

  if (externalType === 'image') {
    const urls = readStringArray(data.options)
    const primaryUrl = readFirstString([data.imageUrl, data.src, metadata?.url, urls[0]])
    const imageResults = normalizeImportedAssetResults(urls, data.imageResults, label)
    return {
      ...base,
      data: {
        ...base.data,
        imageUrl: primaryUrl || undefined,
        imageResults,
        imagePrimaryIndex: primaryUrl ? Math.max(0, imageResults.findIndex((item) => item.url === primaryUrl)) : 0,
      },
    }
  }

  if (externalType === 'video') {
    const urls = readStringArray(data.options)
    const primaryUrl = readFirstString([data.videoUrl, data.src, metadata?.url, urls[0]])
    const videoResults = normalizeImportedAssetResults(urls, data.videoResults, label)
    return {
      ...base,
      data: {
        ...base.data,
        videoUrl: primaryUrl || undefined,
        videoTitle: label,
        videoResults,
        videoPrimaryIndex: primaryUrl ? Math.max(0, videoResults.findIndex((item) => item.url === primaryUrl)) : 0,
      },
    }
  }

  const textValue = readFirstString([
    data.text,
    Array.isArray(data.textResults) && data.textResults.length > 0
      ? readRecord(data.textResults[data.textResults.length - 1])?.text
      : '',
    data.prompt,
  ])

  return {
    ...base,
    data: {
      ...base.data,
      prompt: textValue,
      textResults: textValue ? [{ text: textValue }] : [],
    },
  }
}

function normalizeImportedTaskTextNode(node: Node): Node {
  if (node.type !== 'taskNode') return node

  const data = getNodeDataRecord(node)
  const kind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  if (kind !== 'text') return node

  const prompt = readTrimmedString(data.prompt)
  const text = readTrimmedString(data.text)
  const latestTextResult =
    Array.isArray(data.textResults) && data.textResults.length > 0
      ? readTrimmedString(readRecord(data.textResults[data.textResults.length - 1])?.text)
      : ''
  const textValue = readFirstString([prompt, text, latestTextResult])

  const nextData: Record<string, unknown> = { ...data }
  let changed = false

  if (!prompt && textValue) {
    nextData.prompt = textValue
    changed = true
  }

  if ((!Array.isArray(data.textResults) || data.textResults.length === 0) && textValue) {
    nextData.textResults = [{ text: textValue }]
    changed = true
  }

  return changed ? { ...node, data: nextData } : node
}

export function sanitizeGraphForCanvas(input: CanvasImportData | SerializedCanvas | null | undefined): { nodes: Node[]; edges: Edge[] } {
  const extracted = extractCanvasGraph(input)
  const rawNodes = extracted?.nodes || []
  const rawEdges = extracted?.edges || []

  const normalizedNodes = rawNodes
    .filter((n): n is Node => Boolean(n))
    .map(normalizeImportedNodeType)
    .map(adaptImportedCanvasNode)
    .map(normalizeImportedTaskTextNode)
    .map(normalizeImportedNodeShape)
    .map(normalizeNodeParentId)
    .map(normalizeWorkflowNodeMeta)

  const groupIds = new Set(normalizedNodes.filter((n) => n.type === 'groupNode').map((n) => n.id))
  const nodeIds = new Set(normalizedNodes.map((n) => n.id))

  const nodes = normalizedNodes.map((node) => {
    const pid = getNodeParentId(node)
    if (!pid) return node
    const invalidParent = pid === node.id || !groupIds.has(pid) || !nodeIds.has(pid)
    if (!invalidParent) return node
    const { parentId: _parentId, parentNode: _legacyParentNode, extent: _extent, ...rest } = (node as any)
    return rest as Node
  })

  const finalNodeIds = new Set(nodes.map((n) => n.id))
  const edgesByNode = normalizeImportedEdgeHandles(
    nodes,
    rawEdges.filter((e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)),
  )
  const edges = sanitizeEdgesForNodes(nodes, edgesByNode).map(normalizeWorkflowEdgeMeta)
  return { nodes: ensureParentFirstOrder(nodes), edges }
}

type TreeLayoutPoint = { x: number; y: number }
type TreeLayoutSize = { w: number; h: number }

// 允许图像类节点可选中（用于展示提示词/模型等面板与交互）。
// 若未来有确实需要禁用选择的 taskNode kind，可再加入该集合。
const UNSELECTABLE_TASK_NODE_KINDS = new Set<string>()

function getNodeSizeForLayout(node: Node): TreeLayoutSize {
  // Layout must follow actual rendered box first; stale data.nodeWidth/nodeHeight
  // can otherwise create huge phantom gaps between nodes.
  const measured = getNodeSize(node)
  return { w: measured.w, h: measured.h }
}

const GROUP_PADDING = 8
const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90
const LAYOUT_EXCLUDED_GROUP_SOURCES = new Set<string>([
  'novel_storyboard_progress',
])

function getNodeParentId(node: Node): string | null {
  const anyNode = node as any
  const raw =
    typeof anyNode?.parentId === 'string'
      ? anyNode.parentId
      : typeof anyNode?.parentNode === 'string'
        ? anyNode.parentNode
        : ''
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || null
}

function shouldExcludeNodeFromGroupArrange(node: Node): boolean {
  if (!node || node.type === 'groupNode') return true
  const data = (node as any)?.data as Record<string, unknown> | undefined
  const source = String(data?.source || '').trim()
  if (source && LAYOUT_EXCLUDED_GROUP_SOURCES.has(source)) return true
  return false
}

function buildFlowArrangeColumns(nodes: Node[], edges: Edge[]): Node[][] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const targetIds = new Set(nodes.map((node) => node.id))
  const outgoing = new Map<string, Set<string>>()
  const incomingCount = new Map<string, number>()

  for (const node of nodes) {
    outgoing.set(node.id, new Set<string>())
    incomingCount.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!targetIds.has(edge.source) || !targetIds.has(edge.target) || edge.source === edge.target) continue
    const nextTargets = outgoing.get(edge.source)
    if (!nextTargets || nextTargets.has(edge.target)) continue
    nextTargets.add(edge.target)
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1)
  }

  const compare = (leftId: string, rightId: string): number => {
    const leftNode = nodesById.get(leftId)
    const rightNode = nodesById.get(rightId)
    if (!leftNode || !rightNode) return leftId.localeCompare(rightId)
    return compareNodesByHorizontalPriority(leftNode, rightNode, nodesById)
  }

  const roots = nodes
    .filter((node) => (incomingCount.get(node.id) || 0) === 0)
    .sort((left, right) => compareNodesByHorizontalPriority(left, right, nodesById))
  const visited = new Set<string>()
  const columns: Node[][] = []

  const visitChain = (startId: string): void => {
    if (visited.has(startId)) return
    const queue: string[] = [startId]
    const orderedIds: string[] = []

    while (queue.length > 0) {
      const currentId = queue.shift()
      if (!currentId || visited.has(currentId)) continue
      visited.add(currentId)
      orderedIds.push(currentId)
      const nextIds = Array.from(outgoing.get(currentId) || []).sort(compare)
      for (const nextId of nextIds) {
        if (!visited.has(nextId)) queue.push(nextId)
      }
    }

    if (!orderedIds.length) return
    columns.push(orderedIds.map((id) => nodesById.get(id)).filter((node): node is Node => Boolean(node)))
  }

  for (const root of roots) visitChain(root.id)

  const remaining = nodes
    .filter((node) => !visited.has(node.id))
    .sort((left, right) => compareNodesByHorizontalPriority(left, right, nodesById))
  for (const node of remaining) visitChain(node.id)

  return columns
}

function arrangeGroupChildrenInNodes(
  nodes: Node[],
  edges: Edge[],
  groupId: string,
  direction: GroupArrangeDirection,
  nodeIds?: string[],
): Node[] {
  const group = nodes.find((n) => n.id === groupId && n.type === 'groupNode')
  if (!group) return nodes

  const allChildren = nodes.filter((n) => getNodeParentId(n) === groupId && !shouldExcludeNodeFromGroupArrange(n))
  if (allChildren.length < 2) return nodes

  const targetIds =
    Array.isArray(nodeIds) && nodeIds.length
      ? new Set(nodeIds.filter((id) => allChildren.some((n) => n.id === id)))
      : new Set(allChildren.map((n) => n.id))
  const targets = allChildren
    .filter((n) => targetIds.has(n.id))
    .sort((a, b) => {
      const ay = Number(a.position?.y ?? 0)
      const by = Number(b.position?.y ?? 0)
      if (Math.abs(ay - by) > 1) return ay - by
      const ax = Number(a.position?.x ?? 0)
      const bx = Number(b.position?.x ?? 0)
      if (Math.abs(ax - bx) > 1) return ax - bx
      return String(a.id).localeCompare(String(b.id))
    })
  if (targets.length < 2) return nodes

  const padding = GROUP_PADDING
  const gapX = 12
  const gapY = 12

  const nodeSizeById = new Map<string, { w: number; h: number }>(
    targets.map((node) => [node.id, getNodeSizeForLayout(node)] as const),
  )

  const layoutPos = new Map<string, { x: number; y: number }>()
  if (direction === 'column') {
    let cursorY = padding
    for (const node of targets) {
      layoutPos.set(node.id, { x: padding, y: cursorY })
      cursorY += (nodeSizeById.get(node.id)?.h ?? 0) + gapY
    }
  } else if (direction === 'flow') {
    const targetIdSet = new Set(targets.map((node) => node.id))
    const scopedEdges = edges.filter((edge) => targetIdSet.has(edge.source) && targetIdSet.has(edge.target))
    const columns = buildFlowArrangeColumns(targets, scopedEdges)
    let cursorX = padding

    for (const column of columns) {
      let cursorY = padding
      let columnWidth = 0
      for (const node of column) {
        const size = nodeSizeById.get(node.id) || { w: 0, h: 0 }
        layoutPos.set(node.id, { x: cursorX, y: cursorY })
        cursorY += size.h + gapY
        columnWidth = Math.max(columnWidth, size.w)
      }
      cursorX += columnWidth + gapX
    }
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(targets.length)))
    const rows = Math.max(1, Math.ceil(targets.length / cols))
    const colWidths = Array.from({ length: cols }, () => 0)
    const rowHeights = Array.from({ length: rows }, () => 0)
    targets.forEach((node, idx) => {
      const row = Math.floor(idx / cols)
      const col = idx % cols
      const size = nodeSizeById.get(node.id) || { w: 0, h: 0 }
      colWidths[col] = Math.max(colWidths[col], size.w)
      rowHeights[row] = Math.max(rowHeights[row], size.h)
    })
    const colOffsets = Array.from({ length: cols }, () => 0)
    const rowOffsets = Array.from({ length: rows }, () => 0)
    let x = padding
    for (let col = 0; col < cols; col += 1) {
      colOffsets[col] = x
      x += colWidths[col] + gapX
    }
    let y = padding
    for (let row = 0; row < rows; row += 1) {
      rowOffsets[row] = y
      y += rowHeights[row] + gapY
    }
    targets.forEach((node, idx) => {
      const row = Math.floor(idx / cols)
      const col = idx % cols
      layoutPos.set(node.id, {
        x: colOffsets[col] ?? padding,
        y: rowOffsets[row] ?? padding,
      })
    })
  }

  const laidOutNodes = nodes.map((node) => {
    const next = layoutPos.get(node.id)
    if (!next) return node
    const stripped = stripNodePositionInternals(node)
    return { ...stripped, position: next }
  })

  return autoFitSingleGroupNode(laidOutNodes, groupId, new Set(allChildren.map((n) => n.id)))
}

function normalizeNodeParentId(node: Node): Node {
  const anyNode = node as any
  const rawParentId = typeof anyNode?.parentId === 'string' ? anyNode.parentId : null
  const rawLegacyParentNode = typeof anyNode?.parentNode === 'string' ? anyNode.parentNode : null
  const resolved = (rawParentId || rawLegacyParentNode || '').trim()

  const shouldStripLegacy = rawLegacyParentNode != null
  const shouldNormalizeParentId = (rawParentId || '').trim() !== resolved
  const shouldDropEmptyParentId = rawParentId != null && !resolved

  if (!shouldStripLegacy && !shouldNormalizeParentId && !shouldDropEmptyParentId) return node

  const { parentNode: _legacyParentNode, parentId: _existingParentId, ...rest } = anyNode
  return resolved ? ({ ...rest, parentId: resolved } as Node) : (rest as Node)
}

function stripNodePositionInternals(node: Node): Node {
  const {
    positionAbsolute: _positionAbsolute,
    dragging: _dragging,
    resizing: _resizing,
    ...rest
  } = (node as any) || {}
  return rest as Node
}

function ensureParentFirstOrder(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: Node[] = []

  const visit = (node: Node) => {
    if (visited.has(node.id)) return
    if (visiting.has(node.id)) {
      visited.add(node.id)
      ordered.push(node)
      return
    }
    visiting.add(node.id)
    const pid = getNodeParentId(node)
    if (pid && pid !== node.id) {
      const parent = byId.get(pid)
      if (parent) visit(parent)
    }
    visiting.delete(node.id)
    if (!visited.has(node.id)) {
      visited.add(node.id)
      ordered.push(node)
    }
  }

  for (const node of nodes) visit(node)
  return ordered
}

function parseViewportTransform(): { tx: number; ty: number; zoom: number } | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
  if (!viewport) return null
  const transform = window.getComputedStyle(viewport).transform
  if (!transform || transform === 'none') return { tx: 0, ty: 0, zoom: 1 }
  const matrixMatch = transform.match(/^matrix\((.+)\)$/)
  if (matrixMatch?.[1]) {
    const values = matrixMatch[1].split(',').map((x) => Number.parseFloat(x.trim()))
    if (values.length >= 6 && values.every((n) => Number.isFinite(n))) {
      return { tx: values[4], ty: values[5], zoom: values[0] || 1 }
    }
  }
  const matrix3dMatch = transform.match(/^matrix3d\((.+)\)$/)
  if (matrix3dMatch?.[1]) {
    const values = matrix3dMatch[1].split(',').map((x) => Number.parseFloat(x.trim()))
    if (values.length >= 16 && values.every((n) => Number.isFinite(n))) {
      return { tx: values[12], ty: values[13], zoom: values[0] || 1 }
    }
  }
  return null
}

function getFlowViewRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
  const host = (viewport?.parentElement as HTMLElement | null) || viewport
  if (!host) return null
  const rect = host.getBoundingClientRect()
  const t = parseViewportTransform() || { tx: 0, ty: 0, zoom: 1 }
  const safeZoom = Number.isFinite(t.zoom) && t.zoom > 0 ? t.zoom : 1
  const left = -t.tx / safeZoom
  const top = -t.ty / safeZoom
  const width = (rect.width || window.innerWidth) / safeZoom
  const height = (rect.height || window.innerHeight) / safeZoom
  return { left, top, right: left + width, bottom: top + height, width, height }
}

export function computeContextAwarePosition(nodes: Node[], preferredSize?: { w: number; h: number }): { x: number; y: number } {
  const view = getFlowViewRect()
  if (!view) return { x: 80, y: 80 }
  const margin = 24
  const gap = 28
  const size = preferredSize || { w: 420, h: 240 }
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  const nodesById = new Map(nodes.map((n) => [n.id, n] as const))
  const rects = nodes
    .filter((n) => n.type !== 'groupNode')
    .map((n) => {
      const p = getNodeAbsPosition(n, nodesById)
      const s = getNodeSize(n)
      return { x: p.x, y: p.y, w: s.w, h: s.h }
    })
    .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h))
  const visible = rects.filter((r) => !(r.x + r.w < view.left || r.x > view.right || r.y + r.h < view.top || r.y > view.bottom))
  if (!visible.length) {
    return {
      x: clamp(view.left + view.width * 0.58, view.left + margin, view.right - size.w - margin),
      y: clamp(view.top + margin, view.top + margin, view.bottom - size.h - margin),
    }
  }
  const source = visible

  const minX = Math.min(...source.map((r) => r.x))
  const minY = Math.min(...source.map((r) => r.y))
  const maxX = Math.max(...source.map((r) => r.x + r.w))
  const maxY = Math.max(...source.map((r) => r.y + r.h))
  const rightX = maxX + gap
  const belowY = maxY + gap
  const canRight = rightX + size.w <= view.right - margin
  const canBelow = belowY + size.h <= view.bottom - margin

  if (canRight) {
    return {
      x: clamp(rightX, view.left + margin, view.right - size.w - margin),
      y: clamp(minY, view.top + margin, view.bottom - size.h - margin),
    }
  }
  if (canBelow) {
    return {
      x: clamp(minX, view.left + margin, view.right - size.w - margin),
      y: clamp(belowY, view.top + margin, view.bottom - size.h - margin),
    }
  }
  return {
    x: clamp(view.right - size.w - margin, view.left + margin, view.right - size.w - margin),
    y: clamp(view.bottom - size.h - margin, view.top + margin, view.bottom - size.h - margin),
  }
}

function resolveViewportImportPosition(preferredSize?: NodeSize): XY {
  const view = getFlowViewRect()
  if (!view) return { x: 120, y: 120 }
  const size = preferredSize ?? { w: 420, h: 240 }
  return clampPositionToView(
    { x: view.left + 48, y: view.top + 48 },
    size,
    view,
  )
}

function getRootImportBounds(nodes: Node[]): NodeRect | null {
  const roots = nodes.filter((node) => !getNodeParentId(node))
  const targets = roots.length ? roots : nodes
  if (!targets.length) return null

  const rects = targets
    .map((node) => {
      const x = Number(node.position?.x ?? 0)
      const y = Number(node.position?.y ?? 0)
      const size = getNodeSize(node)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return { x, y, w: size.w, h: size.h }
    })
    .filter((rect): rect is NodeRect => Boolean(rect))

  if (!rects.length) return null

  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h))

  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  }
}

function toNodeRect(position: XY, size: NodeSize): NodeRect {
  return { x: position.x, y: position.y, w: size.w, h: size.h }
}

function rectsOverlap(a: NodeRect, b: NodeRect, padding: number): boolean {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  )
}

function clampPositionToView(position: XY, size: NodeSize, view: ReturnType<typeof getFlowViewRect>): XY {
  if (!view) return position
  const margin = 24
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  return {
    x: clamp(position.x, view.left + margin, view.right - size.w - margin),
    y: clamp(position.y, view.top + margin, view.bottom - size.h - margin),
  }
}

function collectOccupiedRects(nodes: Node[], parentId: string | null): NodeRect[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  if (parentId) {
    return nodes
      .filter((node) => node.type !== 'groupNode' && String(node.parentId || '').trim() === parentId)
      .map((node) => toNodeRect({ x: Number(node.position?.x ?? 0), y: Number(node.position?.y ?? 0) }, getNodeSize(node)))
      .filter((rect) => [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value)))
  }

  return nodes
    .filter((node) => node.type !== 'groupNode')
    .map((node) => toNodeRect(getNodeAbsPosition(node, nodesById), getNodeSize(node)))
    .filter((rect) => [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value)))
}

export function resolveNonOverlappingPosition(
  nodes: Node[],
  preferredPosition: XY,
  preferredSize: NodeSize,
  parentId: string | null,
): XY {
  const occupiedRects = collectOccupiedRects(nodes, parentId)
  if (!occupiedRects.length) return preferredPosition

  const collisionPadding = 32
  const stepX = Math.max(180, Math.round(preferredSize.w + collisionPadding))
  const stepY = Math.max(140, Math.round(preferredSize.h + collisionPadding))
  const view = parentId ? null : getFlowViewRect()
  const origin = parentId ? preferredPosition : clampPositionToView(preferredPosition, preferredSize, view)
  const offsets: XY[] = [{ x: 0, y: 0 }]

  for (let radius = 1; radius <= 8; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        offsets.push({ x: dx, y: dy })
      }
    }
  }

  for (const offset of offsets) {
    const rawCandidate = {
      x: origin.x + offset.x * stepX,
      y: origin.y + offset.y * stepY,
    }
    const candidate = parentId ? rawCandidate : clampPositionToView(rawCandidate, preferredSize, view)
    const candidateRect = toNodeRect(candidate, preferredSize)
    const overlaps = occupiedRects.some((rect) => rectsOverlap(candidateRect, rect, collisionPadding))
    if (!overlaps) return candidate
  }

  return parentId
    ? { x: origin.x, y: origin.y + stepY * 2 }
    : clampPositionToView({ x: origin.x, y: origin.y + stepY * 2 }, preferredSize, view)
}

function applyGroupMembershipOnDragStop(nodes: Node[], movedNodeIds: Set<string>): Node[] {
  if (!movedNodeIds.size) return nodes

  const nodesById = new Map(nodes.map(n => [n.id, n] as const))
  const groupNodes = nodes.filter(n => n.type === 'groupNode')

  const groupRects = groupNodes
    .map((group) => {
      const pos = getNodeAbsPosition(group, nodesById)
      const { w, h } = getNodeSize(group)
      const area = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w * h : Number.POSITIVE_INFINITY
      return { id: group.id, x: pos.x, y: pos.y, w, h, area }
    })
    .filter((g) => Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.w) && Number.isFinite(g.h) && g.w > 0 && g.h > 0)

  if (!groupRects.length) return nodes

  const isCenterInside = (child: Node, group: { x: number; y: number; w: number; h: number }) => {
    const epsilon = 2
    const pos = getNodeAbsPosition(child, nodesById)
    const { w, h } = getNodeSize(child)
    const cx = pos.x + w / 2
    const cy = pos.y + h / 2
    const left = group.x - epsilon
    const top = group.y - epsilon
    const right = group.x + group.w + epsilon
    const bottom = group.y + group.h + epsilon
    if (![cx, cy, left, top, right, bottom].every(Number.isFinite)) return false
    return cx >= left && cx <= right && cy >= top && cy <= bottom
  }

  const updates = new Map<string, Node>()
  for (const nodeId of movedNodeIds) {
    const node = nodesById.get(nodeId)
    if (!node) continue
    if (node.type === 'groupNode') continue

    let bestGroupId: string | null = null
    let bestArea = Number.POSITIVE_INFINITY
    for (const group of groupRects) {
      if (group.id === node.id) continue
      if (!isCenterInside(node, group)) continue
      if (bestGroupId === null || group.area < bestArea || (group.area === bestArea && group.id < bestGroupId)) {
        bestGroupId = group.id
        bestArea = group.area
      }
    }

    const currentParent = getNodeParentId(node)
    const nextParent = bestGroupId
    const shouldStripExtent = (node as any)?.extent != null

    if (nextParent === currentParent && !shouldStripExtent) continue

    const cleanNode = stripNodePositionInternals(normalizeNodeParentId(node))
    const absPos = getNodeAbsPosition(node, nodesById)

    if (!nextParent) {
      updates.set(nodeId, {
        ...cleanNode,
        parentId: undefined,
        extent: undefined,
        position: { x: absPos.x, y: absPos.y },
      })
      continue
    }

    const group = nodesById.get(nextParent)
    if (!group) continue
    const groupAbs = getNodeAbsPosition(group, nodesById)
    updates.set(nodeId, {
      ...cleanNode,
      parentId: nextParent,
      extent: undefined,
      position: { x: absPos.x - groupAbs.x, y: absPos.y - groupAbs.y },
    })
  }

  if (!updates.size) return nodes
  return ensureParentFirstOrder(nodes.map((n) => updates.get(n.id) || n))
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
    updates.set(id, { ...stripNodePositionInternals(base), ...patch })
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

    const desiredPos = {
      x: (group.position?.x ?? 0) + (minX - GROUP_PADDING),
      y: (group.position?.y ?? 0) + (minY - GROUP_PADDING),
    }
    const desiredSize = {
      w: Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2),
      h: Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2),
    }

    const { w: currentW, h: currentH } = getNodeSize(group, { w: desiredSize.w, h: desiredSize.h })

    const dx = desiredPos.x - (group.position?.x ?? 0)
    const dy = desiredPos.y - (group.position?.y ?? 0)
    const posChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1
    const sizeChanged = Math.abs(desiredSize.w - currentW) > 0.1 || Math.abs(desiredSize.h - currentH) > 0.1

    if (!posChanged && !sizeChanged) continue

    updateNode(group.id, {
      position: { x: desiredPos.x, y: desiredPos.y },
      width: desiredSize.w,
      height: desiredSize.h,
      data: {
        ...(group.data || {}),
        nodeWidth: desiredSize.w,
        nodeHeight: desiredSize.h,
      },
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

function autoFitSingleGroupNode(nodes: Node[], groupId: string, childIds?: Set<string>): Node[] {
  const group = nodes.find((n) => n.id === groupId && n.type === 'groupNode')
  if (!group) return nodes

  const children = nodes.filter((n) => {
    if (getNodeParentId(n) !== groupId) return false
    if (childIds && !childIds.has(n.id)) return false
    return true
  })
  if (!children.length) return nodes

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

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return nodes
  }

  const desiredPos = {
    x: (group.position?.x ?? 0) + (minX - GROUP_PADDING),
    y: (group.position?.y ?? 0) + (minY - GROUP_PADDING),
  }
  const desiredSize = {
    w: Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2),
    h: Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2),
  }
  const currentSize = getNodeSize(group, { w: desiredSize.w, h: desiredSize.h })
  const dx = desiredPos.x - (group.position?.x ?? 0)
  const dy = desiredPos.y - (group.position?.y ?? 0)
  const posChanged = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1
  const sizeChanged = Math.abs(desiredSize.w - currentSize.w) > 0.1 || Math.abs(desiredSize.h - currentSize.h) > 0.1
  if (!posChanged && !sizeChanged) return nodes

  return ensureParentFirstOrder(
    nodes.map((node) => {
      if (node.id === groupId) {
        return {
          ...stripNodePositionInternals(node),
          position: { x: desiredPos.x, y: desiredPos.y },
          width: desiredSize.w,
          height: desiredSize.h,
          data: {
            ...(node.data || {}),
            nodeWidth: desiredSize.w,
            nodeHeight: desiredSize.h,
          },
          style: {
            ...(node.style || {}),
            width: desiredSize.w,
            height: desiredSize.h,
          },
        }
      }
      if (!posChanged) return node
      if (getNodeParentId(node) !== groupId) return node
      return {
        ...stripNodePositionInternals(node),
        position: {
          x: (node.position?.x ?? 0) - dx,
          y: (node.position?.y ?? 0) - dy,
        },
      }
    }),
  )
}

function createGroupForNodeIdsInNodes(
  nodes: Node[],
  nextGroupId: number,
  nodeIds: string[],
  name?: string,
  options?: { preserveLayout?: boolean },
): { nodes: Node[]; nextGroupId: number; groupId: string | null } {
  const targetIds = new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean))
  if (!targetIds.size) return { nodes, nextGroupId, groupId: null }

  const targetNodes = nodes.filter((node) => targetIds.has(String(node.id || '')) && node.type !== 'groupNode')
  if (!targetNodes.length) return { nodes, nextGroupId, groupId: null }

  const parentIds = new Set(targetNodes.map((node) => getNodeParentId(node) || ''))
  if (parentIds.size !== 1) return { nodes, nextGroupId, groupId: null }

  const parentKey = Array.from(parentIds)[0] || ''
  const parentId = parentKey || null
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const parentNode = parentId ? nodesById.get(parentId) : null
  if (parentId && !parentNode) return { nodes, nextGroupId, groupId: null }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const targetAbsById = new Map<string, { x: number; y: number; w: number; h: number }>()

  for (const node of targetNodes) {
    const abs = getNodeAbsPosition(node, nodesById)
    const { w, h } = getNodeSize(node)
    targetAbsById.set(node.id, { x: abs.x, y: abs.y, w, h })
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + w)
    maxY = Math.max(maxY, abs.y + h)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { nodes, nextGroupId, groupId: null }
  }

  let nextGroupNo = nextGroupId
  let groupId = genGroupId(nextGroupNo)
  const existingIds = new Set(nodes.map((node) => node.id))
  while (existingIds.has(groupId)) {
    nextGroupNo += 1
    groupId = genGroupId(nextGroupNo)
  }

  const padding = GROUP_PADDING
  const groupAbsX = minX - padding
  const groupAbsY = minY - padding
  const groupWidth = Math.max(GROUP_MIN_WIDTH, (maxX - minX) + padding * 2)
  const groupHeight = Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + padding * 2)
  const parentAbs = parentNode ? getNodeAbsPosition(parentNode, nodesById) : { x: 0, y: 0 }
  const groupLabel = typeof name === 'string' && name.trim() ? name.trim() : `组 ${nextGroupNo}`

  const groupNode = enforceNodeSelectability({
    id: groupId,
    type: 'groupNode',
    position: { x: groupAbsX - parentAbs.x, y: groupAbsY - parentAbs.y },
    parentId: parentId || undefined,
    draggable: true,
    selectable: true,
    focusable: true,
    data: {
      label: groupLabel,
      isGroup: true,
    },
    selected: false,
    style: {
      width: groupWidth,
      height: groupHeight,
    },
  } as Node)

  const nextNodes = nodes.map((node) => {
    if (!targetIds.has(node.id) || node.type === 'groupNode') return node
    const box = targetAbsById.get(node.id)
    if (!box) return node
    const normalized = stripNodePositionInternals(normalizeNodeParentId(node))
    return enforceNodeSelectability({
      ...normalized,
      parentId: groupId,
      extent: undefined,
      selected: false,
      position: {
        x: box.x - groupAbsX,
        y: box.y - groupAbsY,
      },
    } as Node)
  })

  const firstSelectedIndex = nodes.findIndex((node) => targetIds.has(node.id))
  const insertIndex = firstSelectedIndex >= 0 ? firstSelectedIndex : 0
  const nextNodesWithGroup = [
    ...nextNodes.slice(0, insertIndex),
    groupNode,
    ...nextNodes.slice(insertIndex),
  ]
  const nextNodesRaw = ensureParentFirstOrder(nextNodesWithGroup)
  const preserveLayout = options?.preserveLayout !== false
  const arrangedNodes = preserveLayout
    ? autoFitSingleGroupNode(nextNodesRaw, groupId, targetIds)
    : arrangeGroupChildrenInNodes(nextNodesRaw, [], groupId, 'grid', Array.from(targetIds))

  return {
    nodes: arrangedNodes,
    nextGroupId: nextGroupNo + 1,
    groupId,
  }
}

function scaleNodeByGroupResize(node: Node, scale: number): Node {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) return node

  const stripped = stripNodePositionInternals(node)
  const nextPos = {
    x: Number.isFinite(Number(stripped.position?.x)) ? Number((stripped.position as any).x) * scale : stripped.position?.x,
    y: Number.isFinite(Number(stripped.position?.y)) ? Number((stripped.position as any).y) * scale : stripped.position?.y,
  }

  const anyNode = stripped as any
  const data = (anyNode?.data || {}) as Record<string, any>
  const style = (anyNode?.style || {}) as Record<string, any>

  const scaledNodeWidth = Number.isFinite(Number(data.nodeWidth)) && Number(data.nodeWidth) > 0
    ? Math.max(24, Math.round(Number(data.nodeWidth) * scale))
    : undefined
  const scaledNodeHeight = Number.isFinite(Number(data.nodeHeight)) && Number(data.nodeHeight) > 0
    ? Math.max(24, Math.round(Number(data.nodeHeight) * scale))
    : undefined

  const scaledStyleWidth = Number.isFinite(Number(style.width)) && Number(style.width) > 0
    ? Math.max(24, Math.round(Number(style.width) * scale))
    : undefined
  const scaledStyleHeight = Number.isFinite(Number(style.height)) && Number(style.height) > 0
    ? Math.max(24, Math.round(Number(style.height) * scale))
    : undefined

  // Keep React Flow internal measurement fields unmanaged here to avoid hitbox drift.
  const {
    width: _internalWidth,
    height: _internalHeight,
    measured: _internalMeasured,
    ...nodeWithoutInternalSize
  } = stripped as any

  return {
    ...nodeWithoutInternalSize,
    position: nextPos as any,
    style: {
      ...style,
      ...(scaledStyleWidth ? { width: scaledStyleWidth } : null),
      ...(scaledStyleHeight ? { height: scaledStyleHeight } : null),
    },
    data: {
      ...data,
      ...(scaledNodeWidth ? { nodeWidth: scaledNodeWidth } : null),
      ...(scaledNodeHeight ? { nodeHeight: scaledNodeHeight } : null),
    },
  }
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
  if (node.type !== 'taskNode') return node
  const data = node.data && typeof node.data === 'object'
    ? node.data as Record<string, unknown>
    : {}
  const normalizedKind = normalizeTaskNodeKind(typeof data.kind === 'string' ? data.kind : null)
  if (!normalizedKind) return node

  const nextData: Record<string, unknown> = {
    ...data,
    kind: normalizedKind,
  }

  if (normalizedKind === 'video') {
    Object.assign(nextData, buildVideoDurationPatch(readVideoDurationSeconds(data, 5)))
    if (typeof nextData.videoModel !== 'string' || !nextData.videoModel.trim()) {
      nextData.videoModel = 'veo3.1-fast'
    }
  }

  if (normalizedKind === 'image' || normalizedKind === 'imageEdit') {
    if (typeof nextData.imageModel !== 'string' || !nextData.imageModel.trim()) {
      nextData.imageModel = getDefaultModel(normalizedKind === 'imageEdit' ? 'imageEdit' : 'image')
    }
  }

  return { ...node, data: nextData }
}

function upgradeImageFissionModel(node: Node): Node {
  return node
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
  const isVideoKind = kind === 'video'
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
  nextGroupId: 1,
  lastGroupArrangeDirection: 'grid',
  historyPast: [],
  historyFuture: [],
  clipboard: null,
  onNodesChange: (changes) => set((s) => {
    const dimChanges = new Map<string, { width?: number; height?: number }>()
    const safeEdgeInvariantChangeTypes = new Set(['position', 'select', 'dimensions'])
    // Dimension changes can come from:
    // - NodeResizer (explicit user resize): contains `resizing: boolean`
    // - internal measurement updates (no `resizing` flag)
    // Only the former should trigger "scale children by group resize"; otherwise it causes drift/flicker.
	    const resizerDimChangeIds = new Set<string>()
	    const movedNodeIds = new Set<string>()
	    const dragStopNodeIds = new Set<string>()
	    let hasDragMove = false
	    let hasDragStop = false
	    let isDragStart = false
	    let hasNonDragRelatedChange = false
      let needsEdgeSanitize = false

    for (const change of changes as any[]) {
      if (!change || typeof change !== 'object') continue
      const id = typeof change.id === 'string' ? change.id : ''
      const changeType = typeof change.type === 'string' ? change.type : ''

      if (!safeEdgeInvariantChangeTypes.has(changeType)) {
        needsEdgeSanitize = true
      }

      if (change.type === 'position') {
        if (id) movedNodeIds.add(id)
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
	          if (id) {
	            activeDragNodeIds.delete(id)
	            dragStopNodeIds.add(id)
	          }
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
        dimChanges.set(id, {
          ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : null),
          ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : null),
        })
        if (typeof (change as any).resizing === 'boolean') {
          resizerDimChangeIds.add(id)
        }
      }
    }

    const rawUpdated = applyNodeChanges(changes, s.nodes)
    const updatedWithDims = dimChanges.size
      ? rawUpdated.map((node) => {
        const dims = dimChanges.get(node.id)
        if (!dims) return node
        const kind = typeof (node.data as any)?.kind === 'string' ? String((node.data as any).kind) : ''
        const coreType = getTaskNodeCoreType(kind)
        const isCanvasMediaKind = coreType === 'image' || coreType === 'video' || coreType === 'storyboard'
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
      : rawUpdated

    const isPureDragMove =
      hasDragMove &&
      !hasDragStop &&
      !hasNonDragRelatedChange &&
      dimChanges.size === 0 &&
      !needsEdgeSanitize

    if (isPureDragMove) {
      if (!isDragStart) {
        return { nodes: updatedWithDims }
      }
      const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
      return { nodes: updatedWithDims, historyPast: past, historyFuture: [] }
    }

    const prevById = new Map(s.nodes.map((n) => [n.id, n] as const))
    // Treat "group resize" only when it comes from NodeResizer (has `resizing` flag).
    // This avoids scaling children on measurement-driven dimension updates.
    const hasGroupResize = Array.from(resizerDimChangeIds).some((id) => {
      const prev = prevById.get(id)
      return !!prev && prev.type === 'groupNode'
    })
    const childScaleById = new Map<string, number>()
    if (hasGroupResize) {
      const updatedById = new Map(updatedWithDims.map((n) => [n.id, n] as const))
      for (const [id, dims] of dimChanges.entries()) {
        if (!resizerDimChangeIds.has(id)) continue
        const prev = prevById.get(id)
        const next = updatedById.get(id)
        if (!prev || !next || prev.type !== 'groupNode') continue

        const oldSize = getNodeSize(prev)
        const nextWidth = typeof dims.width === 'number' ? dims.width : oldSize.w
        const nextHeight = typeof dims.height === 'number' ? dims.height : oldSize.h

        if (!Number.isFinite(oldSize.w) || !Number.isFinite(oldSize.h) || oldSize.w <= 0 || oldSize.h <= 0) continue
        if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) continue

        const scaleX = nextWidth / oldSize.w
        const scaleY = nextHeight / oldSize.h
        // Use the dominant axis delta for uniform child scaling.
        // Using min(scaleX, scaleY) causes counter-intuitive shrink when one axis
        // is slightly reduced (or jittering) while the other axis is being enlarged.
        const scale =
          Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)
            ? scaleX
            : scaleY
        if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) continue

        for (const node of updatedWithDims) {
          if (getNodeParentId(node) !== id) continue
          if (node.type === 'groupNode') continue
          if (dimChanges.has(node.id)) continue
          if (!childScaleById.has(node.id)) childScaleById.set(node.id, scale)
        }
      }
    }

	    const updatedAfterGroupResize = childScaleById.size
	      ? updatedWithDims.map((node) => {
	        const scale = childScaleById.get(node.id)
	        if (!scale) return node
	        return scaleNodeByGroupResize(node, scale)
	      })
	      : updatedWithDims
	
	    const membershipMovedNodeIds = new Set<string>()
	    if (hasDragStop && dragStopNodeIds.size) {
	      for (const id of dragStopNodeIds) membershipMovedNodeIds.add(id)
	    }

	    const updatedWithGroupMembership =
	      membershipMovedNodeIds.size
	        ? applyGroupMembershipOnDragStop(updatedAfterGroupResize, membershipMovedNodeIds)
	        : updatedAfterGroupResize

	    const updatedAfterMembershipLayout = ensureParentFirstOrder(updatedWithGroupMembership)

	    // Keep group size fully user-controlled by default.
	    // Auto-fit is only applied in explicit actions (e.g. group arrange), not on every node change.
	    const shouldAutoFitGroups = false
	    const updatedBeforeSanitize = shouldAutoFitGroups
	      ? autoFitGroupNodes(updatedAfterMembershipLayout).map(enforceNodeSelectability)
	      : updatedAfterMembershipLayout
	    const updated = ensureParentFirstOrder(updatedBeforeSanitize.map(stripNodePositionInternals))

	    const isDragRelated = hasDragMove || hasDragStop
	    const shouldCaptureHistory = hasNonDragRelatedChange || !isDragRelated || isDragStart
    const sanitizedEdges = needsEdgeSanitize ? sanitizeEdgesForNodes(updated, s.edges) : s.edges
    if (!shouldCaptureHistory) {
      return sanitizedEdges === s.edges ? { nodes: updated } : { nodes: updated, edges: sanitizedEdges }
    }

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, edges: sanitizedEdges, historyPast: past, historyFuture: [] }
  }),
  onEdgesChange: (changes) => set((s) => {
    const updated = applyEdgeChanges(changes, s.edges)
    const sanitized = sanitizeEdgesForNodes(s.nodes, updated)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { edges: sanitized, historyPast: past, historyFuture: [] }
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
    const sanitizedEdges = sanitizeEdgesForNodes(s.nodes, nextEdges)
    const past = exists ? s.historyPast : [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    if (exists) {
      return { edges: sanitizedEdges }
    }

    let updatedNodes = s.nodes
    if (connection.target && connection.source) {
      const targetNode = s.nodes.find((n) => n.id === connection.target)
      const sourceNode = s.nodes.find((n) => n.id === connection.source)
      if (
        targetNode &&
        getTaskNodeCoreType(typeof (targetNode.data as Record<string, unknown> | undefined)?.kind === 'string' ? String((targetNode.data as Record<string, unknown>).kind) : null) === 'video' &&
        sourceNode &&
        getTaskNodeCoreType(typeof (sourceNode.data as Record<string, unknown> | undefined)?.kind === 'string' ? String((sourceNode.data as Record<string, unknown>).kind) : null) === 'video'
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
      edges: sanitizedEdges,
      historyPast: past,
      historyFuture: [],
    }
  }),
  addNode: (type, label, extra) => set((s) => {
    if (type === 'groupNode') return {}
    const id = genNodeId()
    const rawExtra = extra || {}
    const { label: extraLabel, autoLabel, position: preferredPosition, parentId: requestedParentIdRaw, ...restExtra } = rawExtra
    const requestedParentId =
      typeof requestedParentIdRaw === 'string' && requestedParentIdRaw.trim()
        ? requestedParentIdRaw.trim()
        : null
    const desiredParentId = requestedParentId
    const parentId =
      desiredParentId && s.nodes.some((n) => n.type === 'groupNode' && n.id === desiredParentId)
        ? desiredParentId
        : null
    let finalLabel = label ?? extraLabel ?? type
    const allowAutoLabel = type === 'taskNode' && autoLabel !== false
    if (allowAutoLabel) {
      const kind = normalizeTaskNodeKind(typeof restExtra.kind === 'string' ? restExtra.kind : null) || null
      const schema = getTaskNodeSchema(kind)
      const schemaLabel = schema.label || kind || '节点'
      const sameKindCount = s.nodes.filter((n) => n.type === 'taskNode' && normalizeTaskNodeKind(((n.data as any)?.kind || null) as string | null) === kind).length
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
    const taskKind =
      type === 'taskNode'
        ? normalizeTaskNodeKind(typeof restExtra.kind === 'string' ? restExtra.kind : null) || null
        : null
    const taskCoreType = taskKind ? getTaskNodeCoreType(taskKind) : null
    const fallbackW = type === 'taskNode'
      ? taskCoreType === 'text'
        ? 380
        : taskCoreType === 'storyboard'
          ? 560
          : taskKind === 'imageEdit'
            ? 320
          : 360
      : 220
    const fallbackH = type === 'taskNode'
      ? taskCoreType === 'text'
        ? 360
        : taskCoreType === 'storyboard'
          ? 470
          : taskKind === 'imageEdit'
            ? 220
          : 220
      : 120
    const defaultPosition = computeContextAwarePosition(s.nodes, { w: fallbackW, h: fallbackH })
    const hasPreferred =
      preferredPosition &&
      typeof preferredPosition.x === 'number' &&
      typeof preferredPosition.y === 'number' &&
      Number.isFinite(preferredPosition.x) &&
      Number.isFinite(preferredPosition.y)
    let position = hasPreferred ? preferredPosition : defaultPosition
    if (!hasPreferred && parentId) {
      const siblings = s.nodes
        .filter((n) => String((n as any).parentId || '').trim() === parentId && n.type === 'taskNode')
        .sort((a, b) => {
          const ay = Number(a.position?.y ?? 0)
          const by = Number(b.position?.y ?? 0)
          if (ay !== by) return ay - by
          const ax = Number(a.position?.x ?? 0)
          const bx = Number(b.position?.x ?? 0)
          return ax - bx
        })
      if (!siblings.length) {
        position = { x: 24, y: 24 }
      } else {
        const last = siblings[siblings.length - 1]
        const lastY = Number(last.position?.y ?? 24)
        position = { x: 24, y: Number.isFinite(lastY) ? lastY + 96 : 120 }
      }
    }
    position = resolveNonOverlappingPosition(s.nodes, position, { w: fallbackW, h: fallbackH }, parentId)

    let dataExtra = restExtra
    if (type === 'taskNode') {
      const hasResolvedAssetUrl = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0
      const hasResolvedAssetList = (value: unknown): boolean =>
        Array.isArray(value) &&
        value.some((item) => {
          if (!item || typeof item !== 'object') return false
          const record = item as Record<string, unknown>
          return typeof record.url === 'string' && record.url.trim().length > 0
        })
      const taskNodeData = dataExtra as Record<string, unknown>
      const runtimeStatus = typeof taskNodeData.status === 'string' ? taskNodeData.status.trim().toLowerCase() : ''
      const isReferenceOnlyTaskNode =
        runtimeStatus !== 'queued' &&
        runtimeStatus !== 'running' &&
        (
          hasResolvedAssetUrl(taskNodeData.imageUrl) ||
          hasResolvedAssetUrl(taskNodeData.videoUrl) ||
          hasResolvedAssetUrl(taskNodeData.audioUrl) ||
          hasResolvedAssetList(taskNodeData.imageResults) ||
          hasResolvedAssetList(taskNodeData.videoResults) ||
          hasResolvedAssetList(taskNodeData.audioResults) ||
          hasResolvedAssetList(taskNodeData.results) ||
          hasResolvedAssetList(taskNodeData.assets) ||
          hasResolvedAssetList(taskNodeData.outputs)
        )
      const kindValue =
        normalizeTaskNodeKind(typeof dataExtra.kind === 'string' ? dataExtra.kind : null) || null
      if (kindValue && kindValue !== dataExtra.kind) {
        dataExtra = {
          ...dataExtra,
          kind: kindValue,
        }
      }
      if (kindValue === 'video' && !isReferenceOnlyTaskNode && (dataExtra as any).videoModel == null) {
        dataExtra = {
          ...dataExtra,
          videoModel: 'veo3.1-fast',
          videoModelVendor:
            (dataExtra as any).videoModelVendor ?? 'veo',
        }
      }

      if (kindValue === 'video' && !isReferenceOnlyTaskNode) {
        dataExtra = {
          ...dataExtra,
          ...buildVideoDurationPatch(
            readVideoDurationSeconds(dataExtra as Record<string, unknown>, 5),
          ),
        }
      }

      if (kindValue === 'imageEdit' && !isReferenceOnlyTaskNode && (dataExtra as any).imageModel == null) {
        dataExtra = {
          ...dataExtra,
          imageModel: getDefaultModel('imageEdit'),
          imageModelVendor:
            (dataExtra as any).imageModelVendor ?? null,
        }
      }

      if (kindValue === 'workflowInput' || kindValue === 'workflowOutput') {
        const hasNodeWidth =
          typeof (dataExtra as any).nodeWidth === 'number' && Number.isFinite((dataExtra as any).nodeWidth)
        const hasNodeHeight =
          typeof (dataExtra as any).nodeHeight === 'number' && Number.isFinite((dataExtra as any).nodeHeight)
        dataExtra = {
          ...dataExtra,
          ...(hasNodeWidth ? null : { nodeWidth: 260 }),
          ...(hasNodeHeight ? null : { nodeHeight: 140 }),
        }
      }

      if (kindValue === 'text') {
        const hasNodeWidth =
          typeof (dataExtra as any).nodeWidth === 'number' && Number.isFinite((dataExtra as any).nodeWidth)
        const hasNodeHeight =
          typeof (dataExtra as any).nodeHeight === 'number' && Number.isFinite((dataExtra as any).nodeHeight)
        dataExtra = {
          ...dataExtra,
          ...(hasNodeWidth ? null : { nodeWidth: 380 }),
          ...(hasNodeHeight ? null : { nodeHeight: 360 }),
        }
      }

      const kindCoreType = kindValue ? getTaskNodeCoreType(kindValue) : null
      const isCanvasMediaKind = kindCoreType === 'image' || kindCoreType === 'video' || kindCoreType === 'storyboard'
      if (isCanvasMediaKind) {
        const hasNodeWidth =
          typeof (dataExtra as any).nodeWidth === 'number' && Number.isFinite((dataExtra as any).nodeWidth)
        const hasNodeHeight =
          typeof (dataExtra as any).nodeHeight === 'number' && Number.isFinite((dataExtra as any).nodeHeight)
        const defaults = kindCoreType === 'video'
          ? { nodeWidth: 400, nodeHeight: 220 }
          : kindCoreType === 'storyboard'
            ? { nodeWidth: 560, nodeHeight: 470 }
            : kindValue === 'imageEdit'
              ? { nodeWidth: 320, nodeHeight: 220 }
            : { nodeWidth: 120, nodeHeight: 210 }
        dataExtra = {
          ...dataExtra,
          ...(hasNodeWidth ? null : { nodeWidth: defaults.nodeWidth }),
          ...(hasNodeHeight ? null : { nodeHeight: defaults.nodeHeight }),
        }
      }

      if (kindValue === 'storyboard') {
        dataExtra = normalizeStoryboardNodeData(dataExtra as Record<string, unknown>)
      }
    }

      const node: Node = {
      id,
      type: type as any,
      position,
      ...(parentId ? { parentId } : {}),
      data: normalizeProductionNodeMetaRecord({ label: finalLabel, ...dataExtra }, { kind: dataExtra.kind ?? type }),
    }
    const nextNodesRaw = [...s.nodes, enforceNodeSelectability(node)]
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: nextNodes, nextId: s.nextId + 1, historyPast: past, historyFuture: [] }
  }),
  reset: () => set({ nodes: [], edges: [], nextId: 1, nextGroupId: 1, lastGroupArrangeDirection: 'grid' }),
  load: (data) => {
    if (!data) return
    const sanitized = sanitizeGraphForCanvas(data)
    // load and normalize graph payload
	    const anyData = data as any
	    const upgradedNodes = (sanitized.nodes || [])
	      .map(normalizeNodeParentId)
	      .map(upgradeVideoKind)
	      .map(upgradeImageFissionModel)
        .map(normalizeWorkflowNodeMeta)
	      .map(normalizeProductionNodeMeta)
	      .map(enforceNodeSelectability)
	    set((s) => ({
      nodes: upgradedNodes,
      edges: sanitized.edges,
      nextId: upgradedNodes.length + 1,
      nextGroupId: computeNextGroupId(upgradedNodes),
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
	        const childNodes = s.nodes.filter(n => getNodeParentId(n) === id)
	        childNodes.forEach(child => idsToDelete.add(child.id))
	      }
	    })

	    // 如果选中的是子节点，也检查是否需要删除父节点（如果父节点的所有子节点都被选中）
	    const selectedChildNodes = selectedNodes.filter(n => {
	      const pid = getNodeParentId(n)
	      return pid != null && selectedIds.has(pid)
	    })
	    selectedChildNodes.forEach(child => {
	      const pid = getNodeParentId(child)
	      const parentNode = pid ? s.nodes.find(n => n.id === pid) : undefined
	      if (parentNode && parentNode.type === 'groupNode') {
	        const allChildren = s.nodes.filter(n => getNodeParentId(n) === parentNode.id)
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
    const nextNodes = ensureParentFirstOrder(remainingNodes)

    return {
      nodes: nextNodes,
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
  updateNodeData: (id, patch) => set((s) => {
    const normalizedPatch =
      patch && typeof patch === 'object'
        ? { ...(patch as Record<string, unknown>) }
        : {}
    if (typeof normalizedPatch.kind === 'string') {
      const normalizedKind = normalizeTaskNodeKind(normalizedPatch.kind)
      if (normalizedKind) normalizedPatch.kind = normalizedKind
    }
    if (Object.keys(normalizedPatch).length === 0) return s

    let changed = false
    const nextNodes = s.nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        node.data && typeof node.data === 'object'
          ? (node.data as Record<string, unknown>)
          : {}
      const currentKind = normalizeTaskNodeKind(typeof currentData.kind === 'string' ? currentData.kind : undefined)
      const nextData =
        currentKind === 'storyboard' || normalizeTaskNodeKind(typeof normalizedPatch.kind === 'string' ? normalizedPatch.kind : undefined) === 'storyboard'
          ? normalizeStoryboardNodeData({
              ...currentData,
              ...normalizedPatch,
              kind: 'storyboard',
            })
          : {
              ...currentData,
              ...normalizedPatch,
            }
      const nextEntries = Object.entries(nextData)
      for (const [key, value] of nextEntries) {
        if (!Object.is(currentData[key], value)) {
          changed = true
          break
        }
      }
      if (!changed && nextEntries.length !== Object.keys(currentData).length) {
        changed = true
      }
      if (!changed) return node
      return {
        ...node,
        data: nextData,
      }
    })

    if (!changed) return s

    return {
      nodes: nextNodes,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  setNodeStatus: (id, status, patch) => {
    const sanitizedPatch: Record<string, unknown> =
      patch && typeof patch === 'object'
        ? { ...(patch as Record<string, unknown>) }
        : {}

    if ('lastError' in sanitizedPatch) {
      const message = formatErrorMessage(sanitizedPatch.lastError).trim()
      sanitizedPatch.lastError = message || undefined
    }

    // Prevent stale error metadata from leaking into unrelated errors/success states.
    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(sanitizedPatch, key)
    if (status === 'error') {
      if (!hasOwn('httpStatus')) sanitizedPatch.httpStatus = null
      if (!hasOwn('isQuotaExceeded')) sanitizedPatch.isQuotaExceeded = false
    } else {
      if (!hasOwn('lastError')) sanitizedPatch.lastError = undefined
      if (!hasOwn('httpStatus')) sanitizedPatch.httpStatus = null
      if (!hasOwn('isQuotaExceeded')) sanitizedPatch.isQuotaExceeded = false
    }
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n
        const currentData =
          n.data && typeof n.data === 'object'
            ? (n.data as Record<string, unknown>)
            : {}
        const nextDataBase: Record<string, unknown> = {
          ...currentData,
          status,
          ...sanitizedPatch,
        }
        const nextKind = normalizeTaskNodeKind(typeof nextDataBase.kind === 'string' ? nextDataBase.kind : undefined)
        return {
          ...n,
          data: nextKind === 'storyboard'
            ? normalizeStoryboardNodeData({
                ...nextDataBase,
                kind: 'storyboard',
              })
            : nextDataBase,
        }
      })
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
  beginRunToken: (id) => {
    const runToken = genRunToken()
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n
        const currentData =
          n.data && typeof n.data === 'object' && !Array.isArray(n.data)
            ? (n.data as Record<string, unknown>)
            : {}
        return {
          ...n,
          data: {
            ...currentData,
            canceled: false,
            runToken,
            lastError: undefined,
            lastResult: undefined,
            httpStatus: null,
            isQuotaExceeded: false,
            imageTaskId: '',
            imageTaskKind: '',
            videoTaskId: '',
          },
        }
      }),
    }))
    return runToken
  },
  endRunToken: (id) => set((s) => s),
  cancelNode: (id) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, canceled: true } } : n))
  })),
  isCanceled: (id, runToken) => {
    const n = get().nodes.find((x) => x.id === id)
    if (!n) return true
    const canceled = Boolean((n?.data as any)?.canceled)
    if (canceled) return true
    if (runToken == null) return false
    const currentToken = (n?.data as any)?.runToken
    if (typeof currentToken !== 'string' || !currentToken.trim()) return true
    return currentToken !== runToken
  },
  runSelected: async () => {
    const s = get()
    const selected = s.nodes.find((n) => n.selected)
    if (!selected) return
    const kind = normalizeTaskNodeKind((selected.data as any)?.kind as string | undefined)
    if (!kind) return
    const coreType = getTaskNodeCoreType(kind)
    if (coreType === 'text') return
    if (coreType === 'image' || coreType === 'video' || coreType === 'storyboard') {
      await runNodeDagToTarget(selected.id, get, set, { concurrency: 1 })
      return
    }
    await runNodeMock(selected.id, get, set)
  },
  runDag: async (concurrency: number) => {
    const workflowIoValidation = validateWorkflowIoForRun({
      nodes: get().nodes,
      edges: get().edges,
    })
    if (!workflowIoValidation.ok) {
      throw new Error(workflowIoValidation.message || '工作流校验失败')
    }
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

    const nextNodesRaw = [...s.nodes, ...newNodes.map(enforceNodeSelectability)]
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)

    return {
      nodes: nextNodes,
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
  deleteNode: (id) => set((s) => {
    const nextNodesRaw = s.nodes.filter(n => n.id !== id)
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    return {
      nodes: nextNodes,
      edges: s.edges.filter(e => e.source !== id && e.target !== id),
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  deleteEdge: (id) => set((s) => ({
    edges: s.edges.filter(e => e.id !== id),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  reorderEdgeForTarget: (edgeId, direction) => set((s) => {
    const targetEdge = s.edges.find((edge) => edge.id === edgeId)
    if (!targetEdge) return {}

    const inboundIndices = s.edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.target === targetEdge.target)
    if (inboundIndices.length < 2) return {}

    const displayOrdered = inboundIndices.map(({ edge }) => edge).reverse()
    const currentIndex = displayOrdered.findIndex((edge) => edge.id === edgeId)
    if (currentIndex < 0) return {}

    const delta = direction === 'left' ? -1 : 1
    const nextIndex = currentIndex + delta
    if (nextIndex < 0 || nextIndex >= displayOrdered.length) return {}

    const reorderedDisplay = displayOrdered.slice()
    const [moved] = reorderedDisplay.splice(currentIndex, 1)
    if (!moved) return {}
    reorderedDisplay.splice(nextIndex, 0, moved)
    const reorderedInbound = reorderedDisplay.reverse()

    const nextEdges = s.edges.slice()
    inboundIndices.forEach(({ index }, inboundIndex) => {
      const replacement = reorderedInbound[inboundIndex]
      if (replacement) nextEdges[index] = replacement
    })

    return {
      edges: nextEdges,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
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
    const nextNodesRaw = [...s.nodes, enforceNodeSelectability(dup)]
    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    return { nodes: nextNodes, nextId: s.nextId + 1, historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50), historyFuture: [] }
  }),
  pasteFromClipboardAt: (pos) => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const importBounds = getRootImportBounds(s.clipboard.nodes)
    const anchor = importBounds
      ? { x: importBounds.x, y: importBounds.y }
      : { x: 0, y: 0 }
    const shift = { x: pos.x - anchor.x, y: pos.y - anchor.y }
    const idMap = new Map<string, string>()
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      const upgraded = normalizeNodeParentId(upgradeVideoKind(upgradeImageFissionModel(n)))
      const oldParentId = getNodeParentId(upgraded)
      const mappedParentId = oldParentId ? idMap.get(oldParentId) : undefined
      const basePos = upgraded.position || { x: 0, y: 0 }
      return enforceNodeSelectability({
        ...upgraded,
        id: newId,
        parentId: mappedParentId,
        selected: false,
        position: mappedParentId
          ? { x: basePos.x, y: basePos.y }
          : { x: basePos.x + shift.x, y: basePos.y + shift.y },
      })
    })
    const newEdges: Edge[] = s.clipboard.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
    }))
    const nextNodes = ensureParentFirstOrder([...s.nodes, ...newNodes])

    return {
      nodes: nextNodes,
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  importWorkflow: (workflowData, position) => set((s) => {
    const sanitized = sanitizeGraphForCanvas(workflowData)
    if (!sanitized.nodes.length) return {}

    const importBounds = getRootImportBounds(sanitized.nodes)
    const pos = position || resolveViewportImportPosition(
      importBounds ? { w: importBounds.w, h: importBounds.h } : undefined,
    )
    const anchor = importBounds
      ? { x: importBounds.x, y: importBounds.y }
      : { x: 0, y: 0 }
    const shift = { x: pos.x - anchor.x, y: pos.y - anchor.y }

    const idMap = new Map<string, string>()
    const newNodes: Node[] = sanitized.nodes.map((n) => {
      const newId = genNodeId()
      idMap.set(n.id, newId)
      const upgraded = normalizeNodeParentId(upgradeVideoKind(upgradeImageFissionModel(n)))
      const oldParentId = getNodeParentId(upgraded)
      const mappedParentId = oldParentId ? idMap.get(oldParentId) || undefined : undefined
      const basePos = upgraded.position || { x: 0, y: 0 }
      return enforceNodeSelectability({
        ...upgraded,
        id: newId,
        parentId: mappedParentId,
        selected: false,
        dragging: false,
        position: mappedParentId
          ? { x: basePos.x, y: basePos.y }
          : { x: basePos.x + shift.x, y: basePos.y + shift.y },
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
    const newEdges: Edge[] = sanitized.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
      animated: false
    }))
    const nextNodes = ensureParentFirstOrder([...s.nodes, ...newNodes])

    return {
      nodes: nextNodes,
      edges: [...s.edges, ...newEdges],
      nextId: s.nextId + newNodes.length,
      nextGroupId: Math.max(s.nextGroupId, computeNextGroupId([...s.nodes, ...newNodes])),
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
  createScriptBundleFromSelection: (name) => set((s) => {
    const selectedNodes = s.nodes.filter((node) => node.selected && node.type !== 'groupNode')
    const textualNodes = selectedNodes.filter((node) => {
      const kind = getNodeTextField(node, 'kind')
      return SCRIPT_BUNDLE_KINDS.has(kind) && Boolean(getScriptBundleNodeContent(node))
    })
    if (textualNodes.length < 2) return {}

    const orderedNodes = orderScriptBundleNodes(textualNodes, s.edges)
    const bundlePrompt = buildScriptBundlePrompt(orderedNodes)
    if (!bundlePrompt.trim()) return {}

    const bundleId = genNodeId()
    const bundleLabel = typeof name === 'string' && name.trim() ? name.trim() : buildScriptBundleLabel(orderedNodes)
    const parentIds = new Set(orderedNodes.map((node) => getNodeParentId(node) || ''))
    const parentId = parentIds.size === 1 ? (Array.from(parentIds)[0] || null) : null
    const nodesById = new Map(s.nodes.map((node) => [node.id, node] as const))
    const boxes = orderedNodes.map((node) => {
      const abs = getNodeAbsPosition(node, nodesById)
      const size = getNodeSize(node)
      return {
        x: abs.x,
        y: abs.y,
        width: size.w,
        height: size.h,
      }
    })
    const minY = Math.min(...boxes.map((box) => box.y))
    const maxX = Math.max(...boxes.map((box) => box.x + box.width))
    const parentNode = parentId ? s.nodes.find((node) => node.id === parentId && node.type === 'groupNode') : null
    const parentAbs = parentNode ? getNodeAbsPosition(parentNode, nodesById) : { x: 0, y: 0 }
    const preferredAbsPosition = { x: maxX + 96, y: minY }
    const resolvedPosition = resolveNonOverlappingPosition(
      s.nodes,
      { x: preferredAbsPosition.x - parentAbs.x, y: preferredAbsPosition.y - parentAbs.y },
      { w: 420, h: 240 },
      parentId,
    )

    const bundleNode = enforceNodeSelectability({
      id: bundleId,
      type: 'taskNode' as const,
      position: resolvedPosition,
      ...(parentId ? { parentId } : {}),
      selected: true,
      data: {
        label: bundleLabel,
        kind: 'text',
        prompt: bundlePrompt,
        textHtml: convertScriptBundlePlainTextToHtml(bundlePrompt),
        bundleMode: 'concat',
        bundleSourceNodeIds: orderedNodes.map((node) => node.id),
        bundleSourceLabels: orderedNodes.map((node) => getNodeTextField(node, 'label')),
        nodeWidth: 420,
      },
    } as Node)

    const nextNodesRaw = [
      ...s.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
      bundleNode,
    ]
    const nextEdges = [...s.edges]
    const existingEdgeIds = new Set(nextEdges.map((edge) => edge.id))
    for (const sourceNode of orderedNodes) {
      const edgeId = `xy-edge__${sourceNode.id}-${bundleId}`
      if (existingEdgeIds.has(edgeId)) continue
      nextEdges.push({
        id: edgeId,
        source: sourceNode.id,
        target: bundleId,
        animated: false,
        type: 'typed',
        selected: false,
      })
      existingEdgeIds.add(edgeId)
    }

    const nextNodes = ensureParentFirstOrder(nextNodesRaw)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      edges: nextEdges,
      nextId: s.nextId + 1,
      historyPast: past,
      historyFuture: [],
    }
  }),
  addGroupForSelection: (name) => set((s) => {
    const selectedNodes = s.nodes.filter((n) => n.selected && n.type !== 'groupNode')
    if (selectedNodes.length < 2) return {}

    const parentIds = new Set(selectedNodes.map((n) => getNodeParentId(n) || ''))
    if (parentIds.size !== 1) return {}

    const existingGroupId = Array.from(parentIds)[0] || ''
    if (existingGroupId) {
      const siblingIds = s.nodes
        .filter((n) => getNodeParentId(n) === existingGroupId)
        .map((n) => n.id)
      const selectedIds = new Set(selectedNodes.map((n) => n.id))
      if (siblingIds.length === selectedIds.size && siblingIds.every((nodeId) => selectedIds.has(nodeId))) {
        return {}
      }
    }

    const parentKey = Array.from(parentIds)[0] || ''
    const parentId = parentKey || null
    const nodesById = new Map(s.nodes.map((n) => [n.id, n] as const))
    const parentNode = parentId ? nodesById.get(parentId) : null
    if (parentId && !parentNode) return {}

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const selectedAbsById = new Map<string, { x: number; y: number; w: number; h: number }>()

    for (const node of selectedNodes) {
      const abs = getNodeAbsPosition(node, nodesById)
      const { w, h } = getNodeSize(node)
      selectedAbsById.set(node.id, { x: abs.x, y: abs.y, w, h })
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return {}

    let nextGroupNo = s.nextGroupId
    let groupId = genGroupId(nextGroupNo)
    const existingIds = new Set(s.nodes.map((n) => n.id))
    while (existingIds.has(groupId)) {
      nextGroupNo += 1
      groupId = genGroupId(nextGroupNo)
    }

    const padding = GROUP_PADDING
    const groupAbsX = minX - padding
    const groupAbsY = minY - padding
    const groupWidth = Math.max(GROUP_MIN_WIDTH, (maxX - minX) + padding * 2)
    const groupHeight = Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + padding * 2)
    const parentAbs = parentNode ? getNodeAbsPosition(parentNode, nodesById) : { x: 0, y: 0 }
    const groupLabel = typeof name === 'string' && name.trim() ? name.trim() : `组 ${nextGroupNo}`

    const groupNode = enforceNodeSelectability({
      id: groupId,
      type: 'groupNode' as any,
      position: { x: groupAbsX - parentAbs.x, y: groupAbsY - parentAbs.y },
      parentId: parentId || undefined,
      draggable: true,
      selectable: true,
      focusable: true as any,
      data: {
        label: groupLabel,
        isGroup: true,
      },
      selected: true,
      style: {
        width: groupWidth,
        height: groupHeight,
      },
    } as Node)

    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    const nextNodes = s.nodes.map((node) => {
      if (!selectedIds.has(node.id)) {
        return node.selected ? { ...node, selected: false } : node
      }
      const box = selectedAbsById.get(node.id)
      if (!box) return node
      const normalized = stripNodePositionInternals(normalizeNodeParentId(node))
      return enforceNodeSelectability({
        ...normalized,
        parentId: groupId,
        extent: undefined,
        selected: false,
        position: {
          x: box.x - groupAbsX,
          y: box.y - groupAbsY,
        },
      } as Node)
    })

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    const firstSelectedIndex = s.nodes.findIndex((n) => selectedIds.has(n.id))
    const insertIndex = firstSelectedIndex >= 0 ? firstSelectedIndex : 0
    const nextNodesWithGroup = [
      ...nextNodes.slice(0, insertIndex),
      groupNode,
      ...nextNodes.slice(insertIndex),
    ]
    const arrangedNodes = autoFitSingleGroupNode(ensureParentFirstOrder(nextNodesWithGroup), groupId, selectedIds)
    return {
      nodes: arrangedNodes,
      nextGroupId: nextGroupNo + 1,
      historyPast: past,
      historyFuture: [],
    }
  }),
  createGroupForNodeIds: (nodeIds, name, options) => {
    let createdGroupId: string | null = null
    set((s) => {
      const result = createGroupForNodeIdsInNodes(s.nodes, s.nextGroupId, nodeIds, name, options)
      if (!result.groupId || result.nodes === s.nodes) return {}
      createdGroupId = result.groupId
      const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
      return {
        nodes: result.nodes,
        nextGroupId: result.nextGroupId,
        historyPast: past,
        historyFuture: [],
      }
    })
    return createdGroupId
  },
  fitGroupToChildren: (groupId, nodeIds) => set((s) => {
    const childIds = Array.isArray(nodeIds) && nodeIds.length
      ? new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean))
      : undefined
    const fitted = autoFitSingleGroupNode(s.nodes, groupId, childIds)
    if (fitted === s.nodes) return {}
    return { nodes: fitted }
  }),
  removeGroupById: (id) => set((s) => {
    const group = s.nodes.find((n) => n.id === id && n.type === 'groupNode')
    if (!group) return {}

    const childIds = new Set(s.nodes.filter((n) => getNodeParentId(n) === id).map((n) => n.id))
    const idsToDelete = new Set<string>([id, ...childIds])
    const nextNodes = s.nodes.filter((n) => !idsToDelete.has(n.id))
    const nextEdges = s.edges.filter((e) => !idsToDelete.has(e.source) && !idsToDelete.has(e.target))
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      edges: nextEdges,
      historyPast: past,
      historyFuture: [],
    }
  }),
  findGroupMatchingSelection: () => {
    const s = get()
    const selectedNodes = s.nodes.filter((n) => n.selected && n.type !== 'groupNode')
    if (!selectedNodes.length) return null

    const parentIds = new Set(selectedNodes.map((n) => getNodeParentId(n) || ''))
    if (parentIds.size !== 1) return null

    const parentId = Array.from(parentIds)[0] || ''
    if (!parentId) return null

    const parentGroup = s.nodes.find((n) => n.id === parentId && n.type === 'groupNode')
    if (!parentGroup) return null

    const childIds = s.nodes.filter((n) => getNodeParentId(n) === parentId).map((n) => n.id)
    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    if (childIds.length !== selectedIds.size) return null
    if (!childIds.every((id) => selectedIds.has(id))) return null

    const groupName = String((parentGroup.data as any)?.label || '').trim() || parentId
    return {
      id: parentId,
      name: groupName,
      nodeIds: childIds,
    }
  },
  renameGroup: (id, name) => set((s) => {
    const group = s.nodes.find((n) => n.id === id && n.type === 'groupNode')
    const nextName = String(name || '').trim()
    if (!group || !nextName) return {}

    const nextNodes = s.nodes.map((n) =>
      n.id === id
        ? { ...n, data: { ...(n.data || {}), label: nextName } }
        : n,
    )
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      historyPast: past,
      historyFuture: [],
    }
  }),
  ungroupGroupNode: (id) => set((s) => {
    const group = s.nodes.find((n) => n.id === id && n.type === 'groupNode')
    if (!group) return {}

    const nodesById = new Map(s.nodes.map((n) => [n.id, n] as const))
    const nextNodes: Node[] = []
    for (const node of s.nodes) {
      if (node.id === id) continue
      if (getNodeParentId(node) !== id) {
        nextNodes.push(node)
        continue
      }
      const absPos = getNodeAbsPosition(node, nodesById)
      const normalized = stripNodePositionInternals(normalizeNodeParentId(node))
      nextNodes.push(enforceNodeSelectability({
        ...normalized,
        parentId: undefined,
        extent: undefined,
        selected: true,
        position: { x: absPos.x, y: absPos.y },
      } as Node))
    }

    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: nextNodes,
      historyPast: past,
      historyFuture: [],
    }
  }),
  arrangeGroupChildren: (groupId, direction, nodeIds) => set((s) => {
    const arranged = arrangeGroupChildrenInNodes(s.nodes, s.edges, groupId, direction, nodeIds)
    if (arranged === s.nodes) {
      if (s.lastGroupArrangeDirection === direction) return {}
      return { lastGroupArrangeDirection: direction }
    }
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return {
      nodes: arranged,
      historyPast: past,
      historyFuture: [],
      lastGroupArrangeDirection: direction,
    }
  }),
  arrangeGroupChildrenByLastDirection: (groupId, nodeIds) => {
    const s = get()
    s.arrangeGroupChildren(groupId, s.lastGroupArrangeDirection, nodeIds)
  },
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
	        const p = getNodeParentId(n) || ''
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
	    s.nodes.forEach(n => { const p=getNodeParentId(n)||''; if(!byParent.has(p)) byParent.set(p, []); byParent.get(p)!.push(n) })
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
	    const nodesInParent = s.nodes.filter(n => (getNodeParentId(n) || null) === parentId)
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
  const sanitized = sanitizeGraphForCanvas({ nodes: nodes as Node[], edges: state.edges })
  const payload = JSON.stringify(
    sanitizeFlowValueForPersistence({ nodes: sanitized.nodes, edges: sanitized.edges }),
  )
  localStorage.setItem(key, payload)
}

export function restoreFromLocalStorage(key = 'tapcanvas-flow') {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { nodes: Node[]; edges: Edge[] }
    // Backward-compat: older saves may contain `dragHandle` which restricts dragging to a selector.
    // Strip it so "dragging a node" always drags the node.
    const nodes = (parsed.nodes || []).map((n: any) => {
      if (!n || typeof n !== 'object') return n
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { dragHandle: _dragHandle, ...rest } = n
      return rest
    }) as Node[]
    const sanitized = sanitizeGraphForCanvas({ nodes, edges: parsed.edges || [] })
    return { ...parsed, nodes: sanitized.nodes, edges: sanitized.edges }
  } catch {
    return null
  }
}
