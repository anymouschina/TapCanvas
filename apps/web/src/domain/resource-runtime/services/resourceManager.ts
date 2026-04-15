import type {
  AcquireImageResourceInput,
  DecodedImageResource,
  ImageResourceEntry,
  ImageResourceId,
  ImageTransportKind,
  ObjectUrlRevokeReason,
  ResourceCachePolicy,
  ResourceFailurePhase,
  ResourceFailureRecord,
  ResourceHandle,
  ResourceKind,
  ResourceOwner,
  ResourcePriority,
  ResourceRequestedSize,
  ResourceTrimReason,
  ResourceVariantKey,
} from '../model/resourceTypes'
import { DEFAULT_REQUESTED_SIZE } from '../model/resourceTypes'
import { rebuildResourceRuntimeDiagnostics, estimateImageResourceBytes } from './resourceCache'
import { buildBudgetTrimPlan, buildTrimPlanForReason } from './resourceReaper'
import { useResourceRuntimeStore, type ResourceRuntimeState } from '../store/resourceRuntimeStore'
import { imageTransportClient } from './imageTransportClient'

const PRIORITY_ORDER: Record<ResourcePriority, number> = {
  critical: 0,
  visible: 1,
  prefetch: 2,
  background: 3,
}

type ActiveRequestController = {
  abort: () => void
}

type DownloadPayload = {
  blob: Blob | null
  objectUrl: string | null
  renderUrl: string
  transport: ImageTransportKind
  estimatedBytes: number | null
}

type QueueMode = 'download' | 'decode'

const activeControllers = new Map<ImageResourceId, ActiveRequestController>()
const pendingDecodePayloads = new Map<ImageResourceId, DownloadPayload>()

export type ResourceWorkPauseState = Pick<ResourceRuntimeState, 'backgroundPaused' | 'viewportMoving' | 'nodeDragging'>

function now(): number {
  return Date.now()
}

function rankPriority(priority: ResourcePriority): number {
  return PRIORITY_ORDER[priority]
}

export function shouldPauseImageWork(priority: ResourcePriority, state: ResourceWorkPauseState): boolean {
  if (!state.backgroundPaused && !state.viewportMoving && !state.nodeDragging) return false
  // Viewport pan is the most frame-sensitive interaction: pause every non-critical
  // decode/download so already-mounted fixed overlays stay responsive.
  if (state.viewportMoving) {
    return rankPriority(priority) > rankPriority('critical')
  }
  return rankPriority(priority) > rankPriority('visible')
}

function normalizeString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeRequestedSize(value?: Partial<ResourceRequestedSize>): ResourceRequestedSize {
  return {
    width: typeof value?.width === 'number' && Number.isFinite(value.width) && value.width > 0 ? Math.round(value.width) : null,
    height: typeof value?.height === 'number' && Number.isFinite(value.height) && value.height > 0 ? Math.round(value.height) : null,
    dpr: typeof value?.dpr === 'number' && Number.isFinite(value.dpr) && value.dpr > 0 ? value.dpr : DEFAULT_REQUESTED_SIZE.dpr,
    fit: value?.fit ?? DEFAULT_REQUESTED_SIZE.fit,
  }
}

function normalizeCachePolicy(policy?: ResourceCachePolicy): ResourceCachePolicy {
  return policy ?? 'viewport'
}

function normalizeKind(kind?: ResourceKind): ResourceKind {
  return kind ?? 'image'
}

function normalizeVariantKey(kind: ResourceKind, variantKey?: ResourceVariantKey): ResourceVariantKey {
  if (variantKey) return variantKey
  if (kind === 'thumbnail') return 'thumbnail'
  if (kind === 'preview') return 'preview'
  if (kind === 'mosaicSource') return 'mosaic-source'
  if (kind === 'videoFrame') return 'video-frame'
  return 'original'
}

function normalizeOwner(owner: AcquireImageResourceInput['owner']): ResourceOwner | null {
  if (!owner) return null
  const ownerSurface = owner.ownerSurface
  if (!ownerSurface) return null
  const ownerRequestKey = normalizeString(owner.ownerRequestKey) || `${ownerSurface}:${now()}`
  const ownerNodeId = normalizeString(owner.ownerNodeId) || null
  return {
    ownerNodeId,
    ownerSurface,
    ownerRequestKey,
  }
}

function canonicalizeRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const keptEntries = [...parsed.searchParams.entries()]
      .filter(([key]) => !key.toLowerCase().startsWith('utm_') && key.toLowerCase() !== 't')
      .sort(([left], [right]) => left.localeCompare(right))
    parsed.search = ''
    for (const [key, value] of keptEntries) {
      parsed.searchParams.append(key, value)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function buildCanonicalUrl(url: string): string {
  const normalized = normalizeString(url)
  if (!normalized) return ''
  if (normalized.startsWith('blob:')) return `blob:${normalized}`
  if (normalized.startsWith('data:')) {
    const prefix = normalized.slice(0, Math.min(normalized.indexOf(',') > 0 ? normalized.indexOf(',') : 48, 48))
    return `data:${prefix}`
  }
  return canonicalizeRemoteUrl(normalized)
}

function buildImageResourceId(kind: ResourceKind, canonicalUrl: string, variantKey: ResourceVariantKey): ImageResourceId {
  return `${kind}:${variantKey}:${canonicalUrl}`
}

function withDiagnostics(nextState: ResourceRuntimeState): ResourceRuntimeState {
  return {
    ...nextState,
    diagnostics: rebuildResourceRuntimeDiagnostics(nextState.imageEntries, nextState.diagnostics),
  }
}

function compareEntryPriority(left: ImageResourceEntry, right: ImageResourceEntry): number {
  const byPriority = rankPriority(left.descriptor.priority) - rankPriority(right.descriptor.priority)
  if (byPriority !== 0) return byPriority
  return left.createdAt - right.createdAt
}

function sortQueue(queue: ImageResourceId[], entries: Record<ImageResourceId, ImageResourceEntry>): ImageResourceId[] {
  return [...queue].sort((leftId, rightId) => {
    const left = entries[leftId]
    const right = entries[rightId]
    if (!left && !right) return 0
    if (!left) return 1
    if (!right) return -1
    return compareEntryPriority(left, right)
  })
}

function recordFailure(entry: ResourceHandle, phase: ResourceFailurePhase, message: string): ResourceHandle {
  const failure: ResourceFailureRecord = {
    phase,
    at: now(),
    message,
  }
  return {
    ...entry,
    state: 'failed',
    failureReason: message,
    lastFailure: failure,
    lastAccessAt: failure.at,
    decoded: null,
  }
}

function isImmediateUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:')
}

function revokeDecoded(decoded: DecodedImageResource | null, reason: ObjectUrlRevokeReason): number {
  if (!decoded) return 0
  if (decoded.imageBitmap) {
    decoded.imageBitmap.close()
  }
  if (decoded.objectUrl) {
    URL.revokeObjectURL(decoded.objectUrl)
  }
  const count = decoded.objectUrl ? 1 : 0
  if (count > 0) {
    useResourceRuntimeStore.setState((state) => ({
      ...state,
      diagnostics: {
        ...state.diagnostics,
        revokedObjectUrlCount: state.diagnostics.revokedObjectUrlCount + count,
        revokedObjectUrlByReason: {
          ...state.diagnostics.revokedObjectUrlByReason,
          [reason]: state.diagnostics.revokedObjectUrlByReason[reason] + count,
        },
      },
    }))
  }
  return count
}

function updateEntry(id: ImageResourceId, updater: (entry: ImageResourceEntry) => ImageResourceEntry) {
  useResourceRuntimeStore.setState((state) => {
    const current = state.imageEntries[id]
    if (!current) return state
    return withDiagnostics({
      ...state,
      imageEntries: {
        ...state.imageEntries,
        [id]: updater(current),
      },
    })
  })
}

function upsertEntry(entry: ImageResourceEntry) {
  useResourceRuntimeStore.setState((state) => withDiagnostics({
    ...state,
    imageEntries: {
      ...state.imageEntries,
      [entry.id]: entry,
    },
  }))
}

function removeEntries(ids: ImageResourceId[], reason: ObjectUrlRevokeReason, trimReason: ResourceTrimReason | null): number {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return 0

  useResourceRuntimeStore.setState((state) => {
    const nextEntries: Record<ImageResourceId, ImageResourceEntry> = { ...state.imageEntries }
    const removed = new Set<ImageResourceId>()
    for (const id of uniqueIds) {
      const entry = nextEntries[id]
      if (!entry) continue
      revokeDecoded(entry.decoded, reason)
      const pendingPayload = pendingDecodePayloads.get(id)
      if (pendingPayload?.objectUrl) {
        URL.revokeObjectURL(pendingPayload.objectUrl)
      }
      pendingDecodePayloads.delete(id)
      activeControllers.get(id)?.abort()
      activeControllers.delete(id)
      removed.add(id)
      delete nextEntries[id]
    }
    if (removed.size === 0) return state
    const nextState = withDiagnostics({
      ...state,
      imageEntries: nextEntries,
      queuedImageIds: state.queuedImageIds.filter((id) => !removed.has(id)),
      queuedDecodeIds: state.queuedDecodeIds.filter((id) => !removed.has(id)),
    })
    return {
      ...nextState,
      diagnostics: {
        ...nextState.diagnostics,
        trimmedResourceCount: nextState.diagnostics.trimmedResourceCount + (trimReason ? removed.size : 0),
        lruTrimCount: nextState.diagnostics.lruTrimCount + (trimReason === 'lru' ? removed.size : 0),
        lastTrimReason: trimReason ?? nextState.diagnostics.lastTrimReason,
      },
    }
  })

  return uniqueIds.length
}

function setDownloadSlots(activeDownloads: number) {
  useResourceRuntimeStore.setState((state) => ({
    ...state,
    activeDownloads,
  }))
}

function setDecodeSlots(activeDecodes: number) {
  useResourceRuntimeStore.setState((state) => ({
    ...state,
    activeDecodes,
  }))
}

function queueResource(id: ImageResourceId, mode: QueueMode) {
  useResourceRuntimeStore.setState((state) => {
    if (mode === 'download') {
      if (state.queuedImageIds.includes(id)) return state
      const entry = state.imageEntries[id]
      if (!entry) return state
      return withDiagnostics({
        ...state,
        queuedImageIds: sortQueue([...state.queuedImageIds, id], state.imageEntries),
        imageEntries: {
          ...state.imageEntries,
          [id]: {
            ...entry,
            state: 'queued',
          },
        },
      })
    }
    if (state.queuedDecodeIds.includes(id)) return state
    return {
      ...state,
      queuedDecodeIds: sortQueue([...state.queuedDecodeIds, id], state.imageEntries),
    }
  })
}

async function loadTransport(url: string): Promise<DownloadPayload> {
  if (isImmediateUrl(url)) {
    return {
      blob: null,
      objectUrl: null,
      renderUrl: url,
      transport: 'direct-url',
      estimatedBytes: null,
    }
  }
  const { blob } = await imageTransportClient.load(url).promise
  const objectUrl = URL.createObjectURL(blob)
  return {
    blob,
    objectUrl,
    renderUrl: objectUrl,
    transport: 'worker-object-url',
    estimatedBytes: estimateImageResourceBytes(blob.size),
  }
}

function attachDecodedFromImageElement(renderUrl: string): Promise<{ element: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      resolve({
        element: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      })
    }
    image.onerror = () => reject(new Error('image attach failed'))
    image.src = renderUrl
  })
}

async function decodePayload(payload: DownloadPayload): Promise<DecodedImageResource> {
  const attached = await attachDecodedFromImageElement(payload.renderUrl)
  let imageBitmap: ImageBitmap | null = null
  if (typeof createImageBitmap === 'function') {
    try {
      if (payload.blob) {
        imageBitmap = await createImageBitmap(payload.blob)
      } else {
        imageBitmap = await createImageBitmap(attached.element)
      }
    } catch {
      imageBitmap = null
    }
  }
  return {
    blob: payload.blob,
    objectUrl: payload.objectUrl,
    imageBitmap,
    width: attached.width,
    height: attached.height,
    renderUrl: payload.renderUrl,
    transport: payload.transport,
  }
}

function shouldPauseBackground(entry: ImageResourceEntry, state: ResourceRuntimeState): boolean {
  return shouldPauseImageWork(entry.descriptor.priority, state)
}

async function processDownloadQueue(): Promise<void> {
  const state = useResourceRuntimeStore.getState()
  if (state.activeDownloads >= state.maxConcurrentDownloads) return
  const nextIndex = state.queuedImageIds.findIndex((id) => {
    const entry = state.imageEntries[id]
    if (!entry) return false
    return !shouldPauseBackground(entry, state)
  })
  if (nextIndex < 0) return
  const nextId = state.queuedImageIds[nextIndex]
  if (!nextId) return
  useResourceRuntimeStore.setState((current) => ({
    ...current,
    queuedImageIds: current.queuedImageIds.filter((id) => id !== nextId),
    activeDownloads: current.activeDownloads + 1,
  }))
  void startDownload(nextId)
}

async function processDecodeQueue(): Promise<void> {
  const state = useResourceRuntimeStore.getState()
  if (state.activeDecodes >= state.maxConcurrentDecodes) return
  const nextIndex = state.queuedDecodeIds.findIndex((id) => {
    const entry = state.imageEntries[id]
    if (!entry) return false
    return !shouldPauseBackground(entry, state)
  })
  if (nextIndex < 0) return
  const nextId = state.queuedDecodeIds[nextIndex]
  if (!nextId) return
  useResourceRuntimeStore.setState((current) => ({
    ...current,
    queuedDecodeIds: current.queuedDecodeIds.filter((id) => id !== nextId),
    activeDecodes: current.activeDecodes + 1,
  }))
  void startDecode(nextId)
}

async function startDownload(id: ImageResourceId): Promise<void> {
  const entry = useResourceRuntimeStore.getState().imageEntries[id]
  if (!entry || entry.refCount <= 0) {
    setDownloadSlots(Math.max(0, useResourceRuntimeStore.getState().activeDownloads - 1))
    return
  }
  updateEntry(id, (current) => ({
    ...current,
    state: 'loading',
    lastAccessAt: now(),
  }))
  try {
    const payload = isImmediateUrl(entry.descriptor.url)
      ? await loadTransport(entry.descriptor.url)
      : await (() => {
          const transportRequest = imageTransportClient.load(entry.descriptor.url)
          activeControllers.set(id, { abort: transportRequest.abort })
          return transportRequest.promise.then((result) => {
            const objectUrl = URL.createObjectURL(result.blob)
            return {
              blob: result.blob,
              objectUrl,
              renderUrl: objectUrl,
              transport: 'worker-object-url' as const,
              estimatedBytes: estimateImageResourceBytes(result.blob.size),
            }
          })
        })()
    const latest = useResourceRuntimeStore.getState().imageEntries[id]
    if (!latest || latest.refCount <= 0) {
      if (payload.objectUrl) URL.revokeObjectURL(payload.objectUrl)
      return
    }
    pendingDecodePayloads.set(id, payload)
    queueResource(id, 'decode')
    void processDecodeQueue()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'resource fetch failed'
    updateEntry(id, (current) => recordFailure(current, 'fetch', message))
  } finally {
    activeControllers.delete(id)
    setDownloadSlots(Math.max(0, useResourceRuntimeStore.getState().activeDownloads - 1))
    void processDownloadQueue()
  }
}

async function startDecode(id: ImageResourceId): Promise<void> {
  const payload = pendingDecodePayloads.get(id)
  const entry = useResourceRuntimeStore.getState().imageEntries[id]
  if (!payload || !entry || entry.refCount <= 0) {
    pendingDecodePayloads.delete(id)
    setDecodeSlots(Math.max(0, useResourceRuntimeStore.getState().activeDecodes - 1))
    return
  }
  try {
    const decoded = await decodePayload(payload)
    updateEntry(id, (current) => ({
      ...current,
      state: 'ready',
      decoded,
      estimatedBytes: payload.estimatedBytes,
      failureReason: null,
      lastFailure: null,
      lastAccessAt: now(),
    }))
    const latest = useResourceRuntimeStore.getState()
    if (latest.diagnostics.totalEstimatedBytes > latest.maxEstimatedBytes) {
      resourceManager.trimToBudget('budget-exceeded')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'image decode failed'
    if (payload.objectUrl) URL.revokeObjectURL(payload.objectUrl)
    updateEntry(id, (current) => recordFailure(current, 'decode', message))
  } finally {
    pendingDecodePayloads.delete(id)
    setDecodeSlots(Math.max(0, useResourceRuntimeStore.getState().activeDecodes - 1))
    void processDecodeQueue()
  }
}

function buildEntry(input: AcquireImageResourceInput): ImageResourceEntry | null {
  const url = normalizeString(input.url)
  if (!url) return null
  const kind = normalizeKind(input.kind)
  const canonicalUrl = buildCanonicalUrl(url)
  const variantKey = normalizeVariantKey(kind, input.variantKey)
  const descriptorId = buildImageResourceId(kind, canonicalUrl, variantKey)
  const createdAt = now()
  const owner = normalizeOwner(input.owner)
  return {
    id: descriptorId,
    descriptor: {
      id: descriptorId,
      kind,
      url,
      canonicalUrl,
      variantKey,
      priority: input.priority ?? 'visible',
      requestedSize: normalizeRequestedSize(input.requestedSize),
      cachePolicy: normalizeCachePolicy(input.cachePolicy),
    },
    state: 'idle',
    refCount: 1,
    lastAccessAt: createdAt,
    createdAt,
    estimatedBytes: null,
    failureReason: null,
    lastFailure: null,
    owners: owner ? [owner] : [],
    decoded: null,
  }
}

function mergeOwner(currentOwners: ResourceOwner[], nextOwner: ResourceOwner | null): ResourceOwner[] {
  if (!nextOwner) return currentOwners
  const exists = currentOwners.some((owner) => (
    owner.ownerRequestKey === nextOwner.ownerRequestKey
    && owner.ownerSurface === nextOwner.ownerSurface
    && owner.ownerNodeId === nextOwner.ownerNodeId
  ))
  return exists ? currentOwners : [...currentOwners, nextOwner]
}

function rebuildQueue(id: ImageResourceId) {
  const state = useResourceRuntimeStore.getState()
  if (state.queuedImageIds.includes(id)) {
    useResourceRuntimeStore.setState((current) => ({
      ...current,
      queuedImageIds: sortQueue(current.queuedImageIds, current.imageEntries),
    }))
  }
  if (state.queuedDecodeIds.includes(id)) {
    useResourceRuntimeStore.setState((current) => ({
      ...current,
      queuedDecodeIds: sortQueue(current.queuedDecodeIds, current.imageEntries),
    }))
  }
}

export const resourceManager = {
  buildResourceId(input: Pick<AcquireImageResourceInput, 'url' | 'kind' | 'variantKey'>): ImageResourceId | null {
    const url = normalizeString(input.url)
    if (!url) return null
    const kind = normalizeKind(input.kind)
    const canonicalUrl = buildCanonicalUrl(url)
    return buildImageResourceId(kind, canonicalUrl, normalizeVariantKey(kind, input.variantKey))
  },

  acquireImage(input: AcquireImageResourceInput): ImageResourceId | null {
    const nextEntry = buildEntry(input)
    if (!nextEntry) return null
    const owner = normalizeOwner(input.owner)
    const existing = useResourceRuntimeStore.getState().imageEntries[nextEntry.id]
    if (existing) {
      updateEntry(nextEntry.id, (current) => ({
        ...current,
        refCount: current.refCount + 1,
        descriptor: {
          ...current.descriptor,
          priority: rankPriority(nextEntry.descriptor.priority) < rankPriority(current.descriptor.priority)
            ? nextEntry.descriptor.priority
            : current.descriptor.priority,
          requestedSize: nextEntry.descriptor.requestedSize,
          cachePolicy: nextEntry.descriptor.cachePolicy,
        },
        owners: mergeOwner(current.owners, owner),
        lastAccessAt: now(),
        state: current.state === 'released' ? 'idle' : current.state,
      }))
      const refreshed = useResourceRuntimeStore.getState().imageEntries[nextEntry.id]
      if (refreshed && (refreshed.state === 'idle' || refreshed.state === 'failed')) {
        queueResource(nextEntry.id, 'download')
        void processDownloadQueue()
      } else {
        rebuildQueue(nextEntry.id)
      }
      return nextEntry.id
    }
    upsertEntry(nextEntry)
    queueResource(nextEntry.id, 'download')
    void processDownloadQueue()
    return nextEntry.id
  },

  updateImagePriority(id: ImageResourceId | null, priority: ResourcePriority) {
    if (!id) return
    updateEntry(id, (current) => {
      if (rankPriority(priority) >= rankPriority(current.descriptor.priority)) {
        return {
          ...current,
          lastAccessAt: now(),
        }
      }
      return {
        ...current,
        descriptor: {
          ...current.descriptor,
          priority,
        },
        lastAccessAt: now(),
      }
    })
    rebuildQueue(id)
  },

  releaseImage(id: ImageResourceId | null, ownerRequestKey?: string | null, revokeReason: ObjectUrlRevokeReason = 'manual-release') {
    if (!id) return
    const entry = useResourceRuntimeStore.getState().imageEntries[id]
    if (!entry) return
    const nextOwners = ownerRequestKey
      ? entry.owners.filter((owner) => owner.ownerRequestKey !== ownerRequestKey)
      : entry.owners
    if (entry.refCount > 1) {
      updateEntry(id, (current) => ({
        ...current,
        refCount: Math.max(0, current.refCount - 1),
        owners: ownerRequestKey ? nextOwners : current.owners,
        lastAccessAt: now(),
      }))
      return
    }
    removeEntries([id], revokeReason, null)
  },

  releaseNodeResources(nodeId: string) {
    const trimmedNodeId = normalizeString(nodeId)
    if (!trimmedNodeId) return 0
    const state = useResourceRuntimeStore.getState()
    const resourceIds = Object.values(state.imageEntries)
      .filter((entry) => entry.owners.some((owner) => owner.ownerNodeId === trimmedNodeId))
      .map((entry) => entry.id)
    return removeEntries(resourceIds, 'manual-release', null)
  },

  invalidateResource(id: ImageResourceId | null) {
    if (!id) return
    updateEntry(id, (current) => ({
      ...current,
      state: 'idle',
      decoded: null,
      failureReason: null,
      lastFailure: null,
      estimatedBytes: null,
      lastAccessAt: now(),
    }))
    queueResource(id, 'download')
    void processDownloadQueue()
  },

  trimToBudget(reason: ResourceTrimReason): number {
    const state = useResourceRuntimeStore.getState()
    const plan = reason === 'budget-exceeded'
      ? buildBudgetTrimPlan(state.imageEntries, state.maxEstimatedBytes, state.diagnostics.totalEstimatedBytes)
      : buildTrimPlanForReason(state.imageEntries, reason, 8)
    if (plan.resourceIds.length === 0) return 0
    return removeEntries(plan.resourceIds, 'reaper-trim', plan.reason)
  },

  replaceLocalPreview(currentLocalResourceId: ImageResourceId | null) {
    if (!currentLocalResourceId) return
    removeEntries([currentLocalResourceId], 'upload-replacement', null)
  },

  pauseBackgroundLoading() {
    useResourceRuntimeStore.setState((state) => ({
      ...state,
      backgroundPaused: true,
    }))
  },

  resumeBackgroundLoading() {
    useResourceRuntimeStore.setState((state) => ({
      ...state,
      backgroundPaused: false,
    }))
    void processDownloadQueue()
    void processDecodeQueue()
  },

  setViewportMoving(nextViewportMoving: boolean) {
    useResourceRuntimeStore.setState((state) => ({
      ...state,
      viewportMoving: nextViewportMoving,
    }))
    if (nextViewportMoving) {
      this.pauseBackgroundLoading()
      return
    }
    this.resumeBackgroundLoading()
  },

  setNodeDragging(nextNodeDragging: boolean) {
    useResourceRuntimeStore.setState((state) => ({
      ...state,
      nodeDragging: nextNodeDragging,
    }))
    if (nextNodeDragging) {
      this.pauseBackgroundLoading()
      return
    }
    this.resumeBackgroundLoading()
  },
}
