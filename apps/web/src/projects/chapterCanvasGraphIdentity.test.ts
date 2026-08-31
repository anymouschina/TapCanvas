import { describe, expect, it } from 'vitest'
import {
  canReuseChapterCanvasSnapshot,
  createChapterCanvasGraphIdentity,
} from './chapterCanvasGraphIdentity'

describe('chapter canvas graph identity', () => {
  const staleGraph = {
    nodes: [{ id: 'clip-1', data: { kind: 'video', status: 'submitting' } }],
    edges: [],
  }
  const materializedGraph = {
    nodes: [{
      id: 'clip-1',
      data: {
        kind: 'video',
        status: 'success',
        videoUrl: 'https://assets.example/clip-1.mp4',
      },
    }],
    edges: [],
  }

  it('does not reuse a stale snapshot when the revision matches but media facts differ', () => {
    expect(canReuseChapterCanvasSnapshot({
      snapshotRevision: 147,
      serverRevision: 147,
      snapshotGraphIdentity: createChapterCanvasGraphIdentity(staleGraph),
      serverGraphIdentity: createChapterCanvasGraphIdentity(materializedGraph),
    })).toBe(false)
  })

  it('reuses a snapshot only when both revision and graph payload match', () => {
    const identity = createChapterCanvasGraphIdentity(materializedGraph)
    expect(canReuseChapterCanvasSnapshot({
      snapshotRevision: 147,
      serverRevision: 147,
      snapshotGraphIdentity: identity,
      serverGraphIdentity: identity,
    })).toBe(true)
  })
})
