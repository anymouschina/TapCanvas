import {
  type AgentsChatTurnStatusDto,
} from '../../api/agentsChatTurn'

export type ChatTurnRecoveryState = {
  snapshot: AgentsChatTurnStatusDto | null
  checking: boolean
  error: Error | null
}

/**
 * Public chat errors carry their own structural terminal fact. Recoverable
 * diagnostics must remain visible without settling the accepted turn.
 */
export function shouldTerminateChatTurnForStreamError(error: {
  terminal: boolean
}): boolean {
  return error.terminal === true
}

export function isChatTurnStateUncertain(snapshot: AgentsChatTurnStatusDto | null): boolean {
  return snapshot?.turn?.logicalTaskState.status === 'active'
    && snapshot.activeTurn === false
    && snapshot.turn.logicalTaskState.physicalRunStatus !== 'handed_off'
}

function hasDurableSuspendedTurn(snapshot: AgentsChatTurnStatusDto | null): boolean {
  const turn = snapshot?.turn
  return turn?.logicalTaskState.status === 'waiting_external'
    && Boolean(String(turn.turnId || '').trim())
}

/**
 * A provider interruption can leave the exact durable turn inactive after the
 * bridge process disappears. The server remains the sole authority for
 * claiming its continuation; this helper only decides whether the browser
 * should attempt that exact sessionKey + turnId handshake once.
 */
export function isRecoverableInactiveChatTurn(
  snapshot: AgentsChatTurnStatusDto | null,
): boolean {
  const turn = snapshot?.turn
  if (!snapshot || snapshot.activeTurn || !turn) return false
  if (hasDurableSuspendedTurn(snapshot)) {
    const attention = turn.attentionProjection?.status
    return Boolean(turn.recoveryCheckpoint)
      || attention === 'run_now'
      || attention === 'repair'
      || attention === 'replan'
  }
  if (turn.logicalTaskState.status !== 'active') return false
  return Boolean(turn.recoveryCheckpoint)
    || turn.attentionProjection?.status === 'run_now'
    || turn.attentionProjection?.status === 'repair'
    || turn.attentionProjection?.status === 'replan'
}

export function isContinuingChatTurn(snapshot: AgentsChatTurnStatusDto | null): boolean {
  if (!snapshot?.turn) return false
  return snapshot.activeTurn === true
    || snapshot.turn.logicalTaskState.status === 'active'
    || hasDurableSuspendedTurn(snapshot)
}

/**
 * `needs_input` is an actionable handoff, not a running turn.  Once the
 * server has persisted the exact request_user_input payload, a background
 * status refresh must not disable the user's answer path.
 */
export function isAwaitingUserInput(snapshot: AgentsChatTurnStatusDto | null): boolean {
  const turn = snapshot?.turn
  const pending = turn?.pendingUserInput
  return snapshot?.activeTurn === false
    && turn?.logicalTaskState.status === 'waiting_input'
    && Boolean(pending)
    && pending?.requestId === turn.turnId
    && pending.questions.length > 0
}

/**
 * A conversation reset must revoke more than an actively streaming turn.
 * Unknown/failed checkpoints and physical-budget suspensions are still
 * eligible for server-side continuation, while needs_input can still own a
 * queued follow-up. Completed or cancelled turns must remain untouched.
 */
export function isRevokableChatTurn(snapshot: AgentsChatTurnStatusDto | null): boolean {
  if (!snapshot?.turn) return false
  if (snapshot.activeTurn === true) return true
  return snapshot.turn.logicalTaskState.status === 'active'
    || snapshot.turn.logicalTaskState.status === 'waiting_input'
    || snapshot.turn.logicalTaskState.status === 'waiting_external'
}

export function terminalChatMessageKind(
  status: NonNullable<AgentsChatTurnStatusDto['turn']>['logicalTaskState']['status'],
): 'result' | 'error' {
  return status === 'failed' || status === 'cancelled' ? 'error' : 'result'
}

export function isLocallySettledTurnMessage(message: {
  phase?: string
  logicalTaskStatus?: string
}): boolean {
  return message.phase === 'final'
    && (message.logicalTaskStatus === 'succeeded'
      || message.logicalTaskStatus === 'failed'
      || message.logicalTaskStatus === 'cancelled')
}

export function resolveRecoveredChatTurnTerminalText(turn: {
  finalResponse: string | null
  lastConfirmedSummary: string
  reasonCode?: string | null
}): string {
  if (turn.reasonCode === 'terminal_delivery_chain_invalid') {
    return '本轮执行失败：持久成功终态缺少完整交付证据（terminal_delivery_chain_invalid）。已生成资产仍会保留。'
  }
  if (turn.reasonCode === 'async_dependency_terminal') {
    return '本轮执行失败：异步依赖已失败或取消。已生成资产仍会保留。'
  }
  if (turn.reasonCode === 'async_lifecycle_monitor_unavailable') {
    return '本轮执行失败：异步任务生命周期监控未能持久化，系统没有把它继续显示为运行中。已生成资产仍会保留。'
  }
  if (turn.reasonCode === 'video_production_start_deadline_exceeded') {
    return '本轮执行失败：视频生产未在截止时间内取得供应商受理回执。已生成资产仍会保留。'
  }
  return String(turn.finalResponse || '').trim()
    || String(turn.lastConfirmedSummary || '').trim()
}

export type RecoveredTerminalMessageProjection = {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: string
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result' | 'error'
  logicalTaskStatus?: 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled'
}

/**
 * A page may first observe a durable turn after it has already failed. In that
 * case there is no previous in-memory progress bubble to patch. Materialize
 * the authoritative failure under the stable turn-derived assistant id so a
 * refresh cannot hide the terminal reason or recreate a spinner.
 */
export function projectRecoveredFailedTurnMessage(
  messages: readonly RecoveredTerminalMessageProjection[],
  input: {
    turnId: string
    summary: string
    startedAt: string
  },
): RecoveredTerminalMessageProjection[] {
  const ids = buildRecoveredChatMessageIds(input.turnId)
  const content = String(input.summary || '').trim() || '当前任务已失败'
  const existingIndex = messages.findIndex((message) => message.id === ids.assistantMessageId)
  if (existingIndex < 0) {
    return [
      ...messages,
      {
        id: ids.assistantMessageId,
        role: 'assistant',
        content,
        ts: input.startedAt,
        phase: 'final',
        kind: 'error',
        logicalTaskStatus: 'failed',
      },
    ]
  }
  const existing = messages[existingIndex]
  if (
    existing.content === content
    && existing.phase === 'final'
    && existing.kind === 'error'
    && existing.logicalTaskStatus === 'failed'
  ) return messages as RecoveredTerminalMessageProjection[]
  return messages.map((message, index) => index === existingIndex
    ? {
        ...message,
        content,
        phase: 'final',
        kind: 'error',
        logicalTaskStatus: 'failed',
      }
    : message)
}

export function canStartVerifiedChatTurn(state: ChatTurnRecoveryState): boolean {
  // Status is an observability surface, not admission authority. Once the
  // conversation identity is stable, a transport/status failure must not
  // become a browser-side deadlock: the normal chat POST performs the atomic
  // server admission and will either start the turn or return the exact
  // in-flight conflict that can be durably queued. We deliberately do not
  // invent an idle snapshot here.
  if (state.error !== null) return true
  // Recovery is attempted before the hook exposes an inactive snapshot. If the
  // authoritative result still says activeTurn=false, the old checkpoint is
  // diagnostic evidence, not a permanent lock on future user messages.
  // snapshot === null 视为「身份/状态尚未确认」而非「空闲」：会话身份解析（base key
  // 查询）完成前 snapshot 必然为 null，此时允许发送会让消息落到空 base 的临时 key 上，
  // 身份解析完成后 key 变化 → 消息被清空、活流被掐断（恢复竞态）。
  return state.snapshot !== null
    && !isContinuingChatTurn(state.snapshot)
    && (isAwaitingUserInput(state.snapshot) || !state.checking)
}

export function shouldQueueIntoRecoveredTurn(snapshot: AgentsChatTurnStatusDto): boolean {
  return isContinuingChatTurn(snapshot)
}

/**
 * The browser SSE can lose its terminal frame after the server has already
 * durably completed the same turn. Reconcile only by the exact transport turn
 * id and public lifecycle state; prose, prompt text, and model output never
 * participate in this decision.
 */
export function shouldReconcileLocalTurnFromDurableStatus(input: {
  activeTurnId: string
  snapshot: AgentsChatTurnStatusDto | null
}): boolean {
  const activeTurnId = String(input.activeTurnId || '').trim()
  const turn = input.snapshot?.turn
  if (!activeTurnId || !input.snapshot || !turn || turn.turnId !== activeTurnId) return false
  if (input.snapshot.activeTurn === true) return false
  return turn.logicalTaskState.status !== 'active'
    && turn.logicalTaskState.status !== 'waiting_external'
}

export function buildRecoveredChatMessageIds(turnId: string): {
  userMessageId: string
  assistantMessageId: string
} {
  const normalized = String(turnId || '').trim()
  if (!normalized) throw new Error('恢复聊天回合需要 turnId')
  return {
    userMessageId: `m_user_recovered_${normalized}`,
    assistantMessageId: `m_ai_recovered_${normalized}`,
  }
}

/**
 * Canvas SSE is a second transport projection of the same public chat turn.
 * Bind it to the root turn ids before it reaches the message list so the rich
 * live card and the plain broadcast can never become two UI messages.
 */
export function bindBroadcastTurnMessageId<T extends {
  id: string
  role: 'user' | 'assistant'
  turnId?: string
}>(message: T): T {
  const turnId = String(message.turnId || '').trim()
  if (!turnId) return message
  const ids = buildRecoveredChatMessageIds(turnId)
  return {
    ...message,
    id: message.role === 'user' ? ids.userMessageId : ids.assistantMessageId,
  }
}

/**
 * Once the server accepts a turn, both the live SSE projection and durable
 * recovery projection must address the same message pair. Rekey the
 * provisional browser-only ids to the stable root turn ids instead of trying
 * to deduplicate equal prose after two cards have already been created.
 *
 * A status poll may race the stream open event and create the stable recovery
 * card first. In that case the provisional live card wins because it owns the
 * richer local tool/todo state, and the transport-only recovery copy is
 * removed before the id is rebound.
 */
export function bindAcceptedTurnMessageIds<T extends { id: string }>(
  messages: readonly T[],
  input: {
    turnId: string
    provisionalUserMessageId: string
    provisionalAssistantMessageId: string
  },
): {
  messages: T[]
  userMessageId: string
  assistantMessageId: string
} {
  const stableIds = buildRecoveredChatMessageIds(input.turnId)
  const provisionalUserMessageId = String(input.provisionalUserMessageId || '').trim()
  const provisionalAssistantMessageId = String(input.provisionalAssistantMessageId || '').trim()
  const hasProvisionalUser = messages.some((message) => message.id === provisionalUserMessageId)
  const hasProvisionalAssistant = messages.some((message) => message.id === provisionalAssistantMessageId)

  let changed = false
  const rebound = messages.flatMap((message): T[] => {
    if (
      hasProvisionalUser
      && message.id === stableIds.userMessageId
      && message.id !== provisionalUserMessageId
    ) {
      changed = true
      return []
    }
    if (
      hasProvisionalAssistant
      && message.id === stableIds.assistantMessageId
      && message.id !== provisionalAssistantMessageId
    ) {
      changed = true
      return []
    }
    if (message.id === provisionalUserMessageId) {
      changed = true
      return [{ ...message, id: stableIds.userMessageId }]
    }
    if (message.id === provisionalAssistantMessageId) {
      changed = true
      return [{ ...message, id: stableIds.assistantMessageId }]
    }
    return [message]
  })

  // 无任何重绑/去重时返回原数组（保持引用），避免流事件驱动的高频调用产生无意义新数组（#20）。
  return {
    messages: changed ? rebound : (messages as T[]),
    userMessageId: stableIds.userMessageId,
    assistantMessageId: stableIds.assistantMessageId,
  }
}

export function reconcileRecoveredProgressMessages<T extends {
  id: string
  role: string
  phase?: string
  kind?: string
}>(messages: readonly T[], activeAssistantMessageId: string): readonly T[] {
  const activeId = String(activeAssistantMessageId || '').trim()
  if (!activeId) throw new Error('恢复聊天回合需要 activeAssistantMessageId')
  // 无消息被裁时返回原数组（保持引用），避免恢复回合每 2.5s poll 都触发全量
  // setMessages 新数组 → 全列表派生重算（#25）。
  let removed = false
  const next = messages.filter((message) => {
    if (message.id === activeId) return true
    const drop = (
      message.id.startsWith('m_ai_recovered_')
      && message.role === 'assistant'
      && message.phase === 'thinking'
      && message.kind === 'progress'
    )
    if (drop) removed = true
    return !drop
  })
  return removed ? next : messages
}

export function removeTrailingHistoryAssistantMessagesForNonterminalTurn<T extends {
  id: string
  role: string
}>(messages: T[]): T[] {
  let lastUserIndex = -1
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index
  })
  if (lastUserIndex < 0) return messages
  let removed = false
  const next = messages.filter((message, index) => {
    const keep = index <= lastUserIndex
      || message.role !== 'assistant'
      || !message.id.startsWith('m_history_')
    if (!keep) removed = true
    return keep
  })
  return removed ? next : messages
}

export function hasMatchingUserRequest(
  messages: readonly { role: string; content: string }[],
  requestText: string,
): boolean {
  const normalizedRequest = requestText.trim()
  if (!normalizedRequest) return false
  return messages.some((message) => message.role === 'user' && message.content.trim() === normalizedRequest)
}

export function formatRecoveredChatTurnSummary(
  summary: string,
  pendingQueueCount: number,
): string {
  const normalizedSummary = String(summary || '').trim()
  const normalizedQueueCount = Number.isInteger(pendingQueueCount) && pendingQueueCount > 0
    ? pendingQueueCount
    : 0
  if (normalizedQueueCount === 0) return normalizedSummary
  return `${normalizedSummary} · 已排队 ${normalizedQueueCount} 条要求`
}

export function readRequestErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return ''
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' ? code.trim() : ''
}

/**
 * Only an authoritative admission conflict proves that the same session has
 * a live owner and that this request belongs in its durable follow-up queue.
 * Transport/status failures never imply that fact.
 */
export function shouldQueueAfterAuthoritativeAdmission(error: unknown): boolean {
  return readRequestErrorCode(error) === 'chat_turn_inflight'
}
