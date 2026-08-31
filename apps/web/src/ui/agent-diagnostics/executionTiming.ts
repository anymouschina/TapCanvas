import type { ExecutionTiming, ExecutionToolInvocation } from './executionGraph.types'

type TimingInput = {
  startedAt: string | number | null | undefined
  updatedAt?: string | number | null
  finishedAt?: string | number | null
  live?: boolean
  observedAtMs?: number
}

function timestampMs(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isoTimestamp(value: string | number | null | undefined): string {
  const parsed = timestampMs(value)
  return parsed === null ? '' : new Date(parsed).toISOString()
}

export function createExecutionTiming(input: TimingInput): ExecutionTiming | undefined {
  const startedMs = timestampMs(input.startedAt)
  if (startedMs === null) return undefined
  const finishedMs = timestampMs(input.finishedAt)
  const updatedMs = timestampMs(input.updatedAt) ?? finishedMs ?? startedMs
  const live = input.live === true && finishedMs === null
  const endpointMs = live
    ? Math.max(startedMs, input.observedAtMs ?? Date.now())
    : Math.max(startedMs, finishedMs ?? updatedMs)
  return {
    startedAt: new Date(startedMs).toISOString(),
    updatedAt: new Date(Math.max(startedMs, updatedMs)).toISOString(),
    finishedAt: finishedMs === null ? '' : new Date(Math.max(startedMs, finishedMs)).toISOString(),
    elapsedMs: Math.max(0, Math.trunc(endpointMs - startedMs)),
    live,
  }
}

export function timingFromInvocations(
  invocations: readonly ExecutionToolInvocation[],
  observedAtMs: number,
): ExecutionTiming | undefined {
  const startedValues = invocations.map((invocation) => timestampMs(invocation.startedAt)).filter((value): value is number => value !== null)
  if (startedValues.length === 0) return undefined
  const finishedValues = invocations.map((invocation) => timestampMs(invocation.finishedAt)).filter((value): value is number => value !== null)
  const live = invocations.some((invocation) => invocation.status === 'running')
  const startedAt = Math.min(...startedValues)
  const updatedAt = Math.max(startedAt, ...startedValues, ...finishedValues)
  return createExecutionTiming({
    startedAt,
    updatedAt,
    finishedAt: live ? null : updatedAt,
    live,
    observedAtMs,
  })
}

export function timingFromTimestamps(
  values: readonly (string | number | null | undefined)[],
  options: { live: boolean; observedAtMs: number },
): ExecutionTiming | undefined {
  const timestamps = values.map(timestampMs).filter((value): value is number => value !== null)
  if (timestamps.length === 0) return undefined
  const startedAt = Math.min(...timestamps)
  const updatedAt = Math.max(...timestamps)
  return createExecutionTiming({
    startedAt,
    updatedAt,
    finishedAt: options.live ? null : updatedAt,
    live: options.live,
    observedAtMs: options.observedAtMs,
  })
}

export function invocationElapsedMs(invocation: ExecutionToolInvocation, observedAtMs: number): number | null {
  if (invocation.durationMs !== null) return Math.max(0, Math.trunc(invocation.durationMs))
  const startedMs = timestampMs(invocation.startedAt)
  if (startedMs === null) return null
  const finishedMs = timestampMs(invocation.finishedAt)
  if (finishedMs !== null) return Math.max(0, Math.trunc(finishedMs - startedMs))
  if (invocation.status !== 'running') return null
  return Math.max(0, Math.trunc(observedAtMs - startedMs))
}

export function formatElapsedDuration(value: number | null): string {
  if (value === null) return '耗时未记录'
  const durationMs = Math.max(0, Math.trunc(value))
  if (durationMs < 1_000) return `${durationMs} ms`
  const totalSeconds = Math.floor(durationMs / 1_000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 1) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 2 : 1)} s`
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatExecutionTimestamp(value: string): string {
  const parsed = timestampMs(value)
  if (parsed === null) return value || '未记录'
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false })
}

export function normalizeExecutionTimestamp(value: string | number | null | undefined): string {
  return isoTimestamp(value)
}
