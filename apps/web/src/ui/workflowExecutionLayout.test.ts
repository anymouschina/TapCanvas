import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { layoutExecutionWorkflowNodes } from './workflowExecutionLayout'

describe('execution DAG presentation', () => {
  it('separates parallel branches, orders dependencies, and preserves the frozen source', () => {
    const nodes: Node[] = [
      { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: { workflowInstanceId: 'instance' } },
      ...['start', 'design', 'assets', 'join'].map(id => ({
        id, parentId: id === 'assets' ? undefined : 'group', position: { x: 0, y: 0 }, data: { kind: 'workflowStage', workflowInstanceId: 'instance' },
      })),
    ]
    const edges = [['start', 'design'], ['start', 'assets'], ['design', 'join'], ['assets', 'join']]
      .map(([source, target], index) => ({ id: String(index), source, target }))
    const source = JSON.stringify(nodes)
    const result = layoutExecutionWorkflowNodes(nodes, edges)
    const byId = new Map(result.map(node => [node.id, node]))
    for (const edge of edges) expect(byId.get(edge.source)!.position.x).toBeLessThan(byId.get(edge.target)!.position.x)
    expect(byId.get('design')!.position.x).toBe(byId.get('assets')!.position.x)
    expect(Math.abs(byId.get('design')!.position.y - byId.get('assets')!.position.y)).toBeGreaterThanOrEqual(300)
    expect(byId.get('group')!.width).toBeGreaterThan(byId.get('join')!.position.x)
    expect(byId.get('assets')!.parentId).toBe('group')
    expect(JSON.stringify(nodes)).toBe(source)
  })
})
