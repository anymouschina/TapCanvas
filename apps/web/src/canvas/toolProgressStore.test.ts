import { describe, expect, it, beforeEach } from 'vitest'

import {
  useToolProgressStore,
  formatBatchProgressLabel,
  selectToolProgress,
} from './toolProgressStore'

describe('formatBatchProgressLabel', () => {
  it('正常进度', () => {
    expect(formatBatchProgressLabel({ completed: 3, total: 8, failed: 0 })).toBe('已完成 3/8 张')
  })
  it('含失败带后缀', () => {
    expect(formatBatchProgressLabel({ completed: 8, total: 8, failed: 1 })).toBe(
      '已完成 8/8 张（1 失败）',
    )
  })
  it('起始 0/N', () => {
    expect(formatBatchProgressLabel({ completed: 0, total: 8, failed: 0 })).toBe('已完成 0/8 张')
  })
})

describe('toolProgressStore', () => {
  beforeEach(() => useToolProgressStore.getState().clearAll())

  it('set 后可按 callId 读取', () => {
    useToolProgressStore.getState().setToolProgress({
      toolCallId: 'c1',
      toolName: 'x',
      completed: 2,
      total: 5,
      failed: 0,
    })
    const p = selectToolProgress('c1', useToolProgressStore.getState())
    expect(p?.completed).toBe(2)
    expect(p?.total).toBe(5)
  })

  it('clear 后读不到', () => {
    const s = useToolProgressStore.getState()
    s.setToolProgress({ toolCallId: 'c1', toolName: 'x', completed: 1, total: 2, failed: 0 })
    s.clearToolProgress('c1')
    expect(selectToolProgress('c1', useToolProgressStore.getState())).toBeUndefined()
  })

  it('过期（TTL 超 5min）读不到', () => {
    const s = useToolProgressStore.getState()
    s.setToolProgress({ toolCallId: 'c1', toolName: 'x', completed: 1, total: 2, failed: 0 })
    useToolProgressStore.setState((st) => {
      const m = new Map(st.byCallId)
      const e = m.get('c1')!
      m.set('c1', { ...e, updatedAt: Date.now() - 6 * 60_000 })
      return { byCallId: m }
    })
    expect(selectToolProgress('c1', useToolProgressStore.getState())).toBeUndefined()
  })
})
