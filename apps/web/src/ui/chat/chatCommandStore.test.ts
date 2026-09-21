import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useChatCommandStore } from './chatCommandStore'

describe('chat command queue', () => {
  beforeEach(() => {
    useChatCommandStore.setState({
      pending: null,
      pendingQueue: [],
      deferredUntilFlow: [],
      busy: false,
    })
    window.sessionStorage.clear()
  })

  it('keeps multiple commands instead of replacing the first pending command', () => {
    useChatCommandStore.getState().dispatchSend({ text: '第一条' })
    useChatCommandStore.getState().dispatchSend({ text: '第二条' })

    expect(useChatCommandStore.getState().consume()?.text).toBe('第一条')
    expect(useChatCommandStore.getState().consume()?.text).toBe('第二条')
    expect(useChatCommandStore.getState().consume()).toBeNull()
  })

  it('persists deferred project demands until a Flow is available', () => {
    const queued = useChatCommandStore.getState().enqueueUntilFlow({
      text: '等 Flow 创建后继续做这件事',
      displayText: '继续做这件事',
      queuedMessageId: 'm_user_queued_flow_test',
      queuedProjectId: 'project-1',
    })

    expect(queued.queuedUntilFlow).toBe(true)
    expect(useChatCommandStore.getState().deferredUntilFlow).toHaveLength(1)
    expect(JSON.parse(window.sessionStorage.getItem('tapcanvas.aiChat.deferredUntilFlow.v1') || '[]')).toHaveLength(1)
    expect(useChatCommandStore.getState().peekDeferredUntilFlow({ projectId: 'project-1', chapterId: '' })?.text).toBe('等 Flow 创建后继续做这件事')
    expect(useChatCommandStore.getState().consumeDeferredUntilFlow({ projectId: 'project-2', chapterId: '' })).toBeNull()
    expect(useChatCommandStore.getState().consumeDeferredUntilFlow({ projectId: 'project-1', chapterId: '' })?.text).toBe('等 Flow 创建后继续做这件事')
    expect(useChatCommandStore.getState().deferredUntilFlow).toHaveLength(0)
  })
})


describe('restored deferred command identity', () => {
  it('rejects stored commands without safe identity or scope and records only failure facts', async () => {
    window.sessionStorage.setItem('tapcanvas.aiChat.deferredUntilFlow.v1', JSON.stringify([
      { text: 'private invalid request', nonce: 1e30, queuedProjectId: 'project-1', queuedMessageId: 'bad-number' },
      { text: 'private unscoped request', nonce: 2, queuedMessageId: 'bad-scope' },
    ]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      vi.resetModules()
      const { useChatCommandStore: restoredStore } = await import('./chatCommandStore')
      expect(restoredStore.getState().deferredUntilFlow).toEqual([])
      expect(warn).toHaveBeenCalledWith('[ai-chat][deferred-queue] invalid stored commands', { rejectedCount: 2 })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private')
    } finally {
      warn.mockRestore()
      window.sessionStorage.clear()
    }
  })

  it('keeps new command identities distinct from persisted commands after reload', async () => {
    window.sessionStorage.setItem('tapcanvas.aiChat.deferredUntilFlow.v1', JSON.stringify([
      { text: 'persisted request', nonce: 42, queuedProjectId: 'project-1', queuedMessageId: 'queued-42' },
    ]))
    vi.resetModules()
    const { useChatCommandStore: restoredStore } = await import('./chatCommandStore')
    const added = restoredStore.getState().enqueueUntilFlow({
      text: 'new request', queuedProjectId: 'project-1', queuedMessageId: 'queued-next',
    })
    expect(added.nonce).toBeGreaterThan(42)
    expect(restoredStore.getState().deferredUntilFlow.map((command) => command.text)).toEqual([
      'persisted request', 'new request',
    ])
    window.sessionStorage.clear()
  })
})
