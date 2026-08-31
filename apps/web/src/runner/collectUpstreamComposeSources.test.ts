import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { collectUpstreamComposeAudioTracks } from './collectUpstreamComposeSources'

const audioNode: Node = {
  id: 'voice-a',
  type: 'taskNode',
  position: { x: 0, y: 0 },
  data: {
    kind: 'audio',
    audioType: 'voice_card',
    audioUrl: 'https://file.beqlee.icu/voice-a.mp3',
  },
}

const composeNode: Node = {
  id: 'compose-a',
  type: 'taskNode',
  position: { x: 100, y: 0 },
  data: { kind: 'videoCompose' },
}

describe('collectUpstreamComposeAudioTracks', () => {
  it('collects an ordinary executable audio edge', () => {
    const edge: Edge = { id: 'audio-edge', source: 'voice-a', target: 'compose-a' }
    expect(collectUpstreamComposeAudioTracks('compose-a', [audioNode, composeNode], [edge]))
      .toEqual([{ url: 'https://file.beqlee.icu/voice-a.mp3', volume: 1, loop: false }])
  })

  it('does not mix a reference-only voice provenance edge', () => {
    const edge: Edge = {
      id: 'voice-reference-edge',
      source: 'voice-a',
      target: 'compose-a',
      data: {
        edgeType: 'audio',
        relationKind: 'voice_reference',
        executionRole: 'reference_only',
      },
    }
    expect(collectUpstreamComposeAudioTracks('compose-a', [audioNode, composeNode], [edge]))
      .toEqual([])
  })
})
