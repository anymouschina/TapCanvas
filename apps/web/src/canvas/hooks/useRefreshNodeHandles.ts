import { useEffect } from 'react'
import { useNodeId, useStoreApi, useUpdateNodeInternals } from '@xyflow/react'

type PendingRefresh = {
  ids: Map<string, number>
  frame: number
}

const pendingByStore = new WeakMap<object, PendingRefresh>()

/** Batch shell mounts and port changes into one React Flow measurement. Each
 * provider owns its queue; no cross-canvas ids or per-node store broadcasts. */
export function queueNodeHandleRefresh(
  store: object,
  nodeId: string,
  refresh: (ids: string[]) => void,
): () => void {
  let pending = pendingByStore.get(store)
  if (!pending) {
    const ids = new Map<string, number>()
    pending = {
      ids,
      frame: requestAnimationFrame(() => {
        pendingByStore.delete(store)
        if (ids.size) refresh([...ids.keys()])
      }),
    }
    pendingByStore.set(store, pending)
  }
  const queued = pending
  queued.ids.set(nodeId, (queued.ids.get(nodeId) ?? 0) + 1)
  return () => {
    const count = queued.ids.get(nodeId) ?? 0
    if (count > 1) queued.ids.set(nodeId, count - 1)
    else queued.ids.delete(nodeId)
    if (!queued.ids.size && pendingByStore.get(store) === queued) {
      cancelAnimationFrame(queued.frame)
      pendingByStore.delete(store)
    }
  }
}

export function useRefreshNodeHandles(geometryKey: string): void {
  const nodeId = useNodeId()
  const store = useStoreApi()
  const refresh = useUpdateNodeInternals()
  useEffect(() => {
    if (!nodeId) return
    return queueNodeHandleRefresh(store, nodeId, refresh)
  }, [store, nodeId, refresh, geometryKey])
}
