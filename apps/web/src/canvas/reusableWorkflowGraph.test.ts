import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import {
  createReusableWorkflowGraph,
  readReusableWorkflowGraph,
  remapImportedWorkflowInstanceData,
} from './reusableWorkflowGraph'

function graph(): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      {
        id: 'group-1',
        type: 'groupNode',
        position: { x: 0, y: 0 },
        selected: false,
        data: { adminWorkflow: true, workflowKey: AGENT_WORKFLOW_KEY, workflowInstanceId: 'wf-1', label: '提示词工作流' },
      },
      {
        id: 'trigger-1',
        type: 'taskNode',
        parentId: 'group-1',
        position: { x: 10, y: 10 },
        selected: true,
        data: {
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'wf-1',
          workflowStatus: 'success',
          workflowTraceId: 'old-trace',
          workflowPinnedOutputSource: {
            version: 1,
            sourceExecutionId: 'source-execution',
            sourceNodeRunId: 'source-node-run',
          },
          workflowResolvedOutputReuse: {
            version: 1,
            kind: 'pin',
            sourceExecutionId: 'source-execution',
            sourceNodeRunId: 'source-node-run',
            outputRefs: { protocolVersion: '1' },
          },
        },
      },
      {
        id: 'input-1',
        type: 'taskNode',
        parentId: 'group-1',
        position: { x: 220, y: 10 },
        data: { adminWorkflow: true, workflowKey: AGENT_WORKFLOW_KEY, workflowInstanceId: 'wf-1' },
      },
      { id: 'unrelated', type: 'taskNode', position: { x: 900, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'inside', source: 'trigger-1', target: 'input-1' },
      { id: 'outside', source: 'input-1', target: 'unrelated' },
    ],
  }
}

describe('reusable workflow graph', () => {
  it('exports the workflow selected through a child and removes runtime state', () => {
    const source = graph()
    const reusable = createReusableWorkflowGraph(source.nodes, source.edges)
    expect(reusable.name).toBe('提示词工作流')
    expect(reusable.nodes.map((node) => node.id)).toEqual(['group-1', 'trigger-1', 'input-1'])
    expect(reusable.edges.map((edge) => edge.id)).toEqual(['inside'])
    expect(reusable.nodes[1].data).not.toHaveProperty('workflowStatus')
    expect(reusable.nodes[1].data).not.toHaveProperty('workflowTraceId')
    expect(reusable.nodes[1].data).not.toHaveProperty('workflowPinnedOutputSource')
    expect(reusable.nodes[1].data).not.toHaveProperty('workflowResolvedOutputReuse')
  })

  it('reads one workflow from an imported canvas envelope', () => {
    const source = graph()
    const reusable = readReusableWorkflowGraph({ nodes: source.nodes.slice(0, 3), edges: source.edges.slice(0, 1) })
    expect(reusable.nodes).toHaveLength(3)
    expect(reusable.edges).toHaveLength(1)
  })

  it('remaps the workflow instance identity without changing its configuration', () => {
    expect(remapImportedWorkflowInstanceData(
      { workflowInstanceId: 'wf-1', workflowInstruction: '生成提示词' },
      new Map([['wf-1', 'wf-2']]),
    )).toEqual({ workflowInstanceId: 'wf-2', workflowInstruction: '生成提示词' })
  })
})
