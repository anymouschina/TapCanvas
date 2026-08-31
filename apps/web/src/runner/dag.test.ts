import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { collectDagRunPlan } from './dag'

const voiceNode: Node = {
  id: 'voice-a',
  type: 'taskNode',
  position: { x: 0, y: 0 },
  data: { kind: 'audio', audioType: 'voice_card' },
}

const videoNode: Node = {
  id: 'clip-a',
  type: 'taskNode',
  position: { x: 100, y: 0 },
  data: { kind: 'video', prompt: '镜头' },
}

describe('collectDagRunPlan reference-only edges', () => {
  it('does not make a voice card an executable prerequisite', () => {
    const edge: Edge = {
      id: 'voice-reference-edge',
      source: 'voice-a',
      target: 'clip-a',
      data: {
        edgeType: 'audio',
        relationKind: 'voice_reference',
        executionRole: 'reference_only',
      },
    }
    const plan = collectDagRunPlan('clip-a', [voiceNode, videoNode], [edge])
    expect([...plan.requiredNodeIds]).toEqual(['clip-a'])
    expect([...plan.skippedNodeIds]).toEqual([])
  })

  it('preserves ordinary executable edge dependencies', () => {
    const edge: Edge = { id: 'audio-edge', source: 'voice-a', target: 'clip-a' }
    const plan = collectDagRunPlan('clip-a', [voiceNode, videoNode], [edge])
    expect(plan.requiredNodeIds).toEqual(new Set(['clip-a', 'voice-a']))
  })
})
