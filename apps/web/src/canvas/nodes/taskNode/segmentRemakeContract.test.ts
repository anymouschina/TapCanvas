import { describe, expect, it } from 'vitest'
import { createSegmentRemakeDraftFromMarkers } from './segmentRemakeContract'

describe('segment remake marker handoff', () => {
  it('turns saved source markers into executable ranges, prompt notes and frame references', () => {
    expect(createSegmentRemakeDraftFromMarkers({
      sourceVideoUrl: 'https://assets.example.com/source.mp4',
      duration: 12,
      referenceImageLimit: 2,
      markers: [
        {
          id: 'range-1',
          sourceVideoUrl: 'https://assets.example.com/source.mp4',
          startSeconds: 2,
          endSeconds: 4,
          frameUrl: 'https://assets.example.com/frame-1.jpg',
          note: '保留人物，重拍转身动作',
        },
        {
          id: 'frame-2',
          sourceVideoUrl: 'https://assets.example.com/source.mp4',
          startSeconds: 6,
          endSeconds: 6,
          frameUrl: 'https://assets.example.com/frame-2.jpg',
          note: '背景改成雨夜',
        },
        {
          id: 'other-source',
          sourceVideoUrl: 'https://assets.example.com/other.mp4',
          startSeconds: 1,
          endSeconds: 3,
          frameUrl: 'https://assets.example.com/other.jpg',
          note: '不应带入',
        },
      ],
    })).toEqual({
      ranges: [{ start: 2, end: 4 }],
      prompt: '保留人物，重拍转身动作\n背景改成雨夜',
      referenceImages: [
        'https://assets.example.com/frame-1.jpg',
        'https://assets.example.com/frame-2.jpg',
      ],
      markerIds: ['range-1', 'frame-2'],
    })
  })
})
