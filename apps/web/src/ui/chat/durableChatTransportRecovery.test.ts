import { describe, expect, it, vi } from 'vitest'

import type { AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'
import { recoverAcceptedChatTurnAfterTransportLoss } from './durableChatTransportRecovery'
import type { AgentLogicalTaskStateV1 } from '@tapcanvas/agent-observability'

const succeededLogicalTaskState: AgentLogicalTaskStateV1 = {
  version: 1,
  logicalTaskId: 'request_1',
  status: 'succeeded',
  reasonCode: 'delivery_verification_satisfied',
  physicalRunStatus: 'completed',
  deliveryStatus: 'satisfied',
  taskNodeId: 'turn_1',
  taskRevision: 1,
  updatedAt: '2026-08-08T14:34:36.000Z',
  continuationTicket: null,
}

const succeededSnapshot: AgentsChatTurnStatusDto = {
  sessionId: 'session_1',
  durable: true,
  activeTurn: false,
  turn: {
    turnId: 'request_1',
    internalTurnId: 'turn_1',
    state: 'succeeded',
    logicalTaskState: succeededLogicalTaskState,
    phase: 'succeeded',
    startedAt: '2026-08-08T14:31:01.000Z',
    updatedAt: '2026-08-08T14:34:36.000Z',
    lastConfirmedAt: '2026-08-08T14:34:36.000Z',
    requestText: '应用视觉圣经',
    reasonCode: null,
    suspension: null,
    lastConfirmedSummary: '当前回合已完成',
    finalResponse: '项目视觉圣经 V1 已激活',
    pendingQueueCount: 0,
    recentEvents: [],
  },
}

describe('recoverAcceptedChatTurnAfterTransportLoss', () => {
  it('waits through a short API restart and returns the matching durable turn', async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(succeededSnapshot)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(recoverAcceptedChatTurnAfterTransportLoss({
      turnId: 'request_1',
      refresh,
      wait,
    })).resolves.toEqual(succeededSnapshot)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenNthCalledWith(1, 500)
    expect(wait).toHaveBeenNthCalledWith(2, 1_500)
  })

  it('does not adopt a checkpoint from another turn', async () => {
    const refresh = vi.fn().mockResolvedValue({
      ...succeededSnapshot,
      turn: { ...succeededSnapshot.turn!, turnId: 'older_request' },
    })
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(recoverAcceptedChatTurnAfterTransportLoss({
      turnId: 'request_1',
      refresh,
      wait,
    })).resolves.toBeNull()
    expect(refresh).toHaveBeenCalledTimes(5)
  })
})
