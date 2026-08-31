import { describe, expect, it } from 'vitest'
import {
  buildPromptMentionAliasMap,
  collectPromptMentionAliases,
  extractPromptMentionTokens,
  getPromptMentionTokenCore,
} from './promptMentionAliases'

describe('prompt mention aliases', () => {
  it('collects explicit node, asset, version, and display aliases', () => {
    expect(
      collectPromptMentionAliases({
        nodeId: 'NODE-123',
        assetId: 'ASSET-123',
        assetRefId: 'hero-reference',
        aliases: ['VERSION-9'],
        displayName: 'Hero',
      }),
    ).toEqual(['node-123', 'asset-123', 'hero-reference', 'hero', 'version-9'])
  })

  it('keeps punctuation out of the identifier while preserving its source token core', () => {
    expect(getPromptMentionTokenCore('@8d845F8d-cf26-479f-a812-e66da2fc390e,')).toBe(
      '8d845F8d-cf26-479f-a812-e66da2fc390e',
    )
    expect(extractPromptMentionTokens('@NODE-1, then @NODE-1。 and @NODE-2')).toEqual(['node-1', 'node-2'])
  })

  it('does not choose an ambiguous alias', () => {
    const aliases = buildPromptMentionAliasMap([
      { username: 'first', aliases: ['shared'], displayName: 'First' },
      { username: 'second', aliases: ['shared'], displayName: 'Second' },
    ])
    expect(aliases.get('first')?.username).toBe('first')
    expect(aliases.get('shared')).toBeUndefined()
  })
})
