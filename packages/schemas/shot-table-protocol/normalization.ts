import type { ShotTableColumn, ShotTableParseResult, ShotTableRow } from './types'
import { isShotTableRecord } from './types'

export const normalizeShotTable = (value: unknown): ShotTableParseResult => {
  if (!isShotTableRecord(value)) return { ok: false, issues: ['分镜表数据不是对象。'] }
  if (value.version !== 1) return { ok: false, issues: ['分镜表版本必须为 1。'] }
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) {
    return { ok: false, issues: ['分镜表缺少 columns 或 rows 数组。'] }
  }
  const issues: string[] = []
  const columnKeys = new Set<string>()
  const columns: ShotTableColumn[] = []
  value.columns.forEach((column, index) => {
    if (!isShotTableRecord(column)) {
      issues.push(`第 ${index + 1} 列不是对象。`)
      return
    }
    const key = typeof column.key === 'string' ? column.key.trim() : ''
    const label = typeof column.label === 'string' ? column.label.trim() : ''
    const scope = column.scope
    if (!key || !label || (scope !== 'shot' && scope !== 'timeline')) {
      issues.push(`第 ${index + 1} 列缺少合法 key、label 或 scope。`)
      return
    }
    if (columnKeys.has(key)) {
      issues.push(`列 key 重复：${key}`)
      return
    }
    columnKeys.add(key)
    columns.push({ key, label, scope })
  })
  if (columns.length === 0) issues.push('分镜表至少需要一列。')

  const rowIds = new Set<string>()
  const rows: ShotTableRow[] = []
  value.rows.forEach((row, index) => {
    if (!isShotTableRecord(row) || !isShotTableRecord(row.values)) {
      issues.push(`第 ${index + 1} 行缺少 values 对象。`)
      return
    }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const shotId = typeof row.shotId === 'string' ? row.shotId.trim() : ''
    if (!id || !shotId) {
      issues.push(`第 ${index + 1} 行缺少 id 或 shotId。`)
      return
    }
    if (rowIds.has(id)) {
      issues.push(`行 id 重复：${id}`)
      return
    }
    rowIds.add(id)
    const values: Record<string, string> = {}
    for (const column of columns) {
      const raw = row.values[column.key]
      if (raw !== undefined && typeof raw !== 'string') {
        issues.push(`第 ${index + 1} 行的“${column.label}”不是字符串。`)
      } else {
        values[column.key] = raw ?? ''
      }
    }
    rows.push({ id, shotId, values })
  })
  if (rows.length === 0) issues.push('分镜表至少需要一行。')

  const overview: Record<string, string> = {}
  if (!isShotTableRecord(value.overview)) {
    issues.push('分镜表缺少 overview 对象。')
  } else {
    Object.entries(value.overview).forEach(([key, raw]) => {
      if (typeof raw !== 'string') issues.push(`总览字段“${key}”不是字符串。`)
      else overview[key] = raw
    })
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, table: { version: 1, overview, columns, rows } }
}
