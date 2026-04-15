import React from 'react'
import type {
  ImageResourceSnapshot,
  ResourceKind,
  ResourceOwnerSurface,
  ResourcePriority,
  ResourceVariantKey,
} from '../model/resourceTypes'
import { EMPTY_IMAGE_RESOURCE_SNAPSHOT } from '../model/resourceTypes'
import { resourceManager } from '../services/resourceManager'
import { useResourceRuntimeStore } from '../store/resourceRuntimeStore'

type UseImageResourceInput = {
  url: string | null | undefined
  kind?: ResourceKind
  variantKey?: ResourceVariantKey
  priority?: ResourcePriority
  enabled?: boolean
  ownerNodeId?: string | null
  ownerSurface?: ResourceOwnerSurface
  ownerRequestKey?: string
  requestedSize?: {
    width?: number | null
    height?: number | null
    dpr?: number
    fit?: 'cover' | 'contain' | 'fill'
  }
}

export function useImageResource(input: UseImageResourceInput): ImageResourceSnapshot {
  const normalizedUrl = React.useMemo(() => (typeof input.url === 'string' ? input.url.trim() : ''), [input.url])
  const kind = input.kind ?? 'image'
  const variantKey = input.variantKey
  const priority = input.priority ?? 'visible'
  const enabled = input.enabled !== false
  const ownerSurface = input.ownerSurface
  const ownerNodeId = input.ownerNodeId ?? null
  const ownerRequestKey = React.useMemo(() => (
    input.ownerRequestKey
    ?? `${ownerSurface ?? 'task-node-main-image'}:${ownerNodeId ?? 'global'}:${normalizedUrl}:${kind}:${variantKey ?? 'original'}`
  ), [input.ownerRequestKey, ownerNodeId, ownerSurface, normalizedUrl, kind, variantKey])
  const [resourceId, setResourceId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!enabled || !normalizedUrl) {
      setResourceId(null)
      return
    }
    const acquiredId = resourceManager.acquireImage({
      url: normalizedUrl,
      kind,
      variantKey,
      priority,
      requestedSize: input.requestedSize,
      owner: ownerSurface
        ? {
            ownerNodeId,
            ownerSurface,
            ownerRequestKey,
          }
        : null,
    })
    setResourceId(acquiredId)
    return () => {
      resourceManager.releaseImage(acquiredId, ownerRequestKey)
    }
  }, [enabled, kind, normalizedUrl, ownerNodeId, ownerRequestKey, ownerSurface, priority, variantKey, input.requestedSize])

  React.useEffect(() => {
    if (!resourceId) return
    resourceManager.updateImagePriority(resourceId, priority)
  }, [priority, resourceId])

  return useResourceRuntimeStore(
    React.useCallback(
      (state): ImageResourceSnapshot => {
        if (!resourceId) return EMPTY_IMAGE_RESOURCE_SNAPSHOT
        const entry = state.imageEntries[resourceId]
        if (!entry) {
          return {
            ...EMPTY_IMAGE_RESOURCE_SNAPSHOT,
            id: resourceId,
            url: normalizedUrl,
          }
        }
        return {
          id: entry.id,
          url: entry.descriptor.url,
          state: entry.state,
          renderUrl: entry.decoded?.renderUrl ?? null,
          transport: entry.decoded?.transport ?? 'none',
          lastError: entry.failureReason,
          estimatedBytes: entry.estimatedBytes,
          width: entry.decoded?.width ?? null,
          height: entry.decoded?.height ?? null,
          failurePhase: entry.lastFailure?.phase ?? null,
          ownerCount: entry.owners.length,
        }
      },
      [normalizedUrl, resourceId],
    ),
  )
}
