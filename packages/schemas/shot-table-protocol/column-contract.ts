import type { ShotTableColumn } from './types'

export type ResolvedShotTableColumns = {
  columns: ShotTableColumn[]
  shotColumns: ShotTableColumn[]
  timelineColumns: ShotTableColumn[]
}

export type ShotTableColumnContractResult =
  | { ok: true; value: ResolvedShotTableColumns }
  | { ok: false; issues: string[] }

export const resolveShotTableColumnContract = (
  input: readonly ShotTableColumn[],
): ShotTableColumnContractResult => {
  const issues: string[] = []
  const keys = new Set<string>()
  const labels = new Set<string>()
  const columns: ShotTableColumn[] = []

  input.forEach((column, index) => {
    const key = typeof column.key === 'string' ? column.key.trim() : ''
    const label = typeof column.label === 'string' ? column.label.trim() : ''
    if (!key || !label || (column.scope !== 'shot' && column.scope !== 'timeline')) {
      issues.push(`第 ${index + 1} 列缺少合法 key、label 或 scope。`)
      return
    }
    if (keys.has(key)) issues.push(`当前分镜表存在重复列 key：“${key}”。`)
    if (labels.has(label)) issues.push(`当前分镜表存在重复列名：“${label}”。`)
    keys.add(key)
    labels.add(label)
    columns.push({ key, label, scope: column.scope })
  })

  const shotColumns = columns.filter((column) => column.scope === 'shot')
  const timelineColumns = columns.filter((column) => column.scope === 'timeline')
  if (shotColumns.length === 0) issues.push('当前分镜表至少需要一个镜头级字段。')
  if (timelineColumns.length === 0) issues.push('当前分镜表至少需要一个时序级字段。')
  if (!timelineColumns.some((column) => column.label === '时间段')) {
    issues.push('当前分镜表缺少时序列“时间段”。')
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: { columns, shotColumns, timelineColumns } }
}
