import { SHOT_TABLE_OVERVIEW_ORDER } from './defaults'
import { normalizeShotTable } from './normalization'
import type { ShotTableData, ShotTableRow } from './types'

const orderedOverviewEntries = (overview: Record<string, string>): Array<[string, string]> => {
  const seen = new Set<string>()
  const entries: Array<[string, string]> = []
  SHOT_TABLE_OVERVIEW_ORDER.forEach((label) => {
    if (!(label in overview)) return
    seen.add(label)
    entries.push([label, overview[label] ?? ''])
  })
  Object.entries(overview).forEach(([label, value]) => {
    if (!seen.has(label)) entries.push([label, value])
  })
  return entries
}

export const serializeShotTable = (table: ShotTableData): string => {
  const normalized = normalizeShotTable(table)
  if (!normalized.ok) throw new Error(normalized.issues.join('；'))
  const value = normalized.table
  const lines = ['【镜头总览】']
  orderedOverviewEntries(value.overview).forEach(([label, fieldValue]) => {
    lines.push(`${label}：${fieldValue}`)
  })
  const shotColumns = value.columns.filter((column) => column.scope === 'shot')
  const timelineColumns = value.columns.filter((column) => column.scope === 'timeline')
  const groups = new Map<string, ShotTableRow[]>()
  value.rows.forEach((row) => groups.set(row.shotId, [...(groups.get(row.shotId) ?? []), row]))
  groups.forEach((groupRows) => {
    lines.push('', '=========单镜头开始=========')
    shotColumns.forEach((column) => {
      lines.push(`${column.label}：${groupRows.find((row) => row.values[column.key])?.values[column.key] ?? ''}`)
    })
    lines.push('', '---镜头内时序细分')
    groupRows.forEach((row, index) => {
      if (index > 0) lines.push('')
      timelineColumns.forEach((column) => lines.push(`${column.label}：${row.values[column.key] ?? ''}`))
    })
    lines.push('=========单镜头结束=========')
  })
  return lines.join('\n').trim()
}
