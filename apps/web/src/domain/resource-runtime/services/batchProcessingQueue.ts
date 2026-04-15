import { useResourceRuntimeStore } from '../store/resourceRuntimeStore'

type BatchJobTask<T> = {
  execute: () => Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

const pendingBatchJobs: BatchJobTask<unknown>[] = []

function setBatchQueueCounts(nextActiveBatchJobs: number, nextQueuedBatchJobs: number): void {
  useResourceRuntimeStore.setState((state) => ({
    ...state,
    activeBatchJobs: nextActiveBatchJobs,
    queuedBatchJobs: nextQueuedBatchJobs,
  }))
}

function syncBatchQueueCounts(): void {
  const state = useResourceRuntimeStore.getState()
  setBatchQueueCounts(state.activeBatchJobs, pendingBatchJobs.length)
}

function scheduleBatchQueueFlush(): void {
  queueMicrotask(() => {
    void flushBatchQueue()
  })
}

async function flushBatchQueue(): Promise<void> {
  const state = useResourceRuntimeStore.getState()
  if (state.activeBatchJobs >= state.maxConcurrentBatchJobs) {
    syncBatchQueueCounts()
    return
  }
  const nextJob = pendingBatchJobs.shift()
  if (!nextJob) {
    syncBatchQueueCounts()
    return
  }

  setBatchQueueCounts(state.activeBatchJobs + 1, pendingBatchJobs.length)
  try {
    const result = await nextJob.execute()
    nextJob.resolve(result)
  } catch (error) {
    nextJob.reject(error)
  } finally {
    const latest = useResourceRuntimeStore.getState()
    setBatchQueueCounts(Math.max(0, latest.activeBatchJobs - 1), pendingBatchJobs.length)
    scheduleBatchQueueFlush()
  }
}

export function runBatchProcessingJob<T>(execute: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingBatchJobs.push({ execute, resolve, reject })
    const state = useResourceRuntimeStore.getState()
    setBatchQueueCounts(state.activeBatchJobs, pendingBatchJobs.length)
    scheduleBatchQueueFlush()
  })
}
