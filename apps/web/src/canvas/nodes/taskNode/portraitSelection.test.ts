import { describe, expect, it } from 'vitest'
import {
  normalizePixelRect,
  normalizedRectToPixelBoundingBox,
  normalizedRectFromPoints,
} from './portraitSelection'
import { buildPortraitTextureExecutionPrompt } from './portraitTextureContract'

describe('portrait selection contract', () => {
  it('normalizes a detected pixel box to the image coordinate space', () => {
    expect(normalizePixelRect({
      originX: 200,
      originY: 100,
      width: 400,
      height: 600,
      imageWidth: 1000,
      imageHeight: 1000,
    })).toEqual({ x: 0.2, y: 0.1, width: 0.39999999999999997, height: 0.6 })
  })

  it('converts the selected person rectangle to the provider pixel box', () => {
    expect(normalizedRectToPixelBoundingBox({
      rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
      imageWidth: 1000,
      imageHeight: 800,
    })).toEqual([100, 160, 500, 560])
  })

  it('creates a positive manual rectangle regardless of drag direction', () => {
    expect(normalizedRectFromPoints({ x: 0.8, y: 0.75 }, { x: 0.25, y: 0.2 })).toEqual({
      x: 0.25,
      y: 0.2,
      width: 0.55,
      height: 0.55,
    })
  })

  it('binds the generation instruction to the selected mask and strength', () => {
    const prompt = buildPortraitTextureExecutionPrompt({ strength: 64, supplementalPrompt: '保留雀斑' })
    expect(prompt).toContain('只调整透明蒙版选中的人物区域')
    expect(prompt).toContain('人像质感强度：64/100')
    expect(prompt).toContain('不得美颜换脸')
    expect(prompt).toContain('用户补充要求：保留雀斑')
  })
})
