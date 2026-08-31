// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentsChatTurnResumeReceiptDto, AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'
import { getAgentsChatTurnStatus, resumeAgentsChatTurn } from '../../api/server'
import { ChatTurnResumeError, useChatTurnRecovery } from './useChatTurnRecovery'

vi.mock('../../api/server', () => ({
  getAgentsChatTurnStatus: vi.fn(),
  resumeAgentsChatTurn: vi.fn(),
}))

function logicalTaskState(
  status: 'active' | 'waiting_external' | 'failed',
  reasonCode: string,
  physicalRunStatus: 'running' | 'handed_off' | 'interrupted',
) {
  return {
    version: 1 as const,
    logicalTaskId: 'request_1',
    status,
    reasonCode,
    physicalRunStatus,
    deliveryStatus: status === 'failed' ? 'unsatisfied' as const : 'pending' as const,
    taskNodeId: 'root',
    taskRevision: 1,
    updatedAt: '2026-08-03T05:00:02.000Z',
    continuationTicket: null,
  }
}

function recoveryCheckpoint(reasonCode: string) {
  return {
    reasonCode,
    physicalRunId: 'physical_run_1',
    progressRevision: 1,
    durableTaskReferences: [],
    durableProgressClaims: [],
    userIntentContract: null,
  }
}

const activeSnapshot: AgentsChatTurnStatusDto = {
  sessionId: 'session_1',
  durable: true,
  activeTurn: true,
  turn: {
    turnId: 'request_1',
    internalTurnId: 'turn_1',
    state: 'running',
    logicalTaskState: logicalTaskState('active', 'agent_running', 'running'),
    phase: 'agent_running',
    startedAt: '2026-08-03T05:00:00.000Z',
    updatedAt: '2026-08-03T05:00:01.000Z',
    lastConfirmedAt: '2026-08-03T05:00:02.000Z',
    requestText: '制作视频',
    reasonCode: null,
    suspension: null,
    lastConfirmedSummary: '模型正在处理当前任务',
    finalResponse: null,
    pendingQueueCount: 0,
    recentEvents: [],
  },
}

const idleSnapshot: AgentsChatTurnStatusDto = {
  sessionId: 'session_1',
  durable: true,
  activeTurn: false,
  turn: null,
}

const orphanedSnapshot: AgentsChatTurnStatusDto = {
  ...activeSnapshot,
  activeTurn: false,
  turn: activeSnapshot.turn
    ? {
        ...activeSnapshot.turn,
        state: 'unknown',
        logicalTaskState: logicalTaskState('active', 'initial_execution', 'interrupted'),
        reasonCode: 'initial_execution',
        recoveryCheckpoint: recoveryCheckpoint('initial_execution'),
        lastConfirmedSummary: '上次任务未正常收尾，当前已无执行进程',
      }
    : null,
}

const interruptedUnknownSnapshot: AgentsChatTurnStatusDto = {
  ...orphanedSnapshot,
  turn: orphanedSnapshot.turn
    ? {
        ...orphanedSnapshot.turn,
        phase: 'agent_running',
        logicalTaskState: logicalTaskState('active', 'provider_stream_interrupted', 'interrupted'),
        reasonCode: 'provider_stream_interrupted',
        recoveryCheckpoint: recoveryCheckpoint('provider_stream_interrupted'),
      }
    : null,
}

const failedPhysicalSnapshot: AgentsChatTurnStatusDto = {
  ...activeSnapshot,
  activeTurn: false,
  turn: activeSnapshot.turn
    ? {
        ...activeSnapshot.turn,
        state: 'failed',
        phase: 'failed',
        logicalTaskState: logicalTaskState('active', 'TypeError', 'interrupted'),
        reasonCode: 'TypeError',
        recoveryCheckpoint: recoveryCheckpoint('TypeError'),
        lastConfirmedSummary: '当前物理回合已失败',
      }
    : null,
}

const suspendedPhysicalSnapshot: AgentsChatTurnStatusDto = {
  ...activeSnapshot,
  activeTurn: false,
  turn: activeSnapshot.turn
    ? {
        ...activeSnapshot.turn,
        state: 'suspended',
        phase: 'suspended',
        logicalTaskState: logicalTaskState('active', 'root_physical_execution_budget_exhausted', 'handed_off'),
        reasonCode: 'root_physical_execution_budget_exhausted',
        suspension: {
          reasonCode: 'root_physical_execution_budget_exhausted',
          physicalRunId: 'physical_run_1',
          progressRevision: 4,
          progressSinceRunStart: 4,
          budgetKind: 'wall_time',
          observed: 300_308,
          limit: 300_000,
        },
        recoveryCheckpoint: {
          ...recoveryCheckpoint('root_physical_execution_budget_exhausted'),
          progressRevision: 4,
        },
        lastConfirmedSummary: '当前物理执行窗口已结束，系统正在切换到同一逻辑任务的续跑窗口',
      }
    : null,
}

const suspendedResponseSnapshot: AgentsChatTurnStatusDto = {
  ...suspendedPhysicalSnapshot,
  turn: suspendedPhysicalSnapshot.turn
    ? {
        ...suspendedPhysicalSnapshot.turn,
        requestText: '交付一份完整的文字方案',
        lastConfirmedSummary: '候选首稿未通过交付核验，等待同链修订',
        finalResponse: '尚未验收的候选首稿',
        recoveryCheckpoint: {
          reasonCode: 'root_physical_execution_budget_exhausted',
          physicalRunId: 'physical_run_1',
          progressRevision: 4,
          durableTaskReferences: [],
          durableProgressClaims: [],
          userIntentContract: {
            delivery: { mode: 'response', kind: 'text', output: '完整文字方案' },
          },
        },
      }
    : null,
}

const suspendedExternalWaitSnapshot: AgentsChatTurnStatusDto = {
  ...suspendedPhysicalSnapshot,
  turn: suspendedPhysicalSnapshot.turn
    ? {
        ...suspendedPhysicalSnapshot.turn,
        logicalTaskState: logicalTaskState('waiting_external', 'managed_async_submission', 'handed_off'),
        reasonCode: 'managed_async_submission',
        suspension: null,
        recoveryCheckpoint: null,
        attentionProjection: {
          version: 1,
          logicalTaskId: 'request_1',
          status: 'wait',
          waitingOn: 'accepted_provider_job',
          obligation: '等待已受理任务物化',
          sourceHeads: {
            graphRevision: 2,
            evidenceRevision: 3,
            physicalRunId: 'physical_run_1',
          },
        },
        lastConfirmedSummary: '供应商已受理，等待真实资产',
      }
    : null,
}

const resumeReceipt: AgentsChatTurnResumeReceiptDto = {
  ok: true,
  resumed: true,
  sessionKey: 'session_1',
  turnId: 'request_1',
  continuationId: 'async-continuation:1',
  stage: 1,
  resumeTrigger: 'physical_budget',
  recoveryKind: 'orphaned_checkpoint',
}

describe('useChatTurnRecovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('checks durable status when the session becomes effective', async () => {
    vi.mocked(getAgentsChatTurnStatus).mockResolvedValue(activeSnapshot)

    const hook = renderHook(() => useChatTurnRecovery('session_1'))

    await waitFor(() => expect(hook.result.current.checking).toBe(false))
    expect(hook.result.current.snapshot).toEqual(activeSnapshot)
    expect(hook.result.current.error).toBeNull()
    expect(getAgentsChatTurnStatus).toHaveBeenCalledWith({ sessionKey: 'session_1' })
    hook.unmount()
  })

  it('keeps the last confirmed snapshot when a later refresh fails', async () => {
    vi.mocked(getAgentsChatTurnStatus)
      .mockResolvedValueOnce(activeSnapshot)
      .mockRejectedValueOnce(new Error('status offline'))

    const hook = renderHook(() => useChatTurnRecovery('session_1'))
    await waitFor(() => expect(hook.result.current.snapshot).toEqual(activeSnapshot))

    await act(async () => {
      await hook.result.current.refresh()
    })

    expect(hook.result.current.snapshot).toEqual(activeSnapshot)
    expect(hook.result.current.error?.message).toBe('status offline')
    hook.unmount()
  })

  it('coalesces overlapping status checks so slow recovery responses cannot starve each other', async () => {
    let resolveStatus: ((snapshot: AgentsChatTurnStatusDto) => void) | null = null
    vi.mocked(getAgentsChatTurnStatus).mockImplementation(() => new Promise((resolve) => {
      resolveStatus = resolve
    }))

    const hook = renderHook(() => useChatTurnRecovery('session_1'))
    await waitFor(() => expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(1))

    let refreshA: Promise<AgentsChatTurnStatusDto | null> | null = null
    let refreshB: Promise<AgentsChatTurnStatusDto | null> | null = null
    act(() => {
      refreshA = hook.result.current.refresh()
      refreshB = hook.result.current.refresh()
    })
    expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      if (!resolveStatus) throw new Error('status request was not captured')
      resolveStatus(idleSnapshot)
      await Promise.all([refreshA, refreshB])
    })

    expect(hook.result.current.snapshot).toEqual(idleSnapshot)
    expect(hook.result.current.error).toBeNull()
    hook.unmount()
  })

  it('automatically retries a transient status transport failure', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(getAgentsChatTurnStatus)
        .mockRejectedValueOnce(new Error('status restarting'))
        .mockResolvedValueOnce(idleSnapshot)

      const hook = renderHook(() => useChatTurnRecovery('session_1'))
      await act(async () => {
        await hook.result.current.refresh()
      })
      expect(hook.result.current.error?.message).toBe('status restarting')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(2)
      expect(hook.result.current.snapshot).toEqual(idleSnapshot)
      expect(hook.result.current.error).toBeNull()
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the active state after a confirmed terminal refresh', async () => {
    vi.mocked(getAgentsChatTurnStatus)
      .mockResolvedValueOnce(activeSnapshot)
      .mockResolvedValueOnce(idleSnapshot)

    const hook = renderHook(() => useChatTurnRecovery('session_1'))
    await waitFor(() => expect(hook.result.current.snapshot).toEqual(activeSnapshot))

    await act(async () => {
      await hook.result.current.refresh()
    })

    expect(hook.result.current.snapshot).toEqual(idleSnapshot)
    expect(hook.result.current.error).toBeNull()
    hook.unmount()
  })

  it('reconciles an inactive unknown checkpoint through the exact durable turn', async () => {
    vi.mocked(getAgentsChatTurnStatus)
      .mockResolvedValueOnce(orphanedSnapshot)
      .mockResolvedValueOnce(activeSnapshot)
    vi.mocked(resumeAgentsChatTurn).mockResolvedValue(resumeReceipt)

    const hook = renderHook(() => useChatTurnRecovery('session_1'))

    await waitFor(() => expect(hook.result.current.snapshot).toEqual(activeSnapshot))
    expect(resumeAgentsChatTurn).toHaveBeenCalledWith({
      sessionKey: 'session_1',
      turnId: 'request_1',
    })
    expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(2)
    expect(hook.result.current.error).toBeNull()
    hook.unmount()
  })

  it('keeps new-turn admission closed while a claimed continuation is not yet runtime-active', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(getAgentsChatTurnStatus)
        .mockResolvedValueOnce(orphanedSnapshot)
        // The queue accepted the continuation, but its worker has not entered
        // the agents runtime yet. This is the race that previously reopened send.
        .mockResolvedValueOnce(orphanedSnapshot)
        .mockResolvedValueOnce(activeSnapshot)
      vi.mocked(resumeAgentsChatTurn).mockResolvedValue({
        ...resumeReceipt,
        resumeTrigger: 'dependency',
        recoveryKind: 'orphaned_continuation',
      })

      const hook = renderHook(() => useChatTurnRecovery('session_1'))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(hook.result.current.snapshot).toEqual(orphanedSnapshot)
      expect(hook.result.current.checking).toBe(true)
      expect(resumeAgentsChatTurn).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500)
      })

      expect(hook.result.current.snapshot).toEqual(activeSnapshot)
      expect(hook.result.current.checking).toBe(false)
      expect(resumeAgentsChatTurn).toHaveBeenCalledTimes(1)
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reclaims a provider-interrupted unknown checkpoint with the exact durable turn identity', async () => {
    vi.mocked(getAgentsChatTurnStatus)
      .mockResolvedValueOnce(interruptedUnknownSnapshot)
      .mockResolvedValueOnce(activeSnapshot)
    vi.mocked(resumeAgentsChatTurn).mockResolvedValue(resumeReceipt)

    const hook = renderHook(() => useChatTurnRecovery('session_1'))

    await waitFor(() => expect(hook.result.current.snapshot).toEqual(activeSnapshot))
    expect(resumeAgentsChatTurn).toHaveBeenCalledWith({
      sessionKey: 'session_1',
      turnId: 'request_1',
    })
    expect(hook.result.current.error).toBeNull()
    hook.unmount()
  })

  it('reconciles an inactive failed physical checkpoint instead of starting a new request', async () => {
    vi.mocked(getAgentsChatTurnStatus)
      .mockResolvedValueOnce(failedPhysicalSnapshot)
      .mockResolvedValueOnce(activeSnapshot)
    vi.mocked(resumeAgentsChatTurn).mockResolvedValue(resumeReceipt)

    const hook = renderHook(() => useChatTurnRecovery('session_1'))

    await waitFor(() => expect(hook.result.current.snapshot).toEqual(activeSnapshot))
    expect(resumeAgentsChatTurn).toHaveBeenCalledWith({
      sessionKey: 'session_1',
      turnId: 'request_1',
    })
    expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(2)
    hook.unmount()
  })

  it('reclaims an unsatisfied response-mode physical suspension without asking the user to continue', async () => {
    vi.mocked(getAgentsChatTurnStatus)
      .mockResolvedValueOnce(suspendedResponseSnapshot)
      .mockResolvedValueOnce(activeSnapshot)
    vi.mocked(resumeAgentsChatTurn).mockResolvedValue({
      ...resumeReceipt,
      recoveryKind: 'physical_budget',
    })

    const hook = renderHook(() => useChatTurnRecovery('session_1'))

    await waitFor(() => expect(hook.result.current.snapshot).toEqual(activeSnapshot))
    expect(resumeAgentsChatTurn).toHaveBeenCalledWith({
      sessionKey: 'session_1',
      turnId: 'request_1',
    })
    hook.unmount()
  })

  it('keeps polling a durable external wait without forcing a premature resume', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(getAgentsChatTurnStatus)
        .mockResolvedValueOnce(suspendedExternalWaitSnapshot)
        .mockResolvedValueOnce(idleSnapshot)

      const hook = renderHook(() => useChatTurnRecovery('session_1'))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(hook.result.current.snapshot).toEqual(suspendedExternalWaitSnapshot)
      expect(resumeAgentsChatTurn).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500)
      })

      expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(2)
      expect(hook.result.current.snapshot).toEqual(idleSnapshot)
      expect(resumeAgentsChatTurn).not.toHaveBeenCalled()
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops automatic resume retries after a rejected handshake and lets an explicit refresh retry once', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(getAgentsChatTurnStatus)
        .mockResolvedValueOnce(suspendedResponseSnapshot)
        .mockResolvedValueOnce(suspendedResponseSnapshot)
        .mockResolvedValueOnce(suspendedResponseSnapshot)
        .mockResolvedValueOnce(suspendedResponseSnapshot)
        .mockResolvedValueOnce(activeSnapshot)
      vi.mocked(resumeAgentsChatTurn)
        .mockRejectedValueOnce(new Error('continuation was not registered yet'))
        .mockResolvedValueOnce({ ...resumeReceipt, recoveryKind: 'physical_budget' })

      const hook = renderHook(() => useChatTurnRecovery('session_1'))
      await act(async () => {
        await hook.result.current.refresh()
      })

      expect(hook.result.current.snapshot).toEqual(suspendedResponseSnapshot)
      expect(hook.result.current.error).toBeInstanceOf(ChatTurnResumeError)
      expect(hook.result.current.error?.message).toBe('continuation was not registered yet')
      expect(resumeAgentsChatTurn).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(resumeAgentsChatTurn).toHaveBeenCalledTimes(1)
      expect(hook.result.current.error?.message).toBe('continuation was not registered yet')

      await act(async () => {
        const refreshPromise = hook.result.current.refresh()
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(200)
        await refreshPromise
      })

      expect(hook.result.current.snapshot).toEqual(activeSnapshot)
      expect(hook.result.current.error).toBeNull()
      expect(resumeAgentsChatTurn).toHaveBeenCalledTimes(2)
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not query or reclaim a transient conversation identity while disabled', async () => {
    vi.mocked(getAgentsChatTurnStatus).mockResolvedValue(orphanedSnapshot)
    vi.mocked(resumeAgentsChatTurn).mockResolvedValue(resumeReceipt)

    const hook = renderHook(() => useChatTurnRecovery('session_transient', { enabled: false }))

    await waitFor(() => expect(hook.result.current.checking).toBe(false))
    expect(hook.result.current.snapshot).toBeNull()
    expect(getAgentsChatTurnStatus).not.toHaveBeenCalled()
    expect(resumeAgentsChatTurn).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('revokes a late orphan response before it can resume the previous conversation', async () => {
    let resolveStatus: ((snapshot: AgentsChatTurnStatusDto) => void) | null = null
    vi.mocked(getAgentsChatTurnStatus).mockImplementation(() => new Promise((resolve) => {
      resolveStatus = resolve
    }))
    vi.mocked(resumeAgentsChatTurn).mockResolvedValue(resumeReceipt)

    const hook = renderHook(() => useChatTurnRecovery('session_old'))
    await waitFor(() => expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(1))

    act(() => {
      hook.result.current.invalidate()
    })
    await act(async () => {
      if (!resolveStatus) throw new Error('status request was not captured')
      resolveStatus(interruptedUnknownSnapshot)
      await Promise.resolve()
    })

    expect(resumeAgentsChatTurn).not.toHaveBeenCalled()
    expect(hook.result.current.snapshot).toBeNull()
    expect(hook.result.current.checking).toBe(false)
    hook.unmount()
  })

  it('can inspect an orphan without reclaiming it', async () => {
    vi.mocked(getAgentsChatTurnStatus).mockResolvedValue(orphanedSnapshot)

    const hook = renderHook(() => useChatTurnRecovery('session_history', {
      autoResumeOrphan: false,
    }))

    await waitFor(() => expect(hook.result.current.snapshot).toEqual(orphanedSnapshot))
    expect(resumeAgentsChatTurn).not.toHaveBeenCalled()
    hook.unmount()
  })
})
