import { describe, expect, it, vi } from 'vitest'
import {
  createStreamingTextBuffer,
  type StreamingTextBufferScheduler,
} from './streamingTextBuffer'

function createManualScheduler() {
  let nextTimerId = 1
  const callbacks = new Map<number, () => void>()
  const scheduler: StreamingTextBufferScheduler = {
    schedule: (callback) => {
      const timerId = nextTimerId
      nextTimerId += 1
      callbacks.set(timerId, callback)
      return timerId
    },
    cancel: (timerId) => {
      callbacks.delete(timerId)
    },
  }
  return {
    scheduler,
    runNext: () => {
      const entry = callbacks.entries().next().value as [number, () => void] | undefined
      if (!entry) return
      callbacks.delete(entry[0])
      entry[1]()
    },
    pendingCount: () => callbacks.size,
  }
}

describe('createStreamingTextBuffer', () => {
  it('coalesces multiple deltas into one scheduled flush', () => {
    const manual = createManualScheduler()
    const onFlush = vi.fn()
    const buffer = createStreamingTextBuffer({
      flushIntervalMs: 80,
      maxBufferedChars: 384,
      onFlush,
      scheduler: manual.scheduler,
    })

    buffer.append('a')
    buffer.append('b')
    buffer.append('c')

    expect(manual.pendingCount()).toBe(1)
    expect(onFlush).not.toHaveBeenCalled()
    manual.runNext()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('flushes immediately when the character threshold is reached', () => {
    const manual = createManualScheduler()
    const onFlush = vi.fn()
    const buffer = createStreamingTextBuffer({
      flushIntervalMs: 80,
      maxBufferedChars: 4,
      onFlush,
      scheduler: manual.scheduler,
    })

    buffer.append('ab')
    buffer.append('cd')

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(manual.pendingCount()).toBe(0)
  })

  it('supports a deterministic terminal flush and prevents later callbacks', () => {
    const manual = createManualScheduler()
    const onFlush = vi.fn()
    const buffer = createStreamingTextBuffer({
      flushIntervalMs: 80,
      maxBufferedChars: 384,
      onFlush,
      scheduler: manual.scheduler,
    })

    buffer.append('pending')
    buffer.flush()
    manual.runNext()

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(manual.pendingCount()).toBe(0)
  })

  it('drops pending work when disposed', () => {
    const manual = createManualScheduler()
    const onFlush = vi.fn()
    const buffer = createStreamingTextBuffer({
      flushIntervalMs: 80,
      maxBufferedChars: 384,
      onFlush,
      scheduler: manual.scheduler,
    })

    buffer.append('pending')
    buffer.dispose()
    manual.runNext()
    buffer.append('ignored')
    buffer.flush()

    expect(onFlush).not.toHaveBeenCalled()
    expect(manual.pendingCount()).toBe(0)
  })
})
