import { describe, expect, it } from 'vitest'
import { buildTimeline, diffJson, durationLabel } from './model'

describe('execution insight models', () => {
  it('builds a truthful timeline with queue and open execution intervals', () => {
    const runs = [{ id: 'a', executionId: 'e', nodeId: 'a', status: 'success' as const, attempt: 1, createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:03.000Z', durationMs: 2000 }, { id: 'b', executionId: 'e', nodeId: 'b', status: 'running' as const, attempt: 1, createdAt: '2026-01-01T00:00:02.000Z', startedAt: '2026-01-01T00:00:02.500Z', finishedAt: null }]
    const result = buildTimeline(runs, Date.parse('2026-01-01T00:00:04.000Z'))
    expect(result.rows[0]?.duration).toBe(2000)
    expect(result.rows[0]?.queueWidth).toBeGreaterThan(0)
    expect(result.rows[1]?.open).toBe(true)
  })
  it('diffs structured versions without semantic matching', () => {
    expect(diffJson({ a: 1, old: true }, { a: 2, next: true })).toEqual([
      { path: '/a', kind: 'changed', before: 1, after: 2 },
      { path: '/next', kind: 'added', after: true },
      { path: '/old', kind: 'removed', before: true },
    ])
    expect(durationLabel(61000)).toBe('1 分 1 秒')
  })
})
