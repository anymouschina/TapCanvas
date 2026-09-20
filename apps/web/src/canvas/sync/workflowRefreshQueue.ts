type Refresh = { version: number; completed: number; seq: number | null; running: boolean; failures: number; retry: ReturnType<typeof setTimeout> | null }

/** One read per execution at a time; event bursts request at most one trailing read. */
export function createWorkflowRefreshQueue<T>(options: {
  read: (executionId: string) => Promise<T>
  apply: (executionId: string, result: T) => void
  onError: (executionId: string, error: unknown) => void
}): { request: (executionId: string, seq?: number) => void; dispose: () => void } {
  const entries = new Map<string, Refresh>()
  let disposed = false
  async function drain(id: string, entry: Refresh): Promise<void> {
    if (entry.running || disposed) return
    entry.running = true
    try {
      while (!disposed && entry.completed < entry.version) {
        const version = entry.version
        try {
          const result = await options.read(id)
          if (!disposed) options.apply(id, result)
          entry.completed = version
          entry.failures = 0
        } catch (error: unknown) {
          entry.seq = null
          if (!disposed) options.onError(id, error)
          // A failed read has not consumed the event. The terminal event may be
          // the last one, so recovery cannot depend on another SSE notification.
          entry.failures += 1
          if (!disposed) entry.retry = setTimeout(() => {
            entry.retry = null
            void drain(id, entry)
          }, Math.min(10_000, 1_000 * (2 ** Math.min(4, entry.failures - 1))))
          break
        }
      }
    } finally {
      entry.running = false
    }
  }
  return {
    request(id, seq) {
      if (disposed) return
      let entry = entries.get(id)
      if (!entry) {
        entry = { version: 0, completed: 0, seq: null, running: false, failures: 0, retry: null }
        entries.set(id, entry)
      }
      if (typeof seq === 'number' && Number.isFinite(seq)) {
        if (entry.seq !== null && seq <= entry.seq) return
        entry.seq = seq
      }
      entry.version += 1
      if (entry.retry !== null) { clearTimeout(entry.retry); entry.retry = null }
      // The SSE parser handles a batch synchronously; coalesce it before starting I/O.
      queueMicrotask(() => { void drain(id, entry) })
    },
    dispose() {
      disposed = true
      for (const entry of entries.values()) if (entry.retry !== null) clearTimeout(entry.retry)
      entries.clear()
    },
  }
}
