import type { ImageResourceEntry, ImageResourceId, ResourcePriority, ResourceTrimReason } from '../model/resourceTypes'

export type ResourceTrimPlan = {
  reason: ResourceTrimReason
  resourceIds: ImageResourceId[]
  estimatedBytesReclaimed: number
}

const PRIORITY_RANK: Record<ResourcePriority, number> = {
  critical: 0,
  visible: 1,
  prefetch: 2,
  background: 3,
}

function getEstimatedBytes(entry: ImageResourceEntry): number {
  if (typeof entry.estimatedBytes !== 'number' || !Number.isFinite(entry.estimatedBytes) || entry.estimatedBytes <= 0) {
    return 0
  }
  return entry.estimatedBytes
}

function isTrimEligible(entry: ImageResourceEntry): boolean {
  return entry.refCount <= 0 && Boolean(entry.decoded?.objectUrl || entry.decoded?.imageBitmap)
}

function compareTrimCandidate(left: ImageResourceEntry, right: ImageResourceEntry): number {
  const byPriority = PRIORITY_RANK[right.descriptor.priority] - PRIORITY_RANK[left.descriptor.priority]
  if (byPriority !== 0) return byPriority
  const byLastAccess = left.lastAccessAt - right.lastAccessAt
  if (byLastAccess !== 0) return byLastAccess
  return left.createdAt - right.createdAt
}

export function buildBudgetTrimPlan(
  entries: Record<ImageResourceId, ImageResourceEntry>,
  maxEstimatedBytes: number,
  currentEstimatedBytes: number,
): ResourceTrimPlan {
  if (!Number.isFinite(maxEstimatedBytes) || maxEstimatedBytes <= 0) {
    return {
      reason: 'budget-exceeded',
      resourceIds: [],
      estimatedBytesReclaimed: 0,
    }
  }
  if (currentEstimatedBytes <= maxEstimatedBytes) {
    return {
      reason: 'budget-exceeded',
      resourceIds: [],
      estimatedBytesReclaimed: 0,
    }
  }

  const candidates = Object.values(entries)
    .filter(isTrimEligible)
    .sort(compareTrimCandidate)

  let remainingBytes = currentEstimatedBytes
  let reclaimedBytes = 0
  const resourceIds: ImageResourceId[] = []

  for (const entry of candidates) {
    if (remainingBytes <= maxEstimatedBytes) break
    const estimatedBytes = getEstimatedBytes(entry)
    resourceIds.push(entry.id)
    reclaimedBytes += estimatedBytes
    remainingBytes -= estimatedBytes
  }

  return {
    reason: 'budget-exceeded',
    resourceIds,
    estimatedBytesReclaimed: reclaimedBytes,
  }
}

export function buildTrimPlanForReason(
  entries: Record<ImageResourceId, ImageResourceEntry>,
  reason: ResourceTrimReason,
  limit: number,
): ResourceTrimPlan {
  const candidates = Object.values(entries)
    .filter(isTrimEligible)
    .sort(compareTrimCandidate)
    .slice(0, Math.max(0, limit))

  return {
    reason,
    resourceIds: candidates.map((entry) => entry.id),
    estimatedBytesReclaimed: candidates.reduce((total, entry) => total + getEstimatedBytes(entry), 0),
  }
}
