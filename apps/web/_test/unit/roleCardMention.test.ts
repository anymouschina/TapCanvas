import { describe, expect, it } from 'vitest'
import {
  doesRoleCardStateMatchQuery,
  extractRoleCardMentionTokens,
  parseRoleCardMentionToken,
} from '../../src/runner/roleCardMention'

describe('roleCardMention', () => {
  it('parses role name, state, and disambiguator from @角色名-状态 syntax', () => {
    expect(parseRoleCardMentionToken('@方源-少年#card_01')).toEqual({
      raw: '@方源-少年#card_01',
      rawDisplay: '@方源-少年#card_01',
      roleNameKey: '方源',
      stateKey: '少年',
      disambiguatorKey: 'card_01',
    })
  })

  it('deduplicates repeated mentions while preserving state queries', () => {
    expect(extractRoleCardMentionTokens('@方源-少年 看向窗外，随后 @方源-少年 再次起身。')).toEqual([
      {
        raw: '@方源-少年',
        rawDisplay: '@方源-少年',
        roleNameKey: '方源',
        stateKey: '少年',
        disambiguatorKey: '',
      },
    ])
  })

  it('matches state query against stateKey, stateDescription, stateLabel, or ageDescription', () => {
    expect(
      doesRoleCardStateMatchQuery({
        queryStateKey: '少年',
        stateKey: '少年期',
        stateDescription: '十五岁少年体态，刚从床上醒来',
      }),
    ).toBe(true)

    expect(
      doesRoleCardStateMatchQuery({
        queryStateKey: '老年',
        ageDescription: '十五岁',
        stateLabel: '轻伤',
        stateDescription: '衣襟带血但未受重伤',
      }),
    ).toBe(false)
  })
})
