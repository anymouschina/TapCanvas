import { describe, expect, it } from 'vitest'
import { DEFAULT_GENERATION_PREFS } from './generationPrefs'

describe('DEFAULT_GENERATION_PREFS', () => {
  it('uses the catalog-backed MiniMax H3 video default and its compatible resolution', () => {
    expect(DEFAULT_GENERATION_PREFS.videoModel).toBe('minimax-h3')
    expect(DEFAULT_GENERATION_PREFS.videoResolution).toBe('768p')
  })
})
