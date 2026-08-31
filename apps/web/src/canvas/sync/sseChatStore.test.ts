import { beforeEach, describe, expect, it } from 'vitest'

import { useSseChatStore, type SseChatMessage } from './sseChatStore'

function message(id: string, content: string): SseChatMessage {
  return { id, role: 'assistant', content, ts: '2026-08-10T00:00:00.000Z' }
}

describe('sseChatStore conversation isolation', () => {
  beforeEach(() => {
    useSseChatStore.setState({ queue: [] })
  })

  it('drains only messages owned by the exact conversation session', () => {
    const store = useSseChatStore.getState()
    store.push('session_old', [message('shared-id', '旧任务完成')])
    store.push('session_new', [message('shared-id', '新任务运行中')])

    expect(useSseChatStore.getState().drain('session_new')).toEqual([
      message('shared-id', '新任务运行中'),
    ])
    expect(useSseChatStore.getState().drain('session_old')).toEqual([
      message('shared-id', '旧任务完成'),
    ])
  })

  it('keeps another conversation queued when the current conversation drains', () => {
    useSseChatStore.getState().push('session_old', [message('old-1', '旧任务证据')])

    expect(useSseChatStore.getState().drain('session_new')).toEqual([])
    expect(useSseChatStore.getState().queue).toHaveLength(1)
  })

  it('clears queued events when a canvas conversation is overwritten', () => {
    const store = useSseChatStore.getState()
    store.push('session_old', [message('old-1', '旧任务证据')])
    store.push('session_new', [message('new-1', '当前任务证据')])

    store.clear('session_old')

    expect(useSseChatStore.getState().drain('session_old')).toEqual([])
    expect(useSseChatStore.getState().drain('session_new')).toEqual([
      message('new-1', '当前任务证据'),
    ])
  })

  it('rejects unscoped messages instead of attaching them to the foreground chat', () => {
    expect(() => {
      useSseChatStore.getState().push('', [message('unknown-1', '无归属消息')])
    }).toThrow('SSE chat messages require an exact sessionKey')
  })
})
