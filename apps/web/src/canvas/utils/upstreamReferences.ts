import type { Edge, Node } from '@xyflow/react'

const IMAGE_NODE_KINDS = new Set(['image', 'textToImage', 'mosaic', 'storyboardImage', 'imageFission'])
const VIDEO_REFERENCE_NODE_KINDS = new Set(['composeVideo', 'storyboard', 'video'])

export type UpstreamReferenceItem = {
  edgeId: string
  sourceId: string
  sourceKind?: string
  sourceLabel: string
  url: string
  referenceType: 'image' | 'storyboardTail' | 'videoTail'
  soraFileId: string | null
}

export type UpstreamReferenceCollection = {
  items: UpstreamReferenceItem[]
  mostRecentImageNode: Node | null
}

type CollectUpstreamReferenceOptions = {
  preferStoryboardTailShot?: boolean
  maxImageSources?: number
}

function pickPrimaryImage(data: any): string {
  const results = Array.isArray(data?.imageResults) ? data.imageResults : []
  const primaryIndex =
    typeof data?.imagePrimaryIndex === 'number' &&
    data.imagePrimaryIndex >= 0 &&
    data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const primaryFromResults =
    results[primaryIndex] && typeof results[primaryIndex].url === 'string'
      ? results[primaryIndex].url.trim()
      : ''
  const primaryFallback = typeof data?.imageUrl === 'string' ? data.imageUrl.trim() : ''
  return primaryFromResults || primaryFallback || ''
}

function pickStoryboardTailShot(data: any): string {
  const results = Array.isArray(data?.imageResults) ? data.imageResults : []
  if (!results.length) return ''
  const primaryIndex =
    typeof data?.imagePrimaryIndex === 'number' &&
    data.imagePrimaryIndex >= 0 &&
    data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const slice = results.slice(Math.max(0, primaryIndex + 1))
  const shots = slice.filter(
    (it: any) =>
      it &&
      typeof it.url === 'string' &&
      it.url.trim() &&
      typeof it.title === 'string' &&
      it.title.trim().startsWith('镜头'),
  )
  const lastShot = shots.length ? shots[shots.length - 1] : null
  const lastShotUrl = lastShot && typeof lastShot.url === 'string' ? lastShot.url.trim() : ''
  if (lastShotUrl) return lastShotUrl

  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const url = slice[i] && typeof slice[i].url === 'string' ? slice[i].url.trim() : ''
    if (url) return url
  }

  return pickPrimaryImage(data)
}

function pickVideoTailFrame(data: any): string {
  if (!data) return ''
  const results = Array.isArray(data.videoResults) ? data.videoResults : []
  const primaryIndex =
    typeof data.videoPrimaryIndex === 'number' &&
    data.videoPrimaryIndex >= 0 &&
    data.videoPrimaryIndex < results.length
      ? data.videoPrimaryIndex
      : 0
  const fromResults =
    results[primaryIndex] && typeof results[primaryIndex].thumbnailUrl === 'string'
      ? results[primaryIndex].thumbnailUrl.trim()
      : results[0] && typeof results[0].thumbnailUrl === 'string'
        ? results[0].thumbnailUrl.trim()
        : ''
  const fromNode = typeof data.videoThumbnailUrl === 'string' ? data.videoThumbnailUrl.trim() : ''
  return fromResults || fromNode || ''
}

function resolveNodeLabel(node: Node | undefined): string {
  if (!node) return ''
  const rawLabel = (node.data as any)?.label
  if (typeof rawLabel === 'string' && rawLabel.trim()) return rawLabel.trim()
  return node.id
}

export function collectConnectedUpstreamReferences(
  nodes: Node[],
  edges: Edge[],
  targetId: string,
  options?: CollectUpstreamReferenceOptions,
): UpstreamReferenceCollection {
  const inbound = edges.filter((edge) => edge.target === targetId)
  if (!inbound.length) {
    return { items: [], mostRecentImageNode: null }
  }

  const maxImageSources = Math.max(1, Math.min(10, Math.floor(options?.maxImageSources || 3)))
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const seen = new Set<string>()
  const imageSources: Array<{ edge: Edge; node: Node }> = []
  const items: UpstreamReferenceItem[] = []
  let videoTailFrameAdded = false

  for (const edge of [...inbound].reverse()) {
    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode || seen.has(sourceNode.id)) continue

    const sourceData: any = sourceNode.data || {}
    const sourceKind = typeof sourceData.kind === 'string' ? sourceData.kind : undefined
    if (!sourceKind) continue

    if (!videoTailFrameAdded && VIDEO_REFERENCE_NODE_KINDS.has(sourceKind)) {
      const tailFrameUrl = pickVideoTailFrame(sourceData)
      if (tailFrameUrl) {
        items.push({
          edgeId: edge.id,
          sourceId: sourceNode.id,
          sourceKind,
          sourceLabel: resolveNodeLabel(sourceNode),
          url: tailFrameUrl,
          referenceType: 'videoTail',
          soraFileId: null,
        })
        videoTailFrameAdded = true
      }
      seen.add(sourceNode.id)
      continue
    }

    if (!IMAGE_NODE_KINDS.has(sourceKind)) continue

    seen.add(sourceNode.id)
    imageSources.push({ edge, node: sourceNode })
    if (imageSources.length >= maxImageSources) break
  }

  imageSources.forEach(({ edge, node }) => {
    const sourceData: any = node.data || {}
    const sourceKind = typeof sourceData.kind === 'string' ? sourceData.kind : undefined
    if (!sourceKind) return

    const referenceType =
      options?.preferStoryboardTailShot && sourceKind === 'storyboardImage'
        ? 'storyboardTail'
        : 'image'
    const url =
      referenceType === 'storyboardTail'
        ? pickStoryboardTailShot(sourceData)
        : pickPrimaryImage(sourceData)

    if (!url) return

    items.push({
      edgeId: edge.id,
      sourceId: node.id,
      sourceKind,
      sourceLabel: resolveNodeLabel(node),
      url,
      referenceType,
      soraFileId:
        typeof sourceData.soraFileId === 'string' && sourceData.soraFileId.trim()
          ? sourceData.soraFileId.trim()
          : null,
    })
  })

  return {
    items,
    mostRecentImageNode: imageSources[0]?.node || null,
  }
}
