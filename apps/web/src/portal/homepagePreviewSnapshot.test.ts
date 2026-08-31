import { describe, expect, it } from 'vitest'

import { readHomepagePreviewSnapshotMessage } from './homepagePreviewSnapshot'

describe('homepage preview snapshot message', () => {
  it('accepts a complete same-shape temporary snapshot payload', () => {
    const snapshot = readHomepagePreviewSnapshotMessage({
      type: 'tapcanvas:homepage-preview-snapshot',
      snapshot: {
        slides: [{ imageUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/slide.webp', title: null, linkUrl: null }],
        decoration: {
          greetingSubtitle: '从当前草稿开始',
          heroPlaceholder: '输入创意',
          skillCards: [],
          loginVideos: [],
        },
        showcase: [{
          id: 'asset-1',
          name: '作品一',
          type: 'video',
          url: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/work.mp4',
          createdAt: '2026-07-22T00:00:00.000Z',
        }],
        templateWeights: { 'template-1': 100 },
      },
    })

    expect(snapshot?.decoration.heroPlaceholder).toBe('输入创意')
    expect(snapshot?.showcase[0]?.id).toBe('asset-1')
  })

  it('rejects malformed messages instead of partially applying them', () => {
    expect(readHomepagePreviewSnapshotMessage({
      type: 'tapcanvas:homepage-preview-snapshot',
      snapshot: { slides: 'not-an-array' },
    })).toBeNull()
  })
})
