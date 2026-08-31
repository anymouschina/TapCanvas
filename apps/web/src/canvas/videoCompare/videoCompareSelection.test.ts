import { describe, expect, it } from 'vitest'
import { resolveVideoCompareSelection } from './videoCompareSelection'

describe('resolveVideoCompareSelection', () => {
  it('opens an asset-backed video pair in visual left-to-right order', () => {
    expect(resolveVideoCompareSelection([
      {
        id: 'video-right',
        position: { x: 500, y: 100 },
        data: { kind: 'video', label: '右侧还原片', videoUrl: 'https://assets.example/right.mp4' },
      },
      {
        id: 'video-left',
        position: { x: 100, y: 100 },
        data: { kind: 'video', label: '左侧原片', videoUrl: 'https://assets.example/left.mp4' },
      },
    ])).toEqual({
      kind: 'ready',
      source: {
        nodeId: 'video-left',
        label: '左侧原片',
        url: 'https://assets.example/left.mp4',
        durationSeconds: null,
      },
      target: {
        nodeId: 'video-right',
        label: '右侧还原片',
        url: 'https://assets.example/right.mp4',
        durationSeconds: null,
      },
    })
  })

  it('reports a real-asset failure when either selected video has no URL', () => {
    expect(resolveVideoCompareSelection([
      {
        id: 'video-ready',
        position: { x: 0, y: 0 },
        data: { kind: 'video', videoUrl: 'https://assets.example/ready.mp4' },
      },
      {
        id: 'video-empty',
        position: { x: 200, y: 0 },
        data: { kind: 'video' },
      },
    ])).toEqual({ kind: 'missing-assets', nodeIds: ['video-empty'] })
  })

  it('does not hijack ordinary two-node selections', () => {
    expect(resolveVideoCompareSelection([
      { id: 'video-a', position: { x: 0, y: 0 }, data: { kind: 'video', videoUrl: 'https://assets.example/a.mp4' } },
      { id: 'image-a', position: { x: 200, y: 0 }, data: { kind: 'image', imageUrl: 'https://assets.example/a.png' } },
    ])).toEqual({ kind: 'not-video-pair' })
  })
})
