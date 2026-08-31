import { describe, expect, it } from 'vitest'
import type { ImageResourceEntry, ResourcePriority } from '../model/resourceTypes'
import { buildBudgetTrimPlan } from './resourceReaper'

function directUrlEntry(input: Readonly<{
  id: string
  refCount: number
  estimatedBytes: number
  priority?: ResourcePriority
}>): ImageResourceEntry {
  return {
    id: input.id,
    descriptor: {
      id: input.id,
      kind: 'image',
      url: `https://example.com/${input.id}.webp`,
      canonicalUrl: `https://example.com/${input.id}.webp`,
      variantKey: 'original',
      priority: input.priority ?? 'visible',
      requestedSize: { width: 512, height: null, dpr: 1, fit: 'cover' },
      cachePolicy: 'viewport',
    },
    state: input.refCount > 0 ? 'ready' : 'released',
    refCount: input.refCount,
    lastAccessAt: 1,
    createdAt: 1,
    estimatedBytes: input.estimatedBytes,
    failureReason: null,
    lastFailure: null,
    owners: [],
    decoded: {
      blob: null,
      objectUrl: null,
      imageBitmap: null,
      width: 512,
      height: 288,
      renderUrl: `https://example.com/${input.id}.webp`,
      transport: 'direct-url',
    },
  }
}

describe('resourceReaper direct-url entries', () => {
  it('reclaims released browser-backed image records when over budget', () => {
    const released = directUrlEntry({ id: 'released', refCount: 0, estimatedBytes: 12_000_000 })
    const plan = buildBudgetTrimPlan({ released }, 4_000_000, 12_000_000)

    expect(plan.resourceIds).toEqual(['released'])
    expect(plan.estimatedBytesReclaimed).toBe(12_000_000)
  })

  it('never reaps a live visible image', () => {
    const live = directUrlEntry({ id: 'live', refCount: 1, estimatedBytes: 12_000_000 })
    const plan = buildBudgetTrimPlan({ live }, 4_000_000, 12_000_000)

    expect(plan.resourceIds).toEqual([])
  })
})
