import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueNodeHandleRefresh } from './useRefreshNodeHandles'

describe('batched handle measurements', () => {
  let callbacks: Map<number, FrameRequestCallback>
  beforeEach(() => {
    callbacks = new Map()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const flush = () => {
    const pending = [...callbacks.values()]
    callbacks.clear()
    pending.forEach(callback => callback(0))
  }

  it('measures a batch once and isolates separate React Flow providers', () => {
    const store = {}
    const refresh = vi.fn()
    const otherRefresh = vi.fn()
    for (let index = 0; index < 86; index += 1) queueNodeHandleRefresh(store, String(index), refresh)
    queueNodeHandleRefresh({}, 'other', otherRefresh)
    expect(callbacks.size).toBe(2)
    flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls[0][0]).toHaveLength(86)
    expect(otherRefresh).toHaveBeenCalledWith(['other'])
  })

  it('drops unmounted nodes and supports strict-mode remounts', () => {
    const store = {}
    const refresh = vi.fn()
    const cancel = queueNodeHandleRefresh(store, 'a', refresh)
    cancel()
    expect(callbacks.size).toBe(0)
    queueNodeHandleRefresh(store, 'a', refresh)
    const cancelB = queueNodeHandleRefresh(store, 'b', refresh)
    cancelB()
    flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(['a'])
  })

  it('retains a shared node request until its last owner unmounts', () => {
    const store = {}
    const refresh = vi.fn()
    const cancel = queueNodeHandleRefresh(store, 'a', refresh)
    queueNodeHandleRefresh(store, 'a', refresh)
    cancel()
    flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(['a'])
  })
})
