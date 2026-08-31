import { afterEach, describe, expect, it } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import { beginCanvasNodeDrag, clearCanvasNodeDragActivity, isCanvasNodeDragActive, useRFStore } from './store'

describe('canvas node drag activity', () => {
  afterEach(() => {
    const node = useRFStore.getState().nodes[0]
    if (node && isCanvasNodeDragActive()) {
      useRFStore.getState().onNodesChange([
        { id: node.id, type: 'position', position: node.position, dragging: false },
      ])
    }
    useRFStore.setState({ nodes: [], edges: [], historyPast: [], historyFuture: [] })
    clearCanvasNodeDragActivity()
  })

  it('is active for drag frames and clears on drag stop', () => {
    useRFStore.setState({
      nodes: [{ id: 'node-1', type: 'taskNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    const dragMove: NodeChange = {
      id: 'node-1',
      type: 'position',
      position: { x: 20, y: 10 },
      dragging: true,
    }
    useRFStore.getState().onNodesChange([dragMove])
    expect(isCanvasNodeDragActive()).toBe(true)

    useRFStore.getState().onNodesChange([
      { ...dragMove, position: { x: 30, y: 15 }, dragging: false },
    ])
    expect(isCanvasNodeDragActive()).toBe(false)
  })

  it('can be cleared explicitly when the UI drag lifecycle ends without a terminal change', () => {
    useRFStore.setState({
      nodes: [{ id: 'node-1', type: 'taskNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    useRFStore.getState().onNodesChange([
      { id: 'node-1', type: 'position', position: { x: 5, y: 5 }, dragging: true },
    ])

    clearCanvasNodeDragActivity()

    expect(isCanvasNodeDragActive()).toBe(false)
  })

  it('captures one undo snapshot without changing the nodes reference', () => {
    const nodes = [{ id: 'node-1', type: 'taskNode', position: { x: 0, y: 0 }, data: {} }]
    useRFStore.setState({ nodes, edges: [], historyPast: [], historyFuture: [] })

    beginCanvasNodeDrag('node-1')
    beginCanvasNodeDrag('node-1')

    const state = useRFStore.getState()
    expect(state.nodes).toBe(nodes)
    expect(state.historyPast).toHaveLength(1)
    expect(isCanvasNodeDragActive()).toBe(true)
  })
})
