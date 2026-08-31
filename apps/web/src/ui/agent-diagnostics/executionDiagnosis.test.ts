import { describe, expect, it } from 'vitest'
import type { AgentDiagnosticsTraceDto } from '../../api/server'
import type { ExecutionGraph } from './executionGraph.types'
import { buildHistoricalExecutionDiagnosis } from './executionDiagnosis'

type ExecutionGraphProjection = Omit<ExecutionGraph, 'diagnosis'>

function trace(input: Readonly<{
  status: string
  meta: Record<string, unknown>
}>): AgentDiagnosticsTraceDto {
  return {
    id: 'trace-1',
    scopeType: 'project',
    scopeId: 'project-1',
    taskId: 'task-1',
    requestKind: 'agents_bridge:workflow',
    inputSummary: 'workflow test',
    decisionLog: [],
    toolCalls: [],
    meta: input.meta,
    resultSummary: null,
    errorCode: null,
    errorDetail: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    status: input.status,
    sessionKey: 'workflow:execution-1',
    workflowKey: 'agent-workflow/v1',
    logicalTaskId: 'logical-1',
    rootTraceId: 'trace-1',
    parentTraceId: null,
    physicalRunId: 'run-1',
    workflowRunId: 'execution-1',
    startedAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:01.000Z',
    finishedAt: null,
    nextEventSeq: 2,
  }
}

function graph(status: ExecutionGraphProjection['status']): ExecutionGraphProjection {
  return {
    id: 'graph-1',
    executionTraceId: 'trace-1',
    title: 'Agent workflow',
    status,
    provenanceState: 'complete',
    nodes: [{
      id: 'verification-1',
      layer: 1,
      lane: 0,
      kind: 'verification',
      status: status === 'failed' ? 'failed' : 'warning',
      title: '交付验收',
      summary: '',
      primaryItems: [],
      badges: [],
      details: [],
    }],
    edges: [],
    knowledgeSourceCount: 0,
    skillCount: 0,
    activePathNodeCount: 1,
    layout: 'bounded_workflow',
  }
}

describe('execution diagnosis contracts', () => {
  it('projects unsatisfied delivery facts into repair actions without guessing from text', () => {
    const diagnosis = buildHistoricalExecutionDiagnosis(trace({
      status: 'succeeded',
      meta: {
        completionTrace: {
          allowFinish: false,
          terminal: 'continue',
          rationale: '工作流仍缺少持久化视频资产。',
          missingCriteria: ['asset_persisted'],
          requiredActions: ['继续执行资产持久化并记录真实 URL'],
        },
        deliveryVerification: {
          status: 'unsatisfied',
          criteria: [{
            requirementId: 'asset_persisted',
            status: 'unresolved',
            evidenceIds: ['provider-task-1'],
          }],
        },
        requestTerminal: { status: 'running' },
      },
    }), graph('warning'))

    expect(diagnosis.state).toBe('repair_required')
    expect(diagnosis.missingCriteria).toEqual(['asset_persisted'])
    expect(diagnosis.requiredActions).toEqual(['继续执行资产持久化并记录真实 URL'])
    expect(diagnosis.evidenceRefs).toEqual(['provider-task-1'])
    expect(diagnosis.issues.map((issue) => issue.code)).toContain('delivery_verification_unsatisfied')
  })

  it('keeps an accepted asynchronous run in progress instead of reporting task failure', () => {
    const diagnosis = buildHistoricalExecutionDiagnosis(trace({
      status: 'waiting_async',
      meta: {
        completionTrace: { allowFinish: true, terminal: 'continue', rationale: '供应商已受理，等待新证据。' },
        deliveryVerification: { status: 'waiting' },
        requestTerminal: { status: 'suspended', reason: 'accepted_async' },
      },
    }), graph('running'))

    expect(diagnosis.state).toBe('waiting')
    expect(diagnosis.headline).toBe('已取得进度，正在等待新证据')
    expect(diagnosis.issues.some((issue) => issue.severity === 'error')).toBe(false)
  })
})
