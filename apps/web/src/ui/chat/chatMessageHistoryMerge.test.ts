import { describe, expect, it } from 'vitest'

import { mergeLoadedHistoryWithLocalMessages } from './chatMessageHistoryMerge'

type TestMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result'
  languageModel?: string
}

describe('chat history merge', () => {
  it('keeps first-turn model provenance from the structurally matching local message', () => {
    const history: TestMessage[] = [{
      id: 'turn-1-user',
      role: 'user',
      content: '核验当前状态',
      phase: 'final',
      kind: 'result',
    }]
    const local: TestMessage[] = [{
      id: 'turn-1-user',
      role: 'user',
      content: '核验当前状态',
      languageModel: 'gpt-5.6-terra',
    }]

    expect(mergeLoadedHistoryWithLocalMessages(history, local)).toEqual(local)
  })

  it('does not merge equal prose when durable message identities differ', () => {
    const history: TestMessage[] = [
      { id: 'history-1', role: 'user', content: '继续' },
      { id: 'history-2', role: 'user', content: '继续' },
    ]
    const local: TestMessage[] = [
      { id: 'local-1', role: 'user', content: '继续', languageModel: 'model-1' },
      { id: 'local-2', role: 'user', content: '继续', languageModel: 'model-2' },
      { id: 'pending', role: 'assistant', content: '处理中…', phase: 'thinking', kind: 'progress' },
    ]

    expect(mergeLoadedHistoryWithLocalMessages(history, local)).toEqual([
      ...history,
      ...local,
    ])
  })

  it('keeps the richer live assistant card when persisted history catches up', () => {
    const history: TestMessage[] = [{
      id: 'm_ai_recovered_turn-1',
      role: 'assistant',
      content: '最终结论',
      phase: 'final',
      kind: 'result',
    }]
    const local: TestMessage[] = [{
      id: 'm_ai_recovered_turn-1',
      role: 'assistant',
      content: '最终结论',
      phase: 'final',
      kind: 'result',
      languageModel: 'deepseek-v4-flash',
    }]

    expect(mergeLoadedHistoryWithLocalMessages(history, local)).toEqual(local)
  })

  it('projects multiple physical-window history rows for one root turn as one latest assistant card', () => {
    const history: TestMessage[] = [
      {
        id: 'm_ai_recovered_root-turn-1',
        role: 'assistant',
        content: '当前物理执行窗口已挂起',
        phase: 'final',
        kind: 'result',
      },
      {
        id: 'm_ai_recovered_root-turn-1',
        role: 'assistant',
        content: '最终结论',
        phase: 'final',
        kind: 'result',
      },
    ]

    expect(mergeLoadedHistoryWithLocalMessages(history, [])).toEqual([history[1]])
  })

  it('drops an unrebound provisional user bubble when its stable recovered twin is in history', () => {
    // onOpen 重绑竞态失败时，本地临时 m_user_* 与历史稳定 m_user_recovered_* 同文案并存，
    // 导致同一请求出现两条用户气泡（刷新后只剩历史一条）。合并必须丢弃临时副本。
    const history: TestMessage[] = [
      {
        id: 'm_user_recovered_turn-1',
        role: 'user',
        content: '你好',
        phase: 'final',
        kind: 'result',
      },
      {
        id: 'm_ai_recovered_turn-1',
        role: 'assistant',
        content: '你好！我是小T',
        phase: 'final',
        kind: 'result',
      },
    ]
    const local: TestMessage[] = [
      {
        id: 'm_user_1786851089496',
        role: 'user',
        content: '你好',
        languageModel: 'deepseek-v4-flash',
      },
      {
        id: 'm_ai_pending_1786851089497',
        role: 'assistant',
        content: '正在处理你的请求',
        phase: 'thinking',
        kind: 'progress',
      },
    ]

    const merged = mergeLoadedHistoryWithLocalMessages(history, local)
    expect(merged.filter((message) => message.role === 'user' && message.content === '你好')).toHaveLength(1)
    expect(merged[0]?.id).toBe('m_user_recovered_turn-1')
  })

  it('keeps two genuinely distinct same-text turns when both carry stable recovered ids', () => {
    const history: TestMessage[] = [
      {
        id: 'm_user_recovered_turn-1',
        role: 'user',
        content: '你好',
        phase: 'final',
        kind: 'result',
      },
      {
        id: 'm_user_recovered_turn-2',
        role: 'user',
        content: '你好',
        phase: 'final',
        kind: 'result',
      },
    ]

    expect(mergeLoadedHistoryWithLocalMessages(history, [])).toEqual(history)
  })
})
