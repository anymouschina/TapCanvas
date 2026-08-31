import React from 'react'

import {
  listTaskInbox,
  markTaskInboxNotificationRead,
  type TaskInboxItemDto,
} from '../api/server'

const TASK_INBOX_REFRESH_MS = 15_000
const TASK_INBOX_PAGE_SIZE = 50

export type TaskInboxState = Readonly<{
  items: TaskInboxItemDto[]
  unreadCount: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  error: string | null
  reload: () => void
  loadMore: () => void
  markRead: (item: TaskInboxItemDto) => Promise<void>
}>

type TaskInboxSnapshot = Omit<TaskInboxState, 'reload' | 'loadMore' | 'markRead'> & Readonly<{
  nextCursor: string | null
}>

const EMPTY_SNAPSHOT: TaskInboxSnapshot = {
  items: [],
  unreadCount: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null,
  nextCursor: null,
}

let snapshot: TaskInboxSnapshot = EMPTY_SNAPSHOT
let pollingUserId: string | null = null
let pollingSubscribers = 0
let reloadRequestSequence = 0
let loadMoreRequestSequence = 0
let refreshTimer: number | null = null
const listeners = new Set<() => void>()

function getSnapshot(): TaskInboxSnapshot {
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(patch: Partial<TaskInboxSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

function replaceWithResponse(result: Awaited<ReturnType<typeof listTaskInbox>>): void {
  publish({
    items: result.items,
    nextCursor: result.nextCursor,
    hasMore: result.nextCursor !== null,
    unreadCount: result.unreadCount,
    error: null,
  })
}

function mergeTaskInboxItems(current: TaskInboxItemDto[], incoming: TaskInboxItemDto[]): TaskInboxItemDto[] {
  const byTaskId = new Map(current.map((item) => [item.taskId, item]))
  for (const item of incoming) byTaskId.set(item.taskId, item)
  return [...byTaskId.values()]
}

function reloadTaskInbox(): void {
  if (!pollingUserId || snapshot.loading || snapshot.loadingMore) return
  const requestId = ++reloadRequestSequence
  publish({ loading: true })
  void listTaskInbox({ limit: TASK_INBOX_PAGE_SIZE })
    .then((result) => {
      if (requestId !== reloadRequestSequence) return
      replaceWithResponse(result)
    })
    .catch((cause: unknown) => {
      if (requestId !== reloadRequestSequence) return
      publish({ error: cause instanceof Error ? cause.message : String(cause) })
    })
    .finally(() => {
      if (requestId === reloadRequestSequence) publish({ loading: false })
    })
}

function loadMoreTaskInbox(): void {
  if (!pollingUserId || !snapshot.nextCursor || snapshot.loading || snapshot.loadingMore) return
  const cursor = snapshot.nextCursor
  const requestId = ++loadMoreRequestSequence
  publish({ loadingMore: true })
  void listTaskInbox({ cursor, limit: TASK_INBOX_PAGE_SIZE })
    .then((result) => {
      if (requestId !== loadMoreRequestSequence) return
      publish({
        items: mergeTaskInboxItems(snapshot.items, result.items),
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
        unreadCount: result.unreadCount,
        error: null,
      })
    })
    .catch((cause: unknown) => {
      if (requestId !== loadMoreRequestSequence) return
      publish({ error: cause instanceof Error ? cause.message : String(cause) })
    })
    .finally(() => {
      if (requestId === loadMoreRequestSequence) publish({ loadingMore: false })
    })
}

async function markTaskInboxRead(item: TaskInboxItemDto): Promise<void> {
  if (!item.notificationId || item.readAt) return
  try {
    const receipt = await markTaskInboxNotificationRead(item.notificationId)
    reloadRequestSequence += 1
    loadMoreRequestSequence += 1
    publish({
      items: snapshot.items.map((candidate) => (
        candidate.taskId === item.taskId ? { ...candidate, readAt: receipt.readAt } : candidate
      )),
      unreadCount: Math.max(0, snapshot.unreadCount - 1),
      loading: false,
      loadingMore: false,
      error: null,
    })
    reloadTaskInbox()
  } catch (cause: unknown) {
    publish({ error: cause instanceof Error ? cause.message : String(cause) })
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') reloadTaskInbox()
}

function stopPolling(): void {
  reloadRequestSequence += 1
  loadMoreRequestSequence += 1
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
  refreshTimer = null
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  pollingUserId = null
  snapshot = EMPTY_SNAPSHOT
  for (const listener of listeners) listener()
}

function startPolling(userId: string): () => void {
  if (pollingSubscribers > 0 && pollingUserId !== userId) {
    throw new Error('task inbox cannot poll multiple user identities in one browser runtime')
  }
  pollingSubscribers += 1
  if (pollingUserId === null) {
    pollingUserId = userId
    snapshot = EMPTY_SNAPSHOT
    for (const listener of listeners) listener()
    reloadTaskInbox()
    refreshTimer = window.setInterval(reloadTaskInbox, TASK_INBOX_REFRESH_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }
  return () => {
    pollingSubscribers = Math.max(0, pollingSubscribers - 1)
    if (pollingSubscribers === 0) stopPolling()
  }
}

export function useTaskInbox(userId: string | null, enabled: boolean): TaskInboxState {
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  React.useEffect(() => {
    if (!enabled || !userId) return undefined
    return startPolling(userId)
  }, [enabled, userId])

  return {
    items: current.items,
    unreadCount: current.unreadCount,
    hasMore: current.hasMore,
    loading: current.loading,
    loadingMore: current.loadingMore,
    error: current.error,
    reload: reloadTaskInbox,
    loadMore: loadMoreTaskInbox,
    markRead: markTaskInboxRead,
  }
}
