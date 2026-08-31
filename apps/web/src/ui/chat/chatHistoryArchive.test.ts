import { describe, expect, it } from 'vitest'
import { resolveChatHistorySelection } from './chatHistoryArchive'

describe('read-only chat history archive', () => {
  const canonical = 'project:p1:chapter:c1:lane:general:skill:default'

  it('returns to the current view for another skill suffix in the canonical conversation family', () => {
    expect(resolveChatHistorySelection({
      activeSessionKey: canonical,
      selectedSessionKey: 'project:p1:chapter:c1:lane:general:skill:storyboard',
    })).toEqual({ mode: 'current', sessionKey: canonical })
  })

  it('opens a legacy physical conversation as an archive without replacing the canonical key', () => {
    const legacy = 'project:p1:chapter:c1:conversation:legacy-1:lane:general:skill:default'
    const selection = resolveChatHistorySelection({
      activeSessionKey: canonical,
      selectedSessionKey: legacy,
    })

    expect(selection).toEqual({ mode: 'archive', sessionKey: legacy })
    expect(selection.sessionKey).not.toBe(canonical)
  })

  it('rejects an empty historical identity instead of falling back to the current session', () => {
    expect(() => resolveChatHistorySelection({
      activeSessionKey: canonical,
      selectedSessionKey: '  ',
    })).toThrow('历史会话缺少 sessionKey')
  })
})
