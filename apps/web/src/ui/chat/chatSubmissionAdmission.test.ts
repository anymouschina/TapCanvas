import { describe, expect, it } from 'vitest'

import {
  canSubmitChatComposer,
  resolveChatSubmissionText,
  shouldAwaitChatSubmissionReadiness,
} from './chatSubmissionAdmission'

describe('chat submission admission', () => {
  it('admits a composer click only after the turn and selected model are ready', () => {
    expect(canSubmitChatComposer({
      hasMessage: true,
      turnReady: true,
      modelLoading: false,
      modelError: null,
      hasSelectedModel: true,
      preparing: false,
    })).toBe(true)

    expect(canSubmitChatComposer({
      hasMessage: true,
      turnReady: true,
      modelLoading: true,
      modelError: null,
      hasSelectedModel: false,
      preparing: false,
    })).toBe(false)
  })

  it('prevents duplicate composer admission while a click is being prepared', () => {
    expect(canSubmitChatComposer({
      hasMessage: true,
      turnReady: true,
      modelLoading: false,
      modelError: null,
      hasSelectedModel: true,
      preparing: true,
    })).toBe(false)
  })

  it('keeps bounded readiness waits for programmatic dispatch only', () => {
    expect(shouldAwaitChatSubmissionReadiness('composer')).toBe(false)
    expect(shouldAwaitChatSubmissionReadiness('programmatic')).toBe(true)
  })
})

describe('message text shared by busy and idle submission', () => {
  it('keeps composer draft when the send button supplies origin without text', () => {
    expect(resolveChatSubmissionText({ draft: '  请继续  ' })).toBe('请继续')
  })
  it('uses a clicked card without replacing it with an unrelated draft', () => {
    expect(resolveChatSubmissionText({ text: '生成角色参考图', draft: '未发送的草稿' })).toBe('生成角色参考图')
  })
  it('does not replace explicitly empty commands with a draft', () => {
    expect(resolveChatSubmissionText({ text: '', draft: '未发送的草稿' })).toBe('')
  })
})
