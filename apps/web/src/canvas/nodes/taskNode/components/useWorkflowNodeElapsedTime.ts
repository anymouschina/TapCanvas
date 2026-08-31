import React from 'react'

type WorkflowNodeElapsedTime = Readonly<{
  compact: string
  duration: string
  description: string
}>

const ACTIVE_WORKFLOW_STATUSES = new Set(['running', 'waiting_external', 'partial'])

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function workflowStatus(data: Record<string, unknown>): string {
  const value = typeof data.workflowStatus === 'string'
    ? data.workflowStatus
    : typeof data.triggerStatus === 'string'
      ? data.triggerStatus
      : ''
  return value.trim()
}

function compactDuration(elapsedMs: number): string {
  if (elapsedMs < 10_000) return `${Math.max(0.1, elapsedMs / 1_000).toFixed(1)}s`
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}:${String(seconds).padStart(2, '0')}`
  const hours = Math.floor(totalMinutes / 60)
  return `${hours}:${String(totalMinutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function readableDuration(elapsedMs: number): string {
  if (elapsedMs < 10_000) return `${Math.max(0.1, elapsedMs / 1_000).toFixed(1)}秒`
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 1) return `${totalSeconds}秒`
  if (totalMinutes < 60) return `${totalMinutes}分${String(seconds).padStart(2, '0')}秒`
  const hours = Math.floor(totalMinutes / 60)
  return `${hours}时${String(totalMinutes % 60).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`
}

export function workflowNodeElapsedTime(
  data: Record<string, unknown>,
  nowMs: number,
): WorkflowNodeElapsedTime | null {
  const startedAt = timestamp(data.workflowExecutionStartedAt)
  if (startedAt === null) return null
  const finishedAt = timestamp(data.workflowExecutionFinishedAt)
  const active = ACTIVE_WORKFLOW_STATUSES.has(workflowStatus(data))
  if (finishedAt === null && !active) return null
  const elapsedMs = Math.max(0, (finishedAt ?? nowMs) - startedAt)
  const duration = readableDuration(elapsedMs)
  return {
    compact: compactDuration(elapsedMs),
    duration,
    description: finishedAt === null ? `已运行 ${duration}` : `用时 ${duration}`,
  }
}

export function useWorkflowNodeElapsedTime(
  data: Record<string, unknown>,
): WorkflowNodeElapsedTime | null {
  const status = workflowStatus(data)
  const active = ACTIVE_WORKFLOW_STATUSES.has(status)
    && timestamp(data.workflowExecutionStartedAt) !== null
    && timestamp(data.workflowExecutionFinishedAt) === null
  const [nowMs, setNowMs] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!active) return undefined
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active, data.workflowExecutionStartedAt])

  return workflowNodeElapsedTime(data, nowMs)
}
