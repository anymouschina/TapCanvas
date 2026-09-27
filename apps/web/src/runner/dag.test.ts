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

describe('collectDagRunPlan video asset dependencies', () => {
  const image = (id: string, imageUrl?: string): Node => ({
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: { kind: 'image', ...(imageUrl ? { imageUrl } : {}) },
  })

  it('includes explicit image references without canvas edges and deduplicates a shared image', () => {
    const clip: Node = {
      ...videoNode,
      data: { kind: 'video', referenceImageNodeIds: ['shared', 'shared'], firstFrameFromNodeId: 'frame' },
    }
    const plan = collectDagRunPlan(clip.id, [image('shared'), image('frame'), clip], [])
    expect(plan.requiredNodeIds).toEqual(new Set(['clip-a', 'shared', 'frame']))
  })

  it('reuses only persisted remote image URLs', () => {
    const clip: Node = { ...videoNode, data: { kind: 'video', referenceImageNodeIds: ['ready', 'local', 'invalid'] } }
    const plan = collectDagRunPlan(clip.id, [image('ready', 'https://assets.example.com/ready.png'), image('local', 'blob:temporary'), image('invalid', 'https://'), clip], [])
    expect(plan.skippedNodeIds).toEqual(new Set(['ready']))
    expect(plan.requiredNodeIds).toEqual(new Set(['clip-a', 'local', 'invalid']))
  })

  it('reruns an upstream image whose old URL remains on a failed node', () => {
    const stale: Node = { ...image('stale', 'https://assets.example.com/old.png'), data: {
      kind: 'image', status: 'failed', imageUrl: 'https://assets.example.com/old.png',
    } }
    const clip: Node = { ...videoNode, data: { kind: 'video', referenceImageNodeIds: ['stale'] } }
    const plan = collectDagRunPlan(clip.id, [stale, clip], [])
    expect(plan.requiredNodeIds).toEqual(new Set(['clip-a', 'stale']))
  })

  it('stops traversal at an existing image asset', () => {
    const parent = image('parent')
    const ready = image('ready', 'https://assets.example.com/ready.png')
    const clip: Node = { ...videoNode, data: { kind: 'video', referenceImageNodeIds: ['ready'] } }
    const plan = collectDagRunPlan(clip.id, [parent, ready, clip], [{ id: 'parent-ready', source: 'parent', target: 'ready' }])
    expect(plan.requiredNodeIds).toEqual(new Set(['clip-a']))
    expect(plan.skippedNodeIds).toEqual(new Set(['ready']))
  })
})
