import { describe, expect, it } from 'vitest'
import { projectChatQueue } from './chatQueueProjection'

type QueueItem = Readonly<{
  id: string
  text: string
}>

const queuedItems: QueueItem[] = [
  { id: 'queue-oldest', text: '第一条' },
  { id: 'queue-middle', text: '第二条' },
  { id: 'queue-newest', text: '第三条' },
]

describe('projectChatQueue', () => {
  it('keeps the local optimistic projection until a durable count is known', () => {
    expect(projectChatQueue(queuedItems, null)).toEqual({
      pendingItems: queuedItems,
      consumedCount: 0,
      serverOnlyCount: 0,
    })
  })

  it('clears every local row after the durable queue reaches zero', () => {
    expect(projectChatQueue(queuedItems, 0)).toEqual({
      pendingItems: [],
      consumedCount: 3,
      serverOnlyCount: 0,
    })
  })

  it('removes consumed FIFO entries and keeps the newest pending entries', () => {
    expect(projectChatQueue(queuedItems, 1)).toEqual({
      pendingItems: [queuedItems[2]],
      consumedCount: 2,
      serverOnlyCount: 0,
    })
  })

  it('reports durable pending entries whose text is unknown to this browser', () => {
    expect(projectChatQueue(queuedItems.slice(0, 1), 3)).toEqual({
      pendingItems: [queuedItems[0]],
      consumedCount: 0,
      serverOnlyCount: 2,
    })
  })
})
