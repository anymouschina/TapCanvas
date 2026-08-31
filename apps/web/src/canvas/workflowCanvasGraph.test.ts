import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { compileReachableWorkflowGraph } from './workflowCanvasGraph'

function node(id: string): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data: {} }
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

describe('reachable workflow graph compiler', () => {
  it('returns only trigger-reachable nodes in dependency order', () => {
    const graph = compileReachableWorkflowGraph({
      triggerNodeId: 'trigger',
      nodes: [node('orphan'), node('delivery'), node('trigger'), node('agent')],
      edges: [edge('e1', 'trigger', 'agent'), edge('e2', 'agent', 'delivery')],
      isEligibleNode: () => true,
    })

    expect(graph.nodes.map((item) => item.id)).toEqual(['trigger', 'agent', 'delivery'])
  })

  it('rejects a cycle instead of silently choosing an execution order', () => {
    expect(() => compileReachableWorkflowGraph({
      triggerNodeId: 'trigger',
      nodes: [node('trigger'), node('agent'), node('control')],
      edges: [
        edge('e1', 'trigger', 'agent'),
        edge('e2', 'agent', 'control'),
        edge('e3', 'control', 'agent'),
      ],
      isEligibleNode: () => true,
    })).toThrow('工作流存在循环连线')
  })
})
