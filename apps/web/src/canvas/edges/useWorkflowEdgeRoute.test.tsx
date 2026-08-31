// @vitest-environment jsdom

import React from 'react'
import { renderHook } from '@testing-library/react'
import { Position, ReactFlowProvider, type Edge, type Node } from '@xyflow/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useRFStore } from '../store'
import { useWorkflowEdgeRoute } from './useWorkflowEdgeRoute'

const SOURCE_ID = 'source'
const MIDDLE_ID = 'middle'
const TARGET_ID = 'target'
const EDGE_ID = 'source-to-target'

const nodes: Node[] = [
  { id: SOURCE_ID, position: { x: 0, y: 0 }, width: 56, height: 56, data: { kind: 'workflowStage' } },
  { id: MIDDLE_ID, position: { x: 120, y: 0 }, width: 56, height: 56, data: { kind: 'workflowStage' } },
  { id: TARGET_ID, position: { x: 240, y: 0 }, width: 56, height: 56, data: { kind: 'workflowStage' } },
]

const edges: Edge[] = [{
  id: EDGE_ID,
  source: SOURCE_ID,
  target: TARGET_ID,
  sourceHandle: 'out-workflow:result',
  targetHandle: 'in-workflow:result',
}]

const editableCanvasGraphBeforeTest = {
  nodes: useRFStore.getState().nodes,
  edges: useRFStore.getState().edges,
}

function SnapshotFlowProvider(props: React.PropsWithChildren): React.JSX.Element {
  return (
    <ReactFlowProvider initialNodes={nodes} initialEdges={edges}>
      {props.children}
    </ReactFlowProvider>
  )
}

describe('useWorkflowEdgeRoute', () => {
  afterEach(() => {
    useRFStore.setState(editableCanvasGraphBeforeTest)
  })

  it('routes from the nearest React Flow instance instead of the editable-canvas singleton', () => {
    useRFStore.setState({ nodes: [], edges: [] })

    const { result } = renderHook(() => useWorkflowEdgeRoute({
      enabled: true,
      edgeId: EDGE_ID,
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      sourceX: 56,
      sourceY: 28,
      sourcePosition: Position.Right,
      targetX: 240,
      targetY: 28,
      targetPosition: Position.Left,
      routeOffset: 8,
    }), { wrapper: SnapshotFlowProvider })

    expect(result.current?.detourSide).toBe('top')
    expect(result.current?.points).toHaveLength(6)
    expect(result.current?.points.some((point) => point.y < 0)).toBe(true)
  })
})
