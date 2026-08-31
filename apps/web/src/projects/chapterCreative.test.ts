import { describe, expect, it } from 'vitest'
import {
  buildChapterOverrideWithDirector,
  buildChapterOverrideWithStyle,
  chapterOverrideToChatContext,
  chapterOverrideToLockedStyle,
  parseChapterCreativeOverride,
} from './chapterCreative'

describe('chapter creative override', () => {
  it('parses the persisted JSON shape without making semantic decisions', () => {
    expect(parseChapterCreativeOverride(JSON.stringify({
      styleId: 'noir',
      styleName: '夜景冷调',
      stylePrompt: '低饱和，硬侧光',
      category: '真人',
      referenceImages: ['https://cdn.example/style.webp'],
      directorPersona: { personaId: 'slow-burn', personaName: '慢燃导演' },
    }))).toEqual({
      styleId: 'noir',
      styleName: '夜景冷调',
      stylePrompt: '低饱和，硬侧光',
      category: '真人',
      referenceImages: ['https://cdn.example/style.webp'],
      directorPersona: { personaId: 'slow-burn', personaName: '慢燃导演' },
    })
  })

  it('builds a chapter style context for agents without exposing image URLs', () => {
    const override = parseChapterCreativeOverride({
      styleId: 'custom',
      styleName: '本章自定义',
      stylePrompt: '保留阴影层次',
      referenceImages: ['a', 'b'],
    })
    expect(chapterOverrideToChatContext(override)).toEqual({
      styleId: 'custom',
      styleName: '本章自定义',
      stylePrompt: '保留阴影层次',
      referenceImageCount: 2,
    })
  })

  it('updates one chapter dimension while preserving the other', () => {
    const current = {
      styleId: 'daylight',
      styleName: '日光',
      stylePrompt: '',
      directorPersona: { personaId: 'director-a', personaName: '导演 A' },
    }
    const style = chapterOverrideToLockedStyle(buildChapterOverrideWithStyle(current, {
      styleId: 'night',
      styleName: '夜景',
      referenceImageUrl: null,
      stylePrompt: '深蓝夜色',
    }))
    expect(style).toEqual({
      styleId: 'night',
      styleName: '夜景',
      referenceImageUrl: null,
      stylePrompt: '深蓝夜色',
    })
    expect(buildChapterOverrideWithDirector(current, null)).toEqual({
      styleId: 'daylight',
      styleName: '日光',
      stylePrompt: '',
    })
  })

  it('preserves a user-authored chapter director prompt as structured context', () => {
    const parsed = parseChapterCreativeOverride({
      directorPersona: {
        personaId: 'chapter-custom-director',
        personaName: '克制写实导演',
        source: 'custom',
        prompt: '表演收敛，镜头只在情绪转折时移动。',
      },
    })
    expect(parsed?.directorPersona).toEqual({
      personaId: 'chapter-custom-director',
      personaName: '克制写实导演',
      source: 'custom',
      prompt: '表演收敛，镜头只在情绪转折时移动。',
    })
  })
})
