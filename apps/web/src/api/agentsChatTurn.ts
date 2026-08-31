import type { AgentLogicalTaskStateV1 } from '@tapcanvas/agent-observability'

export type AgentsChatTurnPublicState =
  | 'running'
  | 'needs_input'
  | 'suspended'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'unknown'

export type AgentsChatTurnPhase =
  | 'accepted'
  | 'agent_running'
  | 'completion_verifying'
  | 'waiting_for_input'
  | 'suspended'
  | 'succeeded'
  | 'failed'

export const VIDEO_PRODUCTION_START_DEADLINE_EXCEEDED_REASON =
  'video_production_start_deadline_exceeded' as const

export type AgentsChatPendingUserInput = {
  status: 'needs_input'
  requestId: string
  questions: Array<{
    id: string
    header: string
    question: string
    options: Array<{ label: string; description?: string; imageUrl?: string; thumbnailUrl?: string }>
  }>
}

export type AgentsChatPhysicalBudgetSuspension = {
  reasonCode: 'root_physical_execution_budget_exhausted'
  physicalRunId: string
  progressRevision: number
  progressSinceRunStart: number
  budgetKind: 'turns' | 'tool_calls' | 'tokens' | 'wall_time'
  observed: number
  limit: number
}

export type AgentsChatTurnRecoveryCheckpoint = {
  reasonCode: string
  physicalRunId: string
  progressRevision: number
  durableTaskReferences?: Array<Record<string, unknown>>
  durableProgressClaims?: Array<Record<string, unknown>>
  userIntentContract: Record<string, unknown> | null
}

export type AgentsChatAttentionProjection = {
  version: 1
  logicalTaskId: string
  status: 'run_now' | 'wait' | 'user_action_required' | 'repair' | 'replan' | 'terminal'
  waitingOn: string | null
  obligation: string
  sourceHeads: {
    graphRevision: number | null
    evidenceRevision: number | null
    physicalRunId: string | null
  }
}

export type AgentsChatDurableTerminalDelivery = {
  version: 1
  requestTerminal: {
    version: 1
    terminal: true
    status: 'succeeded'
    reason: string
  }
  expectedDelivery: Record<string, unknown> & {
    version: 2
    contractHash: string
  }
  deliveryEvidence: Array<Record<string, unknown> & {
    evidenceId: string
    kind: 'final_response' | 'tool_call' | 'artifact' | 'persisted_state' | 'source'
    sourceRef: string
  }>
  deliveryVerification: Record<string, unknown> & {
    version: 2
    contractHash: string
    status: 'satisfied'
    verifiedAt: string
  }
}

export type AgentsChatVideoProductionStart = {
	version: 6
	status: 'waiting' | 'started' | 'failed'
	anchor: 'request_accepted' | 'workflow_execution_created'
  acceptedAt: string
  deadlineAt: string
  evaluatedAt: string
  providerAcceptedAt: string | null
  lastSuccessfulActionAt: string
  lastSuccessfulAction: 'request_accepted' | 'workflow_accepted' | 'provider_task_accepted'
  evidence: {
    method: 'direct_video_task' | 'workflow_video_node'
    taskId: string
    providerAcceptedAt: string
    workflowExecutionId: string | null
    workflowNodeId: string | null
  } | null
  diagnostic: {
    code: typeof VIDEO_PRODUCTION_START_DEADLINE_EXCEEDED_REASON
    observedAt: string
    elapsedMs: number
		blocking: true
  } | null
}

export type AgentsChatTurnStatusDto = {
  sessionId: string
  durable: true
  activeTurn: boolean
  turn: {
    turnId: string
    internalTurnId: string
    state: AgentsChatTurnPublicState
    logicalTaskState: AgentLogicalTaskStateV1
    phase: AgentsChatTurnPhase
    startedAt: string
    updatedAt: string
    lastConfirmedAt: string
    requestText: string
    terminalAuthority?: 'user_delivery' | 'workflow_action'
    reasonCode: string | null
    suspension: AgentsChatPhysicalBudgetSuspension | null
    recoveryCheckpoint?: AgentsChatTurnRecoveryCheckpoint | null
    attentionProjection?: AgentsChatAttentionProjection | null
    lastConfirmedSummary: string
    finalResponse: string | null
    terminalDelivery?: AgentsChatDurableTerminalDelivery | null
    pendingUserInput?: AgentsChatPendingUserInput | null
    pendingQueueCount: number
    videoProductionStart?: AgentsChatVideoProductionStart | null
    recentEvents: Array<{
      type: string
      at: string
      toolName: string | null
      toolStatus: string | null
    }>
  } | null
}

function readVideoProductionStart(value: unknown): AgentsChatVideoProductionStart | null {
  if (value === undefined || value === null) return null
  const root = asRecord(value)
	if (!root || root.version !== 6) throw new Error('视频生产启动状态无效')
	if (root.status !== 'waiting' && root.status !== 'started' && root.status !== 'failed') {
    throw new Error('视频生产启动阶段无效')
  }
  if (
    root.lastSuccessfulAction !== 'request_accepted'
    && root.lastSuccessfulAction !== 'workflow_accepted'
    && root.lastSuccessfulAction !== 'provider_task_accepted'
  ) throw new Error('视频生产最后成功动作无效')
  const evidenceRecord = root.evidence === null ? null : asRecord(root.evidence)
  const evidenceMethod = evidenceRecord?.method === 'direct_video_task' || evidenceRecord?.method === 'workflow_video_node'
    ? evidenceRecord.method
    : null
  if (evidenceRecord && !evidenceMethod) throw new Error('视频生产证据类型无效')
  const evidence = evidenceRecord
    ? {
        method: evidenceMethod as 'direct_video_task' | 'workflow_video_node',
        taskId: readRequiredString(evidenceRecord, 'taskId'),
        providerAcceptedAt: readRequiredString(evidenceRecord, 'providerAcceptedAt'),
        workflowExecutionId: readNullableString(evidenceRecord.workflowExecutionId),
        workflowNodeId: readNullableString(evidenceRecord.workflowNodeId),
      }
    : null
  const diagnosticRecord = root.diagnostic === null ? null : asRecord(root.diagnostic)
  const elapsedMs = diagnosticRecord?.elapsedMs
  if (diagnosticRecord && (
    diagnosticRecord.code !== 'video_production_start_deadline_exceeded'
    || typeof elapsedMs !== 'number'
    || !Number.isFinite(elapsedMs)
    || elapsedMs < 0
		|| diagnosticRecord.blocking !== true
	)) throw new Error('视频生产启动截止观测诊断无效')
	return {
		version: 6,
    status: root.status,
		anchor: root.anchor === 'request_accepted' || root.anchor === 'workflow_execution_created'
			? root.anchor
			: (() => { throw new Error('视频生产启动计时锚点无效') })(),
    acceptedAt: readRequiredString(root, 'acceptedAt'),
    deadlineAt: readRequiredString(root, 'deadlineAt'),
    evaluatedAt: readRequiredString(root, 'evaluatedAt'),
    providerAcceptedAt: readNullableString(root.providerAcceptedAt),
    lastSuccessfulActionAt: readRequiredString(root, 'lastSuccessfulActionAt'),
    lastSuccessfulAction: root.lastSuccessfulAction,
    evidence,
    diagnostic: diagnosticRecord ? {
      code: 'video_production_start_deadline_exceeded',
      observedAt: readRequiredString(diagnosticRecord, 'observedAt'),
      elapsedMs: elapsedMs as number,
			blocking: true,
    } : null,
  }
}

const PUBLIC_STATES = new Set<AgentsChatTurnPublicState>([
  'running',
  'needs_input',
  'suspended',
  'succeeded',
  'cancelled',
  'failed',
  'unknown',
])

const TURN_PHASES = new Set<AgentsChatTurnPhase>([
  'accepted',
  'agent_running',
  'completion_verifying',
  'waiting_for_input',
  'suspended',
  'succeeded',
  'failed',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const raw = record[key]
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) throw new Error(`聊天回合状态缺少 ${key}`)
  return value
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const DELIVERY_EVIDENCE_KINDS = new Set<AgentsChatDurableTerminalDelivery['deliveryEvidence'][number]['kind']>([
  'final_response',
  'tool_call',
  'artifact',
  'persisted_state',
  'source',
])

function readDurableTerminalDelivery(value: unknown): AgentsChatDurableTerminalDelivery | null {
  const source = asRecord(value)
  const requestTerminal = asRecord(source?.requestTerminal)
  const expectedDelivery = asRecord(source?.expectedDelivery)
  const deliveryVerification = asRecord(source?.deliveryVerification)
  if (
    !source || source.version !== 1
    || !requestTerminal || requestTerminal.version !== 1 || requestTerminal.terminal !== true
    || requestTerminal.status !== 'succeeded'
    || !expectedDelivery || expectedDelivery.version !== 2
    || !deliveryVerification || deliveryVerification.version !== 2
    || deliveryVerification.status !== 'satisfied'
    || !Array.isArray(source.deliveryEvidence) || source.deliveryEvidence.length === 0
  ) return null
  const contractHash = readNullableString(expectedDelivery.contractHash)
  const verifiedContractHash = readNullableString(deliveryVerification.contractHash)
  const reason = readNullableString(requestTerminal.reason)
  const verifiedAt = readNullableString(deliveryVerification.verifiedAt)
  if (!contractHash || contractHash !== verifiedContractHash || !reason || !verifiedAt) return null
  const deliveryEvidence = source.deliveryEvidence.flatMap((item) => {
    const evidence = asRecord(item)
    const kind = readNullableString(evidence?.kind) as AgentsChatDurableTerminalDelivery['deliveryEvidence'][number]['kind'] | null
    if (!evidence || !kind || !DELIVERY_EVIDENCE_KINDS.has(kind)) return []
    const evidenceId = readNullableString(evidence.evidenceId)
    const sourceRef = readNullableString(evidence.sourceRef)
    return evidenceId && sourceRef ? [{ ...evidence, evidenceId, kind, sourceRef }] : []
  })
  if (deliveryEvidence.length !== source.deliveryEvidence.length) return null
  return {
    version: 1,
    requestTerminal: { version: 1, terminal: true, status: 'succeeded', reason },
    expectedDelivery: { ...expectedDelivery, version: 2, contractHash },
    deliveryEvidence,
    deliveryVerification: {
      ...deliveryVerification,
      version: 2,
      contractHash: verifiedContractHash,
      status: 'satisfied',
      verifiedAt,
    },
  }
}

const PHYSICAL_BUDGET_KINDS = new Set<AgentsChatPhysicalBudgetSuspension['budgetKind']>([
  'turns',
  'tool_calls',
  'tokens',
  'wall_time',
])

const LOGICAL_TASK_STATUSES = new Set<AgentLogicalTaskStateV1['status']>([
  'active',
  'waiting_input',
  'waiting_external',
  'succeeded',
  'failed',
  'cancelled',
])

const PHYSICAL_RUN_STATUSES = new Set<AgentLogicalTaskStateV1['physicalRunStatus']>([
  'running',
  'completed',
  'handed_off',
  'interrupted',
])

const DELIVERY_STATUSES = new Set<AgentLogicalTaskStateV1['deliveryStatus']>([
  'pending',
  'satisfied',
  'unsatisfied',
])

function projectPublicTurnState(
  status: AgentLogicalTaskStateV1['status'],
): AgentsChatTurnPublicState {
  if (status === 'active') return 'running'
  if (status === 'waiting_input') return 'needs_input'
  if (status === 'waiting_external') return 'suspended'
  return status
}

function readLogicalTaskState(value: unknown): AgentLogicalTaskStateV1 {
  const source = asRecord(value)
  if (!source || source.version !== 1) throw new Error('聊天回合 logicalTaskState 无效')
  const status = readRequiredString(source, 'status') as AgentLogicalTaskStateV1['status']
  const physicalRunStatus = readRequiredString(source, 'physicalRunStatus') as AgentLogicalTaskStateV1['physicalRunStatus']
  const deliveryStatus = readRequiredString(source, 'deliveryStatus') as AgentLogicalTaskStateV1['deliveryStatus']
  if (!LOGICAL_TASK_STATUSES.has(status)) throw new Error('聊天回合 logicalTaskState.status 无效')
  if (!PHYSICAL_RUN_STATUSES.has(physicalRunStatus)) throw new Error('聊天回合 logicalTaskState.physicalRunStatus 无效')
  if (!DELIVERY_STATUSES.has(deliveryStatus)) throw new Error('聊天回合 logicalTaskState.deliveryStatus 无效')
  if (source.continuationTicket !== null) {
    throw new Error('聊天状态接口不得暴露未解析的 continuationTicket')
  }
  return {
    version: 1,
    logicalTaskId: readRequiredString(source, 'logicalTaskId'),
    status,
    reasonCode: readRequiredString(source, 'reasonCode'),
    physicalRunStatus,
    deliveryStatus,
    taskNodeId: readRequiredString(source, 'taskNodeId'),
    taskRevision: readNonNegativeInteger(source, 'taskRevision'),
    updatedAt: readRequiredString(source, 'updatedAt'),
    continuationTicket: null,
  }
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`聊天回合状态 ${key} 无效`)
  }
  return value
}

function readPhysicalBudgetSuspension(value: unknown): AgentsChatPhysicalBudgetSuspension | null {
  if (value === null || typeof value === 'undefined') return null
  const record = asRecord(value)
  if (!record || record.reasonCode !== 'root_physical_execution_budget_exhausted') {
    throw new Error('聊天回合物理预算挂起状态无效')
  }
  const budgetKind = readRequiredString(record, 'budgetKind') as AgentsChatPhysicalBudgetSuspension['budgetKind']
  if (!PHYSICAL_BUDGET_KINDS.has(budgetKind)) throw new Error('聊天回合预算类型无效')
  return {
    reasonCode: 'root_physical_execution_budget_exhausted',
    physicalRunId: readRequiredString(record, 'physicalRunId'),
    progressRevision: readNonNegativeInteger(record, 'progressRevision'),
    progressSinceRunStart: readNonNegativeInteger(record, 'progressSinceRunStart'),
    budgetKind,
    observed: readNonNegativeInteger(record, 'observed'),
    limit: readNonNegativeInteger(record, 'limit'),
  }
}

function readRecoveryCheckpoint(value: unknown): AgentsChatTurnRecoveryCheckpoint | null {
  if (value === null || typeof value === 'undefined') return null
  const record = asRecord(value)
  if (!record) throw new Error('聊天回合恢复 checkpoint 无效')
  const reasonCode = readRequiredString(record, 'reasonCode')
  const physicalRunId = readRequiredString(record, 'physicalRunId')
  const progressRevision = readNonNegativeInteger(record, 'progressRevision')
  const userIntentContract = record.userIntentContract === null
    ? null
    : asRecord(record.userIntentContract)
  if (record.userIntentContract !== null && !userIntentContract) {
    throw new Error('聊天回合恢复 checkpoint userIntentContract 无效')
  }
  const readRecordArray = (key: 'durableTaskReferences' | 'durableProgressClaims') => {
    const candidate = record[key]
    if (typeof candidate === 'undefined') return undefined
    if (!Array.isArray(candidate)) throw new Error(`聊天回合恢复 checkpoint ${key} 无效`)
    return candidate.map((item) => {
      const parsed = asRecord(item)
      if (!parsed) throw new Error(`聊天回合恢复 checkpoint ${key} 无效`)
      return parsed
    })
  }
  const durableTaskReferences = readRecordArray('durableTaskReferences')
  const durableProgressClaims = readRecordArray('durableProgressClaims')
  return {
    reasonCode,
    physicalRunId,
    progressRevision,
    ...(durableTaskReferences ? { durableTaskReferences } : {}),
    ...(durableProgressClaims ? { durableProgressClaims } : {}),
    userIntentContract,
  }
}

function readAttentionProjection(value: unknown): AgentsChatAttentionProjection | null {
  if (value === null || typeof value === 'undefined') return null
  const record = asRecord(value)
  if (!record || record.version !== 1) throw new Error('聊天回合 attentionProjection 无效')
  const statuses: AgentsChatAttentionProjection['status'][] = ['run_now', 'wait', 'user_action_required', 'repair', 'replan', 'terminal']
  if (typeof record.status !== 'string' || !statuses.includes(record.status as AgentsChatAttentionProjection['status'])) {
    throw new Error('聊天回合 attentionProjection status 无效')
  }
  const sourceHeads = asRecord(record.sourceHeads)
  if (!sourceHeads) throw new Error('聊天回合 attentionProjection sourceHeads 无效')
  const readRevision = (candidate: unknown): number | null => {
    if (candidate === null) return null
    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 0) {
      throw new Error('聊天回合 attentionProjection revision 无效')
    }
    return candidate
  }
  return {
    version: 1,
    logicalTaskId: readRequiredString(record, 'logicalTaskId'),
    status: record.status as AgentsChatAttentionProjection['status'],
    waitingOn: readNullableString(record.waitingOn),
    obligation: readRequiredString(record, 'obligation'),
    sourceHeads: {
      graphRevision: readRevision(sourceHeads.graphRevision),
      evidenceRevision: readRevision(sourceHeads.evidenceRevision),
      physicalRunId: readNullableString(sourceHeads.physicalRunId),
    },
  }
}

function readPendingUserInput(value: unknown): AgentsChatPendingUserInput | null {
  const record = asRecord(value)
  if (!record || record.status !== 'needs_input') return null
  const requestId = readNullableString(record.requestId)
  if (!requestId || !Array.isArray(record.questions)) return null
  const questions = record.questions.map((item) => {
    const question = asRecord(item)
    if (!question) throw new Error('聊天回合 pendingUserInput 问题无效')
    const id = readRequiredString(question, 'id')
    const header = readRequiredString(question, 'header')
    const text = readRequiredString(question, 'question')
    if (!Array.isArray(question.options)) throw new Error('聊天回合 pendingUserInput 选项无效')
    const options = question.options.map((item) => {
      const option = asRecord(item)
      if (!option) throw new Error('聊天回合 pendingUserInput 选项无效')
      return {
        label: readRequiredString(option, 'label'),
        ...(readNullableString(option.description) ? { description: readNullableString(option.description)! } : {}),
        ...(readNullableString(option.imageUrl) ? { imageUrl: readNullableString(option.imageUrl)! } : {}),
        ...(readNullableString(option.thumbnailUrl) ? { thumbnailUrl: readNullableString(option.thumbnailUrl)! } : {}),
      }
    })
    return { id, header, question: text, options }
  })
  return { status: 'needs_input', requestId, questions }
}

export function readAgentsChatTurnIdHeader(headers: Pick<Headers, 'get'>): string {
  const turnId = String(headers.get('X-Trace-ID') || '').trim()
  if (!turnId) throw new Error('聊天流响应缺少稳定回合 ID（X-Trace-ID）')
  return turnId
}

export function parseAgentsChatTurnStatusDto(
  payload: unknown,
  expectedSessionId: string,
): AgentsChatTurnStatusDto {
  const root = asRecord(payload)
  if (!root || root.durable !== true || typeof root.activeTurn !== 'boolean') {
    throw new Error('聊天回合状态响应缺少 durable 字段')
  }
  const sessionId = readRequiredString(root, 'sessionId')
  if (sessionId !== expectedSessionId) throw new Error('聊天回合状态 sessionId 不匹配')
  if (root.turn === null) {
    if (root.activeTurn) throw new Error('聊天回合状态 activeTurn 与 turn 不一致')
    return { sessionId, durable: true, activeTurn: false, turn: null }
  }
  const turn = asRecord(root.turn)
  if (!turn) throw new Error('聊天回合状态 turn 无效')
  const receivedState = readRequiredString(turn, 'state') as AgentsChatTurnPublicState
  const logicalTaskState = readLogicalTaskState(turn.logicalTaskState)
  const receivedPhase = readRequiredString(turn, 'phase') as AgentsChatTurnPhase
  if (!PUBLIC_STATES.has(receivedState)) throw new Error(`未知聊天回合状态：${receivedState}`)
  if (!TURN_PHASES.has(receivedPhase)) throw new Error(`未知聊天回合阶段：${receivedPhase}`)
  const terminalAuthority = turn.terminalAuthority === undefined || turn.terminalAuthority === null
    ? 'user_delivery'
    : turn.terminalAuthority === 'user_delivery' || turn.terminalAuthority === 'workflow_action'
      ? turn.terminalAuthority
      : null
  if (!terminalAuthority) throw new Error('聊天回合状态 terminalAuthority 无效')
  const terminalDelivery = readDurableTerminalDelivery(turn.terminalDelivery)
  // `state`, `terminalAuthority` and `terminalDelivery` remain observable
  // physical/delivery facts. They no longer arbitrate the user-level terminal:
  // every browser consumer receives the projection of logicalTaskState.
  const state = projectPublicTurnState(logicalTaskState.status)
  const phase = receivedPhase
  const turnId = readRequiredString(turn, 'turnId')
  if (logicalTaskState.logicalTaskId !== turnId) {
    throw new Error('聊天回合 logicalTaskState.logicalTaskId 不匹配')
  }
  if (root.activeTurn !== (logicalTaskState.physicalRunStatus === 'running')) {
    throw new Error('聊天回合 activeTurn 与 logicalTaskState.physicalRunStatus 不一致')
  }
  const pendingQueueCount = turn.pendingQueueCount
  if (
    typeof pendingQueueCount !== 'number'
    || !Number.isInteger(pendingQueueCount)
    || pendingQueueCount < 0
  ) {
    throw new Error('聊天回合状态 pendingQueueCount 无效')
  }
  const reasonCode = logicalTaskState.reasonCode
  const suspension = readPhysicalBudgetSuspension(turn.suspension)
  const recoveryCheckpoint = readRecoveryCheckpoint(turn.recoveryCheckpoint)
  const attentionProjection = readAttentionProjection(turn.attentionProjection)
  if (recoveryCheckpoint && recoveryCheckpoint.reasonCode !== reasonCode) {
    throw new Error('聊天回合恢复 checkpoint 与回合原因不一致')
  }
  if (reasonCode === 'root_physical_execution_budget_exhausted' && !suspension) {
    throw new Error('物理预算挂起缺少结构化证据')
  }
  if (reasonCode !== 'root_physical_execution_budget_exhausted' && suspension) {
    throw new Error('物理预算证据与回合原因不一致')
  }
  if (!Array.isArray(turn.recentEvents)) throw new Error('聊天回合状态 recentEvents 无效')
  const recentEvents = turn.recentEvents.map((item) => {
    const event = asRecord(item)
    if (!event) throw new Error('聊天回合事件无效')
    return {
      type: readRequiredString(event, 'type'),
      at: readRequiredString(event, 'at'),
      toolName: readNullableString(event.toolName),
      toolStatus: readNullableString(event.toolStatus),
    }
  })
  return {
    sessionId,
    durable: true,
    activeTurn: root.activeTurn,
    turn: {
      turnId,
      internalTurnId: readRequiredString(turn, 'internalTurnId'),
      state,
      logicalTaskState,
      phase,
      startedAt: readRequiredString(turn, 'startedAt'),
      updatedAt: readRequiredString(turn, 'updatedAt'),
      lastConfirmedAt: readRequiredString(turn, 'lastConfirmedAt'),
      requestText: typeof turn.requestText === 'string' ? turn.requestText : '',
      terminalAuthority,
      reasonCode,
      suspension,
      recoveryCheckpoint,
      attentionProjection,
      lastConfirmedSummary: readRequiredString(turn, 'lastConfirmedSummary'),
      finalResponse: readNullableString(turn.finalResponse),
      terminalDelivery,
      pendingUserInput: readPendingUserInput(turn.pendingUserInput),
      pendingQueueCount,
      videoProductionStart: readVideoProductionStart(turn.videoProductionStart),
      recentEvents,
    },
  }
}

export type AgentsChatInterruptOperationErrorDto = {
  code: string
  message: string
  details?: unknown
}

export type AgentsChatTurnInterruptReceiptDto = {
  ok: true
  interrupted: boolean
  fullyInterrupted: boolean
  sessionKey: string
  turnId: string
  localTransport:
    | { status: 'interrupted' | 'not_running' }
    | { status: 'failed'; error: AgentsChatInterruptOperationErrorDto }
  runtime:
    | { status: 'interrupted' | 'already_inactive'; turnId: string | null }
    | { status: 'unknown' | 'failed'; error: AgentsChatInterruptOperationErrorDto }
  continuations:
    | { status: 'cancelled' | 'none'; cancelledCount: number }
    | { status: 'failed'; cancelledCount: 0; error: AgentsChatInterruptOperationErrorDto }
  cancellationScope: 'physical_only' | 'logical_task'
  workflowExecutions:
    | { status: 'cancelled' | 'none'; matchedCount: number; cancelledCount: number; executionIds: string[]; fullyInterrupted: boolean }
    | { status: 'failed'; matchedCount: 0; cancelledCount: 0; executionIds: []; fullyInterrupted: false; error: AgentsChatInterruptOperationErrorDto }
  status: AgentsChatTurnStatusDto | null
}

function readInterruptOperationError(
  value: unknown,
  operationLabel: string,
): AgentsChatInterruptOperationErrorDto {
  const record = asRecord(value)
  if (!record) throw new Error(`${operationLabel}中断回执缺少错误事实`)
  const code = readRequiredString(record, 'code')
  const message = readRequiredString(record, 'message')
  return {
    code,
    message,
    ...('details' in record ? { details: record.details } : {}),
  }
}

function readLocalInterruptReceipt(value: unknown): AgentsChatTurnInterruptReceiptDto['localTransport'] {
  const record = asRecord(value)
  if (!record) throw new Error('本地 transport 中断回执无效')
  if (record.status === 'interrupted' || record.status === 'not_running') {
    return { status: record.status }
  }
  if (record.status === 'failed') {
    return {
      status: 'failed',
      error: readInterruptOperationError(record.error, '本地 transport'),
    }
  }
  throw new Error('本地 transport 中断状态无效')
}

function readRuntimeInterruptReceipt(value: unknown): AgentsChatTurnInterruptReceiptDto['runtime'] {
  const record = asRecord(value)
  if (!record) throw new Error('远端 runtime 中断回执无效')
  if (record.status === 'interrupted' || record.status === 'already_inactive') {
    if (!('turnId' in record)) throw new Error('远端 runtime 中断回执缺少 turnId')
    const turnId = readNullableString(record.turnId)
    if (record.turnId !== null && turnId === null) {
      throw new Error('远端 runtime 中断回执 turnId 无效')
    }
    return { status: record.status, turnId }
  }
  if (record.status === 'unknown' || record.status === 'failed') {
    return {
      status: record.status,
      error: readInterruptOperationError(record.error, '远端 runtime'),
    }
  }
  throw new Error('远端 runtime 中断状态无效')
}

function readContinuationInterruptReceipt(
  value: unknown,
): AgentsChatTurnInterruptReceiptDto['continuations'] {
  const record = asRecord(value)
  if (!record) throw new Error('续跑任务中断回执无效')
  const cancelledCount = record.cancelledCount
  if (
    typeof cancelledCount !== 'number'
    || !Number.isInteger(cancelledCount)
    || cancelledCount < 0
  ) {
    throw new Error('续跑任务中断数量无效')
  }
  if (record.status === 'cancelled') {
    if (cancelledCount === 0) throw new Error('续跑任务 cancelled 状态缺少已取消任务')
    return { status: 'cancelled', cancelledCount }
  }
  if (record.status === 'none') {
    if (cancelledCount !== 0) throw new Error('续跑任务 none 状态与取消数量不一致')
    return { status: 'none', cancelledCount: 0 }
  }
  if (record.status === 'failed') {
    if (cancelledCount !== 0) throw new Error('续跑任务 failed 状态不得声明取消成功')
    return {
      status: 'failed',
      cancelledCount: 0,
      error: readInterruptOperationError(record.error, '续跑任务'),
    }
  }
  throw new Error('续跑任务中断状态无效')
}

function readWorkflowInterruptReceipt(
  value: unknown,
): AgentsChatTurnInterruptReceiptDto['workflowExecutions'] {
  const record = asRecord(value)
  if (!record) throw new Error('工作流中断回执无效')
  const matchedCount = record.matchedCount
  const cancelledCount = record.cancelledCount
  const executionIds = Array.isArray(record.executionIds)
    ? record.executionIds.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean)
    : null
  if (
    typeof matchedCount !== 'number' || !Number.isInteger(matchedCount) || matchedCount < 0
    || typeof cancelledCount !== 'number' || !Number.isInteger(cancelledCount) || cancelledCount < 0
    || !executionIds || executionIds.length !== matchedCount
    || typeof record.fullyInterrupted !== 'boolean'
  ) throw new Error('工作流中断数量或身份无效')
  if (record.status === 'cancelled' || record.status === 'none') {
    if (record.status === 'cancelled' && cancelledCount === 0) throw new Error('工作流 cancelled 状态缺少已取消执行')
    if (record.status === 'none' && cancelledCount !== 0) throw new Error('工作流 none 状态与取消数量不一致')
    return { status: record.status, matchedCount, cancelledCount, executionIds, fullyInterrupted: record.fullyInterrupted }
  }
  if (record.status === 'failed') {
    if (matchedCount !== 0 || cancelledCount !== 0 || executionIds.length !== 0 || record.fullyInterrupted !== false) {
      throw new Error('工作流 failed 状态不得声明取消成功')
    }
    return {
      status: 'failed', matchedCount: 0, cancelledCount: 0, executionIds: [], fullyInterrupted: false,
      error: readInterruptOperationError(record.error, '工作流'),
    }
  }
  throw new Error('工作流中断状态无效')
}

export function parseAgentsChatTurnInterruptReceiptDto(
  payload: unknown,
  expectedTurnId: string,
): AgentsChatTurnInterruptReceiptDto {
  const root = asRecord(payload)
  if (
    !root
    || root.ok !== true
    || typeof root.interrupted !== 'boolean'
    || typeof root.fullyInterrupted !== 'boolean'
  ) {
    throw new Error('中断聊天回合响应缺少组合结果字段')
  }
  const sessionKey = readRequiredString(root, 'sessionKey')
  const turnId = readRequiredString(root, 'turnId')
  if (turnId !== expectedTurnId) throw new Error('interrupt agents chat response turnId mismatch')
  const localTransport = readLocalInterruptReceipt(root.localTransport)
  const runtime = readRuntimeInterruptReceipt(root.runtime)
  const continuations = readContinuationInterruptReceipt(root.continuations)
  const cancellationScope = root.cancellationScope === 'logical_task' || root.cancellationScope === 'physical_only'
    ? root.cancellationScope
    : null
  if (!cancellationScope) throw new Error('中断聊天回合缺少 cancellationScope')
  const workflowExecutions = readWorkflowInterruptReceipt(root.workflowExecutions)
  const interrupted = localTransport.status === 'interrupted'
    || runtime.status === 'interrupted'
    || continuations.status === 'cancelled'
    || workflowExecutions.status === 'cancelled'
  if (root.interrupted !== interrupted) throw new Error('中断聊天回合 interrupted 与分路事实不一致')
  const fullyInterrupted = localTransport.status !== 'failed'
    && runtime.status !== 'failed'
    && runtime.status !== 'unknown'
    && continuations.status !== 'failed'
    && workflowExecutions.status !== 'failed'
    && workflowExecutions.fullyInterrupted
  if (root.fullyInterrupted !== fullyInterrupted) {
    throw new Error('中断聊天回合 fullyInterrupted 与分路事实不一致')
  }
  const status = root.status === null || typeof root.status === 'undefined'
    ? null
    : parseAgentsChatTurnStatusDto(root.status, sessionKey)
  return {
    ok: true,
    interrupted,
    fullyInterrupted,
    sessionKey,
    turnId,
    localTransport,
    runtime,
    continuations,
    cancellationScope,
    workflowExecutions,
    status,
  }
}

export type AgentsChatTurnResumeReceiptDto = {
  ok: true
  resumed: true
  sessionKey: string
  turnId: string
  continuationId: string
  stage: number
  resumeTrigger: 'physical_budget' | 'replan' | 'dependency'
  recoveryKind: 'physical_budget' | 'orphaned_checkpoint' | 'orphaned_continuation'
}
