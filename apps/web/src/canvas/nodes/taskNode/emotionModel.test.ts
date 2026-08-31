import { describe, expect, it } from 'vitest'
import { buildEmotionPrompt, buildLibTvEmotionPrompt, getEmotionCell } from './emotionModel'

describe('emotion adjustment contract', () => {
  it('clamps the two-dimensional emotion coordinate to a real cell', () => {
    expect(getEmotionCell(9, -3)).toMatchObject({ x: 4, y: 0, zh: '暴怒沉怒' })
  })

  it('binds the original image, cropped face reference and pixel bounding box', () => {
    expect(buildLibTvEmotionPrompt({
      expression: '淡然自若',
      faceBoundingBox: [120, 80, 420, 680],
    })).toBe('以参考图一（原图）为主参考图，第2个人脸参考图的坐标是[120,80,420,680]设置成淡然自若表情')
  })

  it('limits the requested change to expression while preserving identity and scene facts', () => {
    const prompt = buildEmotionPrompt(getEmotionCell(0, 2))
    expect(prompt).toContain('仅将人物的面部表情与神态调整')
    expect(prompt).toContain('保持人物的身份、五官、发型、服装、身体姿态、构图、光照和画面风格完全不变')
  })
})
