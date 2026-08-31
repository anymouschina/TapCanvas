import { describe, expect, it } from 'vitest'
import { createEmptyShotTable } from '@tapcanvas/shot-table-protocol'
import {
  addTimelineRow,
  changeShotTableColumnScope,
  updateShotTableCell,
} from './shotTableOperations'

const createId = (prefix: 'shot' | 'row' | 'column'): string => `${prefix}-new`

describe('shotTableOperations', () => {
  it('propagates shot-scoped edits across timeline rows', () => {
    const initial = createEmptyShotTable()
    const expanded = addTimelineRow(initial, initial.rows[0]?.id ?? '', createId)
    const column = expanded.columns.find((candidate) => candidate.label === '景别')
    const updated = updateShotTableCell(expanded, expanded.rows[1]?.id ?? '', column?.key ?? '', '近景')
    expect(updated.rows.map((row) => row.values[column?.key ?? ''])).toEqual(['近景', '近景'])
  })

  it('keeps timeline-scoped edits on one row', () => {
    const initial = createEmptyShotTable()
    const expanded = addTimelineRow(initial, initial.rows[0]?.id ?? '', createId)
    const column = expanded.columns.find((candidate) => candidate.label === '目标人物')
    const updated = updateShotTableCell(expanded, expanded.rows[1]?.id ?? '', column?.key ?? '', '@角色A')
    expect(updated.rows.map((row) => row.values[column?.key ?? ''])).toEqual(['', '@角色A'])
  })

  it('normalizes values when changing a timeline column to shot scope', () => {
    const initial = createEmptyShotTable()
    const expanded = addTimelineRow(initial, initial.rows[0]?.id ?? '', createId)
    const column = expanded.columns.find((candidate) => candidate.label === '目标人物')
    const edited = updateShotTableCell(expanded, expanded.rows[1]?.id ?? '', column?.key ?? '', '@角色A')
    const changed = changeShotTableColumnScope(edited, column?.key ?? '', 'shot')
    expect(changed.rows.map((row) => row.values[column?.key ?? ''])).toEqual(['@角色A', '@角色A'])
  })
})
