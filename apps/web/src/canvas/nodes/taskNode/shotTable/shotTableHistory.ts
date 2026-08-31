import { normalizeShotTable, type ShotTableData } from '@tapcanvas/shot-table-protocol'

export type ShotTableSnapshot = {
  id: string
  createdAt: string
  source: string
  table: ShotTableData
  rawText: string
  note: string
}

export type ShotTableHistoryResult = {
  snapshots: ShotTableSnapshot[]
  error: string
}

const readText = (value: unknown): string => typeof value === 'string' ? value : ''

export const readShotTableHistory = (value: unknown): ShotTableHistoryResult => {
  if (value === undefined) return { snapshots: [], error: '' }
  if (!Array.isArray(value)) return { snapshots: [], error: '版本历史不是数组。' }
  const snapshots: ShotTableSnapshot[] = []
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { snapshots: [], error: `第 ${index + 1} 个版本不是对象。` }
    }
    const record = raw as Record<string, unknown>
    const normalized = normalizeShotTable(record.table)
    if (!normalized.ok) {
      return { snapshots: [], error: `第 ${index + 1} 个版本无效：${normalized.issues.join('；')}` }
    }
    const id = readText(record.id).trim()
    const createdAt = readText(record.createdAt).trim()
    const source = readText(record.source).trim()
    const rawText = readText(record.rawText)
    const note = readText(record.note)
    if (!id || !createdAt || !source) {
      return { snapshots: [], error: `第 ${index + 1} 个版本缺少 id、createdAt 或 source。` }
    }
    if (!Number.isFinite(Date.parse(createdAt))) {
      return { snapshots: [], error: `第 ${index + 1} 个版本的 createdAt 不是有效日期。` }
    }
    snapshots.push({ id, createdAt, source, table: normalized.table, rawText, note })
  }
  return { snapshots, error: '' }
}
