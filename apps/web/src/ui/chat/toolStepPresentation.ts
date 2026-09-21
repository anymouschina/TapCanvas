/** Read a tool identity without ever coercing an object to "[object Object]". */
export function readPresentedToolName(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  for (const key of ['toolName', 'name', 'logicalName']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
  }
  return ''
}

export function resolvePresentedToolName(toolName: unknown, input: unknown): string {
  const rawName = readPresentedToolName(toolName)
  if (rawName !== 'tapcanvas_call_tool') return rawName || 'tool'
  if (!input || typeof input !== 'object' || Array.isArray(input)) return rawName
  const nestedName = readPresentedToolName(input)
  return nestedName || rawName
}

export type PresentedToolStatus = 'succeeded' | 'failed' | 'denied' | 'blocked'

export type PresentedTaskStatus = 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled'

/** Only the logical task verdict owns the headline; tool failures remain diagnostics. */
export function presentTaskExecution(input: {
  status?: PresentedTaskStatus
  active: boolean
  stageLabel?: string
  totalCount: number
}): { label: string; state: 'completed' | 'active' | 'failed' | 'neutral' } {
  if (input.status === 'succeeded') return { label: `执行完成 · ${input.totalCount} 次调用`, state: 'completed' }
  if (input.status === 'failed') return { label: '任务执行失败', state: 'failed' }
  if (input.status === 'cancelled') return { label: '任务已取消', state: 'neutral' }
  if (input.status === 'waiting_external') return { label: '等待外部结果', state: 'active' }
  if (input.status === 'waiting_input') return { label: '等待你的回复', state: 'neutral' }
  if (input.status === 'active' || input.active) return {
    label: input.stageLabel ? `当前阶段 · ${input.stageLabel}` : '任务处理中',
    state: 'active',
  }
  return { label: `执行记录 · ${input.totalCount} 次调用`, state: 'neutral' }
}

/**
 * A tool receipt is an action-level fact, not the terminal state of the chat
 * turn. Keep the top-level progress copy compatible with a still-running root
 * turn; the exact failed/denied/blocked receipt remains a separate diagnostic
 * fact (and may be deferred from the compact chat card during self-repair).
 */
export function buildToolProgressSummary(input: {
  label: string
  phase: 'started' | 'completed'
  status?: PresentedToolStatus
  severity?: 'warning' | 'error'
}): string {
  const label = String(input.label || '').trim() || '调用工具'
  if (input.phase === 'started') return `正在执行：${label}`
  if (input.severity === 'warning') return `${label}需要补全，正在确认后续处理`
  if (input.status === 'succeeded') return `已完成：${label}`
  if (input.status === 'denied') return `${label}未获授权，正在确认后续处理`
  if (input.status === 'blocked') return `${label}当前受阻，正在确认后续处理`
  if (input.status === 'failed') return `${label}未完成，正在确认后续处理`
  return `${label}已更新，正在确认后续处理`
}

/**
 * A continuation event is authoritative evidence that agents-cli accepted the
 * preceding receipt and started another model turn. It must replace stale
 * action-level failure copy without mutating the underlying receipt.
 */
export function buildAgentContinuationSummary(
  priorToolStatus: PresentedToolStatus | undefined,
): string {
  if (
    priorToolStatus === 'failed'
    || priorToolStatus === 'denied'
    || priorToolStatus === 'blocked'
  ) {
    return '正在调整处理方式并继续完成请求'
  }
  return '正在继续处理你的请求'
}

export function buildToolStepSummary(input: {
  totalCount: number
  currentToolLabel: string | null
  failedCount: number
  warningCount?: number
  active: boolean
}): string {
  const warningCount = input.warningCount ?? 0
  if (input.currentToolLabel) {
    return input.active
      ? `正在执行 · ${input.currentToolLabel}`
      : input.failedCount > 0
        ? `执行详情 · ${input.totalCount} 次调用 · ${input.failedCount} 次异常`
        : warningCount > 0
          ? `执行详情 · ${input.totalCount} 次调用 · ${warningCount} 个提示`
          : `执行详情 · ${input.totalCount} 次调用`
  }
  if (input.failedCount > 0) return `执行详情 · ${input.totalCount} 次调用 · ${input.failedCount} 次异常`
  if (warningCount > 0) return `执行详情 · ${input.totalCount} 次调用 · ${warningCount} 个提示`
  return `执行详情 · ${input.totalCount} 次调用`
}
