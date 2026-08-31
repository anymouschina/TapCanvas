import { describe, expect, it } from 'vitest'
import { createEmptyShotTable, serializeShotTable } from '@tapcanvas/shot-table-protocol'
import { readShotTableHistory } from './shotTableHistory'

describe('shot table history', () => {
  it('accepts a fully traceable snapshot', () => {
    const table = createEmptyShotTable()
    const result = readShotTableHistory([{
      id: 'snapshot-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      source: '视频分析',
      table,
      rawText: serializeShotTable(table),
      note: 'model: test',
    }])
    expect(result.error).toBe('')
    expect(result.snapshots).toHaveLength(1)
  })

  it('rejects malformed snapshots instead of exposing an empty replacement history', () => {
    expect(readShotTableHistory([{ id: 'broken' }]).error).toContain('版本无效')
    expect(readShotTableHistory({ invalid: true }).error).toBe('版本历史不是数组。')
  })
})
