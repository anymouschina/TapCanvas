import { create } from 'zustand'
import type {
  AgentsChatResponseDto,
  AgentsChatStreamEvent,
  AgentsChatToolStreamPayload,
} from '../../api/server'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'

const MAX_LIVE_CHAT_LOGS = 120
const MAX_ASSISTANT_PREVIEW_CHARS = 4_000

type LiveChatRunStatus = 'running' | 'succeeded' | 'failed'

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

export type LiveChatLogEntry = {
  id: string
  event: string
  title: string
  detail: string
  at: number
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
}

type StartLiveChatRunInput = {
  runId: string
  requestText?: string
  displayText?: string
  projectId?: string
  projectName?: string
  flowId?: string
  sessionKey?: string
  skillName?: string
}

type LiveChatRunStore = {
  activeRun: LiveChatRunRecord | null
  startRun: (input: StartLiveChatRunInput) => void
  recordEvent: (event: AgentsChatStreamEvent) => void
  completeRun: (response: AgentsChatResponseDto, finalReplyText?: string) => void
  failRun: (message: string) => void
  clearRun: () => void
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

function summarizeUnknownRecord(value: Record<string, unknown>): string {
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

function summarizeToolEvent(data: AgentsChatToolStreamPayload): { title: string; detail: string } {
  const toolName = trimString(data.toolName) || 'tool'
  const phase = trimString(data.phase) || 'event'
  const status = trimString(data.status)
  const detailParts = [
    status ? `status: ${status}` : '',
    typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? `durationMs: ${data.durationMs}` : '',
    trimString(data.outputPreview),
    trimString(data.errorMessage),
  ].filter(Boolean)
  return {
    title: `${toolName} ${phase}`.trim(),
    detail: detailParts.join('\n'),
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

function buildLogEntry(event: string, title: string, detail: string): LiveChatLogEntry {
  const now = Date.now()
  return {
    id: `${event}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    title: title || event,
    detail,
    at: now,
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

export const useLiveChatRunStore = create<LiveChatRunStore>((set) => ({
  activeRun: null,
  startRun: (input) => {
    const startedAt = Date.now()
    set({
      activeRun: {
        runId: trimString(input.runId) || `live-chat-${startedAt}`,
        status: 'running',
        requestText: trimString(input.requestText),
        displayText: trimString(input.displayText),
        projectId: trimString(input.projectId),
        projectName: trimString(input.projectName),
        flowId: trimString(input.flowId),
        sessionKey: trimString(input.sessionKey),
        skillName: trimString(input.skillName),
        requestId: '',
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
        return {
          activeRun: {
            ...run,
            updatedAt,
            logs: pushLog(run.logs, buildLogEntry('tool', summary.title, summary.detail)),
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
            status: 'failed',
            updatedAt,
            finishedAt: updatedAt,
            errorMessage: message,
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
      return {
        activeRun: {
          ...run,
          status: 'succeeded',
          updatedAt: finishedAt,
          finishedAt,
          errorMessage: '',
          assistantPreview: clipText(previewSource, MAX_ASSISTANT_PREVIEW_CHARS),
          assetCount: readResponseAssetCount(response),
          logs: pushLog(
            run.logs,
            buildLogEntry(
              'run.completed',
              'chat completed',
              `assets: ${readResponseAssetCount(response)}\noutputMode: ${trimString(response.trace?.outputMode)}`,
            ),
          ),
        },
      }
    }),
  failRun: (message) =>
    set((state) => {
      const run = state.activeRun
      if (!run) return state
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
  clearRun: () => set({ activeRun: null }),
}))
