import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { beginCanvasNodeDrag, isCanvasNodeDragActive, useRFStore } from './store'

const node = (id: string): Node => ({
  id,
  type: 'taskNode',
  position: { x: 0, y: 0 },
  data: { label: id },
})

const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
})

describe('canvas runtime lifecycle', () => {
  beforeEach(() => {
    useRFStore.getState().reset()
  })

  it('fully clears graph-scoped session state when the canvas unmounts', () => {
    const first = node('first')
    useRFStore.setState({
      nodes: [first],
      edges: [],
      nextId: 8,
      nextGroupId: 4,
      historyPast: [{ nodes: [node('past')], edges: [] }],
      historyFuture: [{ nodes: [node('future')], edges: [] }],
      clipboard: { nodes: [node('copied')], edges: [] },
      canvasViewLocked: true,
      pendingFocusNodeId: first.id,
      userMovedNodeIds: new Set([first.id]),
      graphProvenanceKey: 'flow:first-flow',
    })
    beginCanvasNodeDrag(first.id)

    useRFStore.getState().reset()

    const state = useRFStore.getState()
    expect(state.nodes).toEqual([])
    expect(state.edges).toEqual([])
    expect(state.nextId).toBe(1)
    expect(state.nextGroupId).toBe(1)
    expect(state.historyPast).toEqual([])
    expect(state.historyFuture).toEqual([])
    expect(state.clipboard).toBeNull()
    expect(state.canvasViewLocked).toBe(false)
    expect(state.pendingFocusNodeId).toBeNull()
    expect(state.userMovedNodeIds.size).toBe(0)
    expect(state.graphProvenanceKey).toBeNull()
    expect(isCanvasNodeDragActive()).toBe(false)
  })

  it('replaces a resource without retaining the previous graph in undo history', () => {
    const oldNode = node('old')
    const oldEdge = edge('old-edge', 'old', 'old')
    useRFStore.setState({
      nodes: [oldNode],
      edges: [oldEdge],
      historyPast: [{ nodes: [node('older')], edges: [] }],
      historyFuture: [{ nodes: [node('newer')], edges: [] }],
      clipboard: { nodes: [oldNode], edges: [oldEdge] },
      graphProvenanceKey: 'chapter:old',
    })

    useRFStore.getState().load({ nodes: [node('new')], edges: [] })

    const state = useRFStore.getState()
    expect(state.nodes.map((item) => item.id)).toEqual(['new'])
    expect(state.historyPast).toEqual([])
    expect(state.historyFuture).toEqual([])
    expect(state.graphProvenanceKey).toBeNull()

    state.undo()
    expect(useRFStore.getState().nodes.map((item) => item.id)).toEqual(['new'])
  })
})
