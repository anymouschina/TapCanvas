import { describe, expect, it } from 'vitest'
import { resolveSubtitleTextAtTime } from './renderTimeline'

describe('subtitle text shared by preview and export', () => {
  const captions = [
    { startUs: 0, endUs: 2_000_000, text: '第一句' },
    { startUs: 1_000_000, endUs: 3_000_000, text: '第二句\n下一行' },
  ]

  it('keeps all overlapping captions in their timeline order', () => {
    expect(resolveSubtitleTextAtTime(captions, 1_500_000)).toBe('第一句\n第二句\n下一行')
  })

  it('uses inclusive starts and exclusive ends without holding expired text', () => {
    expect(resolveSubtitleTextAtTime(captions, 0)).toBe('第一句')
    expect(resolveSubtitleTextAtTime(captions, 2_000_000)).toBe('第二句\n下一行')
    expect(resolveSubtitleTextAtTime(captions, 3_000_000)).toBe('')
    expect(resolveSubtitleTextAtTime([], 0)).toBe('')
  })
})
