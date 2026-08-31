import type {
  CodexTask,
  CodexTaskMessage,
  CodexTaskState,
} from '@tapcanvas/codex-task-protocol'
import { isCodexTerminalTaskState } from '@tapcanvas/codex-task-protocol'

export type CodexTimelineEntry = {
  id: string
  role: 'assistant' | 'user'
  content: string
  ts: string
  phase: 'thinking' | 'final'
  kind: 'progress' | 'result' | 'error'
  source: 'codex'
}

const FAILED_TASK_STATES: ReadonlySet<CodexTaskState> = new Set([
  'codex_failed',
  'remote_build_failed_code',
  'failed',
  'canceled',
  'unknown',
])

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function taskResultContent(task: CodexTask): string {
  const summary = task.deliveryEvidence.codex?.summary.trim() || ''
  if (FAILED_TASK_STATES.has(task.state)) {
    const failure = task.lastMessage.trim()
    if (summary && failure && summary !== failure) {
      return `${summary}\n\n${failure}`
    }
    return failure || summary || 'Codex 回合失败，但服务端未记录失败详情。'
  }
  if (task.state === 'succeeded' && task.deliveryEvidence.preview) {
    const previewPath = `/preview/${encodeURIComponent(task.previewId)}`
    return `${summary || task.lastMessage.trim()}\n\n[打开已验收预览](${previewPath})`
  }
  return summary || task.lastMessage.trim() || 'Codex 回合已结束。'
}

function taskAssistantEntry(task: CodexTask): CodexTimelineEntry {
  const terminal = isCodexTerminalTaskState(task.state)
  const failed = FAILED_TASK_STATES.has(task.state)
  return {
    id: `codex-assistant-${task.id}`,
    role: 'assistant',
    content: terminal
      ? taskResultContent(task)
      : task.lastMessage.trim() || `当前 Codex 任务状态：${task.state}`,
    ts: formatTimestamp(task.updatedAt),
    phase: terminal ? 'final' : 'thinking',
    kind: terminal ? (failed ? 'error' : 'result') : 'progress',
    source: 'codex',
  }
}

function taskUserEntry(task: CodexTask): CodexTimelineEntry {
  return {
    id: `codex-user-task-${task.id}`,
    role: 'user',
    content: task.goal,
    ts: formatTimestamp(task.createdAt),
    phase: 'final',
    kind: 'result',
    source: 'codex',
  }
}

function steeringUserEntry(message: CodexTaskMessage): CodexTimelineEntry {
  const deliveryStatus = message.state === 'queued'
    ? `等待送达：${message.detail.trim() || '补充消息已持久化，等待 Bridge 送入当前回合。'}`
    : message.state === 'rejected'
    ? `未送达：${message.detail.trim() || 'Bridge 明确拒绝了这条补充消息。'}`
    : message.state === 'unknown'
      ? `送达状态未知：${message.detail.trim() || 'Bridge 无法确认这条补充是否进入当前回合。'}`
      : ''
  return {
    id: `codex-user-message-${message.id}`,
    role: 'user',
    content: deliveryStatus
      ? `${message.text}\n\n> ${deliveryStatus}`
      : message.text,
    ts: formatTimestamp(message.createdAt),
    phase: 'final',
    kind: message.state === 'queued'
      ? 'progress'
      : message.state === 'rejected' || message.state === 'unknown'
        ? 'error'
        : 'result',
    source: 'codex',
  }
}

export function buildCodexTimeline(input: {
  tasks: CodexTask[]
  messages: CodexTaskMessage[]
}): CodexTimelineEntry[] {
  const messagesByTaskId = new Map<string, CodexTaskMessage[]>()
  for (const message of input.messages) {
    const current = messagesByTaskId.get(message.taskId) || []
    current.push(message)
    messagesByTaskId.set(message.taskId, current)
  }

  const entries: CodexTimelineEntry[] = []
  const tasks = [...input.tasks].sort(
    (left, right) => left.turnSequence - right.turnSequence,
  )
  for (const task of tasks) {
    entries.push(taskUserEntry(task))
    const steeringMessages = (messagesByTaskId.get(task.id) || [])
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    entries.push(...steeringMessages.map(steeringUserEntry))
    entries.push(taskAssistantEntry(task))
  }
  return entries
}
