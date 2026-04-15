import type { Edge, Node } from '@xyflow/react'
import { buildAssetRefId } from '../../../runner/assetReference'
import { isRemoteUrl } from './utils'

type NodeDataRecord = Record<string, unknown>
type UnknownRecord = Record<string, unknown>

export type OrderedUpstreamImageSource = {
  edgeId: string
  node: Node
}

export type OrderedUpstreamVideoTailSource = {
  edgeId: string
  node: Node
  previewUrl: string
}

export type OrderedUpstreamReferenceItem = {
  edgeId: string
  sourceNodeId: string
  sourceKind: 'image' | 'imageEdit' | 'video'
  label: string
  previewUrl: string
}

export type NodePrimaryAssetReference = {
  url: string
  assetId: string | null
  assetRefId: string
  displayName: string
}

const IMAGE_REFERENCE_NODE_KINDS = new Set(['image', 'imageEdit', 'storyboard'])

function isVideoReferenceNodeKind(kind: string): boolean {
  return kind === 'video' || kind === 'composeVideo'
}

function getReferenceOrderForTargetNode(nodes: Node[], targetId: string): string[] {
  const targetNode = nodes.find((node) => node.id === targetId)
  const data = getNodeDataRecord(targetNode)
  const raw = data.upstreamReferenceOrder
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function applyReferenceOrder<T extends { sourceNodeId: string }>(items: T[], order: string[]): T[] {
  if (!items.length || !order.length) return items
  const rankById = new Map(order.map((id, index) => [id, index] as const))
  return [...items].sort((left, right) => {
    const leftRank = rankById.get(left.sourceNodeId)
    const rightRank = rankById.get(right.sourceNodeId)
    if (leftRank === undefined && rightRank === undefined) return 0
    if (leftRank === undefined) return 1
    if (rightRank === undefined) return -1
    return leftRank - rightRank
  })
}

function getNodeDataRecord(node: Pick<Node, 'data'> | null | undefined): NodeDataRecord {
  const raw = node?.data
  return raw && typeof raw === 'object' ? (raw as NodeDataRecord) : {}
}

function getTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object')
}

function resolvePrimaryIndex(length: number, rawIndex: unknown): number {
  return typeof rawIndex === 'number' && rawIndex >= 0 && rawIndex < length ? rawIndex : 0
}

export function getNodeLabel(node: Node): string {
  const data = getNodeDataRecord(node)
  return getTrimmedString(data.label) || String(node.id)
}

function getPrimaryImageResultRecord(node: Node | null | undefined): UnknownRecord | null {
  const data = getNodeDataRecord(node)
  const results = getRecordArray(data.imageResults)
  if (results.length === 0) return null
  const primaryIndex = resolvePrimaryIndex(results.length, data.imagePrimaryIndex)
  return results[primaryIndex] || results[0] || null
}

export function extractNodePrimaryAssetReference(node: Node | null | undefined): NodePrimaryAssetReference | null {
  if (!node) return null
  const data = getNodeDataRecord(node)
  const url = pickPrimaryImageFromNode(node)
  if (!isRemoteUrl(url)) return null

  const primaryResult = getPrimaryImageResultRecord(node)
  const assetId =
    getTrimmedString(primaryResult?.assetId) ||
    getTrimmedString(data.assetId) ||
    ''
  const displayName =
    getTrimmedString(primaryResult?.assetName) ||
    getTrimmedString(primaryResult?.title) ||
    getTrimmedString(data.assetName) ||
    getNodeLabel(node)
  const assetRefId =
    getTrimmedString(primaryResult?.assetRefId) ||
    getTrimmedString(data.assetRefId) ||
    buildAssetRefId({
      assetId: assetId || null,
      name: displayName || null,
      title: getNodeLabel(node),
      fallbackPrefix: 'ref',
    })

  return {
    url,
    assetId: assetId || null,
    assetRefId,
    displayName,
  }
}

export function pickPrimaryImageFromNode(node: Node | null | undefined): string {
  const data = getNodeDataRecord(node)
  const results = getRecordArray(data.imageResults)
  const primaryIndex = resolvePrimaryIndex(results.length, data.imagePrimaryIndex)
  const primaryFromResults = getTrimmedString(results[primaryIndex]?.url)
  const primaryFallback = getTrimmedString(data.imageUrl)
  if (primaryFromResults || primaryFallback) return primaryFromResults || primaryFallback

  const storyboardCells = getRecordArray(data.storyboardEditorCells)
  const firstStoryboardCellImage = storyboardCells
    .map((cell) => getTrimmedString(cell.imageUrl))
    .find(Boolean)

  return firstStoryboardCellImage || ''
}

export function pickVideoTailFrameFromNode(node: Node | null | undefined): string {
  const data = getNodeDataRecord(node)
  const results = getRecordArray(data.videoResults)
  const primaryIndex = resolvePrimaryIndex(results.length, data.videoPrimaryIndex)
  const fromResults = getTrimmedString(results[primaryIndex]?.thumbnailUrl) || getTrimmedString(results[0]?.thumbnailUrl)
  const fromNode = getTrimmedString(data.videoThumbnailUrl)
  return fromResults || fromNode || ''
}

export function collectPoseReferenceUrlsFromNode(node: Node | null | undefined): string[] {
  const data = getNodeDataRecord(node)
  const output: string[] = []
  const poseRefs = Array.isArray(data.poseReferenceImages) ? data.poseReferenceImages : []
  if (poseRefs.length > 0) {
    poseRefs.forEach((value) => {
      const url = getTrimmedString(value)
      if (url) output.push(url)
    })
    return output
  }
  const stickmanUrl = getTrimmedString(data.poseStickmanUrl)
  if (stickmanUrl) output.push(stickmanUrl)
  return output
}

export function collectOrderedUpstreamMediaSources(
  nodes: Node[],
  edges: Edge[],
  targetId: string,
): {
  imageSources: OrderedUpstreamImageSource[]
  videoTailSource: OrderedUpstreamVideoTailSource | null
} {
  const inbound = edges.filter((edge) => edge.target === targetId)
  if (inbound.length === 0) {
    return {
      imageSources: [],
      videoTailSource: null,
    }
  }

  const imageSources: OrderedUpstreamImageSource[] = []
  const seen = new Set<string>()
  let videoTailSource: OrderedUpstreamVideoTailSource | null = null

  for (const edge of [...inbound].reverse()) {
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (!sourceNode || seen.has(sourceNode.id)) continue

    const data = getNodeDataRecord(sourceNode)
    const kind = getTrimmedString(data.kind)
    if (!kind) continue

    if (!videoTailSource && isVideoReferenceNodeKind(kind)) {
      const previewUrl = pickVideoTailFrameFromNode(sourceNode)
      seen.add(sourceNode.id)
      if (isRemoteUrl(previewUrl)) {
        videoTailSource = {
          edgeId: edge.id,
          node: sourceNode,
          previewUrl,
        }
      }
      continue
    }

    if (!IMAGE_REFERENCE_NODE_KINDS.has(kind)) continue

    seen.add(sourceNode.id)
    imageSources.push({
      edgeId: edge.id,
      node: sourceNode,
    })
    if (imageSources.length >= 3) break
  }

  const referenceOrder = getReferenceOrderForTargetNode(nodes, targetId)
  const orderedImageSources = applyReferenceOrder(
    imageSources.map((item) => ({ ...item, sourceNodeId: item.node.id })),
    referenceOrder,
  ).map(({ sourceNodeId: _sourceNodeId, ...item }) => item)
  const orderedVideoTailSource = videoTailSource
    ? applyReferenceOrder(
        [{ ...videoTailSource, sourceNodeId: videoTailSource.node.id }],
        referenceOrder,
      )[0] ?? null
    : null

  return {
    imageSources: orderedImageSources,
    videoTailSource: orderedVideoTailSource,
  }
}

export function collectOrderedUpstreamReferenceItems(
  nodes: Node[],
  edges: Edge[],
  targetId: string,
): OrderedUpstreamReferenceItem[] {
  const { imageSources, videoTailSource } = collectOrderedUpstreamMediaSources(nodes, edges, targetId)
  const items: OrderedUpstreamReferenceItem[] = []

  if (videoTailSource) {
    items.push({
      edgeId: videoTailSource.edgeId,
      sourceNodeId: videoTailSource.node.id,
      sourceKind: 'video',
      label: getNodeLabel(videoTailSource.node),
      previewUrl: videoTailSource.previewUrl,
    })
  }

  imageSources.forEach(({ edgeId, node }) => {
    const previewUrl = pickPrimaryImageFromNode(node)
    if (!isRemoteUrl(previewUrl)) return
    const kind = getTrimmedString(getNodeDataRecord(node).kind)
    items.push({
      edgeId,
      sourceNodeId: node.id,
      sourceKind: kind === 'imageEdit' ? 'imageEdit' : 'image',
      label: getNodeLabel(node),
      previewUrl,
    })
  })

  return applyReferenceOrder(items, getReferenceOrderForTargetNode(nodes, targetId))
}
