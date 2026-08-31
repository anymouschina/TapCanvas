import type {
  ShotTableColumnScope,
  ShotTableData,
  ShotTableRow,
} from '@tapcanvas/shot-table-protocol'

export type ShotTableIdFactory = (prefix: 'shot' | 'row' | 'column') => string

const withShotCount = (table: ShotTableData): ShotTableData => ({
  ...table,
  overview: {
    ...table.overview,
    总镜数: String(new Set(table.rows.map((row) => row.shotId)).size),
  },
})

const findColumn = (table: ShotTableData, columnKey: string) => {
  const column = table.columns.find((candidate) => candidate.key === columnKey)
  if (!column) throw new Error(`分镜表不存在列：${columnKey}`)
  return column
}

export const updateShotTableCell = (
  table: ShotTableData,
  rowId: string,
  columnKey: string,
  value: string,
): ShotTableData => {
  const column = findColumn(table, columnKey)
  const target = table.rows.find((row) => row.id === rowId)
  if (!target) throw new Error(`分镜表不存在行：${rowId}`)
  return {
    ...table,
    rows: table.rows.map((row) => {
      const shouldUpdate = column.scope === 'shot' ? row.shotId === target.shotId : row.id === rowId
      return shouldUpdate ? { ...row, values: { ...row.values, [columnKey]: value } } : row
    }),
  }
}

export const updateShotTableOverview = (
  table: ShotTableData,
  key: string,
  value: string,
): ShotTableData => ({
  ...table,
  overview: { ...table.overview, [key]: value },
})

export const addTimelineRow = (
  table: ShotTableData,
  afterRowId: string,
  createId: ShotTableIdFactory,
): ShotTableData => {
  const index = table.rows.findIndex((row) => row.id === afterRowId)
  if (index < 0) throw new Error(`分镜表不存在行：${afterRowId}`)
  const source = table.rows[index]
  if (!source) throw new Error(`分镜表不存在行：${afterRowId}`)
  const values = Object.fromEntries(table.columns.map((column) => [
    column.key,
    column.scope === 'shot' ? source.values[column.key] ?? '' : '',
  ]))
  const row: ShotTableRow = { id: createId('row'), shotId: source.shotId, values }
  return { ...table, rows: [...table.rows.slice(0, index + 1), row, ...table.rows.slice(index + 1)] }
}

const nextShotNumber = (table: ShotTableData): string => {
  const shotColumn = table.columns.find((column) => column.label === '镜号')
  if (!shotColumn) return ''
  const numbers = table.rows.flatMap((row) => {
    const match = /^M(\d+)$/i.exec(row.values[shotColumn.key]?.trim() ?? '')
    return match ? [Number(match[1])] : []
  }).filter(Number.isFinite)
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1
  return `M${String(next).padStart(3, '0')}`
}

export const addShotRow = (
  table: ShotTableData,
  afterRowId: string | null,
  createId: ShotTableIdFactory,
): ShotTableData => {
  const sourceIndex = afterRowId ? table.rows.findIndex((row) => row.id === afterRowId) : table.rows.length - 1
  if (afterRowId && sourceIndex < 0) throw new Error(`分镜表不存在行：${afterRowId}`)
  const sourceShotId = table.rows[sourceIndex]?.shotId
  let insertionIndex = sourceIndex + 1
  while (sourceShotId && table.rows[insertionIndex]?.shotId === sourceShotId) insertionIndex += 1
  const values = Object.fromEntries(table.columns.map((column) => [
    column.key,
    column.label === '镜号' ? nextShotNumber(table) : '',
  ]))
  const row: ShotTableRow = { id: createId('row'), shotId: createId('shot'), values }
  return withShotCount({
    ...table,
    rows: [...table.rows.slice(0, insertionIndex), row, ...table.rows.slice(insertionIndex)],
  })
}

export const duplicateTimelineRow = (
  table: ShotTableData,
  rowId: string,
  createId: ShotTableIdFactory,
): ShotTableData => {
  const index = table.rows.findIndex((row) => row.id === rowId)
  if (index < 0) throw new Error(`分镜表不存在行：${rowId}`)
  const source = table.rows[index]
  if (!source) throw new Error(`分镜表不存在行：${rowId}`)
  const duplicate: ShotTableRow = {
    id: createId('row'),
    shotId: source.shotId,
    values: { ...source.values },
  }
  return { ...table, rows: [...table.rows.slice(0, index + 1), duplicate, ...table.rows.slice(index + 1)] }
}

export const deleteShotTableRow = (table: ShotTableData, rowId: string): ShotTableData => {
  if (table.rows.length <= 1) throw new Error('分镜表至少需要保留一行。')
  if (!table.rows.some((row) => row.id === rowId)) throw new Error(`分镜表不存在行：${rowId}`)
  return withShotCount({ ...table, rows: table.rows.filter((row) => row.id !== rowId) })
}

export const addShotTableColumn = (
  table: ShotTableData,
  input: { label: string; scope: ShotTableColumnScope },
  createId: ShotTableIdFactory,
): ShotTableData => {
  const label = input.label.trim()
  if (!label) throw new Error('列名不能为空。')
  if (table.columns.some((column) => column.label === label)) throw new Error(`列名已存在：${label}`)
  const key = createId('column')
  return {
    ...table,
    columns: [...table.columns, { key, label, scope: input.scope }],
    rows: table.rows.map((row) => ({ ...row, values: { ...row.values, [key]: '' } })),
  }
}

export const renameShotTableColumn = (
  table: ShotTableData,
  columnKey: string,
  rawLabel: string,
): ShotTableData => {
  findColumn(table, columnKey)
  const label = rawLabel.trim()
  if (!label) throw new Error('列名不能为空。')
  if (table.columns.some((column) => column.key !== columnKey && column.label === label)) {
    throw new Error(`列名已存在：${label}`)
  }
  return {
    ...table,
    columns: table.columns.map((column) => column.key === columnKey ? { ...column, label } : column),
  }
}

export const changeShotTableColumnScope = (
  table: ShotTableData,
  columnKey: string,
  scope: ShotTableColumnScope,
): ShotTableData => {
  const column = findColumn(table, columnKey)
  if (column.scope === scope) return table
  const firstValueByShot = new Map<string, string>()
  if (scope === 'shot') {
    table.rows.forEach((row) => {
      if (!firstValueByShot.has(row.shotId) || (!firstValueByShot.get(row.shotId) && row.values[columnKey])) {
        firstValueByShot.set(row.shotId, row.values[columnKey] ?? '')
      }
    })
  }
  return {
    ...table,
    columns: table.columns.map((candidate) => candidate.key === columnKey ? { ...candidate, scope } : candidate),
    rows: scope === 'shot'
      ? table.rows.map((row) => ({
          ...row,
          values: { ...row.values, [columnKey]: firstValueByShot.get(row.shotId) ?? '' },
        }))
      : table.rows,
  }
}

export const deleteShotTableColumn = (table: ShotTableData, columnKey: string): ShotTableData => {
  if (table.columns.length <= 1) throw new Error('分镜表至少需要保留一列。')
  findColumn(table, columnKey)
  return {
    ...table,
    columns: table.columns.filter((column) => column.key !== columnKey),
    rows: table.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values).filter(([key]) => key !== columnKey)),
    })),
  }
}

