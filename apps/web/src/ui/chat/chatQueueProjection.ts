export type ChatQueueProjection<T> = Readonly<{
  pendingItems: T[]
  consumedCount: number
  serverOnlyCount: number
}>

/**
 * Reconcile the browser's FIFO queue projection with the durable queue count.
 * The server count is authoritative for every turn state, including
 * needs_input and terminal states. When older local items have already been
 * consumed, only the newest still-pending items remain in the dock.
 */
export function projectChatQueue<T>(
  localItems: readonly T[],
  pendingQueueCount: number | null,
): ChatQueueProjection<T> {
  if (pendingQueueCount === null) {
    return {
      pendingItems: [...localItems],
      consumedCount: 0,
      serverOnlyCount: 0,
    }
  }

  const normalizedPendingCount = Number.isInteger(pendingQueueCount) && pendingQueueCount >= 0
    ? pendingQueueCount
    : 0
  const localPendingCount = Math.min(localItems.length, normalizedPendingCount)
  const consumedCount = localItems.length - localPendingCount

  return {
    pendingItems: localPendingCount > 0
      ? localItems.slice(consumedCount)
      : [],
    consumedCount,
    serverOnlyCount: Math.max(0, normalizedPendingCount - localPendingCount),
  }
}
