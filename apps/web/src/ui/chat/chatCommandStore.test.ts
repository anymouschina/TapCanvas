import { describe, expect, it, beforeEach } from 'vitest'
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
