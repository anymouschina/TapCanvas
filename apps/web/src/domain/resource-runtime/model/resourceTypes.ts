export type ResourcePriority = 'critical' | 'visible' | 'prefetch' | 'background'

export type ResourceLifecycleState = 'idle' | 'queued' | 'loading' | 'ready' | 'failed' | 'released'

export type ResourceKind = 'image' | 'thumbnail' | 'preview' | 'mosaicSource' | 'videoFrame'

export type ResourceVariantKey = 'thumbnail' | 'preview' | 'original' | 'mosaic-source' | 'video-frame'

export type ResourceFitMode = 'cover' | 'contain' | 'fill'

export type ResourceCachePolicy = 'ephemeral' | 'viewport' | 'session'

export type ResourceOwnerSurface =
  | 'task-node-main-image'
  | 'task-node-candidate'
  | 'task-node-upstream-reference'
  | 'preview-modal'
  | 'mosaic-runner'
  | 'reference-sheet'

export type ImageTransportKind = 'none' | 'object-url' | 'worker-object-url' | 'direct-url'

export type ImageResourceId = string

export type ResourceTrimReason = 'manual' | 'interaction' | 'ttl' | 'lru' | 'budget-exceeded' | 'viewport-out'

export type ResourceFailurePhase = 'fetch' | 'decode' | 'attach' | 'release'

export type ObjectUrlRevokeReason = 'manual-release' | 'reaper-trim' | 'upload-replacement'

export type ResourceRequestedSize = {
  width: number | null
  height: number | null
  dpr: number
  fit: ResourceFitMode
}

export type ResourceDescriptor = {
  id: ImageResourceId
  kind: ResourceKind
  url: string
  canonicalUrl: string
  variantKey: ResourceVariantKey
  priority: ResourcePriority
  requestedSize: ResourceRequestedSize
  cachePolicy: ResourceCachePolicy
}

export type ResourceOwner = {
  ownerNodeId: string | null
  ownerSurface: ResourceOwnerSurface
  ownerRequestKey: string
}

export type ResourceFailureRecord = {
  phase: ResourceFailurePhase
  at: number
  message: string
}

export type DecodedImageResource = {
  blob: Blob | null
  objectUrl: string | null
  imageBitmap: ImageBitmap | null
  width: number
  height: number
  renderUrl: string | null
  transport: ImageTransportKind
}

export type ResourceHandle = {
  id: ImageResourceId
  descriptor: ResourceDescriptor
  state: ResourceLifecycleState
  refCount: number
  lastAccessAt: number
  createdAt: number
  estimatedBytes: number | null
  failureReason: string | null
  lastFailure: ResourceFailureRecord | null
  owners: ResourceOwner[]
  decoded: DecodedImageResource | null
}

export type ImageResourceEntry = ResourceHandle

export type AcquireImageResourceInput = {
  url: string
  kind?: ResourceKind
  variantKey?: ResourceVariantKey
  priority?: ResourcePriority
  requestedSize?: Partial<ResourceRequestedSize>
  cachePolicy?: ResourceCachePolicy
  owner?: Partial<ResourceOwner> | null
}

export type ImageResourceSnapshot = {
  id: ImageResourceId | null
  url: string
  state: ResourceLifecycleState
  renderUrl: string | null
  transport: ImageTransportKind
  lastError: string | null
  estimatedBytes: number | null
  width: number | null
  height: number | null
  failurePhase: ResourceFailurePhase | null
  ownerCount: number
}

export const DEFAULT_REQUESTED_SIZE: ResourceRequestedSize = {
  width: null,
  height: null,
  dpr: 1,
  fit: 'cover',
}

export const EMPTY_IMAGE_RESOURCE_SNAPSHOT: ImageResourceSnapshot = {
  id: null,
  url: '',
  state: 'idle',
  renderUrl: null,
  transport: 'none',
  lastError: null,
  estimatedBytes: null,
  width: null,
  height: null,
  failurePhase: null,
  ownerCount: 0,
}
