import { describe, expect, it } from 'vitest'

import { resolveWorkflowWaitingReason } from './workflowWaitingReason'

describe('resolveWorkflowWaitingReason', () => {
  it('projects the balance label when all declared structured facts agree', () => {
    expect(resolveWorkflowWaitingReason({
      evidence: {
        continuationReason: 'provider_balance_required',
        requestTerminal: { reason: 'provider_balance_required' },
        deliveryEvidence: {
          recoveryCheckpoint: { reasonCode: 'provider_balance_required' },
        },
      },
    })).toEqual({
      code: 'provider_balance_required',
      label: '等待余额恢复',
    })
  })

  it('keeps the generic wait state when declared structured facts conflict', () => {
    expect(resolveWorkflowWaitingReason({
      evidence: {
        continuationReason: 'provider_balance_required',
        requestTerminal: { reason: 'provider_stream_interrupted' },
      },
    })).toBeNull()
  })

  it('does not infer a balance wait from historical error prose', () => {
    expect(resolveWorkflowWaitingReason({
      errorCode: 'insufficient_balance',
      errorMessage: '余额不足，请充值后继续',
      evidence: {},
    })).toBeNull()
  })
})
