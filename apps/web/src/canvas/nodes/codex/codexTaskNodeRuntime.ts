import type { Edge } from '@xyflow/react'
import type { CodexTask, CodexTaskState } from '@tapcanvas/codex-task-protocol'
import { isCodexTerminalTaskState } from '@tapcanvas/codex-task-protocol'

export type CodexTaskNodeData = Readonly<{
  label: string
  draft: string
  sessionId: string
  taskId: string
  state: CodexTaskState | null
  summary: string
  updatedAt: string
  bridgeId: string
  workspaceId: string
}>

export const CODEX_CLI_BRIDGE_MIN_VERSION = '0.7.0'

const CODEX_TASK_STATES: ReadonlySet<string> = new Set([
  'queued',
  'claimed',
  'codex_running',
  'awaiting_user_input',
  'codex_failed',
  'remote_build_queued',
  'remote_build_running',
  'remote_build_failed_code',
  'remote_build_failed_infrastructure',
  'fallback_waiting_approval',
  'local_fallback_approved',
  'local_build_running',
  'succeeded',
  'failed',
  'canceled',
  'unknown',
])

function readString(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : ''
}

function parseVersion(value: string): [number, number, number] | null {
  const core = value.trim().split('-', 1)[0] || ''
  const segments = core.split('.')
  if (segments.length !== 3) return null
  const numbers = segments.map((segment) => Number(segment))
  if (numbers.some((segment) => !Number.isInteger(segment) || segment < 0)) {
    return null
  }
  return [numbers[0], numbers[1], numbers[2]]
}

export function isCodexBridgeCliCompatible(workerVersion: string): boolean {
  const actual = parseVersion(workerVersion)
  const minimum = parseVersion(CODEX_CLI_BRIDGE_MIN_VERSION)
  if (!actual || !minimum) return false
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

export function readCodexTaskNodeData(value: unknown): CodexTaskNodeData {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const rawState = readString(data, 'codexState')
  return {
    label: readString(data, 'label') || 'Codex',
    draft: typeof data.codexDraft === 'string' ? data.codexDraft : '',
    sessionId: readString(data, 'codexSessionId'),
    taskId: readString(data, 'codexTaskId'),
    state: CODEX_TASK_STATES.has(rawState) ? rawState as CodexTaskState : null,
    summary: readString(data, 'codexSummary'),
    updatedAt: readString(data, 'codexUpdatedAt'),
    bridgeId: readString(data, 'codexBridgeId'),
    workspaceId: readString(data, 'codexWorkspaceId'),
  }
}

export function collectCodexContextNodeIds(
  ownerNodeId: string,
  edges: readonly Edge[],
): string[] {
  return Array.from(new Set([
    ownerNodeId,
    ...edges
      .filter((edge) => edge.target === ownerNodeId)
      .map((edge) => edge.source),
  ]))
}

function taskSummary(task: CodexTask): string {
  return task.deliveryEvidence.codex?.summary.trim()
    || task.lastMessage.trim()
    || `Codex 任务状态：${task.state}`
}

function nodeStatus(task: CodexTask): 'idle' | 'running' | 'success' | 'error' {
  if (!isCodexTerminalTaskState(task.state)) return 'running'
  if (task.state === 'succeeded') return 'success'
  if (task.state === 'awaiting_user_input') return 'idle'
  return 'error'
}

export function buildCodexTaskNodePatch(task: CodexTask): Record<string, unknown> {
  const summary = taskSummary(task)
  const terminal = isCodexTerminalTaskState(task.state)
  return {
    codexSessionId: task.sessionId,
    codexTaskId: task.id,
    codexState: task.state,
    codexSummary: summary,
    codexUpdatedAt: task.updatedAt,
    codexPreviewId: task.previewId || '',
    codexBridgeId: task.bridgeId,
    codexWorkspaceId: task.workspaceId,
    status: nodeStatus(task),
    ...(terminal
      ? {
          text: summary,
          textResults: [{ text: summary }],
        }
      : {}),
  }
}
