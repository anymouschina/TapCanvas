import { describe, expect, it } from 'vitest'
import { resolveComposeFrame, containComposeFrame } from './composeFrameLayout'

describe('mixed aspect composition', () => {
  const portrait = { width: 720, height: 1280, duration: 15 }
  const landscape = { width: 1280, height: 720, duration: 100 }
  it('uses dominant duration instead of the first video', () => {
    expect(resolveComposeFrame([portrait, landscape])).toEqual({ width: 1280, height: 720 })
    expect(resolveComposeFrame([landscape, portrait])).toEqual({ width: 1280, height: 720 })
  })
  it('groups the same aspect across resolutions', () => {
    expect(resolveComposeFrame([portrait, { width: 1280, height: 720, duration: 10 }, { width: 1920, height: 1080, duration: 10 }]))
      .toEqual({ width: 1920, height: 1080 })
  })
  it('honors an explicit output aspect', () => {
    expect(resolveComposeFrame([landscape], '9:16')).toEqual({ width: 1080, height: 1920 })
  })
  it('contains both orientations without stretching or cropping', () => {
    expect(containComposeFrame(portrait, landscape)).toEqual({ x: 437.5, y: 0, w: 405, h: 720 })
    expect(containComposeFrame(landscape, portrait)).toEqual({ x: 0, y: 437.5, w: 720, h: 405 })
  })
  it('does not choose a fully trimmed source and rejects invalid metadata', () => {
    expect(resolveComposeFrame([{ ...portrait, duration: 0 }, landscape])).toEqual({ width: 1280, height: 720 })
    expect(() => resolveComposeFrame([{ ...portrait, width: 0 }])).toThrow('视频尺寸无效')
    expect(() => resolveComposeFrame([{ ...portrait, duration: 0 }])).toThrow('没有可合成')
  })
})
