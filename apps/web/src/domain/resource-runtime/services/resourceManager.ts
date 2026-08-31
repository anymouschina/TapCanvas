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
import {
  estimateDecodedImageBytes,
  estimateImageResourceBytes,
  rebuildResourceRuntimeDiagnostics,
} from './resourceCache'
import { buildBudgetTrimPlan, buildTrimPlanForReason } from './resourceReaper'
import { buildImageDeliveryUrl } from './imageUrlTransform'
import { useResourceRuntimeStore, type ResourceRuntimeState } from '../store/resourceRuntimeStore'

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

const activeControllers = new Map<ImageResourceId, ActiveRequestController>()
const pendingReleases = new Map<ImageResourceId, ReturnType<typeof setTimeout>>()
const RELEASE_GRACE_MS = 15_000

// Native <img> decode completion reports natural dimensions and a conservative
// RGBA byte estimate. Coalesce a burst of those reports into one budget-trim
// pass so hundreds of images decoding at once cannot OOM-crash the tab.
// The reaper only evicts refCount<=0 entries, so live/visible images are safe.
const BUDGET_TRIM_DEBOUNCE_MS = 300
let budgetTrimTimer: ReturnType<typeof setTimeout> | null = null
function scheduleBudgetTrim(): void {
  if (budgetTrimTimer !== null) return
  budgetTrimTimer = setTimeout(() => {
    budgetTrimTimer = null
    const state = useResourceRuntimeStore.getState()
    if (state.diagnostics.totalEstimatedBytes > state.maxEstimatedBytes) {
      resourceManager.trimToBudget('budget-exceeded')
    }
  }, BUDGET_TRIM_DEBOUNCE_MS)
}

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

function hashStringForResourceKey(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function buildCanonicalUrl(url: string): string {
  const normalized = normalizeString(url)
  if (!normalized) return ''
  if (normalized.startsWith('blob:')) return `blob:${normalized}`
  if (normalized.startsWith('data:')) {
    const prefix = normalized.slice(0, Math.min(normalized.indexOf(',') > 0 ? normalized.indexOf(',') : 48, 48))
    return `${prefix}:len-${normalized.length}:hash-${hashStringForResourceKey(normalized)}`
  }
  return canonicalizeRemoteUrl(normalized)
}

// Quantize the requested CSS-pixel width (already multiplied by dpr by caller)
// into a small set of buckets. Each bucket maps to a distinct CDN URL and
// resource entry — variant swapping is just a different bucket.
// Buckets are powers-of-two-ish to maximize CDN/SW cache reuse across nodes.
function quantizeWidthBucket(width: number | null | undefined): string {
  if (!width || !Number.isFinite(width) || width <= 0) return ''
  if (width <= 256) return 'w256'
  if (width <= 512) return 'w512'
  if (width <= 1024) return 'w1024'
  if (width <= 2048) return 'w2048'
  return 'w-orig'
}

function buildImageResourceId(
  kind: ResourceKind,
  canonicalUrl: string,
  variantKey: ResourceVariantKey,
  widthBucket: string,
): ImageResourceId {
  const bucketSuffix = widthBucket ? `:${widthBucket}` : ''
  return `${kind}:${variantKey}${bucketSuffix}:${canonicalUrl}`
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

function queueResource(id: ImageResourceId) {
  useResourceRuntimeStore.setState((state) => {
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
  })
}

async function loadTransport(url: string): Promise<DownloadPayload> {
  // All URLs (data:, blob:, http(s):) are now passed through directly to the
  // <img> element. The browser handles fetching, caching (HTTP / SW), and
  // decoding natively — this restores native pixel-retention on src swap,
  // enables HTTP/SW cache hits, and lets width-based variant switching work
  // (different ?width=N URLs are distinct browser cache keys).
  // Previously HTTPS URLs were downloaded into a Blob via the worker transport
  // and exposed as object-URLs, which broke variant swapping and forced manual
  // lifecycle management with subtle revoke-timing bugs.
  return {
    blob: null,
    objectUrl: null,
    renderUrl: url,
    transport: 'direct-url',
    estimatedBytes: null,
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
    // Focused editors omit requestedSize and keep the persisted original.
    // Lightweight canvas shells request verified TOS width variants.
    const fetchUrl = buildImageDeliveryUrl(entry.descriptor.url, {
      width: entry.descriptor.requestedSize?.width ?? null,
    })
    // Pass-through transport for every URL — see loadTransport for rationale.
    const payload = await loadTransport(fetchUrl)
    const latest = useResourceRuntimeStore.getState().imageEntries[id]
    if (!latest || latest.refCount <= 0) {
      if (payload.objectUrl) URL.revokeObjectURL(payload.objectUrl)
      return
    }
    // Mark entry as ready immediately. We used to spin up a second <img> to
    // run image.decode() and read naturalWidth/Height, but that's a duplicate
    // decode of the same URL that the visible <img> in ManagedImage is already
    // doing — pure CPU waste. width/height are populated lazily by the visible
    // <img>'s onLoad through resourceManager.recordDecodedSize.
    updateEntry(id, (current) => ({
      ...current,
      state: 'ready',
      decoded: {
        blob: payload.blob,
        objectUrl: payload.objectUrl,
        imageBitmap: null,
        width: current.decoded?.width ?? 0,
        height: current.decoded?.height ?? 0,
        renderUrl: payload.renderUrl,
        transport: payload.transport,
      },
      estimatedBytes: payload.estimatedBytes,
      failureReason: null,
      lastFailure: null,
      lastAccessAt: now(),
    }))
    // Direct-url entries get their byte estimate after the visible <img>
    // reports its decoded natural size.
  } catch (error) {
    const message = error instanceof Error ? error.message : 'resource fetch failed'
    updateEntry(id, (current) => recordFailure(current, 'fetch', message))
  } finally {
    activeControllers.delete(id)
    setDownloadSlots(Math.max(0, useResourceRuntimeStore.getState().activeDownloads - 1))
    void processDownloadQueue()
  }
}

function buildEntry(input: AcquireImageResourceInput): ImageResourceEntry | null {
  const url = normalizeString(input.url)
  if (!url) return null
  const kind = normalizeKind(input.kind)
  const canonicalUrl = buildCanonicalUrl(url)
  const variantKey = normalizeVariantKey(kind, input.variantKey)
  const requestedSize = normalizeRequestedSize(input.requestedSize)
  const widthBucket = quantizeWidthBucket(requestedSize.width)
  const descriptorId = buildImageResourceId(kind, canonicalUrl, variantKey, widthBucket)
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
      requestedSize,
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
}

export const resourceManager = {
  buildResourceId(
    input: Pick<AcquireImageResourceInput, 'url' | 'kind' | 'variantKey' | 'requestedSize'>,
  ): ImageResourceId | null {
    const url = normalizeString(input.url)
    if (!url) return null
    const kind = normalizeKind(input.kind)
    const canonicalUrl = buildCanonicalUrl(url)
    const requestedSize = normalizeRequestedSize(input.requestedSize)
    const widthBucket = quantizeWidthBucket(requestedSize.width)
    return buildImageResourceId(kind, canonicalUrl, normalizeVariantKey(kind, input.variantKey), widthBucket)
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
      if (pendingReleases.has(nextEntry.id)) {
        clearTimeout(pendingReleases.get(nextEntry.id)!)
        pendingReleases.delete(nextEntry.id)
      }
      const refreshed = useResourceRuntimeStore.getState().imageEntries[nextEntry.id]
      if (refreshed && (refreshed.state === 'idle' || refreshed.state === 'failed')) {
        queueResource(nextEntry.id)
        void processDownloadQueue()
      } else {
        rebuildQueue(nextEntry.id)
      }
      return nextEntry.id
    }
    upsertEntry(nextEntry)
    queueResource(nextEntry.id)
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
    updateEntry(id, (current) => ({
      ...current,
      refCount: 0,
      owners: ownerRequestKey ? nextOwners : current.owners,
      state: 'released',
      lastAccessAt: now(),
    }))
    if (pendingReleases.has(id)) clearTimeout(pendingReleases.get(id)!)
    pendingReleases.set(id, setTimeout(() => {
      pendingReleases.delete(id)
      const current = useResourceRuntimeStore.getState().imageEntries[id]
      if (current && current.refCount <= 0) {
        removeEntries([id], revokeReason, null)
      }
    }, RELEASE_GRACE_MS))
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
    queueResource(id)
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
  },

  /**
   * Called by ManagedImage's visible <img onLoad> to populate width/height
   * lazily — replaces the second-decode pass that startDecode used to do.
   */
  recordDecodedSize(id: ImageResourceId | null, width: number, height: number): void {
    if (!id || !Number.isFinite(width) || !Number.isFinite(height)) return
    updateEntry(id, (current) => {
      if (!current.decoded) return current
      const estimatedBytes = estimateDecodedImageBytes(width, height)
      if (
        current.decoded.width === width
        && current.decoded.height === height
        && current.estimatedBytes === estimatedBytes
      ) return current
      return {
        ...current,
        decoded: { ...current.decoded, width, height },
        estimatedBytes,
        lastAccessAt: now(),
      }
    })
    scheduleBudgetTrim()
  },

  /**
   * Called by the browser-backed <img> renderer when the attached URL cannot
   * produce image pixels. Direct-url transport only schedules the browser
   * load, so a successful transport hand-off is not proof that the response
   * is a decodable image. Persist the attach failure to stop the renderer from
   * immediately mounting the same broken URL again.
   */
  reportImageElementFailure(id: ImageResourceId | null, failedRenderUrl: string): void {
    if (!id || !failedRenderUrl) return
    updateEntry(id, (current) => {
      if (current.decoded?.renderUrl !== failedRenderUrl) return current
      return recordFailure(current, 'attach', `Image element failed to load: ${failedRenderUrl}`)
    })
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

  setViewportZoom(nextZoom: number) {
    const z = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 1
    // Always bump viewportEpoch even if zoom is unchanged — pan-only viewport
    // changes still move nodes relative to the screen center, so subscribers
    // (ManagedImage focus-based bucketing) need to re-measure.
    useResourceRuntimeStore.setState((state) => ({
      ...state,
      viewportZoom: z,
      viewportEpoch: state.viewportEpoch + 1,
    }))
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
