import type { ImageResourceEntry } from '../model/resourceTypes'
import type { ResourceRuntimeDiagnostics } from '../store/resourceRuntimeStore'

export function estimateImageResourceBytes(blobSize: number | null | undefined): number | null {
  if (typeof blobSize !== 'number' || !Number.isFinite(blobSize) || blobSize <= 0) return null
  return Math.trunc(blobSize)
}

export function countReadyObjectUrls(entries: Record<string, ImageResourceEntry>): number {
  return Object.values(entries).reduce((count, entry) => {
    if (entry.decoded?.objectUrl && entry.state === 'ready') return count + 1
    return count
  }, 0)
}

export function countReadyBitmaps(entries: Record<string, ImageResourceEntry>): number {
  return Object.values(entries).reduce((count, entry) => {
    if (entry.decoded?.imageBitmap && entry.state === 'ready') return count + 1
    return count
  }, 0)
}

export function sumEstimatedBytes(entries: Record<string, ImageResourceEntry>): number {
  return Object.values(entries).reduce((total, entry) => {
    if (typeof entry.estimatedBytes !== 'number' || !Number.isFinite(entry.estimatedBytes) || entry.estimatedBytes <= 0) {
      return total
    }
    return total + entry.estimatedBytes
  }, 0)
}

export function rebuildResourceRuntimeDiagnostics(
  entries: Record<string, ImageResourceEntry>,
  previous: ResourceRuntimeDiagnostics,
): ResourceRuntimeDiagnostics {
  const failureByPhase = Object.values(entries).reduce<ResourceRuntimeDiagnostics['failureByPhase']>((acc, entry) => {
    const phase = entry.lastFailure?.phase
    if (!phase) return acc
    acc[phase] += 1
    return acc
  }, {
    fetch: 0,
    decode: 0,
    attach: 0,
    release: 0,
  })
  return {
    ...previous,
    readyObjectUrlCount: countReadyObjectUrls(entries),
    readyBitmapCount: countReadyBitmaps(entries),
    totalEstimatedBytes: sumEstimatedBytes(entries),
    failureCount: Object.values(failureByPhase).reduce((total, current) => total + current, 0),
    failureByPhase,
  }
}
