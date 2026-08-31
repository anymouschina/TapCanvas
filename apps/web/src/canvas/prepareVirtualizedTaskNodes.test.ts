import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { prepareVirtualizedTaskNodes } from './prepareVirtualizedTaskNodes'

type TestNode = Node<Record<string, unknown>>

function taskNode(kind: string, data: Record<string, unknown> = {}): TestNode {
  return {
    id: `${kind}-1`,
    type: 'taskNode',
    position: { x: 2000, y: 2000 },
    data: { kind, ...data },
  }
}

describe('prepareVirtualizedTaskNodes', () => {
  it('keeps the original array when virtualization is disabled', () => {
    const nodes = [taskNode('image')]
    expect(prepareVirtualizedTaskNodes(nodes, false)).toBe(nodes)
  })

  it('provides cold-start dimensions and handle geometry for image nodes', () => {
    const [prepared] = prepareVirtualizedTaskNodes([
      taskNode('image', { nodeWidth: 320, nodeHeight: 180 }),
    ], true)
    expect(prepared).toMatchObject({
      initialWidth: 320,
      initialHeight: 180,
      measured: { width: 320, height: 180 },
      style: { width: 320, height: 180 },
    })
    expect(prepared.handles?.map((handle) => handle.id)).toEqual([
      'in-image',
      'out-image',
      'in-image-wide',
      'out-image-wide',
    ])
    expect(prepared.handles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'in-image', x: -36, y: 80, width: 20, height: 20 }),
      expect.objectContaining({ id: 'out-image', x: 336, y: 80, width: 20, height: 20 }),
      expect.objectContaining({ id: 'in-image-wide', x: -45, y: 6, width: 18, height: 168 }),
      expect.objectContaining({ id: 'out-image-wide', x: 347, y: 6, width: 18, height: 168 }),
    ]))
  })

  it('premeasures completed video nodes so cold-start culling does not mount them all', () => {
    const [prepared] = prepareVirtualizedTaskNodes([taskNode('video')], true)
    expect(prepared).toMatchObject({
      initialWidth: 622,
      initialHeight: 350,
      measured: { width: 622, height: 350 },
      style: { width: 622, height: 350 },
    })
    expect(prepared.handles?.map((handle) => handle.id)).toEqual([
      'in-any',
      'out-video',
      'in-any-wide',
      'out-video-wide',
    ])
  })

  it('uses the lightweight audio shell footprint before its first DOM measure', () => {
    const [prepared] = prepareVirtualizedTaskNodes([taskNode('audio')], true)
    expect(prepared).toMatchObject({
      initialWidth: 432,
      initialHeight: 203,
      measured: { width: 432, height: 203 },
    })
    expect(prepared.handles?.map((handle) => handle.id)).toEqual([
      'in-text',
      'in-audio',
      'in-image',
      'out-audio',
      'in-text-wide',
      'out-audio-wide',
    ])
  })

  it('preserves persisted dimensions instead of replacing them with type defaults', () => {
    const [prepared] = prepareVirtualizedTaskNodes([
      {
        ...taskNode('video'),
        measured: { width: 640, height: 360 },
        style: { width: 640, height: 360, opacity: 0.5 },
      },
    ], true)
    expect(prepared).toMatchObject({
      initialWidth: 640,
      initialHeight: 360,
      measured: { width: 640, height: 360 },
      style: { width: 640, height: 360, opacity: 0.5 },
    })
  })

  it('clamps corrupt persisted visual dimensions to the node contract', () => {
    const [prepared] = prepareVirtualizedTaskNodes([
      {
        ...taskNode('video'),
        measured: { width: 2000, height: 40 },
      },
    ], true)
    expect(prepared).toMatchObject({
      initialWidth: 960,
      initialHeight: 169,
      measured: { width: 960, height: 169 },
    })
  })

  it('does not guess a dynamic text height when none is persisted', () => {
    const textNode = taskNode('text')
    const [prepared] = prepareVirtualizedTaskNodes([textNode], true)
    expect(prepared).toBe(textNode)
  })

  it('hard-cuts persisted workflow cards to the icon-node footprint', () => {
    const [prepared] = prepareVirtualizedTaskNodes([
      taskNode('workflowStage', { nodeWidth: 300, nodeHeight: 224 }),
    ], true)
    expect(prepared).toMatchObject({
      initialWidth: 56,
      initialHeight: 56,
      measured: { width: 56, height: 56 },
      style: { width: 56, height: 56 },
    })
  })

  it('premeasures workflow media result mode to its 16:9 canvas footprint', () => {
    const [prepared] = prepareVirtualizedTaskNodes([
      taskNode('workflowStage', {
        workflowAtomicSpec: { operation: 'image_generate' },
        workflowCanvasDisplayMode: 'result',
        workflowOutputArtifacts: [{
          type: 'tapcanvas.image/v1',
          identity: 'image-1',
          value: 'https://cdn.example.com/image-1.webp',
        }],
        nodeWidth: 300,
        nodeHeight: 224,
      }),
    ], true)
    expect(prepared).toMatchObject({
      initialWidth: 240,
      initialHeight: 135,
      measured: { width: 240, height: 135 },
      style: { width: 240, height: 135 },
    })
  })
})
