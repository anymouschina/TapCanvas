import { describe, expect, it } from 'vitest'
import type { Node, NodeChange } from '@xyflow/react'
import { normalizeCanvasNodeChanges } from './normalizeCanvasNodeChanges'

describe('normalizeCanvasNodeChanges', () => {
  it('normalizes only the emitted drag changes without requiring the node collection', () => {
    const positionChange: NodeChange<Node> = {
      id: 'node-42',
      type: 'position',
      position: { x: 120, y: 80 },
    }

    expect(normalizeCanvasNodeChanges([positionChange], true)).toEqual([
      {
        ...positionChange,
        dragging: true,
      },
    ])
  })

  it('preserves explicit drag lifecycle flags and non-position changes', () => {
    const changes: NodeChange<Node>[] = [
      {
        id: 'node-1',
        type: 'position',
        position: { x: 10, y: 20 },
        dragging: false,
      },
      { id: 'node-2', type: 'select', selected: true },
    ]

    const result = normalizeCanvasNodeChanges(changes, true)

    expect(result).toEqual(changes)
    expect(result[0]).toBe(changes[0])
    expect(result[1]).toBe(changes[1])
  })

  it('drops transient remove changes handled by explicit canvas actions', () => {
    const changes: NodeChange<Node>[] = [
      { id: 'node-1', type: 'remove' },
      { id: 'node-2', type: 'select', selected: false },
    ]

    expect(normalizeCanvasNodeChanges(changes, false)).toEqual([changes[1]])
  })
})
