import { describe, expect, it } from 'vitest'
import { getConnectedNodeIds } from './connectedNodeIds'

describe('getConnectedNodeIds', () => {
  it('returns each connected endpoint once in edge order', () => {
    expect(getConnectedNodeIds([
      { source: 'text-1', target: 'image-1' },
      { source: 'image-1', target: 'video-1' },
    ])).toEqual(['text-1', 'image-1', 'video-1'])
  })

  it('returns no node ids when the graph has no edges', () => {
    expect(getConnectedNodeIds([])).toEqual([])
  })
})
