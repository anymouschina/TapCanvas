import type { ShotTableData } from '@tapcanvas/shot-table-protocol'
import type { ShotTableAssetReference, ShotTableAssetSource } from './ShotTableAssetPicker'
import { updateShotTableCell } from './shotTableOperations'

export type ShotTableActiveCellSelection = {
  rowId: string
  columnKey: string
  selectionStart: number
  selectionEnd: number
}

export type ActiveMentionRange = {
  start: number
  end: number
  query: string
}

export type ShotTableAssetInsertion = {
  table: ShotTableData
  bindings: ShotTableAssetBinding[]
  token: string
  caret: number
}

export type ShotTableAssetBinding = {
  id: string
  createdAt: string
  rowId: string
  columnKey: string
  token: string
  source: ShotTableAssetSource
  nodeId: string | null
  assetId: string | null
  assetRefId: string | null
  assetName: string
  assetUrl: string | null
}

export type ShotTableAssetBindingsResult = {
  bindings: ShotTableAssetBinding[]
  error: string
}

const ASSET_SOURCES = new Set<ShotTableAssetSource>(['canvas', 'project', 'personal', 'team', 'official'])
const readText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const readNullableText = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' && value.trim() ? value.trim() : undefined

const readAssetUrl = (value: unknown): string | null | undefined => {
  const text = readNullableText(value)
  if (text === null || text === undefined) return text
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

export const readShotTableAssetBindings = (value: unknown): ShotTableAssetBindingsResult => {
  if (value === undefined) return { bindings: [], error: '' }
  if (!Array.isArray(value)) return { bindings: [], error: 'shotTableAssetBindings 必须是数组。' }
  const bindings: ShotTableAssetBinding[] = []
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { bindings: [], error: `shotTableAssetBindings 第 ${index + 1} 项不是对象。` }
    }
    const record = raw as Record<string, unknown>
    const id = readText(record.id)
    const createdAt = readText(record.createdAt)
    const rowId = readText(record.rowId)
    const columnKey = readText(record.columnKey)
    const token = readText(record.token)
    const source = record.source
    const nodeId = readNullableText(record.nodeId)
    const assetId = readNullableText(record.assetId)
    const assetRefId = readNullableText(record.assetRefId)
    const assetName = readText(record.assetName)
    const assetUrl = readAssetUrl(record.assetUrl)
    if (!id || !createdAt || !Number.isFinite(Date.parse(createdAt)) || !rowId || !columnKey || !assetName) {
      return { bindings: [], error: `shotTableAssetBindings 第 ${index + 1} 项缺少可追溯身份或时间。` }
    }
    if (!token.startsWith('@') || token.length === 1 || Array.from(token).some((character) => character.trim() === '')) {
      return { bindings: [], error: `shotTableAssetBindings 第 ${index + 1} 项的 token 无效。` }
    }
    if (typeof source !== 'string' || !ASSET_SOURCES.has(source as ShotTableAssetSource)) {
      return { bindings: [], error: `shotTableAssetBindings 第 ${index + 1} 项的 source 无效。` }
    }
    if (nodeId === undefined || assetId === undefined || assetRefId === undefined || assetUrl === undefined) {
      return { bindings: [], error: `shotTableAssetBindings 第 ${index + 1} 项包含无效资产标识或 URL。` }
    }
    bindings.push({
      id,
      createdAt,
      rowId,
      columnKey,
      token,
      source: source as ShotTableAssetSource,
      nodeId,
      assetId,
      assetRefId,
      assetName,
      assetUrl,
    })
  }
  return { bindings, error: '' }
}

export const findActiveMentionRange = (value: string, caret: number): ActiveMentionRange | null => {
  const boundedCaret = Math.max(0, Math.min(value.length, caret))
  const at = value.lastIndexOf('@', Math.max(0, boundedCaret - 1))
  if (at < 0) return null
  const query = value.slice(at + 1, boundedCaret)
  if (Array.from(query).some((character) => character.trim() === '')) return null
  return { start: at, end: boundedCaret, query }
}

export const insertShotTableAssetReference = (input: {
  table: ShotTableData
  activeCell: ShotTableActiveCellSelection
  reference: ShotTableAssetReference
  existingBindings: unknown
  bindingId: string
  createdAt: string
}): ShotTableAssetInsertion => {
  const existing = readShotTableAssetBindings(input.existingBindings)
  if (existing.error) throw new Error(`${existing.error} 为避免覆盖既有素材绑定，当前禁止插入。`)
  const row = input.table.rows.find((candidate) => candidate.id === input.activeCell.rowId)
  if (!row) throw new Error('当前素材目标行已不存在，请重新选择单元格。')
  if (!input.table.columns.some((column) => column.key === input.activeCell.columnKey)) {
    throw new Error('当前素材目标列已不存在，请重新选择单元格。')
  }
  const value = row.values[input.activeCell.columnKey] ?? ''
  const mention = findActiveMentionRange(value, input.activeCell.selectionStart)
  const start = mention?.start ?? Math.max(0, Math.min(value.length, input.activeCell.selectionStart))
  const end = mention?.end ?? Math.max(start, Math.min(value.length, input.activeCell.selectionEnd))
  const token = `@${input.reference.username}`
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`
  return {
    table: updateShotTableCell(input.table, input.activeCell.rowId, input.activeCell.columnKey, nextValue),
    bindings: [
      ...existing.bindings,
      {
        id: input.bindingId,
        createdAt: input.createdAt,
        rowId: input.activeCell.rowId,
        columnKey: input.activeCell.columnKey,
        token,
        source: input.reference.source,
        nodeId: input.reference.nodeId,
        assetId: input.reference.assetId,
        assetRefId: input.reference.assetRefId,
        assetName: input.reference.assetName,
        assetUrl: input.reference.assetUrl,
      },
    ],
    token,
    caret: start + token.length,
  }
}
