import { beforeEach, describe, expect, it } from 'vitest'
import { useVideoCompareStore } from './videoCompareStore'
import type { VideoCompareSource } from './videoCompareSource'

const source = (nodeId: string): VideoCompareSource => ({
  nodeId,
  label: nodeId,
  url: `https://assets.example/${nodeId}.mp4`,
  durationSeconds: 5,
})

beforeEach(() => {
  useVideoCompareStore.getState().close()
})

describe('video compare selection store', () => {
  it('opens one explicit pair without an intermediate click-selection state', () => {
    useVideoCompareStore.getState().openComparison(source('video-a'), source('video-b'))
    expect(useVideoCompareStore.getState().session).toMatchObject({
      phase: 'open',
      source: { nodeId: 'video-a' },
      target: { nodeId: 'video-b' },
    })
  })

  it('closes without retaining a stale comparison pair', () => {
    useVideoCompareStore.getState().openComparison(source('video-a'), source('video-b'))
    useVideoCompareStore.getState().close()
    expect(useVideoCompareStore.getState().session).toEqual({ phase: 'idle' })
  })
})
