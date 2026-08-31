import { describe, expect, it, vi } from 'vitest'
import { drainDeferredCanvasPatches, type DeferredCanvasPatch } from './deferredCanvasPatchQueue'

describe('drainDeferredCanvasPatches', () => {
  it('acknowledges a deferred revision only after its graph patch is applied', () => {
    const events: string[] = []
    const queue: DeferredCanvasPatch<{ revision: number }>[] = [
      {
        patch: { revision: 12 },
        onApplied: (patch) => events.push(`ack:${patch.revision}`),
      },
    ]

    drainDeferredCanvasPatches(queue, (patch) => events.push(`apply:${patch.revision}`))

    expect(events).toEqual(['apply:12', 'ack:12'])
    expect(queue).toEqual([])
  })

  it('runs each apply and acknowledgement exactly once in queue order', () => {
    const apply = vi.fn()
    const acknowledge = vi.fn()
    const queue: DeferredCanvasPatch<{ revision: number }>[] = [
      { patch: { revision: 3 }, onApplied: acknowledge },
      { patch: { revision: 4 }, onApplied: acknowledge },
    ]

    drainDeferredCanvasPatches(queue, apply)

    expect(apply.mock.calls.map(([patch]) => patch.revision)).toEqual([3, 4])
    expect(acknowledge.mock.calls.map(([patch]) => patch.revision)).toEqual([3, 4])
  })
})
