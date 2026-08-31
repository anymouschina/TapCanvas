import { describe, expect, it, vi } from 'vitest'
import { createVideoMarker, normalizeVideoMarkers, validateVideoMarkerRange } from './videoMarkers'

describe('videoMarkers', () => {
  it('validates an explicit point or segment inside the source duration', () => {
    expect(validateVideoMarkerRange({ startSeconds: 2, endSeconds: 2, durationSeconds: 10 })).toBe('')
    expect(validateVideoMarkerRange({ startSeconds: 2, endSeconds: 6, durationSeconds: 10 })).toBe('')
    expect(validateVideoMarkerRange({ startSeconds: 6, endSeconds: 2, durationSeconds: 10 })).toContain('不能早于')
    expect(validateVideoMarkerRange({ startSeconds: 2, endSeconds: 12, durationSeconds: 10 })).toContain('不能超过')
  })

  it('creates a traceable marker backed by hosted video and frame assets', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'marker-id' })
    const marker = createVideoMarker({
      sourceVideoUrl: 'https://assets.example.com/source.mp4',
      startSeconds: 3.25,
      endSeconds: 5.5,
      frameUrl: 'https://assets.example.com/frame.jpg',
      frameAssetId: 'asset-frame',
      note: '重拍这个转身',
      createdAt: '2026-08-13T00:00:00.000Z',
    })

    expect(marker).toMatchObject({
      id: 'video-marker-marker-id',
      startSeconds: 3.25,
      endSeconds: 5.5,
      frameAssetId: 'asset-frame',
    })
    vi.unstubAllGlobals()
  })

  it('drops legacy or incomplete placeholder records instead of fabricating assets', () => {
    expect(normalizeVideoMarkers([
      { id: 'placeholder', startSeconds: 1, endSeconds: 2, note: '没有资产' },
      {
        id: 'real',
        sourceVideoUrl: 'https://assets.example.com/source.mp4',
        startSeconds: 1,
        endSeconds: 2,
        frameUrl: 'https://assets.example.com/frame.jpg',
        frameAssetId: 'asset-frame',
        note: '',
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ])).toHaveLength(1)
  })
})
