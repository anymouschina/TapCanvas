import { describe, expect, it } from 'vitest'
import type { WorkflowNodeRunDto } from '../api/server'
import {
  resolveWorkflowExecutionFocusNode,
  workflowFocusNodePrefix,
  workflowNodeRunStatusLabel,
} from './workflowExecutionHistory'

function run(nodeId: string, status: WorkflowNodeRunDto['status']): WorkflowNodeRunDto {
  return {
    id: `run-${nodeId}`,
    executionId: 'execution-1',
    nodeId,
    status,
    attempt: 1,
    createdAt: `2026-08-14T09:00:0${nodeId.length}.000Z`,
  }
}

describe('workflowExecutionHistory', () => {
  it('identifies the structurally blocking node before running and queued nodes', () => {
    const focus = resolveWorkflowExecutionFocusNode([
      run('queued', 'queued'),
      run('running', 'running'),
      run('approval', 'waiting_external'),
    ])

    expect(focus?.nodeId).toBe('approval')
    expect(workflowFocusNodePrefix(focus?.status ?? 'queued')).toBe('等待在')
    expect(workflowNodeRunStatusLabel(focus?.status ?? 'queued')).toBe('等待外部结果')
  })

  it('prefers an exact failed node over all other node states', () => {
    expect(resolveWorkflowExecutionFocusNode([
      run('approval', 'waiting_external'),
      run('video', 'failed'),
    ])?.nodeId).toBe('video')
  })

  it('uses the structured balance reason for a waiting execution node', () => {
    expect(workflowNodeRunStatusLabel('waiting_external', {
      evidence: {
        continuationReason: 'provider_balance_required',
        deliveryEvidence: {
          recoveryCheckpoint: { reasonCode: 'provider_balance_required' },
        },
      },
    })).toBe('等待余额恢复')
  })
})
