import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Node } from '@xyflow/react'
import type {
  AgentExecutionProvenanceDto,
  AgentsChatAgentRoleStreamPayload,
  AgentsChatResponseDto,
  AgentsChatStreamEvent,
  AgentsChatTurnStatusDto,
  AgentsChatAttentionProjection,
  AgentsChatToolStreamPayload,
} from '../../api/server'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'
import { resolveChatTerminalProjection } from './replyDisposition'
import { resolvePresentedToolName } from './toolStepPresentation'

const MAX_LIVE_CHAT_LOGS = 120
const MAX_ASSISTANT_PREVIEW_CHARS = 4_000

type LiveChatRunStatus = 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled'

export type LiveChatAsyncArtifact = {
  toolCallId: string
  assetType: 'image' | 'video' | 'audio'
  nodeId: string
  taskId: string
  runId: string
  status: 'accepted' | 'queued' | 'running' | 'succeeded' | 'failed'
  failureReason: string
}

type LiveChatLifecycleEventName =
  | 'thread.started'
  | 'turn.started'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'turn.completed'

export type LiveChatTodoItem = {
  text: string
  completed: boolean
  status: 'pending' | 'in_progress' | 'completed'
}

export type LiveChatRoleActivity = {
  agentId: string
  role: string
  roleName: string
  description: string
  status: AgentsChatAgentRoleStreamPayload['status']
  progressSummary: string
  claimedTaskId: string
  at: number
}

export type LiveChatToolActivity = {
  toolCallId: string
  toolName: string
  transportToolName?: string
  phase: AgentsChatToolStreamPayload['phase']
  status: AgentsChatToolStreamPayload['status']
  severity: AgentsChatToolStreamPayload['severity']
  input?: unknown
  outputPreview?: string
  errorMessage?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
}

export type LiveChatLogEntry = {
  id: string
  event: string
  title: string
  detail: string
  at: number
  // blocked/failed/denied 工具的原因首行，直接贴在日志头部（不用展开 detail 才看到）。
  reason?: string
  tone?: 'error' | 'warn'
  roleActivity?: LiveChatRoleActivity
  toolActivity?: LiveChatToolActivity
}

export type LiveChatRunRecord = {
  runId: string
  status: LiveChatRunStatus
  requestText: string
  displayText: string
  projectId: string
  projectName: string
  flowId: string
  sessionKey: string
  skillName: string
  /** 仅由明确的结构化入口写入；不得从用户文案或工具名称推断。 */
  workflowKey?: string
  requestId: string
  sessionId: string
  userMessageId: string
  startedAt: number
  updatedAt: number
  finishedAt: number | null
  errorMessage: string
  doneReason: string
  assistantPreview: string
  assetCount: number
  todoItems: LiveChatTodoItem[]
  logs: LiveChatLogEntry[]
  executionProvenance: AgentExecutionProvenanceDto | null
  attentionProjection: AgentsChatAttentionProjection | null
  asyncArtifacts?: LiveChatAsyncArtifact[]
}

type StartLiveChatRunInput = {
  runId: string
  requestId: string
  requestText?: string
  displayText?: string
  projectId?: string
  projectName?: string
  flowId?: string
  sessionKey?: string
  skillName?: string
  workflowKey?: string
}

type LiveChatRunStore = {
  activeRun: LiveChatRunRecord | null
  startRun: (input: StartLiveChatRunInput) => void
  recordEvent: (event: AgentsChatStreamEvent) => void
  completeRun: (response: AgentsChatResponseDto, finalReplyText?: string) => void
  failRun: (message: string, expectedRequestId?: string) => void
  cancelRun: (message: string, expectedRequestId?: string) => void
  reconcileTurnStatus: (snapshot: AgentsChatTurnStatusDto) => void
  clearRun: () => void
  reconcileAsyncArtifacts: (nodes: readonly Node[]) => void
}

function readNodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
}

function hasMaterializedAsset(data: Record<string, unknown>, assetType: LiveChatAsyncArtifact['assetType']): boolean {
  const directKey = assetType === 'image' ? 'imageUrl' : assetType === 'video' ? 'videoUrl' : 'audioUrl'
  if (trimString(data[directKey])) return true
  const resultsKey = assetType === 'image' ? 'imageResults' : assetType === 'video' ? 'videoResults' : 'audioResults'
  return Array.isArray(data[resultsKey]) && data[resultsKey].some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    return Boolean(trimString((entry as Record<string, unknown>).url))
  })
}

function resolveArtifactNodeStatus(
  artifact: LiveChatAsyncArtifact,
  node: Node | undefined,
): Pick<LiveChatAsyncArtifact, 'status' | 'failureReason'> {
  if (!node) return { status: artifact.status, failureReason: artifact.failureReason }
  const data = readNodeData(node)
  if (hasMaterializedAsset(data, artifact.assetType)) return { status: 'succeeded', failureReason: '' }
  // A materialized asset is immutable delivery evidence. A late queued/running
  // canvas projection must not move the persisted chat indicator backwards.
  if (artifact.status === 'succeeded') return { status: 'succeeded', failureReason: '' }
  const status = trimString(data.status).toLowerCase()
  const failureReason = trimString(data.errorMessage) || trimString(data.error) || trimString(data.failureReason)
  if (status === 'error' || status === 'failed' || status === 'cancelled') {
    return { status: 'failed', failureReason: failureReason || '生成节点已失败' }
  }
  if (status === 'running') return { status: 'running', failureReason: '' }
  if (status === 'queued' || status === 'scheduled' || status === 'pending') {
    return { status: 'queued', failureReason: '' }
  }
  return { status: artifact.status, failureReason: artifact.failureReason }
}

function readAsyncArtifacts(response: AgentsChatResponseDto): LiveChatAsyncArtifact[] {
  const artifacts = response.trace?.deliveryEvidence?.artifacts ?? []
  const artifactByNode = new Map<string, LiveChatAsyncArtifact>()
  for (const artifact of artifacts) {
    // The durable canvas node owns post-submission materialization. Keeping this
    // receipt in the chat progress store would make a completed parent task look
    // active and keep the chat UI monitoring work that is visible on the canvas.
    if (artifact.completionBoundary === 'submission') continue
    const nodeId = trimString(artifact.nodeId)
    if (!nodeId) continue
    const key = `${artifact.assetType}:${nodeId}`
    const next: LiveChatAsyncArtifact = {
      toolCallId: trimString(artifact.toolCallId),
      assetType: artifact.assetType,
      nodeId,
      taskId: trimString(artifact.taskId),
      runId: trimString(artifact.runId),
      status: artifact.deliveryState === 'materialized' ? 'succeeded' : 'accepted',
      failureReason: '',
    }
    const current = artifactByNode.get(key)
    if (current?.status === 'succeeded' && next.status !== 'succeeded') continue
    artifactByNode.set(key, next)
  }
  return [...artifactByNode.values()]
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clipText(text: string, maxChars: number): string {
  // 头部优先 + 省略号：恢复投影展示的是「这条回复的开头」，而不是流中断时的
  // 尾巴（长回复开头丢失是恢复后的可见缺陷 #11）。
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

function summarizeUnknownRecord(value: object): string {
  const pairs = Object.entries(value)
    .map(([key, raw]) => {
      if (raw === null || typeof raw === 'undefined') return ''
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed ? `${key}: ${trimmed}` : ''
      }
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        return `${key}: ${String(raw)}`
      }
      if (Array.isArray(raw)) {
        return raw.length > 0 ? `${key}: [${raw.length}]` : ''
      }
      if (typeof raw === 'object') {
        return `${key}: {…}`
      }
      return ''
    })
    .filter(Boolean)
  return pairs.join('\n')
}

function summarizeLifecycleEvent(event: LiveChatLifecycleEventName, data: Record<string, unknown>): {
  title: string
  detail: string
} {
  switch (event) {
    case 'thread.started':
      return {
        title: 'thread started',
        detail: summarizeUnknownRecord(data),
      }
    case 'turn.started':
      return {
        title: 'turn started',
        detail: summarizeUnknownRecord(data),
      }
    case 'item.started':
      return {
        title: `item started ${trimString(data.itemType || data.type || '')}`.trim(),
        detail: summarizeUnknownRecord(data),
      }
    case 'item.updated':
      return {
        title: `item updated ${trimString(data.itemType || data.type || '')}`.trim(),
        detail: summarizeUnknownRecord(data),
      }
    case 'item.completed':
      return {
        title: `item completed ${trimString(data.itemType || data.type || '')}`.trim(),
        detail: summarizeUnknownRecord(data),
      }
    case 'turn.completed':
      return {
        title: 'turn completed',
        detail: summarizeUnknownRecord(data),
      }
  }
}

function firstLine(text: string, max = 160): string {
  const line = text.split('\n').map((s) => s.trim()).find(Boolean) || ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function summarizeToolEvent(data: AgentsChatToolStreamPayload): {
  title: string
  detail: string
  reason?: string
  tone?: 'error' | 'warn'
} {
  const toolName = resolvePresentedToolName(data.toolName, data.input)
  const phase = trimString(data.phase) || 'event'
  const status = trimString(data.status)
  const severity = trimString(data.severity)
  const outputPreview = trimString(data.outputPreview)
  const errorMessage = trimString(data.errorMessage)
  const detailParts = [
    status ? `status: ${severity === 'warning' ? 'warning' : status}` : '',
    typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? `durationMs: ${data.durationMs}` : '',
    outputPreview,
    errorMessage,
  ].filter(Boolean)
  // blocked/failed/denied：把原因首行抽到日志头部直接贴出来，红/黄标识。
  const isWarning = severity === 'warning'
  const isFail = !isWarning && (status === 'failed' || status === 'denied' || status === 'blocked')
  const reasonText = isWarning || isFail ? firstLine(errorMessage || outputPreview) : ''
  return {
    title: `${toolName} ${phase}`.trim(),
    detail: detailParts.join('\n'),
    ...(reasonText ? { reason: reasonText } : {}),
    ...((isWarning || isFail)
      ? { tone: isWarning || status === 'blocked' ? ('warn' as const) : ('error' as const) }
      : {}),
  }
}

function summarizeTodoItems(items: LiveChatTodoItem[]): string {
  if (!items.length) return ''
  return items
    .slice(0, 8)
    .map((item) => `[${item.status}] ${item.text}`)
    .join('\n')
}

function normalizeTodoItems(input: unknown): LiveChatTodoItem[] {
  if (!Array.isArray(input)) return []
  const items: LiveChatTodoItem[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const text = trimString(record.text)
    if (!text) continue
    const statusRaw = trimString(record.status)
    const status: LiveChatTodoItem['status'] =
      statusRaw === 'completed' || statusRaw === 'in_progress' || statusRaw === 'pending'
        ? statusRaw
        : record.completed === true
          ? 'completed'
          : 'pending'
    items.push({
      text,
      completed: record.completed === true || status === 'completed',
      status,
    })
    if (items.length >= 20) break
  }
  return items
}

function buildLogEntry(
  event: string,
  title: string,
  detail: string,
  extra?: {
    reason?: string
    tone?: 'error' | 'warn'
    roleActivity?: LiveChatRoleActivity
    toolActivity?: LiveChatToolActivity
  },
): LiveChatLogEntry {
  const now = Date.now()
  return {
    id: `${event}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    title: title || event,
    detail,
    at: now,
    ...(extra?.reason ? { reason: extra.reason } : {}),
    ...(extra?.tone ? { tone: extra.tone } : {}),
    ...(extra?.roleActivity ? { roleActivity: extra.roleActivity } : {}),
    ...(extra?.toolActivity ? { toolActivity: extra.toolActivity } : {}),
  }
}

function pushLog(logs: LiveChatLogEntry[], next: LiveChatLogEntry): LiveChatLogEntry[] {
  const merged = [...logs, next]
  if (merged.length <= MAX_LIVE_CHAT_LOGS) return merged
  return merged.slice(merged.length - MAX_LIVE_CHAT_LOGS)
}

function readResponseAssetCount(response: AgentsChatResponseDto): number {
  return Array.isArray(response.assets) ? response.assets.length : 0
}

export const useLiveChatRunStore = create<LiveChatRunStore>()(persist((set) => ({
  activeRun: null,
  startRun: (input) => {
    const startedAt = Date.now()
    set({
      activeRun: {
        runId: trimString(input.runId) || `live-chat-${startedAt}`,
        status: 'active',
        requestText: trimString(input.requestText),
        displayText: trimString(input.displayText),
        projectId: trimString(input.projectId),
        projectName: trimString(input.projectName),
        flowId: trimString(input.flowId),
        sessionKey: trimString(input.sessionKey),
        skillName: trimString(input.skillName),
        ...(trimString(input.workflowKey) ? { workflowKey: trimString(input.workflowKey) } : {}),
        requestId: trimString(input.requestId),
        sessionId: '',
        userMessageId: '',
        startedAt,
        updatedAt: startedAt,
        finishedAt: null,
        errorMessage: '',
        doneReason: '',
        assistantPreview: '',
        assetCount: 0,
        todoItems: [],
        executionProvenance: null,
        attentionProjection: null,
        asyncArtifacts: [],
        logs: [
          buildLogEntry(
            'run.started',
            'chat started',
            [trimString(input.displayText) || trimString(input.requestText), trimString(input.projectName), trimString(input.skillName)]
              .filter(Boolean)
              .join('\n'),
          ),
        ],
      },
    })
  },
  recordEvent: (event) =>
    set((state) => {
      const run = state.activeRun
      if (!run) return state
      const updatedAt = Date.now()

      if (event.event === 'initial') {
        return {
          activeRun: {
            ...run,
            requestId: trimString(event.data.requestId),
            userMessageId: trimString(event.data.messageId),
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry('initial', 'request accepted', summarizeUnknownRecord(event.data as Record<string, unknown>)),
            ),
          },
        }
      }

      if (event.event === 'session') {
        return {
          activeRun: {
            ...run,
            sessionId: trimString(event.data.sessionId),
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry('session', 'session assigned', summarizeUnknownRecord(event.data as Record<string, unknown>)),
            ),
          },
        }
      }

      if (event.event === 'thinking') {
        const text = trimString(event.data.text)
        if (!text) {
          return { activeRun: { ...run, updatedAt } }
        }
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(run.logs, buildLogEntry('thinking', 'thinking', text)),
          },
        }
      }

      if (event.event === 'tool') {
        const summary = summarizeToolEvent(event.data)
        const presentedToolName = resolvePresentedToolName(event.data.toolName, event.data.input)
        const toolActivity: LiveChatToolActivity = {
          toolCallId: trimString(event.data.toolCallId),
          toolName: presentedToolName,
          phase: event.data.phase,
          status: event.data.status,
          severity: event.data.severity,
          ...(trimString(event.data.transportToolName)
            ? { transportToolName: trimString(event.data.transportToolName) }
            : {}),
          ...(event.data.input !== undefined ? { input: event.data.input } : {}),
          ...(trimString(event.data.outputPreview) ? { outputPreview: trimString(event.data.outputPreview) } : {}),
          ...(trimString(event.data.errorMessage) ? { errorMessage: trimString(event.data.errorMessage) } : {}),
          startedAt: trimString(event.data.startedAt),
          ...(trimString(event.data.finishedAt) ? { finishedAt: trimString(event.data.finishedAt) } : {}),
          ...(typeof event.data.durationMs === 'number' && Number.isFinite(event.data.durationMs)
            ? { durationMs: Math.max(0, Math.trunc(event.data.durationMs)) }
            : {}),
        }
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry('tool', summary.title, summary.detail, {
                reason: summary.reason,
                tone: summary.tone,
                toolActivity,
              }),
            ),
          },
        }
      }

      if (event.event === 'agent_role') {
        const eventAt = Date.parse(trimString(event.data.at))
        const roleActivity: LiveChatRoleActivity = {
          agentId: trimString(event.data.agentId),
          role: trimString(event.data.role),
          roleName: trimString(event.data.roleName),
          description: trimString(event.data.description),
          status: event.data.status,
          progressSummary: trimString(event.data.progressSummary),
          claimedTaskId: trimString(event.data.claimedTaskId),
          at: Number.isFinite(eventAt) ? eventAt : updatedAt,
        }
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'agent_role',
                roleActivity.roleName || roleActivity.role || 'agent role',
                roleActivity.progressSummary || roleActivity.description || `status: ${roleActivity.status}`,
                { roleActivity },
              ),
            ),
          },
        }
      }

      if (event.event === 'todo_list') {
        const todoItems = normalizeTodoItems(event.data.items)
        return {
          activeRun: {
            ...run,
            updatedAt,
            todoItems,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'todo_list',
                `todo ${event.data.completedCount}/${event.data.totalCount}`,
                summarizeTodoItems(todoItems),
              ),
            ),
          },
        }
      }

      if (event.event === 'content') {
        const delta = typeof event.data.delta === 'string' ? event.data.delta : ''
        const assistantPreview = clipText(`${run.assistantPreview}${delta}`, MAX_ASSISTANT_PREVIEW_CHARS)
        return {
          activeRun: {
            ...run,
            updatedAt,
            assistantPreview,
          },
        }
      }

      if (event.event === 'status-update') {
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'status-update',
                event.data.phase === 'agent_continuation'
                  ? `model continuation ${event.data.llmTurn}`
                  : `model reasoning ${event.data.llmTurn}`,
                summarizeUnknownRecord(event.data),
              ),
            ),
          },
        }
      }

      if (event.event === 'artifact-update') {
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'artifact-update',
                event.data.artifact.name || event.data.artifact.artifactId,
                summarizeUnknownRecord(event.data),
              ),
            ),
          },
        }
      }

      if (
        event.event === 'thread.started' ||
        event.event === 'turn.started' ||
        event.event === 'item.started' ||
        event.event === 'item.updated' ||
        event.event === 'item.completed' ||
        event.event === 'turn.completed'
      ) {
        const summary = summarizeLifecycleEvent(event.event, event.data)
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(run.logs, buildLogEntry(event.event, summary.title, summary.detail)),
          },
        }
      }

      if (event.event === 'done') {
        return {
          activeRun: {
            ...run,
            updatedAt,
            doneReason: trimString(event.data.reason),
            logs: pushLog(
              run.logs,
              buildLogEntry('done', `stream done ${trimString(event.data.reason) || 'finished'}`.trim(), ''),
            ),
          },
        }
      }

      if (event.event === 'error') {
        const message = formatAgentsStreamErrorMessage(event.data)
        return {
          activeRun: {
            ...run,
            status: event.data.terminal ? 'failed' : 'active',
            updatedAt,
            finishedAt: event.data.terminal ? updatedAt : null,
            errorMessage: event.data.terminal ? message : '',
            logs: pushLog(run.logs, buildLogEntry('error', 'stream error', message)),
          },
        }
      }

      if (event.event === 'result') {
        return {
          activeRun: {
            ...run,
            updatedAt,
            assistantPreview: clipText(
              trimString(event.data.response?.text) || run.assistantPreview,
              MAX_ASSISTANT_PREVIEW_CHARS,
            ),
            assetCount: readResponseAssetCount(event.data.response),
            executionProvenance: event.data.response.trace?.executionProvenance ?? run.executionProvenance,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'result',
                'result received',
                `assets: ${readResponseAssetCount(event.data.response)}`,
              ),
            ),
          },
        }
      }

      return { activeRun: { ...run, updatedAt } }
    }),
  completeRun: (response, finalReplyText) =>
    set((state) => {
      const run = state.activeRun
      if (!run) return state
      const finishedAt = Date.now()
      const previewSource = trimString(finalReplyText) || trimString(response.text) || run.assistantPreview
      const terminalProjection = resolveChatTerminalProjection(response)
      const terminalStatus: LiveChatRunStatus = terminalProjection.reason === 'chat_turn_user_interrupt'
        ? 'cancelled'
        : terminalProjection.status
      const terminalReason = terminalProjection.reason === 'chat_turn_user_interrupt'
        ? 'chat_turn_user_interrupt'
        : terminalProjection.reason
      const logicalTerminal = terminalStatus === 'succeeded' || terminalStatus === 'failed' || terminalStatus === 'cancelled'
      return {
        activeRun: {
          ...run,
          status: terminalStatus,
          updatedAt: finishedAt,
          finishedAt: logicalTerminal ? finishedAt : null,
          errorMessage: terminalStatus === 'failed' ? terminalReason : '',
          assistantPreview: clipText(previewSource, MAX_ASSISTANT_PREVIEW_CHARS),
          assetCount: readResponseAssetCount(response),
          executionProvenance: response.trace?.executionProvenance ?? run.executionProvenance,
          asyncArtifacts: readAsyncArtifacts(response),
          logs: pushLog(
            run.logs,
            buildLogEntry(
              terminalStatus === 'failed' ? 'run.failed' : terminalStatus === 'cancelled' ? 'run.cancelled' : terminalStatus === 'active' || terminalStatus === 'waiting_external' ? 'run.handed_off' : 'run.completed',
              terminalStatus === 'failed'
                ? 'chat failed'
                : terminalStatus === 'cancelled'
                  ? 'chat cancelled'
                : terminalStatus === 'waiting_input'
                  ? 'chat needs input'
                  : terminalStatus === 'active' || terminalStatus === 'waiting_external'
                    ? 'logical task is continuing outside this physical run'
                  : 'chat completed',
              `terminal: ${terminalStatus}\nreason: ${terminalReason}\nassets: ${readResponseAssetCount(response)}\noutputMode: ${trimString(response.trace?.outputMode)}`,
            ),
          ),
        },
      }
    }),
  failRun: (message, expectedRequestId) =>
    set((state) => {
      const run = state.activeRun
      if (!run) return state
      const normalizedExpectedRequestId = trimString(expectedRequestId)
      if (normalizedExpectedRequestId && run.requestId !== normalizedExpectedRequestId) return state
      if (run.status !== 'active') return state
      const finishedAt = Date.now()
      const normalized = trimString(message) || '对话失败'
      return {
        activeRun: {
          ...run,
          status: 'failed',
          updatedAt: finishedAt,
          finishedAt,
          errorMessage: normalized,
          logs: pushLog(run.logs, buildLogEntry('run.failed', 'chat failed', normalized)),
        },
      }
    }),
  cancelRun: (message, expectedRequestId) =>
    set((state) => {
      const run = state.activeRun
      if (!run) return state
      const normalizedExpectedRequestId = trimString(expectedRequestId)
      if (normalizedExpectedRequestId && run.requestId !== normalizedExpectedRequestId) return state
      if (run.status !== 'active') return state
      const finishedAt = Date.now()
      const normalized = trimString(message) || '本次对话已中断'
      return {
        activeRun: {
          ...run,
          status: 'cancelled',
          updatedAt: finishedAt,
          finishedAt,
          errorMessage: '',
          doneReason: 'chat_turn_user_interrupt',
          logs: pushLog(run.logs, buildLogEntry('run.cancelled', 'chat cancelled', normalized)),
        },
      }
    }),
  reconcileTurnStatus: (snapshot) =>
    set((state) => {
      const run = state.activeRun
      const turn = snapshot.turn
      if (!run || !turn) return state
      if (run.sessionKey !== snapshot.sessionId || run.requestId !== turn.turnId) return state
      const attentionProjection = turn.attentionProjection ?? null
      if (turn.logicalTaskState.physicalRunStatus === 'running') {
        // activeTurn is the authoritative fact for this exact public request.
        // A crashed physical window may first be persisted as failed/unknown
        // and then reclaimed through its server-owned continuation. Preserve
        // the original logical-task startedAt while reopening that same run.
        if (run.status === 'active' || run.status === 'cancelled') return state
        const resumedAtCandidate = Date.parse(turn.updatedAt)
        const resumedAt = Number.isFinite(resumedAtCandidate) ? resumedAtCandidate : Date.now()
        return {
          activeRun: {
            ...run,
            status: 'active',
            updatedAt: resumedAt,
            finishedAt: null,
            doneReason: '',
            errorMessage: '',
            attentionProjection,
            logs: pushLog(
              run.logs,
              buildLogEntry(
                'run.resumed',
                'physical execution continued',
                `turn: ${turn.internalTurnId}\nsummary: ${trimString(turn.lastConfirmedSummary) || '同一逻辑任务已进入新的物理执行窗口'}`,
              ),
            ),
          },
        }
      }
      if (turn.reasonCode === 'chat_turn_user_interrupt' && run.status !== 'cancelled') {
        const finishedAtCandidate = Date.parse(turn.updatedAt)
        const finishedAt = Number.isFinite(finishedAtCandidate) ? finishedAtCandidate : Date.now()
        const summary = trimString(turn.lastConfirmedSummary) || '本次对话已中断'
        return {
          activeRun: {
            ...run,
            status: 'cancelled',
            updatedAt: finishedAt,
            finishedAt,
            doneReason: 'chat_turn_user_interrupt',
            errorMessage: '',
            attentionProjection,
            logs: pushLog(run.logs, buildLogEntry('run.cancelled', 'chat cancelled', summary)),
          },
        }
      }
      // waiting_external / waiting_input are logical nonterminal states. The
      // same durable public turn may later settle without opening a new local
      // run, so its authoritative terminal snapshot must still be applied.
      // Already terminal local records remain immutable here; a resumed
      // physical execution is handled by the running branch above.
      if (
        run.status !== 'active'
        && run.status !== 'waiting_external'
        && run.status !== 'waiting_input'
      ) return state
      const terminalStatus: LiveChatRunStatus = turn.logicalTaskState.status
      if (terminalStatus === 'active') return state
      if (
        run.status === terminalStatus
        && run.doneReason === turn.logicalTaskState.reasonCode
      ) return state
      const finishedAtCandidate = Date.parse(turn.updatedAt)
      const finishedAt = Number.isFinite(finishedAtCandidate) ? finishedAtCandidate : Date.now()
      const summary = trimString(turn.lastConfirmedSummary)
        || trimString(turn.reasonCode)
        || '当前回合已结束'
      const event = terminalStatus === 'failed'
        ? 'run.failed'
        : terminalStatus === 'cancelled'
          ? 'run.cancelled'
        : terminalStatus === 'waiting_external'
          ? 'run.waiting_external'
          : 'run.completed'
      const title = terminalStatus === 'failed'
        ? 'chat failed'
        : terminalStatus === 'cancelled'
          ? 'chat cancelled'
        : terminalStatus === 'waiting_input'
          ? 'chat needs input'
          : terminalStatus === 'waiting_external'
            ? 'logical task is waiting for external evidence'
            : 'chat completed'
      return {
        activeRun: {
          ...run,
          status: terminalStatus,
          updatedAt: finishedAt,
          finishedAt: terminalStatus === 'succeeded' || terminalStatus === 'failed' || terminalStatus === 'cancelled'
            ? finishedAt
            : null,
          doneReason: turn.logicalTaskState.reasonCode,
          errorMessage: terminalStatus === 'failed' ? summary : '',
          attentionProjection,
          logs: pushLog(
            run.logs,
            buildLogEntry(
              event,
              title,
              `logicalTaskStatus: ${terminalStatus}\nreason: ${turn.logicalTaskState.reasonCode}\nsummary: ${summary}`,
            ),
          ),
        },
      }
    }),
  clearRun: () => set({ activeRun: null }),
  reconcileAsyncArtifacts: (nodes) =>
    set((state) => {
      const run = state.activeRun
      const currentArtifacts = run?.asyncArtifacts ?? []
      if (!run || currentArtifacts.length === 0) return state
      const nodeById = new Map(nodes.map((node) => [String(node.id), node]))
      let changed = false
      const asyncArtifacts = currentArtifacts.map((artifact) => {
        const next = resolveArtifactNodeStatus(artifact, nodeById.get(artifact.nodeId))
        if (next.status === artifact.status && next.failureReason === artifact.failureReason) return artifact
        changed = true
        return { ...artifact, ...next }
      })
      if (!changed) return state
      return { activeRun: { ...run, asyncArtifacts, updatedAt: Date.now() } }
    }),
}), {
  name: 'tapcanvas-live-chat-run-v2',
  partialize: (state) => ({ activeRun: state.activeRun }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<LiveChatRunStore>
    const activeRun = saved.activeRun
      ? { ...saved.activeRun, asyncArtifacts: saved.activeRun.asyncArtifacts ?? [] }
      : null
    return { ...current, activeRun }
  },
}))
