import type { Node } from '@xyflow/react'
import { useRFStore } from '../../../canvas/store'
import { resourceManager } from './resourceManager'
import { useResourceRuntimeStore } from '../store/resourceRuntimeStore'
import type {
  ImageResourceId,
  ResourceOwnerSurface,
  ResourcePriority,
  ResourceTrimReason,
  ResourceVariantKey,
} from '../model/resourceTypes'

export type ViewportSnapshot = {
  viewportRect: {
    x: number
    y: number
    width: number
    height: number
  }
  zoom: number
  visibleNodeIds: string[]
  bufferNodeIds: string[]
  selectedNodeIds: string[]
  focusedNodeId: string | null
  previewNodeId: string | null
  isDragging: boolean
  isPanning: boolean
}

export type EnsureNodePreviewReadyInput = {
  nodeId: string
  ownerSurface: ResourceOwnerSurface
  preferredVariant: ResourceVariantKey
}

export type EnsureNodePreviewReadyResult = {
  resourceId: ImageResourceId | null
  handleState: 'idle' | 'queued' | 'loading' | 'ready' | 'failed' | 'released'
  failureReason: string | null
}

export type ViewportPatch = {
  acquire: string[]
  release: string[]
  priorityPatches: Array<{ nodeId: string; priority: ResourcePriority }>
  deferred: string[]
}

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function resolveNodeImageUrl(node: Node): string | null {
  if (node.type !== 'taskNode') return null
  const data = node.data
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const direct = normalizeImageUrl(record.imageUrl)
  if (direct) return direct
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  for (const result of imageResults) {
    if (!result || typeof result !== 'object') continue
    const url = normalizeImageUrl((result as Record<string, unknown>).url)
    if (url) return url
  }
  return null
}

export function ensureNodePreviewReady(input: EnsureNodePreviewReadyInput): EnsureNodePreviewReadyResult {
  const node = useRFStore.getState().nodes.find((item) => item.id === input.nodeId) ?? null
  if (!node) {
    return {
      resourceId: null,
      handleState: 'failed',
      failureReason: `node ${input.nodeId} not found`,
    }
  }
  const url = resolveNodeImageUrl(node)
  if (!url) {
    return {
      resourceId: null,
      handleState: 'failed',
      failureReason: `node ${input.nodeId} has no real image url`,
    }
  }
  const resourceId = resourceManager.acquireImage({
    url,
    kind: input.preferredVariant === 'thumbnail' ? 'thumbnail' : 'preview',
    variantKey: input.preferredVariant,
    priority: 'visible',
    owner: {
      ownerNodeId: input.nodeId,
      ownerSurface: input.ownerSurface,
      ownerRequestKey: `${input.ownerSurface}:${input.nodeId}:${input.preferredVariant}`,
    },
  })
  const runtimeEntry = resourceId ? useResourceRuntimeStore.getState().imageEntries[resourceId] : null
  return {
    resourceId,
    handleState: runtimeEntry?.state ?? (resourceId ? 'queued' : 'failed'),
    failureReason: runtimeEntry?.failureReason ?? (resourceId ? null : `failed to acquire ${input.nodeId}`),
  }
}

export function prefetchViewportResources(snapshot: ViewportSnapshot): ViewportPatch {
  const visible = new Set(snapshot.visibleNodeIds)
  const buffered = new Set(snapshot.bufferNodeIds)
  const acquire = [...visible, ...snapshot.bufferNodeIds]
  const release: string[] = []
  const priorityPatches: Array<{ nodeId: string; priority: ResourcePriority }> = []
  const deferred: string[] = []

  for (const node of useRFStore.getState().nodes) {
    if (!visible.has(String(node.id)) && !buffered.has(String(node.id))) {
      release.push(String(node.id))
      continue
    }
    if (visible.has(String(node.id))) {
      priorityPatches.push({ nodeId: String(node.id), priority: 'visible' })
      continue
    }
    if (snapshot.isDragging || snapshot.isPanning) {
      deferred.push(String(node.id))
      continue
    }
    priorityPatches.push({ nodeId: String(node.id), priority: 'prefetch' })
  }

  return { acquire, release, priorityPatches, deferred }
}

export function releaseNodeResources(nodeId: string): number {
  return resourceManager.releaseNodeResources(nodeId)
}

export function pauseBackgroundLoading(): void {
  resourceManager.pauseBackgroundLoading()
}

export function resumeBackgroundLoading(): void {
  resourceManager.resumeBackgroundLoading()
}

export function trimToBudget(reason: ResourceTrimReason): number {
  return resourceManager.trimToBudget(reason)
}

export function invalidateResource(resourceId: ImageResourceId): void {
  resourceManager.invalidateResource(resourceId)
}
