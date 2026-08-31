import { describe, expect, it } from 'vitest'
import type { AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'
import {
  bindAcceptedTurnMessageIds,
  bindBroadcastTurnMessageId,
  buildRecoveredChatMessageIds,
  canStartVerifiedChatTurn,
  formatRecoveredChatTurnSummary,
  hasMatchingUserRequest,
  isAwaitingUserInput,
  isContinuingChatTurn,
  isRecoverableInactiveChatTurn,
  isRevokableChatTurn,
  isLocallySettledTurnMessage,
  readRequestErrorCode,
  projectRecoveredFailedTurnMessage,
  reconcileRecoveredProgressMessages,
  removeTrailingHistoryAssistantMessagesForNonterminalTurn,
  resolveRecoveredChatTurnTerminalText,
  shouldQueueAfterAuthoritativeAdmission,
  shouldReconcileLocalTurnFromDurableStatus,
  shouldQueueIntoRecoveredTurn,
  shouldTerminateChatTurnForStreamError,
  terminalChatMessageKind,
} from './chatTurnRecovery'

const idleSnapshot: AgentsChatTurnStatusDto = {
  sessionId: 'session_1',
  durable: true,
  activeTurn: false,
  turn: null,
}

function logicalTaskState(
  logicalTaskId: string,
  status: 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled',
  reasonCode: string,
) {
  return {
    version: 1 as const,
    logicalTaskId,
    status,
    reasonCode,
    physicalRunStatus: status === 'active'
      ? 'running' as const
      : status === 'waiting_external'
        ? 'handed_off' as const
        : status === 'failed' || status === 'cancelled'
          ? 'interrupted' as const
          : 'completed' as const,
    deliveryStatus: status === 'succeeded'
      ? 'satisfied' as const
      : status === 'failed' || status === 'cancelled'
        ? 'unsatisfied' as const
        : 'pending' as const,
    taskNodeId: 'root',
    taskRevision: 0,
    updatedAt: '2026-08-03T05:05:00.000Z',
    continuationTicket: null,
  }
}

describe('chat turn recovery policy', () => {
  it('keeps nonterminal stream diagnostics inside the current accepted turn', () => {
    expect(shouldTerminateChatTurnForStreamError({ terminal: false })).toBe(false)
    expect(shouldTerminateChatTurnForStreamError({ terminal: true })).toBe(true)
  })

  it('uses durable status when available and delegates status transport failures to atomic server admission', () => {
    expect(canStartVerifiedChatTurn({ snapshot: idleSnapshot, checking: false, error: null })).toBe(true)
    expect(canStartVerifiedChatTurn({ snapshot: null, checking: true, error: null })).toBe(false)
    expect(canStartVerifiedChatTurn({ snapshot: idleSnapshot, checking: false, error: new Error('offline') })).toBe(true)
    expect(canStartVerifiedChatTurn({ snapshot: null, checking: false, error: new Error('offline') })).toBe(true)
  })

  it('treats a missing snapshot as unconfirmed instead of idle', () => {
    // 会话身份（base key）解析完成前 snapshot 必为 null：此时不得允许发送，
    // 否则消息会落到空 base 的临时 key、身份解析完成后被清空。
    expect(canStartVerifiedChatTurn({ snapshot: null, checking: false, error: null })).toBe(false)
  })

  it('keeps a structured needs_input handoff answerable during a background refresh', () => {
    const needsInputSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_input',
        internalTurnId: 'turn_input',
        state: 'needs_input',
        logicalTaskState: logicalTaskState('request_input', 'waiting_input', 'request_user_input_pending'),
        phase: 'waiting_for_input',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:01.000Z',
        requestText: '选择资产',
        reasonCode: 'request_user_input_pending',
        suspension: null,
        lastConfirmedSummary: '等待用户选择',
        finalResponse: null,
        pendingUserInput: {
          status: 'needs_input',
          requestId: 'request_input',
          questions: [{
            id: 'asset',
            header: '资产',
            question: '使用哪一个？',
            options: [{ label: '项目已有资产' }],
          }],
        },
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isAwaitingUserInput(needsInputSnapshot)).toBe(true)
    expect(canStartVerifiedChatTurn({
      snapshot: needsInputSnapshot,
      checking: true,
      error: null,
    })).toBe(true)
  })

  it('does not treat an incomplete needs_input snapshot as an answerable handoff', () => {
    const incompleteSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_input',
        internalTurnId: 'turn_input',
        state: 'needs_input',
        logicalTaskState: logicalTaskState('request_input', 'waiting_input', 'request_user_input_pending'),
        phase: 'waiting_for_input',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:01.000Z',
        requestText: '选择资产',
        reasonCode: 'request_user_input_pending',
        suspension: null,
        lastConfirmedSummary: '等待用户选择',
        finalResponse: null,
        pendingUserInput: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isAwaitingUserInput(incompleteSnapshot)).toBe(false)
    expect(canStartVerifiedChatTurn({
      snapshot: incompleteSnapshot,
      checking: true,
      error: null,
    })).toBe(false)
  })

  it('treats an inactive failed logical task as settled without reviving the physical run', () => {
    const staleSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_1',
        internalTurnId: 'turn_1',
        state: 'unknown',
        logicalTaskState: logicalTaskState('request_1', 'failed', 'physical_run_lost'),
        phase: 'agent_running',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:01.000Z',
        requestText: '制作视频',
        reasonCode: 'initial_execution',
        suspension: null,
        lastConfirmedSummary: '上次任务未正常收尾，当前已无执行进程',
        finalResponse: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }
    expect(isRecoverableInactiveChatTurn(staleSnapshot)).toBe(false)
    expect(canStartVerifiedChatTurn({
      checking: false,
      error: null,
      snapshot: staleSnapshot,
    })).toBe(true)
    expect(canStartVerifiedChatTurn({
      checking: true,
      error: null,
      snapshot: staleSnapshot,
    })).toBe(false)
    expect(shouldQueueIntoRecoveredTurn(staleSnapshot)).toBe(false)
    expect(shouldQueueIntoRecoveredTurn({ ...staleSnapshot, activeTurn: true })).toBe(true)
    expect(isRevokableChatTurn(staleSnapshot)).toBe(false)
    expect(isRevokableChatTurn({
      ...staleSnapshot,
      turn: {
        ...staleSnapshot.turn!,
        state: 'succeeded',
        logicalTaskState: logicalTaskState('request_1', 'succeeded', 'delivery_verified'),
      },
    })).toBe(false)
  })

  it('keeps a physical handoff inside the same continuing logical turn', () => {
    const suspendedSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_root',
        internalTurnId: 'turn_physical_2',
        state: 'suspended',
        logicalTaskState: logicalTaskState('request_root', 'waiting_external', 'root_physical_execution_budget_exhausted'),
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:00.000Z',
        lastConfirmedAt: '2026-08-03T05:05:00.000Z',
        requestText: '',
        reasonCode: 'root_physical_execution_budget_exhausted',
        suspension: {
          reasonCode: 'root_physical_execution_budget_exhausted',
          physicalRunId: 'physical_run_2',
          progressRevision: 2,
          progressSinceRunStart: 1,
          budgetKind: 'turns',
          observed: 30,
          limit: 30,
        },
        lastConfirmedSummary: '正在切换续跑窗口',
        finalResponse: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isContinuingChatTurn(suspendedSnapshot)).toBe(true)
    expect(canStartVerifiedChatTurn({ snapshot: suspendedSnapshot, checking: false, error: null })).toBe(false)
    expect(shouldQueueIntoRecoveredTurn(suspendedSnapshot)).toBe(true)
    expect(isRevokableChatTurn(suspendedSnapshot)).toBe(true)
  })

  it('keeps a generic replan suspension in the same logical turn', () => {
    const suspendedSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_replan',
        internalTurnId: 'turn_replan_2',
        state: 'suspended',
        logicalTaskState: logicalTaskState('request_replan', 'waiting_external', 'tool_progress_circuit_exhausted'),
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:00.000Z',
        lastConfirmedAt: '2026-08-03T05:05:00.000Z',
        requestText: '完成整个任务',
        reasonCode: 'tool_progress_circuit_exhausted',
        suspension: null,
        attentionProjection: {
          version: 1,
          logicalTaskId: 'request_replan',
          status: 'replan',
          waitingOn: null,
          obligation: 'create a new plan increment',
          sourceHeads: {
            graphRevision: 3,
            evidenceRevision: 2,
            physicalRunId: 'physical_replan_2',
          },
        },
        lastConfirmedSummary: '当前物理窗口已结束，正在重新规划',
        finalResponse: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isContinuingChatTurn(suspendedSnapshot)).toBe(true)
    expect(isRecoverableInactiveChatTurn(suspendedSnapshot)).toBe(true)
    expect(canStartVerifiedChatTurn({ snapshot: suspendedSnapshot, checking: false, error: null })).toBe(false)
    expect(shouldQueueIntoRecoveredTurn(suspendedSnapshot)).toBe(true)
    expect(isRevokableChatTurn(suspendedSnapshot)).toBe(true)
  })

  it('recovers a new suspension reason from its machine-issued checkpoint', () => {
    const suspendedSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_role_timeout',
        internalTurnId: 'turn_role_timeout',
        state: 'suspended',
        logicalTaskState: logicalTaskState('request_role_timeout', 'waiting_external', 'workflow_agent_role_timeout'),
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:00.000Z',
        lastConfirmedAt: '2026-08-03T05:05:00.000Z',
        requestText: '完成任务',
        reasonCode: 'workflow_agent_role_timeout',
        suspension: null,
        recoveryCheckpoint: {
          reasonCode: 'workflow_agent_role_timeout',
          physicalRunId: 'physical_role_timeout',
          progressRevision: 5,
          durableTaskReferences: [],
          durableProgressClaims: [],
          userIntentContract: null,
        },
        lastConfirmedSummary: '当前角色窗口已结束，等待续跑',
        finalResponse: null,
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isRecoverableInactiveChatTurn(suspendedSnapshot)).toBe(true)
  })

  it('continues an unsatisfied response candidate from its structured physical recovery ticket', () => {
    const responseSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_response',
        internalTurnId: 'turn_response_physical',
        state: 'suspended',
        logicalTaskState: logicalTaskState('request_response', 'waiting_external', 'root_physical_execution_budget_exhausted'),
        phase: 'suspended',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:00.000Z',
        lastConfirmedAt: '2026-08-03T05:05:00.000Z',
        requestText: '完成一份可交付的文字方案',
        reasonCode: 'root_physical_execution_budget_exhausted',
        suspension: {
          reasonCode: 'root_physical_execution_budget_exhausted',
          physicalRunId: 'physical_response_2',
          progressRevision: 2,
          progressSinceRunStart: 1,
          budgetKind: 'turns',
          observed: 30,
          limit: 30,
        },
        recoveryCheckpoint: {
          reasonCode: 'root_physical_execution_budget_exhausted',
          physicalRunId: 'physical_response_2',
          progressRevision: 2,
          durableTaskReferences: [],
          durableProgressClaims: [],
          userIntentContract: { delivery: { mode: 'response', kind: 'text', output: '完整文字方案' } },
        },
        lastConfirmedSummary: '首稿仍未通过交付核验，等待同链修订',
        finalResponse: '尚未验收的候选首稿',
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isRecoverableInactiveChatTurn(responseSnapshot)).toBe(true)
    expect(isContinuingChatTurn(responseSnapshot)).toBe(true)
    expect(canStartVerifiedChatTurn({ snapshot: responseSnapshot, checking: false, error: null })).toBe(false)
    expect(shouldQueueIntoRecoveredTurn(responseSnapshot)).toBe(true)
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'request_response',
      snapshot: responseSnapshot,
    })).toBe(false)
  })

  it('does not recover a response after the durable turn is genuinely satisfied', () => {
    const satisfiedSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'request_response_done',
        internalTurnId: 'turn_response_done',
        state: 'succeeded',
        logicalTaskState: logicalTaskState('request_response_done', 'succeeded', 'delivery_verified'),
        phase: 'succeeded',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:05:00.000Z',
        lastConfirmedAt: '2026-08-03T05:05:00.000Z',
        requestText: '完成一份可交付的文字方案',
        reasonCode: null,
        suspension: null,
        recoveryCheckpoint: {
          reasonCode: 'delivery_verified',
          physicalRunId: 'physical_response_done',
          progressRevision: 3,
          durableTaskReferences: [],
          durableProgressClaims: [],
          userIntentContract: { delivery: { mode: 'response', kind: 'text', output: '完整文字方案' } },
        },
        lastConfirmedSummary: '交付已核验',
        finalResponse: '最终方案',
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }

    expect(isRecoverableInactiveChatTurn(satisfiedSnapshot)).toBe(false)
    expect(isContinuingChatTurn(satisfiedSnapshot)).toBe(false)
    expect(canStartVerifiedChatTurn({ snapshot: satisfiedSnapshot, checking: false, error: null })).toBe(true)
    expect(shouldQueueIntoRecoveredTurn(satisfiedSnapshot)).toBe(false)
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'request_response_done',
      snapshot: satisfiedSnapshot,
    })).toBe(true)
  })

  it('reconciles an exact local turn when SSE missed a durable terminal state', () => {
    const terminalSnapshot: AgentsChatTurnStatusDto = {
      ...idleSnapshot,
      turn: {
        turnId: 'turn_1',
        internalTurnId: 'physical_1',
        state: 'succeeded',
        logicalTaskState: logicalTaskState('turn_1', 'succeeded', 'delivery_verified'),
        phase: 'succeeded',
        startedAt: '2026-08-03T05:00:00.000Z',
        updatedAt: '2026-08-03T05:00:01.000Z',
        lastConfirmedAt: '2026-08-03T05:00:01.000Z',
        requestText: '只做文字讨论',
        reasonCode: null,
        suspension: null,
        lastConfirmedSummary: '当前回合已完成',
        finalResponse: '完成',
        pendingQueueCount: 0,
        recentEvents: [],
      },
    }
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'turn_1',
      snapshot: terminalSnapshot,
    })).toBe(true)
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'turn_1',
      snapshot: { ...terminalSnapshot, activeTurn: true },
    })).toBe(false)
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'turn_1',
      snapshot: {
        ...terminalSnapshot,
        turn: {
          ...terminalSnapshot.turn!,
          state: 'running',
          phase: 'agent_running',
          logicalTaskState: logicalTaskState('turn_1', 'active', 'agent_running'),
        },
      },
    })).toBe(false)
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'turn_1',
      snapshot: {
        ...terminalSnapshot,
        turn: {
          ...terminalSnapshot.turn!,
          state: 'suspended',
          phase: 'suspended',
          logicalTaskState: logicalTaskState('turn_1', 'waiting_external', 'async_waiting'),
        },
      },
    })).toBe(false)
    expect(shouldReconcileLocalTurnFromDurableStatus({
      activeTurnId: 'turn_2',
      snapshot: terminalSnapshot,
    })).toBe(false)
  })

  it('uses stable recovered ids and reads structured conflict codes', () => {
    expect(buildRecoveredChatMessageIds('request_1')).toEqual({
      userMessageId: 'm_user_recovered_request_1',
      assistantMessageId: 'm_ai_recovered_request_1',
    })
    const error = Object.assign(new Error('busy'), { code: 'chat_turn_inflight' })
    expect(readRequestErrorCode(error)).toBe('chat_turn_inflight')
    expect(formatRecoveredChatTurnSummary('正在执行', 2)).toBe('正在执行 · 已排队 2 条要求')
    expect(formatRecoveredChatTurnSummary('正在执行', 0)).toBe('正在执行')
  })

  it('queues only after the server authoritatively confirms an in-flight turn', () => {
    expect(shouldQueueAfterAuthoritativeAdmission(
      Object.assign(new Error('busy'), { code: 'chat_turn_inflight' }),
    )).toBe(true)
    expect(shouldQueueAfterAuthoritativeAdmission(
      Object.assign(new Error('offline'), { code: 'agents_bridge_unavailable' }),
    )).toBe(false)
    expect(shouldQueueAfterAuthoritativeAdmission(new Error('status timeout'))).toBe(false)
  })

  it('binds canvas broadcast projections to the same root turn message ids', () => {
    expect(bindBroadcastTurnMessageId({
      id: 'sse-asst-response_1',
      turnId: 'request_1',
      role: 'assistant',
      content: '普通终态投影',
    })).toEqual({
      id: 'm_ai_recovered_request_1',
      turnId: 'request_1',
      role: 'assistant',
      content: '普通终态投影',
    })
    expect(bindBroadcastTurnMessageId({
      id: 'legacy-message',
      role: 'assistant',
      content: '旧协议消息',
    })).toEqual({
      id: 'legacy-message',
      role: 'assistant',
      content: '旧协议消息',
    })
  })

  it('binds the accepted live pair to the same stable ids used by durable recovery', () => {
    const result = bindAcceptedTurnMessageIds([
      { id: 'm_user_pending', role: 'user', content: '应用视觉规范' },
      { id: 'm_ai_pending', role: 'assistant', content: '处理中', toolSteps: ['读取规范'] },
    ], {
      turnId: 'request_1',
      provisionalUserMessageId: 'm_user_pending',
      provisionalAssistantMessageId: 'm_ai_pending',
    })

    expect(result.userMessageId).toBe('m_user_recovered_request_1')
    expect(result.assistantMessageId).toBe('m_ai_recovered_request_1')
    expect(result.messages).toEqual([
      { id: 'm_user_recovered_request_1', role: 'user', content: '应用视觉规范' },
      { id: 'm_ai_recovered_request_1', role: 'assistant', content: '处理中', toolSteps: ['读取规范'] },
    ])
  })

  it('keeps the richer live card when status recovery races stream acceptance', () => {
    const result = bindAcceptedTurnMessageIds([
      { id: 'm_user_recovered_request_1', role: 'user', content: '应用视觉规范' },
      { id: 'm_ai_recovered_request_1', role: 'assistant', content: '模型正在处理当前任务' },
      { id: 'm_user_pending', role: 'user', content: '应用视觉规范' },
      { id: 'm_ai_pending', role: 'assistant', content: '执行详情', toolSteps: ['读取规范', '激活版本'] },
    ], {
      turnId: 'request_1',
      provisionalUserMessageId: 'm_user_pending',
      provisionalAssistantMessageId: 'm_ai_pending',
    })

    expect(result.messages.filter((message) => message.role === 'assistant')).toEqual([
      {
        id: 'm_ai_recovered_request_1',
        role: 'assistant',
        content: '执行详情',
        toolSteps: ['读取规范', '激活版本'],
      },
    ])
    expect(new Set(result.messages.map((message) => message.id)).size).toBe(result.messages.length)
  })

  it('does not duplicate an identical user request when a physical continuation is recovered', () => {
    expect(hasMatchingUserRequest([
      { role: 'assistant', content: '正在执行' },
      { role: 'user', content: '  完成当前章节一键成片  ' },
    ], '完成当前章节一键成片')).toBe(true)
    expect(hasMatchingUserRequest([
      { role: 'user', content: '完成上一章一键成片' },
    ], '完成当前章节一键成片')).toBe(false)
  })

  it('keeps one progress card when the same logical task crosses physical windows', () => {
    const messages = reconcileRecoveredProgressMessages([
      { id: 'm_user_1', role: 'user', content: '执行任务' },
      { id: 'm_ai_recovered_physical_1', role: 'assistant', content: '处理中', phase: 'thinking', kind: 'progress' },
      { id: 'm_ai_recovered_physical_2', role: 'assistant', content: '处理中', phase: 'thinking', kind: 'progress' },
      { id: 'm_ai_recovered_finished', role: 'assistant', content: '已完成', phase: 'final', kind: 'result' },
    ], 'm_ai_recovered_root')

    expect(messages.map((message) => message.id)).toEqual([
      'm_user_1',
      'm_ai_recovered_finished',
    ])
  })

  it('removes only trailing history replies while the durable turn is nonterminal', () => {
    const messages = removeTrailingHistoryAssistantMessagesForNonterminalTurn([
      { id: 'm_history_old_user', role: 'user', content: '上一条请求' },
      { id: 'm_history_old_answer', role: 'assistant', content: '上一条终态结果' },
      { id: 'm_history_current_user', role: 'user', content: '当前请求' },
      { id: 'm_history_physical_1', role: 'assistant', content: '物理窗口投影' },
      { id: 'm_history_physical_2', role: 'assistant', content: '物理窗口投影' },
      { id: 'm_ai_recovered_root', role: 'assistant', content: '权威处理中状态' },
    ])

    expect(messages.map((message) => message.id)).toEqual([
      'm_history_old_user',
      'm_history_old_answer',
      'm_history_current_user',
      'm_ai_recovered_root',
    ])
  })

  it('keeps terminal recovered replies out of the progress animation state', () => {
    expect(terminalChatMessageKind('failed')).toBe('error')
    expect(terminalChatMessageKind('succeeded')).toBe('result')
    expect(terminalChatMessageKind('waiting_external')).toBe('result')
    expect(terminalChatMessageKind('cancelled')).toBe('error')
    expect(resolveRecoveredChatTurnTerminalText({
      finalResponse: '项目视觉圣经 V1 已激活',
      lastConfirmedSummary: '当前回合已完成',
    })).toBe('项目视觉圣经 V1 已激活')
    expect(resolveRecoveredChatTurnTerminalText({
      finalResponse: null,
      lastConfirmedSummary: '当前回合已完成',
    })).toBe('当前回合已完成')
    expect(resolveRecoveredChatTurnTerminalText({
      finalResponse: '历史回复与资产引用仍保留',
      lastConfirmedSummary: '当前回合已完成',
      reasonCode: 'terminal_delivery_chain_invalid',
    })).toContain('持久成功终态缺少完整交付证据')
    expect(resolveRecoveredChatTurnTerminalText({
      finalResponse: '工作流已受理，正在等待供应商',
      lastConfirmedSummary: '当前回合已失败',
      reasonCode: 'async_dependency_terminal',
    })).toContain('异步依赖已失败或取消')
    expect(resolveRecoveredChatTurnTerminalText({
      finalResponse: '工作流已受理，正在等待供应商',
      lastConfirmedSummary: '当前回合已失败',
      reasonCode: 'video_production_start_deadline_exceeded',
    })).toContain('未在截止时间内取得供应商受理回执')
    expect(isLocallySettledTurnMessage({
      phase: 'final',
      logicalTaskStatus: 'succeeded',
    })).toBe(true)
    expect(isLocallySettledTurnMessage({
      phase: 'final',
      logicalTaskStatus: 'waiting_external',
    })).toBe(false)
    expect(isLocallySettledTurnMessage({ phase: 'thinking' })).toBe(false)
  })

  it('materializes a complete failed reply when refresh has no prior progress bubble', () => {
    const projected = projectRecoveredFailedTurnMessage([
      {
        id: 'm_user_recovered_turn_deadline',
        role: 'user',
        content: '生成当前章节整片',
        ts: '07:41',
      },
    ], {
      turnId: 'turn_deadline',
      summary: '供应商权限校验失败，任务已失败。\n当前阶段：失败。\n失败原因：provider_permission_denied',
      startedAt: '07:41',
    })

    expect(projected).toHaveLength(2)
    expect(projected[1]).toMatchObject({
      id: 'm_ai_recovered_turn_deadline',
      role: 'assistant',
      phase: 'final',
      kind: 'error',
      logicalTaskStatus: 'failed',
    })
    expect(projected[1]?.content).toContain('失败原因：provider_permission_denied')
    expect(projectRecoveredFailedTurnMessage(projected, {
      turnId: 'turn_deadline',
      summary: projected[1]?.content || '',
      startedAt: '07:41',
    })).toBe(projected)
  })
})
