import { describe, expect, it } from 'vitest'
import type { AgentDiagnosticsTraceDto } from '../../api/server'
import { orderExecutionRunTree } from './executionRunTree'

function trace(id: string, parentTraceId: string | null, createdAt: string): AgentDiagnosticsTraceDto {
  return {
    id,
    scopeType: 'project',
    scopeId: 'project-1',
    taskId: null,
    requestKind: 'agents_bridge:public_chat',
    inputSummary: '',
    decisionLog: [],
    toolCalls: [],
    meta: null,
    resultSummary: null,
    errorCode: null,
    errorDetail: null,
    createdAt,
    status: 'succeeded',
    sessionKey: null,
    workflowKey: 'public_agents_chat',
    logicalTaskId: 'logical-1',
    rootTraceId: 'root',
    parentTraceId,
    physicalRunId: null,
    workflowRunId: null,
    startedAt: createdAt,
    updatedAt: createdAt,
    finishedAt: createdAt,
    nextEventSeq: 1,
  }
}

describe('execution run tree', () => {
  it('places continuations below their actual parent even when input order is flat', () => {
    const root = trace('root', null, '2026-08-10T01:00:00.000Z')
    const child = trace('child', 'root', '2026-08-10T01:01:00.000Z')
    const grandchild = trace('grandchild', 'child', '2026-08-10T01:02:00.000Z')
    expect(orderExecutionRunTree([grandchild, child, root]).map((item) => [item.trace.id, item.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
    ])
  })

  it('keeps orphaned and cyclic records visible instead of silently dropping them', () => {
    const orphan = trace('orphan', 'missing', '2026-08-10T02:00:00.000Z')
    const left = trace('left', 'right', '2026-08-10T01:00:00.000Z')
    const right = trace('right', 'left', '2026-08-10T01:01:00.000Z')
    expect(orderExecutionRunTree([left, orphan, right]).map((item) => item.trace.id).sort()).toEqual([
      'left',
      'orphan',
      'right',
    ])
  })
})
