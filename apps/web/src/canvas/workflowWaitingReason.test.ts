import { describe, expect, it } from 'vitest'

import { resolveWorkflowWaitingReason } from './workflowWaitingReason'

describe('resolveWorkflowWaitingReason', () => {
  it('shows the exact missing catalog field from a durable observation', () => {
    expect(resolveWorkflowWaitingReason({ evidence: {
      waitingReason: 'external_dependency_unavailable',
      dependencyObservation: { version: 1, dependency: { kind: 'model_catalog', identity: 'model-a', field: 'maxReferenceImages' } },
    } })).toEqual({ code: 'external_dependency_unavailable', label: '等待模型目录修复：model-a / maxReferenceImages' })
  })
  it('does not invent dependency facts from a wait code alone', () => {
    expect(resolveWorkflowWaitingReason({ evidence: { waitingReason: 'external_dependency_unavailable' } })).toBeNull()
  })
  it('distinguishes internal repair backoff from external media generation', () => {
    expect(resolveWorkflowWaitingReason({ evidence: {
      continuationReason: 'workflow_agent_no_progress_recovery_deferred',
      requestTerminal: { status: 'suspended', reason: 'workflow_agent_no_progress_recovery_deferred' },
    } })).toEqual({ code: 'workflow_agent_no_progress_recovery_deferred', label: '等待内部修复重试' })
  })
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
