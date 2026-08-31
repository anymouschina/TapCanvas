import { describe, expect, it } from 'vitest'
import { resolveVideoCompareSource } from './videoCompareSource'

describe('resolveVideoCompareSource', () => {
  it('resolves the selected real video result', () => {
    expect(resolveVideoCompareSource({
      id: 'video-a',
      data: {
        kind: 'video',
        label: '版本 A',
        videoPrimaryIndex: 1,
        videoResults: [
          { url: 'https://assets.example/a-1.mp4', duration: 5 },
          { url: 'https://assets.example/a-2.mp4', duration: 8 },
        ],
      },
    })).toEqual({
      nodeId: 'video-a',
      label: '版本 A',
      url: 'https://assets.example/a-2.mp4',
      durationSeconds: 8,
    })
  })

  it('accepts a composed-video node because it shares the video core contract', () => {
    expect(resolveVideoCompareSource({
      id: 'compose-a',
      data: { kind: 'videoCompose', videoUrl: 'blob:composed-video' },
    }))?.toMatchObject({
      nodeId: 'compose-a',
      url: 'blob:composed-video',
    })
  })

  it('rejects non-video nodes and video nodes without a real asset URL', () => {
    expect(resolveVideoCompareSource({ id: 'text-a', data: { kind: 'text', prompt: 'hello' } })).toBeNull()
    expect(resolveVideoCompareSource({ id: 'video-empty', data: { kind: 'video', prompt: 'hello' } })).toBeNull()
    expect(resolveVideoCompareSource({ id: 'video-placeholder', data: { kind: 'video', videoUrl: 'placeholder.mp4' } })).toBeNull()
  })
})
