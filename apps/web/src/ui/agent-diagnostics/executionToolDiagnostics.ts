import type {
  LiveChatLogEntry,
  LiveChatRunRecord,
  LiveChatToolActivity,
} from '../chat/liveChatRunStore'
import type {
  ExecutionGraphDiagnostics,
  ExecutionGraphNodeStatus,
  ExecutionToolInvocation,
  ExecutionToolInvocationStatus,
  ExecutionToolIssue,
} from './executionGraph.types'

type JsonRecord = Record<string, unknown>

type ParsedToolOutput = {
  code: string
  message: string
  issues: ExecutionToolIssue[]
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function readString(record: JsonRecord | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function formatUnknown(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseOutputRecord(value: string | undefined): JsonRecord | null {
  const source = value?.trim() ?? ''
  if (!source || source.endsWith('…(truncated)')) return null
  try {
    return readRecord(JSON.parse(source))
  } catch {
    return null
  }
}

function parseIssues(record: JsonRecord | null): ExecutionToolIssue[] {
  if (!Array.isArray(record?.issues)) return []
  return record.issues.flatMap((value) => {
    const issue = readRecord(value)
    if (!issue) return []
    const path = readString(issue, 'path')
    const keyword = readString(issue, 'keyword')
    const message = readString(issue, 'message')
    return path || keyword || message ? [{ path, keyword, message }] : []
  })
}

function parseToolOutput(value: string | undefined): ParsedToolOutput {
  const envelope = parseOutputRecord(value)
  const nested = readRecord(envelope?.data)
  const record = nested?.ok === false ? nested : envelope
  return {
    code: readString(record, 'code'),
    message: readString(record, 'message') || readString(record, 'errorMessage'),
    issues: parseIssues(record),
  }
}

function readOperation(input: unknown): string {
  const envelope = readRecord(input)
  const args = readRecord(envelope?.args) ?? envelope
  const mode = readString(args, 'mode')
  if (mode) return `mode=${mode}`
  const selector = readRecord(args?.selector)
  const field = readString(selector, 'field')
  const value = readString(selector, 'value')
  return field && value ? `${field}=${value}` : ''
}

function invocationStatus(activity: LiveChatToolActivity): ExecutionToolInvocationStatus {
  if (activity.status === 'succeeded') return 'succeeded'
  if (activity.status === 'failed') return 'failed'
  if (activity.status === 'denied') return 'denied'
  if (activity.status === 'blocked') return 'blocked'
  return activity.phase === 'started' ? 'running' : 'unknown'
}

function mergeInvocation(
  current: ExecutionToolInvocation | undefined,
  log: LiveChatLogEntry,
  activity: LiveChatToolActivity,
): ExecutionToolInvocation {
  const parsedOutput = parseToolOutput(activity.outputPreview)
  const observedAt = new Date(log.at).toISOString()
  const nextStatus = invocationStatus(activity)
  return {
    toolCallId: activity.toolCallId || current?.toolCallId || log.id,
    toolName: activity.toolName || current?.toolName || '未命名工具',
    transportToolName: activity.transportToolName || current?.transportToolName || '',
    operation: readOperation(activity.input) || current?.operation || '',
    status: nextStatus === 'running' && current && current.status !== 'running'
      ? current.status
      : nextStatus,
    startedAt: activity.startedAt || current?.startedAt || observedAt,
    finishedAt: activity.finishedAt || current?.finishedAt || '',
    durationMs: typeof activity.durationMs === 'number'
      ? activity.durationMs
      : current?.durationMs ?? null,
    input: activity.input !== undefined ? formatUnknown(activity.input) : current?.input || '',
    output: activity.outputPreview || current?.output || '',
    errorCode: parsedOutput.code || current?.errorCode || '',
    errorMessage: parsedOutput.message || activity.errorMessage || current?.errorMessage || log.reason || '',
    issues: parsedOutput.issues.length > 0 ? parsedOutput.issues : current?.issues ?? [],
  }
}

export function buildToolInvocations(logs: readonly LiveChatLogEntry[]): ExecutionToolInvocation[] {
  const invocations = new Map<string, ExecutionToolInvocation>()
  for (const log of logs) {
    const activity = log.toolActivity
    if (!activity) continue
    const key = activity.toolCallId || log.id
    invocations.set(key, mergeInvocation(invocations.get(key), log, activity))
  }
  return [...invocations.values()].sort((left, right) => {
    const leftAt = Date.parse(left.startedAt)
    const rightAt = Date.parse(right.startedAt)
    return (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0)
  })
}

function stageConclusion(taskStatus: ExecutionGraphNodeStatus, stageStatus: ExecutionGraphNodeStatus): string {
  if (taskStatus === 'running' && stageStatus === 'warning') {
    return '本阶段出现局部调用问题；逻辑任务仍在运行，不能据此判定整个任务失败。'
  }
  if (taskStatus === 'running') return '逻辑任务仍在运行，当前只展示已经确认的调用事实。'
  if (taskStatus === 'failed') return '逻辑任务已进入失败终态；请结合下方失败调用与终态原因定位。'
  if (stageStatus === 'warning') return '逻辑任务已结束，但本阶段保留了局部失败或警告记录。'
  if (taskStatus === 'succeeded') return '逻辑任务已成功结束，本阶段调用均已结算。'
  return '请以任务状态和结构化调用结果分别判断整体终态与局部动作。'
}

export function buildLiveToolDiagnostics(
  run: LiveChatRunRecord,
  taskStatus: ExecutionGraphNodeStatus,
  stageStatus: ExecutionGraphNodeStatus,
): ExecutionGraphDiagnostics {
  const invocations = buildToolInvocations(run.logs)
  const warnings = run.logs
    .filter((log) => log.tone === 'warn' && !log.toolActivity)
    .map((log) => log.reason || log.detail || log.title)
    .filter(Boolean)
  const errors = run.logs
    .filter((log) => (log.tone === 'error' || log.event === 'error') && !log.toolActivity)
    .map((log) => log.reason || log.detail || log.title)
    .filter(Boolean)
  return {
    taskStatus,
    conclusion: stageConclusion(taskStatus, stageStatus),
    invocations,
    roles: run.logs.flatMap((log) => log.roleActivity ? [{
      agentId: log.roleActivity.agentId,
      roleName: log.roleActivity.roleName || log.roleActivity.role,
      status: log.roleActivity.status,
      summary: log.roleActivity.progressSummary || log.roleActivity.description,
      occurredAt: new Date(log.roleActivity.at).toISOString(),
    }] : []),
    warnings,
    errors,
  }
}
