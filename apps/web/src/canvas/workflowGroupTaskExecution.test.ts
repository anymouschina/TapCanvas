import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { planWorkflowGroupTaskExecution } from './workflowGroupTaskExecution'

function taskNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data }
}

describe('planWorkflowGroupTaskExecution', () => {
  it('runs independent DAG nodes, routes durable media through recovery, and defers its downstream nodes', () => {
    const nodes = [
      taskNode('normal-independent', { kind: 'image' }),
      taskNode('workflow-media', {
        kind: 'video', workflowExecutionId: 'execution-1', workflowExecutionFamilyId: 'family-1', workflowRuntimeNodeId: 'submit-video',
      }),
      taskNode('dependent-transform', { kind: 'imageEdit' }),
      taskNode('workflow-video-retry', {
        kind: 'video', workflowExecutionId: 'execution-2', workflowExecutionFamilyId: 'family-1', workflowRuntimeNodeId: 'video-retry-1',
        videoRetrySourceNodeId: 'workflow-media', videoRetryIndex: 1,
      }),
      taskNode('plain-text', { kind: 'text' }),
    ]
    const edges: Edge[] = [
      { id: 'media-to-transform', source: 'workflow-media', target: 'dependent-transform' },
      { id: 'retry-to-transform', source: 'workflow-video-retry', target: 'dependent-transform' },
      { id: 'independent-to-text', source: 'normal-independent', target: 'plain-text' },
    ]

    expect(planWorkflowGroupTaskExecution(nodes, edges, nodes.map((node) => node.id))).toEqual({
      workflowMediaTargets: ['workflow-media'],
      dagTargets: ['normal-independent', 'plain-text'],
      deferredTargets: ['dependent-transform'],
    })
  })
})
