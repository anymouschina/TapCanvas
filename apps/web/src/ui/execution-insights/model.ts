import type { WorkflowExecutionEventDto, WorkflowNodeRunDto } from '../../api/server'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export const timestamp = (value: string | null | undefined): number | null => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
export function durationLabel(ms: number | null): string {
  if (ms === null) return '未记录'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`
  return `${Math.floor(ms / 60000)} 分 ${Math.round(ms % 60000 / 1000)} 秒`
}
export type TimelineRow = {
  run: WorkflowNodeRunDto; start: number | null; end: number | null
  duration: number | null; left: number; width: number; queueLeft: number; queueWidth: number
  open: boolean; issue: string | null
}
export function buildTimeline(runs: readonly WorkflowNodeRunDto[], observedAt: number) {
  const values = runs.map((run) => {
    const start = timestamp(run.startedAt)
    const created = timestamp(run.createdAt)
    const finish = timestamp(run.finishedAt)
    const open = run.status === 'running' || run.status === 'waiting_external' || run.status === 'queued'
    const measured = typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs >= 0 ? run.durationMs : null
    // Missing timestamps do not become fabricated absolute positions.
    const end = finish ?? (open ? observedAt : start !== null && measured !== null ? start + measured : null)
    const issue = start !== null && end !== null && end < start ? '结束时间早于开始时间' : null
    const duration = measured ?? (start !== null && end !== null && !issue ? end - start : null)
    return { run, start, end, created, duration, open, issue }
  })
  const bounds = values.flatMap((v) => [v.created, v.start, v.end].filter((n): n is number => n !== null))
  const origin = bounds.length ? Math.min(...bounds) : null
  const end = bounds.length ? Math.max(...bounds) : null
  const span = origin !== null && end !== null ? Math.max(1, end - origin) : 1
  const rows: TimelineRow[] = values.map((v) => ({
    ...v,
    left: v.start !== null && origin !== null ? (v.start - origin) / span * 100 : 0,
    width: v.start !== null && v.end !== null && !v.issue ? (v.end - v.start) / span * 100 : 0,
    queueLeft: v.created !== null && origin !== null ? (v.created - origin) / span * 100 : 0,
    queueWidth: v.created !== null && (v.start ?? (v.open ? v.end : null)) !== null
      ? Math.max(0, (v.start ?? v.end)! - v.created) / span * 100 : 0,
  }))
  return { origin, end, rows }
}

export const waitEventTypes = new Set([
  'node_waiting_external', 'node_external_check_started', 'node_recovered_after_restart',
  'node_recovery_started', 'node_retry_scheduled', 'node_restart_interrupted',
])
export const closeWaitEventTypes = new Set(['node_started', 'node_succeeded', 'node_failed'])
export function waitHistory(events: readonly WorkflowExecutionEventDto[]) {
  const waiting = new Map<string, WorkflowExecutionEventDto>()
  return [...events].sort((a, b) => a.seq - b.seq).flatMap((event) => {
    const nodeId = event.nodeId
    if (!nodeId) return []
    const previous = waiting.get(nodeId)
    if (event.eventType === 'node_waiting_external') waiting.set(nodeId, event)
    if (!waitEventTypes.has(event.eventType) && !(previous && closeWaitEventTypes.has(event.eventType))) return []
    const start = previous ? timestamp(previous.createdAt) : null
    const end = timestamp(event.createdAt)
    if (closeWaitEventTypes.has(event.eventType)) waiting.delete(nodeId)
    return [{ event, sinceWaitMs: start !== null && end !== null && end >= start ? end - start : null }]
  })
}

export type JsonChange = { path: string; kind: 'added' | 'removed' | 'changed'; before?: unknown; after?: unknown }
export const pointerToken = (value: string) => value.split('~').join('~0').split('/').join('~1')
export function diffJson(before: unknown, after: unknown, path = ''): JsonChange[] {
  if (Object.is(before, after)) return []
  if ((isRecord(before) && isRecord(after)) || (Array.isArray(before) && Array.isArray(after))) {
    const left = before as Record<string, unknown>, right = after as Record<string, unknown>
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => {
      const next = `${path}/${pointerToken(key)}`
      if (!Object.prototype.hasOwnProperty.call(left, key)) return [{ path: next, kind: 'added' as const, after: right[key] }]
      if (!Object.prototype.hasOwnProperty.call(right, key)) return [{ path: next, kind: 'removed' as const, before: left[key] }]
      return diffJson(left[key], right[key], next)
    })
  }
  return [{ path, kind: 'changed', before, after }]
}
