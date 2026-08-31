import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { filterAdminWorkflowCanvasGraph } from './adminWorkflowVisibility'

const nodes: Node[] = [
  { id: 'source', type: 'groupNode', position: { x: 0, y: 0 }, data: { label: '来源组' } },
  { id: 'admin-group', type: 'groupNode', position: { x: 0, y: 0 }, data: { adminWorkflow: true } },
  { id: 'trigger', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowTrigger', adminWorkflow: true } },
  { id: 'stage', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage', adminWorkflow: true } },
]

const edges: Edge[] = [
  { id: 'workflow-edge', source: 'trigger', target: 'stage' },
]

describe('admin workflow canvas visibility', () => {
  it('preserves the complete graph for administrators', () => {
    const graph = filterAdminWorkflowCanvasGraph(nodes, edges, true)
    expect(graph.nodes).toBe(nodes)
    expect(graph.edges).toBe(edges)
  })

  it('removes admin workflow nodes and their edges for non-admin viewers', () => {
    const graph = filterAdminWorkflowCanvasGraph(nodes, edges, false)
    expect(graph.nodes.map((node) => node.id)).toEqual(['source'])
    expect(graph.edges).toEqual([])
  })
})
