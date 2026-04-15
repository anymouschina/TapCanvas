import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { resolveAutoReferenceNodeConnections } from '../../../../src/ui/chat/referenceNodeAutowire'

function createTaskNode(input: {
  id: string
  kind: string
  data?: Record<string, unknown>
}): Node {
  return {
    id: input.id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: {
      kind: input.kind,
      label: input.id,
      ...(input.data || {}),
    },
  }
}

describe('reference node autowire', () => {
  it('matches reference images to existing image nodes and proposes image handles', () => {
    const nodes: Node[] = [
      createTaskNode({
        id: 'ref-1',
        kind: 'image',
        data: {
          imageResults: [{ url: 'https://example.com/assets/fangyuan.jpg?sig=abc' }],
        },
      }),
      createTaskNode({
        id: 'target-1',
        kind: 'image',
        data: {
          referenceImages: ['https://example.com/assets/fangyuan.jpg?sig=xyz'],
        },
      }),
    ]

    const intents = resolveAutoReferenceNodeConnections({
      nodes,
      edges: [],
      targetNodeIds: ['target-1'],
    })

    expect(intents).toEqual([
      {
        targetNodeId: 'target-1',
        targetHandle: 'in-image',
        shouldPatchReferenceOrder: true,
        nextUpstreamReferenceOrder: ['ref-1'],
        connections: [{ sourceNodeId: 'ref-1', sourceHandle: 'out-image' }],
      },
    ])
  })

  it('honors existing edges while still maintaining reference order', () => {
    const nodes: Node[] = [
      createTaskNode({
        id: 'ref-1',
        kind: 'image',
        data: {
          imageUrl: 'https://example.com/assets/fangyuan.jpg',
        },
      }),
      createTaskNode({
        id: 'target-1',
        kind: 'image',
        data: {
          referenceImages: ['https://example.com/assets/fangyuan.jpg'],
          upstreamReferenceOrder: [],
        },
      }),
    ]
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'ref-1',
        target: 'target-1',
        sourceHandle: 'out-image',
        targetHandle: 'in-image',
      },
    ]

    const intents = resolveAutoReferenceNodeConnections({
      nodes,
      edges,
      targetNodeIds: ['target-1'],
    })

    expect(intents).toEqual([
      {
        targetNodeId: 'target-1',
        targetHandle: 'in-image',
        shouldPatchReferenceOrder: true,
        nextUpstreamReferenceOrder: ['ref-1'],
        connections: [],
      },
    ])
  })

  it('skips ambiguous url matches', () => {
    const nodes: Node[] = [
      createTaskNode({
        id: 'ref-1',
        kind: 'image',
        data: {
          imageUrl: 'https://example.com/assets/fangyuan.jpg',
        },
      }),
      createTaskNode({
        id: 'ref-2',
        kind: 'image',
        data: {
          imageUrl: 'https://example.com/assets/fangyuan.jpg',
        },
      }),
      createTaskNode({
        id: 'target-1',
        kind: 'image',
        data: {
          assetInputs: [{ url: 'https://example.com/assets/fangyuan.jpg', role: 'reference' }],
        },
      }),
    ]

    const intents = resolveAutoReferenceNodeConnections({
      nodes,
      edges: [],
      targetNodeIds: ['target-1'],
    })

    expect(intents).toEqual([])
  })
})
