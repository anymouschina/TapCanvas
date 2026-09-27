import type { Edge, Node } from '@xyflow/react'

type JsonRecord = Record<string, unknown>

export type WorkflowMediaAttempt = Readonly<{
  canvasNodeId: string
  kind: 'image' | 'imageEdit' | 'video'
  status: string
  executionId: string | null
  executionFamilyId: string | null
  runtimeNodeId: string | null
  workflowTaskId: string | null
  effectId: string | null
  taskId: string | null
  submissionState: string | null
  errorMessage: string | null
  assetUrls: readonly string[]
}>

export type WorkflowMediaOutputSlot = Readonly<{
  node: Node
  attempts: readonly WorkflowMediaAttempt[]
  activeAttempt: WorkflowMediaAttempt
}>

export type WorkflowMediaCanvasProjection = Readonly<{
  nodes: Node[]
  edges: Edge[]
  hiddenAttemptNodeIds: ReadonlySet<string>
}>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nodeData(node: Node): JsonRecord {
  return isRecord(node.data) ? node.data : {}
}

function mediaKind(value: unknown): WorkflowMediaAttempt['kind'] | null {
  return value === 'image' || value === 'imageEdit' || value === 'video' ? value : null
}

function workflowMediaNode(node: Node): boolean {
  const data = nodeData(node)
  return node.type === 'taskNode'
    && mediaKind(data.kind) !== null
    && data.mediaTaskExecutionOwner !== 'manual'
    && Boolean(readString(data.workflowExecutionId))
    && Boolean(readString(data.workflowRuntimeNodeId))
}

function assetUrls(data: JsonRecord, kind: WorkflowMediaAttempt['kind']): string[] {
  const urls: string[] = []
  const direct = readString(kind === 'video' ? data.videoUrl : data.imageUrl)
  if (direct) urls.push(direct)
  const resultField = kind === 'video' ? data.videoResults : data.imageResults
  if (Array.isArray(resultField)) {
    for (const value of resultField) {
      if (!isRecord(value)) continue
      const url = readString(value.url)
      if (url && !urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

function attemptForNode(node: Node): WorkflowMediaAttempt | null {
  if (!workflowMediaNode(node)) return null
  const data = nodeData(node)
  const kind = mediaKind(data.kind)
  if (!kind) return null
  return {
    canvasNodeId: node.id,
    kind,
    status: readString(data.status) ?? 'idle',
    executionId: readString(data.workflowExecutionId),
    executionFamilyId: readString(data.workflowExecutionFamilyId),
    runtimeNodeId: readString(data.workflowRuntimeNodeId),
    workflowTaskId: readString(data.workflowTaskId),
    effectId: readString(data.workflowEffectId),
    taskId: readString(data.taskId) ?? readString(data.imageTaskId) ?? readString(data.videoTaskId),
    submissionState: readString(data.workflowSubmissionState),
    errorMessage: readString(data.lastError) ?? readString(data.errorMessage) ?? readString(data.error),
    assetUrls: assetUrls(data, kind),
  }
}

function isImageRetry(node: Node): boolean {
  const data = nodeData(node)
  const effectId = readString(data.workflowEffectId) ?? ''
  return effectId.includes('::retry::') || isRecord(data.workflowMediaRetry)
}

function attemptIndex(node: Node): number | null {
  const data = nodeData(node)
  const workflowRetry = isRecord(data.workflowMediaRetry) ? data.workflowMediaRetry : null
  const value = data.workflowAttemptIndex ?? data.videoRetryIndex ?? workflowRetry?.retryIndex
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function attemptTimestamp(node: Node): number | null {
  const data = nodeData(node)
  for (const field of [
    'workflowSubmissionAcceptedAt',
    'workflowMaterializedAt',
    'workflowExecutionStartedAt',
    'workflowExecutionCreatedAt',
    'updatedAt',
  ]) {
    const value = readString(data[field])
    if (!value) continue
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function attemptDepth(node: Node, nodesById: ReadonlyMap<string, Node>, visiting: ReadonlySet<string> = new Set()): number {
  if (visiting.has(node.id)) return 0
  const data = nodeData(node)
  const workflowRetry = isRecord(data.workflowMediaRetry) ? data.workflowMediaRetry : null
  const predecessorId = readString(workflowRetry?.canvasNodeId)
  if (predecessorId) {
    const predecessor = nodesById.get(predecessorId)
    if (predecessor) {
      const nextVisiting = new Set(visiting)
      nextVisiting.add(node.id)
      return attemptDepth(predecessor, nodesById, nextVisiting) + 1
    }
    return 1
  }
  if (readString(data.videoRetrySourceNodeId)) return attemptIndex(node) ?? 1
  return 0
}

function orderAttempts(group: readonly Node[]): Node[] {
  const nodesById = new Map(group.map((node) => [node.id, node] as const))
  const positions = new Map(group.map((node, index) => [node.id, index] as const))
  return [...group].sort((left, right) => {
    const leftIndex = attemptIndex(left)
    const rightIndex = attemptIndex(right)
    if (leftIndex !== null && rightIndex !== null && leftIndex !== rightIndex) return leftIndex - rightIndex
    const depthOrder = attemptDepth(left, nodesById) - attemptDepth(right, nodesById)
    if (depthOrder !== 0) return depthOrder
    const leftTime = attemptTimestamp(left)
    const rightTime = attemptTimestamp(right)
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime
    const leftIsRetry = isImageRetry(left) || Boolean(readString(nodeData(left).videoRetrySourceNodeId))
    const rightIsRetry = isImageRetry(right) || Boolean(readString(nodeData(right).videoRetrySourceNodeId))
    if (leftIsRetry !== rightIsRetry) return leftIsRetry ? 1 : -1
    return (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0)
  })
}

export function isWorkflowMediaAttemptNode(node: Readonly<{ type?: string; data?: unknown }>): boolean {
  const data = isRecord(node.data) ? node.data : {}
  if (node.type !== 'taskNode'
    || mediaKind(data.kind) === null
    || data.mediaTaskExecutionOwner === 'manual'
    || !readString(data.workflowExecutionId)
    || !readString(data.workflowRuntimeNodeId)) return false
  const effectId = readString(data.workflowEffectId) ?? ''
  return Boolean(readString(data.videoRetrySourceNodeId))
    || effectId.includes('::retry::')
    || isRecord(data.workflowMediaRetry)
}

function videoRetryRoots(nodes: readonly Node[]): ReadonlyMap<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const parentById = new Map<string, string>()
  for (const node of nodes) {
    const sourceId = readString(nodeData(node).videoRetrySourceNodeId)
    if (sourceId && byId.has(sourceId) && sourceId !== node.id) parentById.set(node.id, sourceId)
  }

  const roots = new Map<string, string>()
  for (const nodeId of parentById.keys()) {
    let current = nodeId
    const visited = new Set<string>()
    while (parentById.has(current) && !visited.has(current)) {
      visited.add(current)
      current = parentById.get(current) ?? current
    }
    roots.set(nodeId, current)
    roots.set(current, current)
  }
  return roots
}

function slotKey(
  node: Node,
  data: JsonRecord,
  videoRoots: ReadonlyMap<string, string>,
): string | null {
  const kind = mediaKind(data.kind)
  const familyId = readString(data.workflowExecutionFamilyId) ?? readString(data.workflowExecutionId)
  const runtimeNodeId = readString(data.workflowRuntimeNodeId)
  if (!kind || !familyId || !runtimeNodeId) return null
  const videoRootId = videoRoots.get(node.id)
  if (videoRootId) return `video:${familyId}:${videoRootId}`
  // A materialization step can create many logical outputs. Its runtime ID
  // identifies the producer, not a particular clip or shared asset.
  const outputId = kind === 'video'
    ? readString(data.workflowClipId)
    : readString(data.workflowObjectId)
  if (outputId) return JSON.stringify(['media-output', familyId, kind, outputId])
  return `media:${familyId}:${runtimeNodeId}:${kind}`
}

function canonicalNode(group: readonly Node[], videoRoots: ReadonlyMap<string, string>): Node {
  const directVideoRoot = group.find((node) => videoRoots.get(node.id) === node.id)
  if (directVideoRoot) return directVideoRoot
  return group.find((node) => !isImageRetry(node) && !readString(nodeData(node).videoRetrySourceNodeId)) ?? group[0]!
}

function normalizeStatus(status: string): string {
  if (status === 'error' || status === 'failed') return 'failed'
  if (status === 'succeeded') return 'success'
  if (status === 'cancelled') return 'canceled'
  return status
}

function projectAttemptData(data: JsonRecord, attempts: readonly WorkflowMediaAttempt[]): JsonRecord {
  const activeAttempt = attempts[attempts.length - 1]!
  const latestSuccessful = [...attempts].reverse().find((attempt) =>
    normalizeStatus(attempt.status) === 'success' && attempt.assetUrls.length > 0,
  )
  const projected: JsonRecord = {
    ...data,
    workflowOutputAttempts: attempts,
    workflowOutputActiveAttempt: activeAttempt,
  }
  const activeStatus = normalizeStatus(activeAttempt.status)
  if (activeStatus === 'success') {
    projected.status = 'success'
    delete projected.lastError
    delete projected.error
    delete projected.errorMessage
  } else if (activeStatus === 'failed') {
    projected.status = 'error'
    if (activeAttempt.errorMessage) projected.lastError = activeAttempt.errorMessage
    else {
      delete projected.lastError
      delete projected.error
      delete projected.errorMessage
    }
  } else if (activeStatus === 'running' || activeStatus === 'queued' || activeStatus === 'waiting_external' || activeStatus === 'canceled') {
    projected.status = activeStatus === 'waiting_external'
      ? 'running'
      : activeStatus === 'canceled' ? 'canceled' : activeStatus
    delete projected.lastError
    delete projected.error
    delete projected.errorMessage
  }

  if (latestSuccessful) {
    const kind = latestSuccessful.kind
    const aggregateResults = attempts
      .filter((attempt) => attempt.kind === kind && normalizeStatus(attempt.status) === 'success')
      .flatMap((attempt) => attempt.assetUrls)
      .filter((url, index, urls) => urls.indexOf(url) === index)
      .reverse()
    const results = aggregateResults.map((url) => ({ url }))
    if (kind === 'video') {
      projected.videoUrl = latestSuccessful.assetUrls[0]
      projected.videoResults = results
      projected.videoPrimaryIndex = 0
    } else {
      projected.imageUrl = latestSuccessful.assetUrls[0]
      projected.imageResults = results
      projected.imagePrimaryIndex = 0
    }
  }
  return projected
}

export function resolveWorkflowMediaOutputSlot(
  nodes: readonly Node[],
  targetNodeId: string,
): WorkflowMediaOutputSlot | null {
  const target = nodes.find((node) => node.id === targetNodeId)
  if (!target || !workflowMediaNode(target)) return null
  const videoRoots = videoRetryRoots(nodes)
  const targetKey = slotKey(target, nodeData(target), videoRoots)
  if (!targetKey) return null
  const group = orderAttempts(nodes.filter((node) =>
    workflowMediaNode(node) && slotKey(node, nodeData(node), videoRoots) === targetKey,
  ))
  if (!group.length) return null
  const primary = canonicalNode(group, videoRoots)
  const attempts = group.flatMap((node) => {
    const attempt = attemptForNode(node)
    return attempt ? [attempt] : []
  })
  if (!attempts.length) return null
  const primaryWithProjection: Node = group.length > 1
    ? { ...primary, data: projectAttemptData(nodeData(primary), attempts) }
    : primary
  return { node: primaryWithProjection, attempts, activeAttempt: attempts[attempts.length - 1]! }
}

function remapAttemptEdges(
  edges: readonly Edge[],
  hiddenAttemptNodeIds: ReadonlySet<string>,
  primaryByHiddenId: ReadonlyMap<string, string>,
): Edge[] {
  const seen = new Set<string>()
  const result: Edge[] = []
  for (const edge of edges) {
    const source = primaryByHiddenId.get(edge.source) ?? edge.source
    const target = primaryByHiddenId.get(edge.target) ?? edge.target
    if (hiddenAttemptNodeIds.has(edge.source) && !source) continue
    if (hiddenAttemptNodeIds.has(edge.target) && !target) continue
    const identity = JSON.stringify([source, target, edge.sourceHandle ?? null, edge.targetHandle ?? null, edge.type ?? null])
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(source === edge.source && target === edge.target
      ? edge
      : { ...edge, id: `${edge.id}:logical-media-slot`, source, target })
  }
  return result
}

/**
 * Presents append-only workflow receipts as one logical canvas slot. The input graph is
 * never mutated; the canonical node identity and all persisted attempt nodes remain intact.
 */
export function projectWorkflowMediaAttempts(
  nodes: readonly Node[],
  edges: readonly Edge[],
): WorkflowMediaCanvasProjection {
  const videoRoots = videoRetryRoots(nodes)
  const groups = new Map<string, Node[]>()
  for (const node of nodes) {
    if (!workflowMediaNode(node)) continue
    const key = slotKey(node, nodeData(node), videoRoots)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(node)
    groups.set(key, group)
  }

  const hiddenAttemptNodeIds = new Set<string>()
  const primaryByHiddenId = new Map<string, string>()
  const projectedNodes = new Map<string, Node>()
  for (const unsortedGroup of groups.values()) {
    if (unsortedGroup.length < 2) continue
    const group = orderAttempts(unsortedGroup)
    const primary = canonicalNode(group, videoRoots)
    const attempts = group.flatMap((node) => {
      const attempt = attemptForNode(node)
      return attempt ? [attempt] : []
    })
    if (!attempts.length) continue
    for (const node of group) {
      if (node.id === primary.id) continue
      hiddenAttemptNodeIds.add(node.id)
      primaryByHiddenId.set(node.id, primary.id)
    }
    projectedNodes.set(primary.id, {
      ...primary,
      data: projectAttemptData(nodeData(primary), attempts),
    })
  }

  const visibleNodes = nodes
    .filter((node) => !hiddenAttemptNodeIds.has(node.id))
    .map((node) => projectedNodes.get(node.id) ?? node)
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = remapAttemptEdges(edges, hiddenAttemptNodeIds, primaryByHiddenId)
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
  return { nodes: visibleNodes, edges: visibleEdges, hiddenAttemptNodeIds }
}
