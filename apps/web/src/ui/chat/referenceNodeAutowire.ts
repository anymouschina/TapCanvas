import type { Edge, Node } from '@xyflow/react'
import { CanvasService } from '../../ai/canvasService'
import { getTaskNodeCoreType } from '../../canvas/nodes/taskNodeSchema'
import { useRFStore } from '../../canvas/store'
import {
  collectNodeReferenceImageUrls,
  readNodeFirstFrameUrl,
  readNodeLastFrameUrl,
} from '../../runner/nodeReferenceInputs'

type NodeDataRecord = Record<string, unknown>

type SourceHandleId = 'out-image' | 'out-video'
type TargetHandleId = 'in-image' | 'in-any'

export type AutoReferenceNodeConnectionIntent = {
  targetNodeId: string
  targetHandle: TargetHandleId
  shouldPatchReferenceOrder: boolean
  nextUpstreamReferenceOrder: string[]
  connections: Array<{
    sourceNodeId: string
    sourceHandle: SourceHandleId
  }>
}

function asRecord(value: unknown): NodeDataRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as NodeDataRecord)
    : null
}

function readRemoteUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : ''
}

function unwrapProxyUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const nested = parsed.searchParams.get('url') || parsed.searchParams.get('src') || ''
    if (!nested) return parsed.toString()
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    if (
      normalizedPath.endsWith('/assets/proxy-image') ||
      normalizedPath.endsWith('/asset/proxy') ||
      normalizedPath.endsWith('/proxy-image')
    ) {
      return unwrapProxyUrl(nested)
    }
    return parsed.toString()
  } catch {
    return value
  }
}

function normalizeExactUrl(value: unknown): string {
  const remoteUrl = readRemoteUrl(value)
  if (!remoteUrl) return ''
  const unwrapped = unwrapProxyUrl(remoteUrl)
  try {
    const parsed = new URL(unwrapped)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return unwrapped
  }
}

function normalizeCanonicalUrl(value: unknown): string {
  const exact = normalizeExactUrl(value)
  if (!exact) return ''
  try {
    const parsed = new URL(exact)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return exact
  }
}

function collectImageUrlsFromList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const directUrl = readRemoteUrl(record.url)
    if (directUrl) result.push(directUrl)
    const thumbnailUrl = readRemoteUrl(record.thumbnailUrl)
    if (thumbnailUrl) result.push(thumbnailUrl)
  }
  return result
}

function collectStoryboardCellUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const imageUrl = readRemoteUrl(record.imageUrl)
    if (imageUrl) result.push(imageUrl)
  }
  return result
}

function collectSourceUrls(node: Node): string[] {
  const data = asRecord(node.data) || {}
  const candidates = [
    readRemoteUrl(data.imageUrl),
    readRemoteUrl(data.videoThumbnailUrl),
    readNodeFirstFrameUrl(data),
    readNodeLastFrameUrl(data),
    ...collectImageUrlsFromList(data.imageResults),
    ...collectImageUrlsFromList(data.videoResults),
    ...collectImageUrlsFromList(data.assets),
    ...collectImageUrlsFromList(data.outputs),
    ...collectStoryboardCellUrls(data.storyboardEditorCells),
  ]
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const exact = normalizeExactUrl(candidate)
    if (!exact || seen.has(exact)) continue
    seen.add(exact)
    result.push(exact)
  }
  return result
}

function resolveSourceHandle(node: Node): SourceHandleId | null {
  const data = asRecord(node.data)
  const kind = typeof data?.kind === 'string' ? data.kind : null
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'image' || coreType === 'storyboard') return 'out-image'
  if (coreType === 'video') return 'out-video'
  return null
}

function resolveTargetHandle(node: Node): TargetHandleId | null {
  const data = asRecord(node.data)
  const kind = typeof data?.kind === 'string' ? data.kind : null
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'image' || coreType === 'storyboard') return 'in-image'
  if (coreType === 'video') return 'in-any'
  return null
}

function mergeReferenceOrder(existing: unknown, matchedNodeIds: string[]): string[] {
  const existingIds = Array.isArray(existing)
    ? existing
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : []
  if (existingIds.length === 0) return matchedNodeIds
  const seen = new Set(existingIds)
  return [...existingIds, ...matchedNodeIds.filter((nodeId) => !seen.has(nodeId))]
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function edgePairKey(sourceNodeId: string, targetNodeId: string): string {
  return `${sourceNodeId}\u0000${targetNodeId}`
}

function filterUniqueNodeIdsExcludingSelf(nodeIds: Iterable<string> | undefined, targetNodeId: string): string[] {
  if (!nodeIds) return []
  const result = new Set<string>()
  for (const nodeId of nodeIds) {
    const trimmed = typeof nodeId === 'string' ? nodeId.trim() : ''
    if (!trimmed || trimmed === targetNodeId) continue
    result.add(trimmed)
  }
  return Array.from(result)
}

export function resolveAutoReferenceNodeConnections(input: {
  nodes: Node[]
  edges: Edge[]
  targetNodeIds: readonly string[]
}): AutoReferenceNodeConnectionIntent[] {
  const nodesById = new Map(
    input.nodes
      .map((node) => [String(node.id || '').trim(), node] as const)
      .filter(([nodeId]) => Boolean(nodeId)),
  )
  const sourceNodeIdsByExactUrl = new Map<string, Set<string>>()
  const sourceNodeIdsByCanonicalUrl = new Map<string, Set<string>>()

  for (const [nodeId, node] of nodesById.entries()) {
    const sourceHandle = resolveSourceHandle(node)
    if (!sourceHandle) continue
    const sourceUrls = collectSourceUrls(node)
    if (sourceUrls.length === 0) continue
    for (const sourceUrl of sourceUrls) {
      const exactSet = sourceNodeIdsByExactUrl.get(sourceUrl) || new Set<string>()
      exactSet.add(nodeId)
      sourceNodeIdsByExactUrl.set(sourceUrl, exactSet)

      const canonicalUrl = normalizeCanonicalUrl(sourceUrl)
      if (!canonicalUrl) continue
      const canonicalSet = sourceNodeIdsByCanonicalUrl.get(canonicalUrl) || new Set<string>()
      canonicalSet.add(nodeId)
      sourceNodeIdsByCanonicalUrl.set(canonicalUrl, canonicalSet)
    }
  }

  const existingEdgePairs = new Set(
    input.edges
      .map((edge) => {
        const sourceNodeId = String(edge.source || '').trim()
        const targetNodeId = String(edge.target || '').trim()
        return sourceNodeId && targetNodeId ? edgePairKey(sourceNodeId, targetNodeId) : ''
      })
      .filter(Boolean),
  )

  const intents: AutoReferenceNodeConnectionIntent[] = []
  for (const rawTargetNodeId of input.targetNodeIds) {
    const targetNodeId = String(rawTargetNodeId || '').trim()
    if (!targetNodeId) continue
    const targetNode = nodesById.get(targetNodeId)
    if (!targetNode) continue

    const targetHandle = resolveTargetHandle(targetNode)
    if (!targetHandle) continue

    const targetData = asRecord(targetNode.data) || {}
    const requestedUrls = collectNodeReferenceImageUrls(targetData, 12)
      .map((url) => normalizeExactUrl(url))
      .filter(Boolean)
    if (requestedUrls.length === 0) continue

    const matchedSourceNodeIds: string[] = []
    const matchedSourceSet = new Set<string>()
    for (const requestedUrl of requestedUrls) {
      const exactMatches = filterUniqueNodeIdsExcludingSelf(
        sourceNodeIdsByExactUrl.get(requestedUrl),
        targetNodeId,
      )
      let resolvedSourceNodeId = exactMatches.length === 1 ? exactMatches[0] || '' : ''
      if (!resolvedSourceNodeId) {
        const canonicalMatches = filterUniqueNodeIdsExcludingSelf(
          sourceNodeIdsByCanonicalUrl.get(normalizeCanonicalUrl(requestedUrl)),
          targetNodeId,
        )
        resolvedSourceNodeId = canonicalMatches.length === 1 ? canonicalMatches[0] || '' : ''
      }
      if (!resolvedSourceNodeId || matchedSourceSet.has(resolvedSourceNodeId)) continue
      matchedSourceSet.add(resolvedSourceNodeId)
      matchedSourceNodeIds.push(resolvedSourceNodeId)
    }

    if (matchedSourceNodeIds.length === 0) continue

    const currentUpstreamReferenceOrder = Array.isArray(targetData.upstreamReferenceOrder)
      ? targetData.upstreamReferenceOrder
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
      : []
    const nextUpstreamReferenceOrder = mergeReferenceOrder(
      currentUpstreamReferenceOrder,
      matchedSourceNodeIds,
    )
    const shouldPatchReferenceOrder = !areStringArraysEqual(
      currentUpstreamReferenceOrder,
      nextUpstreamReferenceOrder,
    )

    const connections = matchedSourceNodeIds
      .map((sourceNodeId) => {
        const sourceNode = nodesById.get(sourceNodeId)
        const sourceHandle = sourceNode ? resolveSourceHandle(sourceNode) : null
        if (!sourceHandle) return null
        if (existingEdgePairs.has(edgePairKey(sourceNodeId, targetNodeId))) return null
        return { sourceNodeId, sourceHandle }
      })
      .filter((item): item is { sourceNodeId: string; sourceHandle: SourceHandleId } => Boolean(item))

    if (!shouldPatchReferenceOrder && connections.length === 0) continue

    intents.push({
      targetNodeId,
      targetHandle,
      shouldPatchReferenceOrder,
      nextUpstreamReferenceOrder,
      connections,
    })
  }

  return intents
}

export async function autoConnectReferenceNodesForTargets(targetNodeIds: readonly string[]): Promise<{
  connectedEdgeCount: number
  patchedTargetNodeIds: string[]
}> {
  const store = useRFStore.getState()
  const intents = resolveAutoReferenceNodeConnections({
    nodes: store.nodes,
    edges: store.edges,
    targetNodeIds,
  })
  if (intents.length === 0) {
    return { connectedEdgeCount: 0, patchedTargetNodeIds: [] }
  }

  let connectedEdgeCount = 0
  const patchedTargetNodeIds: string[] = []
  const { updateNodeData } = useRFStore.getState()

  for (const intent of intents) {
    if (intent.shouldPatchReferenceOrder) {
      updateNodeData(intent.targetNodeId, {
        upstreamReferenceOrder: intent.nextUpstreamReferenceOrder,
      })
      patchedTargetNodeIds.push(intent.targetNodeId)
    }

    for (const connection of intent.connections) {
      const result = await CanvasService.connectNodes({
        sourceNodeId: connection.sourceNodeId,
        targetNodeId: intent.targetNodeId,
        sourceHandle: connection.sourceHandle,
        targetHandle: intent.targetHandle,
      })
      if (result.success) {
        connectedEdgeCount += 1
        continue
      }
      const message = String(result.error || '').trim()
      if (message.includes('已存在连接')) continue
      throw new Error(message || `自动补齐参考图连线失败：${connection.sourceNodeId} -> ${intent.targetNodeId}`)
    }
  }

  return { connectedEdgeCount, patchedTargetNodeIds }
}
