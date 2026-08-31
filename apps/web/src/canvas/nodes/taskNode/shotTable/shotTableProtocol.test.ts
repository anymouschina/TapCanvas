import { describe, expect, it } from 'vitest'
import {
  createEmptyShotTable,
  parseShotTableText,
  serializeShotTable,
} from '@tapcanvas/shot-table-protocol'

describe('shot table text protocol', () => {
  it('round-trips the current columns and preserves their keys', () => {
    const table = createEmptyShotTable()
    const parsed = parseShotTableText(serializeShotTable(table), { expectedColumns: table.columns })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.table.columns).toEqual(table.columns)
    expect(parsed.table.rows[0]?.values['镜号']).toBe('M001')
  })

  it('rejects explanations, missing timeline sections, and unexpected fields', () => {
    const table = createEmptyShotTable()
    expect(parseShotTableText(`分析如下：\n${serializeShotTable(table)}`, { expectedColumns: table.columns }).ok).toBe(false)
    expect(parseShotTableText(`【镜头总览】\n总镜数：1\n=========单镜头开始=========\n镜号：M001\n=========单镜头结束=========`, {
      expectedColumns: table.columns,
    }).ok).toBe(false)
    const unexpected = parseShotTableText(
      serializeShotTable(table).replace('镜号：M001', '镜号：M001\n额外字段：禁止'),
      { expectedColumns: table.columns },
    )
    expect(unexpected).toEqual({
      ok: false,
      issues: ['第 1 个镜头包含当前表不存在的字段：额外字段。'],
    })
  })
})
