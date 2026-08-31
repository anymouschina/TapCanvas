import { describe, expect, it } from 'vitest'
import type { AgentDiagnosticsTraceDto } from '../api/server'
import { applyAgentWorkflowTrace, findLatestAgentWorkflowTrace } from './agentWorkflowProjectionSync'
import { useRFStore } from './store'

function trace(id: string, createdAt: string, status = 'running'): AgentDiagnosticsTraceDto {
  return {
    id,
    scopeType: 'node',
    scopeId: 'trigger',
    taskId: null,
    requestKind: 'agents_bridge',
    inputSummary: '',
    decisionLog: [],
    toolCalls: [],
    meta: null,
    resultSummary: null,
    errorCode: null,
    errorDetail: null,
    createdAt,
    status,
    sessionKey: null,
    workflowKey: 'agent-workflow/v1',
    logicalTaskId: 'logical-1',
    rootTraceId: null,
    parentTraceId: null,
    physicalRunId: 'physical-1',
    workflowRunId: null,
    startedAt: createdAt,
    updatedAt: createdAt,
    finishedAt: null,
    nextEventSeq: 1,
  }
}

describe('agent workflow projection sync', () => {
  it('selects only a trace created after the manual occurrence', () => {
    const selected = findLatestAgentWorkflowTrace([
      trace('old', '2026-08-11T08:00:00.000Z'),
      trace('new', '2026-08-11T08:00:03.000Z'),
    ], '2026-08-11T08:00:01.000Z')

    expect(selected?.id).toBe('new')
  })

  it('projects trace identity onto every node in the exact workflow instance', () => {
    useRFStore.setState({
      nodes: [
        { id: 'trigger', type: 'taskNode', position: { x: 0, y: 0 }, data: { workflowInstanceId: 'wf-1' } },
        { id: 'stage', type: 'taskNode', position: { x: 0, y: 0 }, data: { workflowInstanceId: 'wf-1' } },
        { id: 'other', type: 'taskNode', position: { x: 0, y: 0 }, data: { workflowInstanceId: 'wf-2' } },
      ],
    })

    applyAgentWorkflowTrace('wf-1', trace('trace-1', '2026-08-11T08:00:03.000Z'))

    const nodes = useRFStore.getState().nodes
    expect(nodes.find((node) => node.id === 'trigger')?.data).toMatchObject({
      workflowTraceId: 'trace-1',
      workflowTraceStatus: 'running',
      workflowLogicalTaskId: 'logical-1',
    })
    expect(nodes.find((node) => node.id === 'stage')?.data.workflowTraceId).toBe('trace-1')
    expect(nodes.find((node) => node.id === 'other')?.data.workflowTraceId).toBeUndefined()
  })
})
