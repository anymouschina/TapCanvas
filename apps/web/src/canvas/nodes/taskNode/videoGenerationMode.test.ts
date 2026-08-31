import { describe, expect, it } from 'vitest'
import { resolveVideoGenerationMode, videoGenerationModeLabel } from './videoGenerationMode'

describe('videoGenerationMode', () => {
  it('derives a single mode from persisted generation inputs', () => {
    expect(resolveVideoGenerationMode({ firstFrameUrl: '', lastFrameUrl: '', referenceCount: 0 })).toBe('text')
    expect(resolveVideoGenerationMode({ firstFrameUrl: '', lastFrameUrl: '', referenceCount: 2 })).toBe('image')
    expect(resolveVideoGenerationMode({ firstFrameUrl: ' https://example.com/first.jpg ', lastFrameUrl: '', referenceCount: 3 })).toBe('first-frame')
    expect(resolveVideoGenerationMode({ firstFrameUrl: 'first', lastFrameUrl: 'last', referenceCount: 0 })).toBe('first-last-frame')
  })

  it('uses the user-visible labels for every supported mode', () => {
    expect(videoGenerationModeLabel('text')).toBe('文生视频')
    expect(videoGenerationModeLabel('image')).toBe('图生视频')
    expect(videoGenerationModeLabel('first-frame')).toBe('首帧视频')
    expect(videoGenerationModeLabel('first-last-frame')).toBe('首尾帧视频')
  })
})
