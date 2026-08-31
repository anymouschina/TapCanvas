import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import {
  agentsChatStream,
  getAgentsChatTurnStatus,
  resumeAgentsChatTurn,
  type AgentsChatRequestDto,
  type AgentsChatStreamEvent,
  type AgentsChatToolStreamPayload,
} from '../api/server'

export type PendingUserInputRequest = {
  requestId: string
  questions: Array<{
    id: string
    header: string
    question: string
    options: Array<{ label: string; description?: string; preview?: string }>
    multiSelect?: boolean
  }>
}

export type StreamChapterIntentParams = {
  executionId: string
  intent: ChapterCanvasIntent
  sourceNodeId: string
  chapterContext: {
    projectId: string
    bookId: string | null
    chapterId: string
    flowSnapshot: {
      nodes: Array<{
        id: string
        kind: string
        preset?: string
        data: Record<string, unknown>
      }>
      edges: Array<{
        id: string
        source: string
        target: string
        sourceHandle?: string
        targetHandle?: string
      }>
    }
  }
  userHints?: string
  generationConfig?: {
    imageModel?: string
    imageSize?: string
  }
  variantParams?: Record<string, unknown>
  styleGuide?: { styleName?: string; referenceImages?: string[] }
  abortSignal: AbortSignal
  onTool: (tool: AgentsChatToolStreamPayload) => void
  onTerminal: (terminal: ChapterIntentTerminal) => void
  onError: (err: { message: string; code?: string }) => void
  onProgress?: (payload: IntentStreamProgress) => void
  onDone?: (info: { reason?: string }) => void
  onWorkflowChanged?: (workflow: string) => void
  onPendingUserInput?: (req: PendingUserInputRequest) => void
  requestUserInputResponse?: {
    requestId: string
    answers: Array<{ id: string; value: string; optionLabel: string; optionIndex: number }>
  }
}

export type ChapterIntentTerminal = {
  status: 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled'
  reason: string
  text: string
}

type ChapterIntentChatRequest = AgentsChatRequestDto & {
  intent: ChapterCanvasIntent
  chapterIntentSourceNodeId: string
  chapterContext: StreamChapterIntentParams['chapterContext']
  chapterIntentGenerationConfig?: StreamChapterIntentParams['generationConfig']
  chapterIntentVariantParams?: Record<string, unknown>
  chapterIntentStyleGuide?: StreamChapterIntentParams['styleGuide']
}

export type IntentStreamProgress =
  | { kind: 'tool_calls_so_far'; count: number }
  | {
      kind: 'stage'
      stage: 'waiting_upstream' | 'tool_completed'
      bufferedToolCalls: number
      toolName?: string
      upstreamErrors?: number
    }

export function buildChapterIntentSessionKey(params: StreamChapterIntentParams): string {
  const executionId = String(params.executionId || '').trim()
  const projectId = String(params.chapterContext.projectId || '').trim()
  const chapterId = String(params.chapterContext.chapterId || '').trim()
  if (!executionId || !projectId || !chapterId) {
    throw new Error('章节画布 Agent 执行缺少 executionId、projectId 或 chapterId')
  }
  return `chapter-intent:${projectId}:${chapterId}:${executionId}`
}

function waitForAbortableDelay(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitForChapterIntentTerminal(
  params: StreamChapterIntentParams,
  sessionKey: string,
): Promise<void> {
  const deadline = Date.now() + 45 * 60_000
  let lastResumeFingerprint = ''
  while (!params.abortSignal.aborted && Date.now() < deadline) {
    await waitForAbortableDelay(params.abortSignal, 2_000)
    if (params.abortSignal.aborted) return
    const snapshot = await getAgentsChatTurnStatus({ sessionKey })
    const turn = snapshot.turn
    if (!turn) continue
    if (turn.logicalTaskState.status === 'succeeded') {
      params.onTerminal({
        status: 'succeeded',
        reason: turn.reasonCode || 'logical_succeeded',
        text: String(turn.finalResponse || turn.lastConfirmedSummary || '').trim(),
      })
      return
    }
    if (turn.logicalTaskState.status === 'waiting_input') {
      if (turn.pendingUserInput) params.onPendingUserInput?.(turn.pendingUserInput)
      params.onTerminal({
        status: 'waiting_input',
        reason: turn.reasonCode || 'request_user_input_pending',
        text: String(turn.finalResponse || turn.lastConfirmedSummary || '').trim(),
      })
      return
    }
    if (turn.logicalTaskState.status === 'cancelled') {
      params.onTerminal({
        status: 'failed',
        reason: turn.reasonCode || 'chat_turn_cancelled',
        text: String(turn.lastConfirmedSummary || '').trim(),
      })
      return
    }
    const checkpoint = turn.recoveryCheckpoint
    if (
      !snapshot.activeTurn
      && checkpoint
      && (turn.logicalTaskState.status === 'active'
        || turn.logicalTaskState.status === 'waiting_external')
    ) {
      const fingerprint = `${turn.turnId}:${checkpoint.physicalRunId}:${checkpoint.progressRevision}`
      if (fingerprint !== lastResumeFingerprint) {
        lastResumeFingerprint = fingerprint
        try {
          await resumeAgentsChatTurn({ sessionKey, turnId: turn.turnId })
        } catch (error: unknown) {
          console.warn('[streamChapterIntent] durable resume not claimed', {
            sessionKey,
            turnId: turn.turnId,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      continue
    }
    if (turn.logicalTaskState.status === 'failed') {
      params.onTerminal({
        status: 'failed',
        reason: turn.reasonCode || 'logical_failed',
        text: String(turn.finalResponse || turn.lastConfirmedSummary || '').trim(),
      })
      return
    }
  }
  if (!params.abortSignal.aborted) {
    params.onError({
      code: 'chapter_intent_terminal_wait_timeout',
      message: '章节画布 Agent 在 45 分钟内没有形成可验证终态',
    })
  }
}

/**
 * Intent planning only needs the selected source node in full. The remaining
 * canvas is an addressable structural index; node details are read through
 * canvas tools when the agent actually needs them.
 */
function compactIntentChapterContext(
  context: StreamChapterIntentParams['chapterContext'],
  sourceNodeId: string,
): StreamChapterIntentParams['chapterContext'] {
  const structuralKeys = [
    'label',
    'kind',
    'status',
    'productionLayer',
    'creationStage',
    'preset',
    'taskId',
    'clipIndex',
  ] as const
  return {
    ...context,
    flowSnapshot: {
      nodes: context.flowSnapshot.nodes.map((node) => {
        if (node.id === sourceNodeId) return node
        const compactData: Record<string, unknown> = {}
        for (const key of structuralKeys) {
          const value = node.data[key]
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            compactData[key] = value
          }
        }
        return {
          ...node,
          data: compactData,
        }
      }),
      edges: context.flowSnapshot.edges,
    },
  }
}

export function buildChapterIntentChatRequest(params: StreamChapterIntentParams): {
  sessionKey: string
  body: ChapterIntentChatRequest
} {
  const sessionKey = buildChapterIntentSessionKey(params)
  const body: ChapterIntentChatRequest = {
    sessionKey,
    clientPendingId: params.executionId,
    canvasProjectId: params.chapterContext.projectId,
    canvasNodeId: params.sourceNodeId,
    ...(params.chapterContext.bookId ? { bookId: params.chapterContext.bookId } : null),
    chapterId: params.chapterContext.chapterId,
    intent: params.intent,
    chapterIntentSourceNodeId: params.sourceNodeId,
    chapterContext: compactIntentChapterContext(params.chapterContext, params.sourceNodeId),
    ...(params.generationConfig ? { chapterIntentGenerationConfig: params.generationConfig } : null),
    ...(params.variantParams ? { chapterIntentVariantParams: params.variantParams } : null),
    ...(params.styleGuide ? { chapterIntentStyleGuide: params.styleGuide } : null),
    ...(params.userHints ? { prompt: params.userHints } : { prompt: '.' }),
    ...(params.requestUserInputResponse ? { requestUserInputResponse: params.requestUserInputResponse } : null),
  }
  return {
    sessionKey,
    body,
  }
}

function projectChapterIntentEvent(
  event: AgentsChatStreamEvent,
  params: StreamChapterIntentParams,
): 'continue' | 'terminal' {
  if (event.event === 'tool' || event.event === 'result' || event.event === 'done') {
    handleChapterIntentStreamEvent(event.event, JSON.stringify(event.data), params)
  }
  if (event.event === 'error') {
    if (event.data.terminal) {
      params.onTerminal({
        status: 'failed',
        reason: String(event.data.code || 'logical_failed').trim() || 'logical_failed',
        text: event.data.message,
      })
      return 'terminal'
    }
    params.onProgress?.({
      kind: 'stage',
      stage: 'waiting_upstream',
      bufferedToolCalls: 0,
      upstreamErrors: 1,
    })
    return 'continue'
  }
  if (event.event === 'result') return 'terminal'
  if (event.event === 'done') {
    if (event.data.reason === 'physical_suspended' || event.data.reason === 'needs_input') {
      params.onTerminal({
        status: event.data.reason === 'needs_input' ? 'waiting_input' : 'active',
        reason: event.data.reason,
        text: '',
      })
    } else {
      params.onError({
        code: 'chapter_intent_request_terminal_missing',
        message: `章节画布 Agent ${event.data.reason} 但没有返回结构化 logicalTaskState`,
      })
    }
    return 'terminal'
  }
  return 'continue'
}

export async function streamChapterIntent(
  params: StreamChapterIntentParams,
): Promise<void> {
  if (params.abortSignal.aborted) return
  const request = buildChapterIntentChatRequest(params)
  const sessionKey = request.sessionKey
  let latestTerminalStatus: ChapterIntentTerminal['status'] | null = null
  const eventParams: StreamChapterIntentParams = {
    ...params,
    onTerminal: (terminal) => {
      latestTerminalStatus = terminal.status
      params.onTerminal(terminal)
    },
  }
  await new Promise<void>((resolve) => {
    let finished = false
    let finishRequested = false
    let accepted = false
    let stopStream: (() => void) | null = null
    const finish = () => {
      if (finished) return
      finished = true
      stopStream?.()
      resolve()
    }
    const requestFinish = () => {
      finishRequested = true
      if (stopStream) finish()
    }
    void agentsChatStream(request.body, {
      signal: params.abortSignal,
      onOpen: () => {
        accepted = true
      },
      onEvent: (event) => {
        if (projectChapterIntentEvent(event, eventParams) === 'terminal') requestFinish()
      },
      onError: (error) => {
        if (accepted) {
          eventParams.onTerminal({
            status: 'active',
            reason: 'chapter_intent_transport_reconcile',
            text: '',
          })
        } else if (!params.abortSignal.aborted) {
          eventParams.onError({
            code: 'chapter_intent_admission_failed',
            message: error.message || '章节画布 Agent 受理失败',
          })
        }
        requestFinish()
      },
    }).then((stop) => {
      stopStream = stop
      if (finishRequested || params.abortSignal.aborted) finish()
    }).catch((error: unknown) => {
      if (!params.abortSignal.aborted) {
        eventParams.onError({
          code: 'chapter_intent_admission_failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
      finish()
    })
  })
  if (latestTerminalStatus === 'active' || latestTerminalStatus === 'waiting_external') {
    await waitForChapterIntentTerminal(eventParams, sessionKey)
  }
}

export function handleChapterIntentStreamEvent(
  eventName: string,
  payloadText: string,
  p: StreamChapterIntentParams,
): void {
  if (p.abortSignal.aborted) return
  const raw = String(payloadText || '').trim()
  if (!raw) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[streamChapterIntent] invalid JSON payload', raw.slice(0, 120))
    return
  }
  if (eventName === 'tool') {
    if (!isRecord(parsed)) return
    const toolName = typeof parsed.toolName === 'string' ? parsed.toolName.trim() : ''
    const toolCallId = typeof parsed.toolCallId === 'string' ? parsed.toolCallId.trim() : ''
    const phase = parsed.phase === 'started' || parsed.phase === 'completed' ? parsed.phase : null
    const startedAt = typeof parsed.startedAt === 'string' ? parsed.startedAt.trim() : ''
    if (!toolName || !toolCallId || !phase || !startedAt) return
    const status = parsed.status === 'succeeded' || parsed.status === 'failed' ||
      parsed.status === 'denied' || parsed.status === 'blocked'
      ? parsed.status
      : undefined
    p.onTool({
      toolCallId,
      toolName,
      phase,
      ...(status ? { status } : {}),
      ...(parsed.severity === 'warning' || parsed.severity === 'error'
        ? { severity: parsed.severity }
        : {}),
      ...(typeof parsed.transportToolName === 'string' && parsed.transportToolName.trim()
        ? { transportToolName: parsed.transportToolName.trim() }
        : {}),
      ...(typeof parsed.input === 'undefined' ? {} : { input: parsed.input }),
      ...(typeof parsed.outputPreview === 'string' ? { outputPreview: parsed.outputPreview } : {}),
      ...(typeof parsed.errorMessage === 'string' ? { errorMessage: parsed.errorMessage } : {}),
      startedAt,
      ...(typeof parsed.finishedAt === 'string' ? { finishedAt: parsed.finishedAt } : {}),
      ...(typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs)
        ? { durationMs: parsed.durationMs }
        : {}),
    })
    return
  }
  if (eventName === 'progress') {
    if (!p.onProgress || !isRecord(parsed)) return
    if (typeof parsed.toolCallsSoFar === 'number') {
      p.onProgress({ kind: 'tool_calls_so_far', count: parsed.toolCallsSoFar })
      return
    }
    if (
      (parsed.stage === 'waiting_upstream' || parsed.stage === 'tool_completed') &&
      typeof parsed.bufferedToolCalls === 'number'
    ) {
      p.onProgress({
        kind: 'stage',
        stage: parsed.stage,
        bufferedToolCalls: parsed.bufferedToolCalls,
        toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
        upstreamErrors:
          typeof parsed.upstreamErrors === 'number' ? parsed.upstreamErrors : undefined,
      })
    }
    return
  }
  if (eventName === 'error') {
    p.onError(parseErrorPayload(parsed))
    return
  }
  if (eventName === 'done') {
    p.onDone?.(isRecord(parsed) ? { reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } : {})
    return
  }
  if (eventName === 'workflow_changed') {
    if (isRecord(parsed) && typeof parsed.workflow === 'string' && p.onWorkflowChanged) {
      p.onWorkflowChanged(parsed.workflow)
    }
    return
  }
  if (eventName === 'result') {
    if (!isRecord(parsed)) {
      p.onError({ code: 'chapter_intent_result_invalid', message: '章节画布 Agent result 不是对象' })
      return
    }
    const response = parsed.response
    if (!isRecord(response)) {
      p.onError({ code: 'chapter_intent_result_invalid', message: '章节画布 Agent result 缺少 response' })
      return
    }
    const pendingUserInput = response.pendingUserInput
    if (pendingUserInput && p.onPendingUserInput) {
      p.onPendingUserInput(pendingUserInput as PendingUserInputRequest)
    }
    const trace = isRecord(response.trace) ? response.trace : null
    const logicalTaskState = isRecord(trace?.logicalTaskState) ? trace.logicalTaskState : null
    const status = logicalTaskState?.status
    if (
      status !== 'active' && status !== 'waiting_input' && status !== 'waiting_external' &&
      status !== 'succeeded' && status !== 'failed' && status !== 'cancelled'
    ) {
      p.onError({
        code: 'chapter_intent_logical_task_state_missing',
        message: '章节画布 Agent result 缺少结构化 logicalTaskState',
      })
      return
    }
    const terminalReason = logicalTaskState && typeof logicalTaskState.reasonCode === 'string'
      ? logicalTaskState.reasonCode.trim()
      : ''
    p.onTerminal({
      status,
      reason: terminalReason || status,
      text: typeof response.text === 'string' ? response.text.trim() : '',
    })
    return
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseErrorPayload(value: unknown): { message: string; code?: string } {
  if (!isRecord(value)) return { message: 'unknown error' }
  const message = typeof value.message === 'string' && value.message.trim() ? value.message : 'unknown error'
  const code = typeof value.code === 'string' && value.code.trim() ? value.code : undefined
  return { message, code }
}
