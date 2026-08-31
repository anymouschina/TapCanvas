import { describe, expect, it } from 'vitest'
import type { InternalNode, Node } from '@xyflow/react'
import { applyActiveNodeDragFrame } from './applyActiveNodeDragFrame'

function buildInternalNode(): InternalNode<Node> {
  return {
    id: 'image-1',
    position: { x: 10, y: 20 },
    data: {},
    measured: { width: 320, height: 180 },
    internals: {
      positionAbsolute: { x: 110, y: 220 },
      z: 0,
      userNode: {
        id: 'image-1',
        position: { x: 10, y: 20 },
        data: {},
      },
    },
  }
}

describe('applyActiveNodeDragFrame', () => {
  it('updates only the dragged node and its mounted element', () => {
    const node = buildInternalNode()
    const sibling = { ...buildInternalNode(), id: 'image-2' }
    const element = document.createElement('div')
    element.dataset.id = node.id
    const root = document.createElement('div')
    root.append(element)
    const lookup = new Map<string, InternalNode<Node>>([
      [node.id, node],
      [sibling.id, sibling],
    ])

    applyActiveNodeDragFrame({
      changes: [{ id: node.id, type: 'position', position: { x: 35, y: 50 }, dragging: true }],
      nodeLookup: lookup,
      canvasRoot: root,
      elementCache: new Map(),
    })

    expect(node.position).toEqual({ x: 35, y: 50 })
    expect(node.internals.positionAbsolute).toEqual({ x: 135, y: 250 })
    expect(element.style.transform).toBe('translate(135px, 250px)')
    expect(sibling.position).toEqual({ x: 10, y: 20 })
  })

  it('honors an absolute position supplied by React Flow', () => {
    const node = buildInternalNode()
    applyActiveNodeDragFrame({
      changes: [{
        id: node.id,
        type: 'position',
        position: { x: 40, y: 60 },
        positionAbsolute: { x: 440, y: 560 },
        dragging: true,
      }],
      nodeLookup: new Map([[node.id, node]]),
      canvasRoot: null,
      elementCache: new Map(),
    })
    expect(node.internals.positionAbsolute).toEqual({ x: 440, y: 560 })
  })
})
