import { describe, expect, it } from 'vitest'
import {
  isExecutionDoWorkflowNodeData,
  isWorkflowRuntimeReferenceEdgeData,
  isWorkflowRuntimeReferenceNodeData,
  withoutWorkflowExecutionProjectionData,
  withoutWorkflowExecutionProjectionEdges,
  withoutWorkflowExecutionProjectionNodes,
  workflowExecutionProjectionGuard,
} from './workflowExecutionProjectionData'

describe('workflow execution projection data', () => {
  it('removes only ExecutionDO runtime facts from a workflow authoring node', () => {
    const authoringData = withoutWorkflowExecutionProjectionData({
      kind: 'workflowStage',
      adminWorkflow: true,
      label: 'Prompt agent',
      workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
      workflowExecutionId: 'execution-1',
      workflowExecutionCreatedAt: '2026-08-12T05:00:00.000Z',
      workflowStatus: 'succeeded',
      workflowLocalTestOutput: { result: 'done' },
      workflowExecutionEvidence: { executorCompleted: true },
      workflowOutputArtifactIds: ['image-1'],
      workflowOutputArtifacts: [{
        type: 'tapcanvas.image/v1',
        identity: 'image-1',
        value: 'https://cdn.example.com/image-1.webp',
      }],
      workflowItemRuns: [{ itemId: 'item-1', status: 'success' }],
      workflowCompletedUnits: 1,
      workflowTotalUnits: 1,
      workflowExecutionFinishedAt: '2026-08-12T05:00:01.000Z',
      workflowNodeRunId: 'node-run-1',
      workflowResolvedOutputReuse: { kind: 'replay' },
    })

    expect(authoringData).toEqual({
      kind: 'workflowStage',
      adminWorkflow: true,
      label: 'Prompt agent',
      workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
    })
  })

  it('identifies only registered workflow trigger and stage nodes', () => {
    expect(isExecutionDoWorkflowNodeData({ kind: 'workflowTrigger', adminWorkflow: true })).toBe(true)
    expect(isExecutionDoWorkflowNodeData({ kind: 'workflowStage', adminWorkflow: true })).toBe(true)
    expect(isExecutionDoWorkflowNodeData({ kind: 'workflowStage' })).toBe(false)
    expect(isExecutionDoWorkflowNodeData({ kind: 'text', adminWorkflow: true })).toBe(false)
  })

  it('strips runtime projection from workflow nodes without cloning unrelated nodes', () => {
    const textNode = { id: 'text', data: { kind: 'text', content: 'source' } }
    const nodes = withoutWorkflowExecutionProjectionNodes([
      textNode,
      {
        id: 'agent',
        data: {
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
          workflowStatus: 'running',
        },
      },
    ])

    expect(nodes[0]).toBe(textNode)
    expect(nodes[1]?.data).toEqual({
      kind: 'workflowStage',
      adminWorkflow: true,
      workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
    })
  })

  it('removes derived Agent reference nodes and edges from the authoring snapshot', () => {
    const nodes = withoutWorkflowExecutionProjectionNodes([
      { id: 'agent', data: { kind: 'workflowStage', adminWorkflow: true } },
      { id: 'reference', data: { kind: 'workflowStage', workflowRuntimeReference: true } },
    ])
    const edges = withoutWorkflowExecutionProjectionEdges([
      { id: 'workflow-edge', data: { edgeType: 'workflow' } },
      {
        id: 'reference-edge',
        data: { executionRole: 'reference_only', relationKind: 'agent_skill_reference' },
      },
    ])

    expect(nodes.map((node) => node.id)).toEqual(['agent'])
    expect(edges.map((edge) => edge.id)).toEqual(['workflow-edge'])
    expect(isWorkflowRuntimeReferenceNodeData({ workflowRuntimeReference: true })).toBe(true)
    expect(isWorkflowRuntimeReferenceEdgeData({
      executionRole: 'reference_only',
      relationKind: 'agent_knowledge_reference',
    })).toBe(true)
  })

  it('scopes nested runtime projection updates without leaking guard state', () => {
    expect(workflowExecutionProjectionGuard.active).toBe(false)
    workflowExecutionProjectionGuard.run(() => {
      expect(workflowExecutionProjectionGuard.active).toBe(true)
      workflowExecutionProjectionGuard.run(() => {
        expect(workflowExecutionProjectionGuard.active).toBe(true)
      })
      expect(workflowExecutionProjectionGuard.active).toBe(true)
    })
    expect(workflowExecutionProjectionGuard.active).toBe(false)
  })
})
