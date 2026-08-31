import { beforeEach, describe, expect, it } from 'vitest'

import {
  bindChatSessionLanguageModel,
  buildSessionTitleLlmRequest,
  isSessionTitleEligibleAssistantMessage,
  readChatSessionLanguageModel,
  reconcileChatSessionTitleGenerationState,
  shouldBindChatSessionLanguageModel,
} from './chatSessionTitle'

describe('chat session title model inheritance', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('uses the exact first-turn language model in the title request', () => {
    const request = buildSessionTitleLlmRequest({
      model: 'gpt-5.6-terra',
      userText: '核验视频状态',
      assistantText: '已完成只读核验',
    })

    expect(request.model).toBe('gpt-5.6-terra')
    expect(request.purpose).toBe('conversation_title')
    expect(request.maxTokens).toBe(32)
  })

  it('only permits a verified succeeded main turn to trigger the silent title task', () => {
    const base = {
      role: 'assistant',
      content: '已完成真实交付',
      phase: 'final',
      kind: 'result',
    }

    expect(isSessionTitleEligibleAssistantMessage({
      ...base,
      logicalTaskStatus: 'succeeded',
    })).toBe(true)
    expect(isSessionTitleEligibleAssistantMessage({
      ...base,
      logicalTaskStatus: 'waiting_external',
    })).toBe(false)
    expect(isSessionTitleEligibleAssistantMessage({
      ...base,
      logicalTaskStatus: 'waiting_input',
    })).toBe(false)
    expect(isSessionTitleEligibleAssistantMessage(base)).toBe(false)
  })

  it('fails explicitly when the first-turn model fact is missing', () => {
    expect(() => buildSessionTitleLlmRequest({
      model: ' ',
      userText: '用户消息',
      assistantText: '助手消息',
    })).toThrow('会话标题缺少首轮语言模型事实')
  })

  it('keeps the first-turn model binding when the UI later selects another model', () => {
    const firstTurnKey = 'project:p1:flow:f1:conversation:c1:lane:general:skill:default'
    const changedSuffixKey = 'project:p1:flow:f1:conversation:c1:lane:director:n1:skill:director'

    bindChatSessionLanguageModel(firstTurnKey, 'gpt-5.6-terra')
    bindChatSessionLanguageModel(changedSuffixKey, 'gpt-5.4')

    expect(readChatSessionLanguageModel(changedSuffixKey)).toBe('gpt-5.6-terra')
  })

  it('only permits model binding before the first non-empty user turn', () => {
    expect(shouldBindChatSessionLanguageModel([])).toBe(true)
    expect(shouldBindChatSessionLanguageModel([
      { role: 'assistant', content: '你好' },
      { role: 'user', content: '   ' },
    ])).toBe(true)
    expect(shouldBindChatSessionLanguageModel([
      { role: 'user', content: '第一轮事实' },
    ])).toBe(false)
  })

  it('preserves the title decision across StrictMode replay and lane or skill churn', () => {
    const unavailable = {
      key: 'project:p1:flow:f1:lane:general:skill:default',
      state: 'unavailable' as const,
    }

    expect(reconcileChatSessionTitleGenerationState(unavailable, unavailable.key)).toEqual(unavailable)
    expect(reconcileChatSessionTitleGenerationState(
      unavailable,
      'project:p1:flow:f1:lane:director:n1:skill:director',
    )).toEqual({
      key: 'project:p1:flow:f1:lane:director:n1:skill:director',
      state: 'unavailable',
    })
  })

  it('resets the title decision only for a different conversation scope', () => {
    expect(reconcileChatSessionTitleGenerationState({
      key: 'project:p1:flow:f1:conversation:c1:lane:general:skill:default',
      state: 'succeeded',
    }, 'project:p1:flow:f1:conversation:c2:lane:general:skill:default')).toEqual({
      key: 'project:p1:flow:f1:conversation:c2:lane:general:skill:default',
      state: 'idle',
    })
  })
})
