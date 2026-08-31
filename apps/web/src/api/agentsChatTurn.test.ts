import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseAgentsChatTurnInterruptReceiptDto,
  parseAgentsChatTurnStatusDto as parseAgentsChatTurnStatusDtoRaw,
  readAgentsChatTurnIdHeader,
} from './agentsChatTurn'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseAgentsChatTurnStatusDto(payload: unknown, expectedSessionId: string) {
  const root = asRecord(payload)
  const turn = asRecord(root?.turn)
  if (!root || !turn || turn.logicalTaskState) {
    return parseAgentsChatTurnStatusDtoRaw(payload, expectedSessionId)
  }
  const state = String(turn.state || '')
  const status = state === 'running'
    ? 'active'
    : state === 'needs_input'
      ? 'waiting_input'
      : state === 'suspended'
        ? 'waiting_external'
        : state === 'succeeded' || state === 'cancelled'
          ? state
          : 'failed'
  const logicalTaskState = {
    version: 1,
    logicalTaskId: String(turn.turnId || ''),
    status,
    reasonCode: typeof turn.reasonCode === 'string' && turn.reasonCode.trim()
      ? turn.reasonCode
      : `logical_${status}`,
    physicalRunStatus: status === 'active'
      ? 'running'
      : status === 'waiting_external'
        ? 'handed_off'
        : status === 'failed' || status === 'cancelled'
          ? 'interrupted'
          : 'completed',
    deliveryStatus: status === 'succeeded'
      ? 'satisfied'
      : status === 'failed' || status === 'cancelled'
        ? 'unsatisfied'
        : 'pending',
    taskNodeId: 'root',
    taskRevision: 0,
    updatedAt: String(turn.updatedAt || turn.lastConfirmedAt || ''),
    continuationTicket: null,
  }
  return parseAgentsChatTurnStatusDtoRaw({
    ...root,
    turn: { ...turn, logicalTaskState },
  }, expectedSessionId)
}

function createDurableTerminalDelivery(contractHash = 'contract-1') {
  return {
    version: 1,
    requestTerminal: {
      version: 1,
      terminal: true,
      status: 'succeeded',
      reason: 'delivery_verification_satisfied',
    },
    expectedDelivery: { version: 2, contractHash },
    deliveryEvidence: [{
      evidenceId: 'runtime-final-response',
      kind: 'final_response',
      sourceRef: 'final_response',
      requirementIds: ['result'],
      attributes: {},
    }],
    deliveryVerification: {
      version: 2,
      contractHash,
      status: 'satisfied',
      criteria: [],
      verifiedAt: '2026-08-03T05:00:03.000Z',
    },
  }
}

describe('agents chat turn interrupt transport', () => {
  it('preserves an outcome-unknown runtime receipt without claiming full interruption', () => {
    const result = parseAgentsChatTurnInterruptReceiptDto({
      ok: true,
      interrupted: true,
      fullyInterrupted: false,
      sessionKey: 'session_1',
      turnId: 'request_1',
      localTransport: { status: 'interrupted' },
      runtime: {
        status: 'unknown',
        error: {
          code: 'agents_chat_runtime_timeout',
          message: 'runtime interrupt timed out',
          details: { operationOutcome: 'unknown' },
        },
      },
      continuations: { status: 'cancelled', cancelledCount: 2 },
      cancellationScope: 'logical_task',
      workflowExecutions: { status: 'cancelled', matchedCount: 1, cancelledCount: 1, executionIds: ['workflow-1'], fullyInterrupted: true },
      status: null,
    }, 'request_1')

    expect(result).toMatchObject({
      interrupted: true,
      fullyInterrupted: false,
      localTransport: { status: 'interrupted' },
      runtime: {
        status: 'unknown',
        error: { code: 'agents_chat_runtime_timeout' },
      },
      continuations: { status: 'cancelled', cancelledCount: 2 },
    })
  })

  it('accepts a fully confirmed already-inactive receipt', () => {
    const result = parseAgentsChatTurnInterruptReceiptDto({
      ok: true,
      interrupted: false,
      fullyInterrupted: true,
      sessionKey: 'session_1',
      turnId: 'request_1',
      localTransport: { status: 'not_running' },
      runtime: { status: 'already_inactive', turnId: 'request_1' },
      continuations: { status: 'none', cancelledCount: 0 },
      cancellationScope: 'physical_only',
      workflowExecutions: { status: 'none', matchedCount: 0, cancelledCount: 0, executionIds: [], fullyInterrupted: true },
      status: null,
    }, 'request_1')

    expect(result.fullyInterrupted).toBe(true)
    expect(result.interrupted).toBe(false)
  })

  it('rejects missing or contradictory composite facts', () => {
    expect(() => parseAgentsChatTurnInterruptReceiptDto({
      ok: true,
      interrupted: true,
      sessionKey: 'session_1',
      turnId: 'request_1',
      status: null,
    }, 'request_1')).toThrow(/缺少组合结果字段/)

    expect(() => parseAgentsChatTurnInterruptReceiptDto({
      ok: true,
      interrupted: true,
      fullyInterrupted: true,
      sessionKey: 'session_1',
      turnId: 'request_1',
      localTransport: { status: 'interrupted' },
      runtime: {
        status: 'unknown',
        error: { code: 'agents_chat_runtime_timeout', message: 'timed out' },
      },
      continuations: { status: 'none', cancelledCount: 0 },
      cancellationScope: 'logical_task',
      workflowExecutions: { status: 'none', matchedCount: 0, cancelledCount: 0, executionIds: [], fullyInterrupted: true },
      status: null,
    }, 'request_1')).toThrow(/fullyInterrupted 与分路事实不一致/)

    expect(() => parseAgentsChatTurnInterruptReceiptDto({
      ok: true,
      interrupted: false,
      fullyInterrupted: true,
      sessionKey: 'session_1',
      turnId: 'request_1',
      localTransport: { status: 'not_running' },
      runtime: { status: 'already_inactive', turnId: 'request_1' },
      continuations: { status: 'cancelled', cancelledCount: 0 },
      cancellationScope: 'logical_task',
      workflowExecutions: { status: 'none', matchedCount: 0, cancelledCount: 0, executionIds: [], fullyInterrupted: true },
      status: null,
    }, 'request_1')).toThrow(/cancelled 状态缺少已取消任务/)
  })
})

describe('agents chat turn status transport', () => {
  const replayFixture = JSON.parse(readFileSync('../../packages/schemas/agent-observability/replay-fixtures/replan-attention-projection.v1.json', 'utf8')) as {
    expected: { attentionProjection: Record<string, unknown> }
  }
  it('accepts a confirmed durable running snapshot', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: true,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'running',
        phase: 'agent_running',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:02.000Z',
        requestText: '制作视频',
        reasonCode: 'initial_execution',
        lastConfirmedSummary: '模型正在处理当前任务',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.activeTurn).toBe(true)
    expect(result.turn?.turnId).toBe('request_1')
  })

	it('parses a five-minute video production deadline as a terminal failure fact', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
		activeTurn: false,
      turn: {
        turnId: 'request_video_1',
        internalTurnId: 'turn_video_1',
		state: 'failed',
		phase: 'failed',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:01.000Z',
        lastConfirmedAt: '2026-08-03T05:05:01.000Z',
        requestText: '制作视频',
		reasonCode: 'video_production_start_deadline_exceeded',
		lastConfirmedSummary: '视频生产未在五分钟内取得供应商受理回执，本轮已失败',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
        videoProductionStart: {
		  version: 6,
		  status: 'failed',
		  anchor: 'request_accepted',
          acceptedAt: '2026-08-03T05:00:00.000Z',
          deadlineAt: '2026-08-03T05:05:00.000Z',
          evaluatedAt: '2026-08-03T05:05:01.000Z',
          providerAcceptedAt: null,
          lastSuccessfulActionAt: '2026-08-03T05:00:00.000Z',
          lastSuccessfulAction: 'request_accepted',
          evidence: null,
          diagnostic: {
            code: 'video_production_start_deadline_exceeded',
            observedAt: '2026-08-03T05:05:01.000Z',
            elapsedMs: 301_000,
			blocking: true,
          },
        },
      },
    }, 'session_1')

		expect(result.activeTurn).toBe(false)
		expect(result.turn?.state).toBe('failed')
		expect(result.turn?.videoProductionStart).toMatchObject({
	  status: 'failed',
	  diagnostic: { blocking: true },
    })
  })

  it('accepts succeeded recovery only with the versioned durable delivery chain', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'succeeded',
        phase: 'succeeded',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '交付结果',
        reasonCode: null,
        lastConfirmedSummary: '当前回合已完成',
        finalResponse: '最终结果',
        terminalDelivery: createDurableTerminalDelivery(),
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.state).toBe('succeeded')
    expect(result.turn?.terminalDelivery?.deliveryVerification.status).toBe('satisfied')
  })

  it('accepts the server-committed logical terminal without browser delivery re-arbitration', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_legacy',
        internalTurnId: 'turn_legacy',
        state: 'succeeded',
        phase: 'succeeded',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '生成视频',
        reasonCode: null,
        lastConfirmedSummary: '当前回合已完成',
        finalResponse: '历史回复仍保留',
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.state).toBe('succeeded')
    expect(result.turn?.logicalTaskState.status).toBe('succeeded')
    expect(result.turn?.reasonCode).toBe('logical_succeeded')
    expect(result.turn?.finalResponse).toBe('历史回复仍保留')
  })

  it('keeps terminalAuthority as diagnostics and uses logicalTaskState as the sole lifecycle authority', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'workflow_request_1',
        internalTurnId: 'workflow_turn_1',
        state: 'succeeded',
        phase: 'succeeded',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '执行 clip writer',
        terminalAuthority: 'workflow_action',
        reasonCode: null,
        lastConfirmedSummary: '当前动作已完成',
        finalResponse: '{"clipId":"clip_02"}',
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.state).toBe('succeeded')
    expect(result.turn?.terminalAuthority).toBe('workflow_action')
    expect(result.turn?.reasonCode).toBe('logical_succeeded')
    expect(result.turn?.finalResponse).toBe('{"clipId":"clip_02"}')
  })

  it('rejects an explicit unknown terminal authority instead of guessing its scope', () => {
    expect(() => parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_invalid_authority',
        internalTurnId: 'turn_invalid_authority',
        state: 'failed',
        phase: 'failed',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '执行任务',
        terminalAuthority: 'unknown_scope',
        reasonCode: 'invalid',
        lastConfirmedSummary: '失败',
        finalResponse: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')).toThrow(/terminalAuthority/)
  })

  it('preserves the versioned attention projection', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'suspended',
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '继续任务',
        reasonCode: 'replan_required',
        attentionProjection: {
          version: 1,
          logicalTaskId: 'logical_replay_1',
          status: 'replan',
          waitingOn: 'replan_required',
          obligation: '建立新的执行计划',
          sourceHeads: { graphRevision: null, evidenceRevision: null, physicalRunId: 'physical_replay_1' },
        },
        lastConfirmedSummary: '需要重规划',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.attentionProjection).toMatchObject(replayFixture.expected.attentionProjection)
  })

  it('accepts any non-empty recovery reason and preserves its durable frontier', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'suspended',
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '继续任务',
        reasonCode: 'workflow_agent_role_timeout',
        recoveryCheckpoint: {
          reasonCode: 'workflow_agent_role_timeout',
          physicalRunId: 'physical_1',
          progressRevision: 7,
          durableTaskReferences: [{ taskId: 'task_1' }],
          durableProgressClaims: [{ completedUnitIds: ['clip_1'] }],
          userIntentContract: null,
        },
        lastConfirmedSummary: '已保存持久进度',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.recoveryCheckpoint).toEqual({
      reasonCode: 'workflow_agent_role_timeout',
      physicalRunId: 'physical_1',
      progressRevision: 7,
      durableTaskReferences: [{ taskId: 'task_1' }],
      durableProgressClaims: [{ completedUnitIds: ['clip_1'] }],
      userIntentContract: null,
    })
  })

  it('rejects a recovery checkpoint whose reason does not match the turn', () => {
    expect(() => parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'suspended',
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:03.000Z',
        lastConfirmedAt: '2026-08-03T05:00:03.000Z',
        requestText: '继续任务',
        reasonCode: 'replan_required',
        recoveryCheckpoint: {
          reasonCode: 'workflow_agent_role_timeout',
          physicalRunId: 'physical_1',
          progressRevision: 7,
          userIntentContract: null,
        },
        lastConfirmedSummary: '已保存持久进度',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')).toThrow(/恢复 checkpoint 与回合原因不一致/)
  })

  it('rejects inconsistent active and cross-session snapshots', () => {
    expect(() => parseAgentsChatTurnStatusDto({
      sessionId: 'other',
      durable: true,
      activeTurn: false,
      turn: null,
    }, 'session_1')).toThrow(/sessionId 不匹配/)

    expect(() => parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: true,
      turn: null,
    }, 'session_1')).toThrow(/activeTurn 与 turn 不一致/)
  })

  it('reads the stable public turn id from the exposed trace header', () => {
    expect(readAgentsChatTurnIdHeader(new Headers({ 'X-Trace-ID': 'request_1' }))).toBe('request_1')
    expect(() => readAgentsChatTurnIdHeader(new Headers())).toThrow(/缺少稳定回合 ID/)
  })

  it('accepts a cancelled snapshot for an explicit user interrupt', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'cancelled',
        phase: 'failed',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:01.000Z',
        requestText: '停止当前任务',
        reasonCode: 'chat_turn_user_interrupt',
        lastConfirmedSummary: '当前回合已中断',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.state).toBe('cancelled')
  })

  it('preserves structured physical budget evidence', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'suspended',
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:00.000Z',
        lastConfirmedAt: '2026-08-03T05:05:00.000Z',
        requestText: '执行 V2',
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
        lastConfirmedSummary: '正在切换续跑窗口',
        finalResponse: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.suspension).toMatchObject({
      physicalRunId: 'physical_run_1',
      progressRevision: 4,
      budgetKind: 'wall_time',
    })
  })

  it('preserves a waiting-for-input choice contract for refresh recovery', () => {
    const result = parseAgentsChatTurnStatusDto({
      sessionId: 'session_1',
      durable: true,
      activeTurn: false,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'needs_input',
        phase: 'waiting_for_input',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:01.000Z',
        requestText: '调整剧本',
        reasonCode: 'request_user_input',
        lastConfirmedSummary: '任务正在等待用户输入',
        finalResponse: null,
        pendingUserInput: {
          status: 'needs_input',
          requestId: 'rui_1',
          questions: [{
            id: 'direction',
            header: '改进方向',
            question: '优先改哪里？',
            options: [{ label: '加强高潮', description: '重排节奏' }],
          }],
        },
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }, 'session_1')

    expect(result.turn?.pendingUserInput?.questions[0]?.options[0]?.label).toBe('加强高潮')
  })
})
