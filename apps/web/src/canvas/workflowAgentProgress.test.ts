import { describe, expect, it } from 'vitest'
import { workflowAgentProgress } from './workflowAgentProgress'

describe('workflowAgentProgress', () => {
  it('projects a durable Agent heartbeat instead of a generic running label', () => {
    expect(workflowAgentProgress({
      executorCompleted: false,
      deliveryEvidence: {
        state: 'running',
        lastConfirmedAt: '2026-08-14T03:35:43.476Z',
      },
      requestTerminal: {
        status: 'suspended',
        reason: 'workflow_agent_turn_still_running',
      },
    })).toMatchObject({
      label: 'Agent 生成中',
    })
  })

  it('distinguishes same-task continuation from the initial model turn', () => {
    expect(workflowAgentProgress({
      executorCompleted: false,
      continuationReason: 'workflow_agent_same_task_continuation_scheduled',
      deliveryEvidence: {
        state: 'suspended',
      },
    })).toEqual({
      label: '同链续跑中',
      detail: '恢复检查点已保存',
    })
  })

  it('does not override completed Agent output', () => {
    expect(workflowAgentProgress({ executorCompleted: true })).toBeNull()
  })
})
