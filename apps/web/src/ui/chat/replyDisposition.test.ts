import type { AgentLogicalTaskStateV1 } from '@tapcanvas/agent-observability'
import { describe, expect, it } from 'vitest'

import {
  isAsyncSubmissionResponse,
  resolveAssistantReplyText,
  resolveChatTerminalProjection,
  resolveTerminalReply,
  shouldAutoAddAssistantAssetsToCanvas,
  shouldShowMissingCanvasPlanError,
} from './replyDisposition'

function logicalTaskState(
  status: AgentLogicalTaskStateV1['status'],
  reasonCode: string,
): AgentLogicalTaskStateV1 {
  const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled'
  return {
    version: 1,
    logicalTaskId: 'turn-1',
    status,
    reasonCode,
    physicalRunStatus: status === 'active' ? 'running' : status === 'waiting_external' ? 'handed_off' : 'completed',
    deliveryStatus: status === 'succeeded' ? 'satisfied' : terminal ? 'unsatisfied' : 'pending',
    taskNodeId: 'root',
    taskRevision: 1,
    updatedAt: '2026-08-30T00:00:00.000Z',
    continuationTicket: null,
  }
}

describe('logical task disposition', () => {
  it('fails explicitly when the server omits the logical task state', () => {
    expect(resolveTerminalReply({
      response: { trace: {} } as unknown as Parameters<typeof resolveTerminalReply>[0]['response'],
      originalReply: '已完成。',
    })).toEqual({
      text: '本轮执行失败：服务端未返回逻辑任务状态（logical_task_state_missing）。',
      failed: true,
    })
  })

  it('uses only the committed logical task state as lifecycle authority', () => {
    expect(resolveChatTerminalProjection({
      trace: {
        logicalTaskState: logicalTaskState('succeeded', 'delivery_verification_satisfied'),
        deliveryVerification: {
          version: 2,
          contractHash: 'diagnostic-only',
          status: 'unsatisfied',
          criteria: [],
          verifiedAt: '2026-08-30T00:00:00.000Z',
        },
        turnVerdict: { status: 'failed', reasons: ['diagnostic_only'] },
      },
    })).toEqual({ status: 'succeeded', reason: 'delivery_verification_satisfied' })
  })

  it('preserves active and waiting states without projecting a terminal failure', () => {
    expect(resolveTerminalReply({
      response: { trace: { logicalTaskState: logicalTaskState('waiting_external', 'managed_async_submission') } },
      originalReply: '任务已提交，等待外部结果。',
    })).toEqual({ text: '任务已提交，等待外部结果。', failed: false })
    expect(resolveAssistantReplyText({
      response: { trace: { logicalTaskState: logicalTaskState('waiting_external', 'managed_async_submission') } },
      reply: '',
    })).toBe('异步编排已持久受理；供应商是否受理与最终交付以真实任务和资产证据为准。')
    expect(resolveAssistantReplyText({
      response: { trace: { logicalTaskState: logicalTaskState('waiting_input', 'request_user_input_pending') } },
      reply: '',
    })).toBe('需要补充信息后才能继续执行。')
  })

  it('keeps delivery evidence useful for side-effect projections, not terminal arbitration', () => {
    expect(isAsyncSubmissionResponse({
      trace: { logicalTaskState: logicalTaskState('waiting_external', 'managed_async_submission') },
    })).toBe(true)
    expect(shouldShowMissingCanvasPlanError({
      hasCanvasPlan: false,
      hasWrongCanvasPlanTag: false,
      response: {
        trace: {
          logicalTaskState: logicalTaskState('failed', 'delivery_verification_failed'),
          deliveryVerification: {
            version: 2,
            contractHash: 'contract-1',
            status: 'unsatisfied',
            criteria: [],
            verifiedAt: '2026-08-30T00:00:00.000Z',
          },
        },
      },
    })).toBe(true)
    expect(shouldAutoAddAssistantAssetsToCanvas({
      canvasPlanExecuted: false,
      aiChatWatchAssetsEnabled: true,
      assistantAssetCount: 1,
      response: {
        trace: {
          logicalTaskState: logicalTaskState('succeeded', 'delivery_verification_satisfied'),
          deliveryEvidence: {
            version: 2,
            items: [],
            artifacts: [],
            assetCount: 1,
            imageAssetCount: 1,
            videoAssetCount: 0,
            wroteCanvas: true,
            generatedAssets: true,
          },
        },
      },
    })).toBe(false)
  })
})
