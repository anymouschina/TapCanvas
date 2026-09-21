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

import { collectUpstreamComposeSources } from './collectUpstreamComposeSources'

function video(id: string, index: number, sequence = 'run-a'): Node {
  return { id, position: { x: 0, y: 0 }, data: {
    kind: 'video', label: '用户可任意改名', clipRunId: sequence, clipIndex: index,
    videoUrl: `https://example.com/${id}.mp4`, durationSeconds: 10,
  } }
}
function connections(ids: string[]): Edge[] {
  return ids.map(id => ({ id: `edge-${id}`, source: id, target: composeNode.id }))
}

describe('composition chronology', () => {
  it('orders explicit connections by numeric clip position, not connection order or title', () => {
    const nodes = [video('ten', 10), video('two', 2), video('zero', 0), composeNode]
    expect(collectUpstreamComposeSources(composeNode.id, nodes, connections(['ten', 'zero', 'two'])).map(item => item.url))
      .toEqual(['https://example.com/zero.mp4', 'https://example.com/two.mp4', 'https://example.com/ten.mp4'])
  })
  it('uses the workflow item identity when the node has no projected index', () => {
    const nodes = [2, 0, 1].map(index => ({ id: `v${index}`, position: { x: 0, y: 0 }, data: {
      kind: 'video', workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: `submit::item::${encodeURIComponent(`source:clip:${index}`)}`,
      videoUrl: `https://example.com/${index}.mp4`,
    } }))
    expect(collectUpstreamComposeSources(composeNode.id, nodes, connections(nodes.map(node => node.id))).map(item => item.url))
      .toEqual([0, 1, 2].map(index => `https://example.com/${index}.mp4`))
  })
  it('preserves unrelated source slots and does not import disconnected clips', () => {
    const loose = video('loose', 0)
    delete loose.data.clipRunId
    const nodes = [video('two', 2), loose, video('one', 1), video('unconnected', 0), composeNode]
    expect(collectUpstreamComposeSources(composeNode.id, nodes, connections(['two', 'loose', 'one'])).map(item => item.url))
      .toEqual(['one', 'loose', 'two'].map(id => `https://example.com/${id}.mp4`))
  })
  it('respects a single explicit input even when the composition has run membership', () => {
    const target = { ...composeNode, data: { ...composeNode.data, clipRunId: 'run-a' } }
    const nodes = [video('one', 1), video('two', 2), target]
    expect(collectUpstreamComposeSources(target.id, nodes, connections(['two']))).toHaveLength(1)
    expect(collectUpstreamComposeSources(target.id, nodes, []).map(item => item.url))
      .toEqual(['one', 'two'].map(id => `https://example.com/${id}.mp4`))
  })
})
