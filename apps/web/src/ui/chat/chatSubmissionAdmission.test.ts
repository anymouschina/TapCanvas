import { describe, expect, it } from 'vitest'

import {
  canSubmitChatComposer,
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
