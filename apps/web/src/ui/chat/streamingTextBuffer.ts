export type StreamingTextBufferScheduler = {
  schedule: (callback: () => void, delayMs: number) => number
  cancel: (timerId: number) => void
}

export type StreamingTextBuffer = {
  append: (delta: string) => void
  flush: () => void
  dispose: () => void
}

type CreateStreamingTextBufferOptions = {
  flushIntervalMs: number
  maxBufferedChars: number
  onFlush: () => void
  scheduler?: StreamingTextBufferScheduler
}

const browserScheduler: StreamingTextBufferScheduler = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (timerId) => window.clearTimeout(timerId),
}

export function createStreamingTextBuffer({
  flushIntervalMs,
  maxBufferedChars,
  onFlush,
  scheduler = browserScheduler,
}: CreateStreamingTextBufferOptions): StreamingTextBuffer {
  if (!Number.isFinite(flushIntervalMs) || flushIntervalMs <= 0) {
    throw new Error('flushIntervalMs must be greater than zero')
  }
  if (!Number.isFinite(maxBufferedChars) || maxBufferedChars <= 0) {
    throw new Error('maxBufferedChars must be greater than zero')
  }

  let bufferedChars = 0
  let timerId: number | null = null
  let disposed = false

  const cancelScheduledFlush = () => {
    if (timerId === null) return
    scheduler.cancel(timerId)
    timerId = null
  }

  const flush = () => {
    cancelScheduledFlush()
    if (disposed || bufferedChars === 0) return
    bufferedChars = 0
    onFlush()
  }

  const scheduleFlush = () => {
    if (timerId !== null) return
    timerId = scheduler.schedule(() => {
      timerId = null
      flush()
    }, flushIntervalMs)
  }

  return {
    append(delta) {
      if (disposed || !delta) return
      bufferedChars += delta.length
      if (bufferedChars >= maxBufferedChars) {
        flush()
        return
      }
      scheduleFlush()
    },
    flush,
    dispose() {
      cancelScheduledFlush()
      bufferedChars = 0
      disposed = true
    },
  }
}
