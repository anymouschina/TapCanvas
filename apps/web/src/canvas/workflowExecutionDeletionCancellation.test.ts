import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { cancelWorkflowExecution } from '../api/server'
import { collectWorkflowExecutionIdsForDeletedNodes } from './workflowExecutionDeletionCancellation'
import { useRFStore } from './store'

vi.mock('../api/server', () => ({
  cancelWorkflowExecution: vi.fn(),
}))

function node(id: string, data: Record<string, unknown>, type = 'taskNode'): Node {
  return { id, type, position: { x: 0, y: 0 }, data }
}

describe('workflow execution cancellation on canvas deletion', () => {
  it('finds the active execution directly attached to the deleted workflow node', () => {
    const nodes = [node('stage', {
      adminWorkflow: true,
      kind: 'workflowStage',
      workflowInstanceId: 'workflow-1',
      workflowExecutionId: 'execution-1',
      workflowStatus: 'running',
    })]

    expect(collectWorkflowExecutionIdsForDeletedNodes(nodes, ['stage'])).toEqual(['execution-1'])
  })

  it('finds an execution from another stage when the deleted queued stage has no id yet', () => {
    const nodes = [
      node('queued-stage', {
        adminWorkflow: true,
        kind: 'workflowStage',
        workflowInstanceId: 'workflow-1',
        workflowStatus: 'queued',
      }),
      node('running-stage', {
        adminWorkflow: true,
        kind: 'workflowStage',
        workflowInstanceId: 'workflow-1',
        workflowExecutionId: 'execution-1',
        workflowStatus: 'running',
      }),
    ]

    expect(collectWorkflowExecutionIdsForDeletedNodes(nodes, ['queued-stage'])).toEqual(['execution-1'])
  })

  it('does not cancel static workflow configuration references or completed runs', () => {
    const nodes = [
      node('reference', {
        adminWorkflow: true,
        kind: 'workflowStage',
        workflowInstanceId: 'workflow-1',
        workflowRuntimeReference: true,
        workflowExecutionId: 'workflow-configuration',
        workflowStatus: 'partial',
        status: 'idle',
      }),
      node('finished', {
        adminWorkflow: true,
        kind: 'workflowStage',
        workflowInstanceId: 'workflow-2',
        workflowExecutionId: 'execution-finished',
        workflowStatus: 'succeeded',
      }),
    ]

    expect(collectWorkflowExecutionIdsForDeletedNodes(nodes, ['reference', 'finished'])).toEqual([])
  })

  it('deduplicates an execution shared by several deleted nodes', () => {
    const nodes = [
      node('stage-a', { workflowExecutionId: 'execution-1', workflowStatus: 'running' }),
      node('stage-b', { workflowExecutionId: 'execution-1', workflowStatus: 'waiting_external' }),
    ]

    expect(collectWorkflowExecutionIdsForDeletedNodes(nodes, ['stage-a', 'stage-b'])).toEqual(['execution-1'])
  })

  it('requests cancellation through the store deletion path', () => {
    const mockedCancelWorkflowExecution = vi.mocked(cancelWorkflowExecution)
    mockedCancelWorkflowExecution.mockResolvedValue({
      execution: { status: 'canceled' },
    } as Awaited<ReturnType<typeof cancelWorkflowExecution>>)

    const activeNode = node('stage', {
      adminWorkflow: true,
      kind: 'workflowStage',
      workflowInstanceId: 'workflow-1',
      workflowExecutionId: 'execution-1',
      workflowStatus: 'running',
    })
    useRFStore.setState({ nodes: [activeNode], edges: [] })

    useRFStore.getState().deleteNode('stage')

    expect(useRFStore.getState().nodes).toEqual([])
    expect(mockedCancelWorkflowExecution).toHaveBeenCalledWith('execution-1')
  })
})
