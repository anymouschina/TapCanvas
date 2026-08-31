import type { ShotTableColumn, ShotTableData, ShotTableRow } from '@tapcanvas/shot-table-protocol'
import {
  buildXlsxWorkbook,
  parseXlsxWorkbook,
  type ParsedWorksheet,
  type WorkbookSheetDefinition,
} from './shotTableWorkbookCodec'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const STORYBOARD_SHEET = '分镜表'
const OVERVIEW_SHEET = '镜头总览'
const COLUMN_SETTINGS_SHEET = '列设置'
const ROW_STRUCTURE_SHEET = '行结构'

export type ShotTableWorkbookImport = {
  table: ShotTableData
  warnings: string[]
}

const buildWorkbookSheets = (table: ShotTableData): WorkbookSheetDefinition[] => [{
  name: STORYBOARD_SHEET,
  rows: [
    table.columns.map((column) => column.label),
    ...table.rows.map((row) => table.columns.map((column) => row.values[column.key] ?? '')),
  ],
  widths: table.columns.map((column) => column.label === '时间段' || column.label === '镜号' ? 18 : 32),
  filter: true,
}, {
  name: OVERVIEW_SHEET,
  rows: [['字段', '值'], ...Object.entries(table.overview)],
  widths: [24, 40],
  filter: false,
}, {
  name: COLUMN_SETTINGS_SHEET,
  rows: [
    ['列标识', '列名', '作用域', '序号'],
    ...table.columns.map((column, index) => [
      column.key,
      column.label,
      column.scope === 'shot' ? '镜头列' : '时序列',
      String(index + 1),
    ]),
  ],
  widths: [34, 30, 18, 12],
  filter: false,
}, {
  name: ROW_STRUCTURE_SHEET,
  rows: [
    ['数据行序号', '行标识', '镜头标识'],
    ...table.rows.map((row, index) => [String(index + 1), row.id, row.shotId]),
  ],
  widths: [14, 38, 38],
  filter: false,
}]

export const buildShotTableWorkbook = (table: ShotTableData): Uint8Array =>
  buildXlsxWorkbook(buildWorkbookSheets(table))

const createImportedId = (prefix: string, index: number): string => `${prefix}-${index + 1}`

const readSettingsColumns = (sheet: ParsedWorksheet): { columns: ShotTableColumn[]; generatedKeys: boolean } => {
  const header = sheet.rows[0] ?? []
  const keyIndex = header.indexOf('列标识')
  const labelIndex = header.indexOf('列名')
  const scopeIndex = header.indexOf('作用域')
  if (labelIndex < 0 || scopeIndex < 0) throw new Error('“列设置”缺少“列名”或“作用域”表头。')
  const labels = new Set<string>()
  const keys = new Set<string>()
  const columns = sheet.rows.slice(1).filter((row) => row.some((value) => value.trim())).map((row, index) => {
    const label = String(row[labelIndex] ?? '').trim()
    const rawScope = String(row[scopeIndex] ?? '').trim().toLowerCase()
    const storedKey = keyIndex >= 0 ? String(row[keyIndex] ?? '').trim() : ''
    const key = storedKey || createImportedId('excel-column', index)
    if (!label) throw new Error(`“列设置”第 ${index + 2} 行缺少列名。`)
    if (labels.has(label) || keys.has(key)) throw new Error(`“列设置”存在重复列：${label}`)
    labels.add(label)
    keys.add(key)
    if (rawScope !== '镜头列' && rawScope !== 'shot' && rawScope !== '时序列' && rawScope !== 'timeline') {
      throw new Error(`列“${label}”的作用域必须是镜头列或时序列。`)
    }
    return { key, label, scope: rawScope === '镜头列' || rawScope === 'shot' ? 'shot' as const : 'timeline' as const }
  })
  return { columns, generatedKeys: keyIndex < 0 || sheet.rows.slice(1).some((row) => !String(row[keyIndex] ?? '').trim()) }
}

const readOverview = (sheet: ParsedWorksheet): Record<string, string> => {
  const header = sheet.rows[0] ?? []
  if (header[0] !== '字段' || header[1] !== '值') throw new Error('“镜头总览”表头必须是“字段、值”。')
  const overview: Record<string, string> = {}
  sheet.rows.slice(1).forEach((row, index) => {
    const label = String(row[0] ?? '').trim()
    if (!label) throw new Error(`“镜头总览”第 ${index + 2} 行缺少字段名。`)
    if (label in overview) throw new Error(`“镜头总览”字段重复：${label}`)
    overview[label] = String(row[1] ?? '')
  })
  return overview
}

const readStructureRows = (
  sheet: ParsedWorksheet,
  expectedRows: number,
): Array<{ rowId: string; shotId: string }> => {
  const header = sheet.rows[0] ?? []
  const rowIdIndex = header.indexOf('行标识')
  const shotIdIndex = header.indexOf('镜头标识')
  if (rowIdIndex < 0 || shotIdIndex < 0) throw new Error('“行结构”缺少“行标识”或“镜头标识”表头。')
  const rows = sheet.rows.slice(1).filter((row) => row.some((value) => value.trim()))
  if (rows.length !== expectedRows) throw new Error('“行结构”的数据行数与“分镜表”不一致。')
  const seenRowIds = new Set<string>()
  return rows.map((row, index) => {
    const rowId = String(row[rowIdIndex] ?? '').trim()
    const shotId = String(row[shotIdIndex] ?? '').trim()
    if (!rowId || !shotId) throw new Error(`“行结构”第 ${index + 2} 行缺少行标识或镜头标识。`)
    if (seenRowIds.has(rowId)) throw new Error(`“行结构”存在重复行标识：${rowId}`)
    seenRowIds.add(rowId)
    return { rowId, shotId }
  })
}

const deriveStructureFromShotNumber = (
  dataRows: string[][],
  columns: ShotTableColumn[],
): Array<{ rowId: string; shotId: string }> => {
  const shotColumnIndex = columns.findIndex((column) => column.label === '镜号')
  if (shotColumnIndex < 0) throw new Error('文件没有“行结构”工作表，也没有“镜号”列，无法恢复镜头分组。')
  const shotIdByNumber = new Map<string, string>()
  return dataRows.map((row, index) => {
    const shotNumber = String(row[shotColumnIndex] ?? '').trim()
    if (!shotNumber) throw new Error(`“分镜表”第 ${index + 2} 行的“镜号”为空，无法恢复镜头分组。`)
    const shotId = shotIdByNumber.get(shotNumber) ?? createImportedId('excel-shot', shotIdByNumber.size)
    shotIdByNumber.set(shotNumber, shotId)
    return { rowId: createImportedId('excel-row', index), shotId }
  })
}

export const parseShotTableWorkbook = (bytes: Uint8Array): ShotTableWorkbookImport => {
  const sheets = parseXlsxWorkbook(bytes)
  const storyboard = sheets.find((sheet) => sheet.name === STORYBOARD_SHEET)
  const settings = sheets.find((sheet) => sheet.name === COLUMN_SETTINGS_SHEET)
  const overviewSheet = sheets.find((sheet) => sheet.name === OVERVIEW_SHEET)
  if (!storyboard) throw new Error('Excel 缺少“分镜表”工作表。')
  if (!settings) throw new Error('Excel 缺少“列设置”工作表，无法确认镜头列与时序列。')
  if (!overviewSheet) throw new Error('Excel 缺少“镜头总览”工作表。')
  const settingsResult = readSettingsColumns(settings)
  const columns = settingsResult.columns
  if (columns.length === 0) throw new Error('“列设置”至少需要一列。')
  const headerLabels = (storyboard.rows[0] ?? []).map((value) => value.trim())
  if (headerLabels.length !== columns.length || columns.some((column, index) => headerLabels[index] !== column.label)) {
    throw new Error('“分镜表”表头与“列设置”的列顺序不一致。')
  }
  const dataRows = storyboard.rows.slice(1)
    .map((row) => columns.map((_, index) => String(row[index] ?? '')))
    .filter((row) => row.some((value) => value.trim()))
  if (dataRows.length === 0) throw new Error('“分镜表”没有数据行。')

  const warnings: string[] = []
  if (settingsResult.generatedKeys) warnings.push('文件未完整保存列标识，已按列顺序创建新的本地列标识。')
  const structureSheet = sheets.find((sheet) => sheet.name === ROW_STRUCTURE_SHEET)
  const structure = structureSheet
    ? readStructureRows(structureSheet, dataRows.length)
    : deriveStructureFromShotNumber(dataRows, columns)
  if (!structureSheet) warnings.push('文件没有“行结构”工作表，已按“镜号”的精确值恢复镜头分组。')

  const rows: ShotTableRow[] = dataRows.map((row, index) => ({
    id: structure[index]!.rowId,
    shotId: structure[index]!.shotId,
    values: Object.fromEntries(columns.map((column, columnIndex) => [column.key, row[columnIndex] ?? ''])),
  }))
  const overview = readOverview(overviewSheet)
  const actualShotCount = String(new Set(rows.map((row) => row.shotId)).size)
  if (!overview['总镜数']) throw new Error('“镜头总览”缺少“总镜数”。')
  if (overview['总镜数'].trim() !== actualShotCount) {
    throw new Error(`“镜头总览”的总镜数为 ${overview['总镜数']}，但行结构实际为 ${actualShotCount}。`)
  }
  return { table: { version: 1, overview, columns, rows }, warnings }
}

export const downloadShotTableWorkbook = (table: ShotTableData, rawFileName = '分镜表'): void => {
  const bytes = buildShotTableWorkbook(table)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeName = rawFileName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.xlsx$/i, '') || '分镜表'
  link.href = url
  link.download = `${safeName}.xlsx`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
