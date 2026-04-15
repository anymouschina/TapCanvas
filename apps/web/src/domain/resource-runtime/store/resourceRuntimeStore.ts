import { create } from 'zustand'
import type {
  ImageResourceEntry,
  ImageResourceId,
  ObjectUrlRevokeReason,
  ResourceFailurePhase,
  ResourceLifecycleState,
  ResourcePriority,
  ResourceTrimReason,
} from '../model/resourceTypes'

export type ResourceRuntimeDiagnostics = {
  readyObjectUrlCount: number
  readyBitmapCount: number
  totalEstimatedBytes: number
  revokedObjectUrlCount: number
  revokedObjectUrlByReason: Record<ObjectUrlRevokeReason, number>
  trimmedResourceCount: number
  lruTrimCount: number
  lastTrimReason: ResourceTrimReason | null
  failureCount: number
  failureByPhase: Record<ResourceFailurePhase, number>
}

export type ResourceRuntimeState = {
  imageEntries: Record<ImageResourceId, ImageResourceEntry>
  queuedImageIds: ImageResourceId[]
  queuedDecodeIds: ImageResourceId[]
  activeDownloads: number
  queuedBatchJobs: number
  activeBatchJobs: number
  maxConcurrentBatchJobs: number
  activeDecodes: number
  maxConcurrentDownloads: number
  maxConcurrentDecodes: number
  maxEstimatedBytes: number
  maxVisibleOriginals: number
  maxActiveDecodedImages: number
  viewportMoving: boolean
  nodeDragging: boolean
  backgroundPaused: boolean
  diagnostics: ResourceRuntimeDiagnostics
}

export type ResourceRuntimeDiagnosticsSnapshot = ResourceRuntimeDiagnostics & {
  handleCount: number
  activeHandleCount: number
  readyHandleCount: number
  queuedHandleCount: number
  loadingHandleCount: number
  failedHandleCount: number
  releasedHandleCount: number
  readyBitmapCount: number
  criticalHandleCount: number
  visibleHandleCount: number
  prefetchHandleCount: number
  backgroundHandleCount: number
  queuedDownloadCount: number
  activeDownloadCount: number
  queuedDecodeCount: number
  activeDecodeCount: number
  queuedBatchJobCount: number
  activeBatchJobCount: number
  viewportMoving: boolean
  nodeDragging: boolean
  backgroundPaused: boolean
}

const RESOURCE_STATES: ResourceLifecycleState[] = ['idle', 'queued', 'loading', 'ready', 'failed', 'released']
const RESOURCE_PRIORITIES: ResourcePriority[] = ['critical', 'visible', 'prefetch', 'background']

function countEntriesByState(
  entries: ImageResourceEntry[],
  state: ResourceLifecycleState,
): number {
  return entries.reduce((count, entry) => (entry.state === state ? count + 1 : count), 0)
}

function countEntriesByPriority(
  entries: ImageResourceEntry[],
  priority: ResourcePriority,
): number {
  return entries.reduce((count, entry) => (entry.descriptor.priority === priority ? count + 1 : count), 0)
}

export function selectResourceRuntimeDiagnosticsSnapshot(
  state: ResourceRuntimeState,
): ResourceRuntimeDiagnosticsSnapshot {
  const entries = Object.values(state.imageEntries)
  const stateCountMap = RESOURCE_STATES.reduce<Record<ResourceLifecycleState, number>>((acc, currentState) => {
    acc[currentState] = countEntriesByState(entries, currentState)
    return acc
  }, {
    idle: 0,
    queued: 0,
    loading: 0,
    ready: 0,
    failed: 0,
    released: 0,
  })
  const priorityCountMap = RESOURCE_PRIORITIES.reduce<Record<ResourcePriority, number>>((acc, currentPriority) => {
    acc[currentPriority] = countEntriesByPriority(entries, currentPriority)
    return acc
  }, {
    critical: 0,
    visible: 0,
    prefetch: 0,
    background: 0,
  })

  return {
    ...state.diagnostics,
    handleCount: entries.length,
    activeHandleCount: entries.reduce((count, entry) => (entry.refCount > 0 ? count + 1 : count), 0),
    readyHandleCount: stateCountMap.ready,
    queuedHandleCount: stateCountMap.queued,
    loadingHandleCount: stateCountMap.loading,
    failedHandleCount: stateCountMap.failed,
    releasedHandleCount: stateCountMap.released,
    readyBitmapCount: state.diagnostics.readyBitmapCount,
    criticalHandleCount: priorityCountMap.critical,
    visibleHandleCount: priorityCountMap.visible,
    prefetchHandleCount: priorityCountMap.prefetch,
    backgroundHandleCount: priorityCountMap.background,
    queuedDownloadCount: state.queuedImageIds.length,
    activeDownloadCount: state.activeDownloads,
    queuedDecodeCount: state.queuedDecodeIds.length,
    activeDecodeCount: state.activeDecodes,
    queuedBatchJobCount: state.queuedBatchJobs,
    activeBatchJobCount: state.activeBatchJobs,
    viewportMoving: state.viewportMoving,
    nodeDragging: state.nodeDragging,
    backgroundPaused: state.backgroundPaused,
  }
}

export const useResourceRuntimeStore = create<ResourceRuntimeState>(() => ({
  imageEntries: {},
  queuedImageIds: [],
  queuedDecodeIds: [],
  activeDownloads: 0,
  queuedBatchJobs: 0,
  activeBatchJobs: 0,
  maxConcurrentBatchJobs: 1,
  activeDecodes: 0,
  maxConcurrentDownloads: 4,
  maxConcurrentDecodes: 2,
  maxEstimatedBytes: 192 * 1024 * 1024,
  maxVisibleOriginals: 1,
  maxActiveDecodedImages: 72,
  viewportMoving: false,
  nodeDragging: false,
  backgroundPaused: false,
  diagnostics: {
    readyObjectUrlCount: 0,
    readyBitmapCount: 0,
    totalEstimatedBytes: 0,
    revokedObjectUrlCount: 0,
    revokedObjectUrlByReason: {
      'manual-release': 0,
      'reaper-trim': 0,
      'upload-replacement': 0,
    },
    trimmedResourceCount: 0,
    lruTrimCount: 0,
    lastTrimReason: null,
    failureCount: 0,
    failureByPhase: {
      fetch: 0,
      decode: 0,
      attach: 0,
      release: 0,
    },
  },
}))
