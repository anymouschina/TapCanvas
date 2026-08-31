import { describe, it, expect } from 'vitest'
import { avcCodecString, buildFfmpegEncodeArgs, isWebCodecsMp4Supported } from './clipEncode'

describe('clipEncode', () => {
  it('≤720p 用 baseline 3.1，更高分辨率抬 level', () => {
    expect(avcCodecString(1280, 720)).toBe('avc1.42001f')
    expect(avcCodecString(1920, 1080)).toBe('avc1.640028')
  })
  it('ffmpeg 兜底命令含 libx264/yuv420p', () => {
    const a = buildFfmpegEncodeArgs(24, 96)
    expect(a).toContain('libx264'); expect(a).toContain('yuv420p')
    expect(a[a.indexOf('-framerate') + 1]).toBe('24')
    expect(a[a.indexOf('-frames:v') + 1]).toBe('96')
  })
  it('jsdom 无 VideoEncoder → 不支持（走兜底）', () => {
    expect(isWebCodecsMp4Supported()).toBe(false)
  })
})
