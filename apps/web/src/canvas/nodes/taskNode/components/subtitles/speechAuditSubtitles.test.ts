import { describe, expect, it } from 'vitest'
import { speechAuditToSubtitleSegments } from './speechAuditSubtitles'

describe('speechAuditToSubtitleSegments', () => {
  it('projects real speech intervals into source-video microseconds', () => {
    const segments = speechAuditToSubtitleSegments('https://cdn.example/video.mp4', {
      transcript: {
        version: 1,
        language: 'zh-CN',
        utterances: [
          { utteranceId: 'u1', startSeconds: 0.25, endSeconds: 1.75, text: '你好。' },
          { utteranceId: 'u2', startSeconds: 2, endSeconds: 3.2, text: '继续。' },
        ],
      },
    })

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      sourceUrl: 'https://cdn.example/video.mp4',
      startUs: 250_000,
      endUs: 1_750_000,
      text: '你好。',
      source: 'auto',
    })
  })

  it('does not create zero-length subtitle segments', () => {
    const segments = speechAuditToSubtitleSegments('https://cdn.example/video.mp4', {
      transcript: {
        version: 1,
        language: 'und',
        utterances: [
          { utteranceId: 'u1', startSeconds: 2, endSeconds: 2, text: 'invalid' },
          { utteranceId: 'u2', startSeconds: 3, endSeconds: 4, text: 'valid' },
        ],
      },
    })

    expect(segments).toHaveLength(1)
    expect(segments[0]?.text).toBe('valid')
  })
})
