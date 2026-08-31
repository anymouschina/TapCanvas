import {
  normalizeShotTable,
  type ShotTableColumn,
  type ShotTableData,
  type ShotTableRow,
} from '@tapcanvas/shot-table-protocol'

export const SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS = 15

const TIME_UNITS_PER_SECOND = 1_000_000

type ParsedTimelineRow = {
  row: ShotTableRow
  start: number
  end: number
}

type ClippedTimelineRow = {
  row: ShotTableRow
  localStart: number
  localEnd: number
}

type TimeRange = {
  start: number
  end: number
}

export type ShotTableSplitSegment = {
  index: number
  table: ShotTableData
  sourceStartSeconds: number
  sourceEndSeconds: number
  durationSeconds: number
  sourceRangeLabel: string
  durationLabel: string
}

export type ShotTableSplitPlan = {
  sourceStartSeconds: number
  sourceEndSeconds: number
  totalDurationSeconds: number
  maxDurationSeconds: number
  requiresSplit: boolean
  segments: ShotTableSplitSegment[]
}

const parseUnsignedInteger = (value: string): number | null => {
  if (!/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const parseSecondsComponent = (value: string): number | null => {
  const match = /^(\d+)(?:[.,](\d{1,6}))?$/u.exec(value)
  if (!match) return null
  const seconds = parseUnsignedInteger(match[1] ?? '')
  if (seconds === null) return null
  const fraction = (match[2] ?? '').padEnd(6, '0')
  const fractionalUnits = fraction ? parseUnsignedInteger(fraction) : 0
  if (fractionalUnits === null) return null
  const units = seconds * TIME_UNITS_PER_SECOND + fractionalUnits
  return Number.isSafeInteger(units) ? units : null
}

const parseTimePoint = (rawValue: string): number | null => {
  const normalized = rawValue
    .trim()
    .replace(/\s*(?:seconds?|secs?|sec|s|秒钟?)\s*$/iu, '')
    .trim()
  if (!normalized) return null
  const parts = normalized.split(':').map((part) => part.trim())
  if (parts.length === 1) return parseSecondsComponent(parts[0] ?? '')
  if (parts.length !== 2 && parts.length !== 3) return null

  const seconds = parseSecondsComponent(parts[parts.length - 1] ?? '')
  const minutes = parseUnsignedInteger(parts[parts.length - 2] ?? '')
  const hours = parts.length === 3 ? parseUnsignedInteger(parts[0] ?? '') : 0
  if (seconds === null || minutes === null || hours === null) return null
  if (seconds >= 60 * TIME_UNITS_PER_SECOND) return null
  if (parts.length === 3 && minutes >= 60) return null
  const units = (
    hours * 60 * 60 * TIME_UNITS_PER_SECOND
    + minutes * 60 * TIME_UNITS_PER_SECOND
    + seconds
  )
  return Number.isSafeInteger(units) ? units : null
}

const parseTimeRange = (value: string): TimeRange | null => {
  const parts = value
    .trim()
    .split(/\s*(?:-->|→|至|到|[–—~～－-])\s*/u)
  if (parts.length !== 2) return null
  const start = parseTimePoint(parts[0] ?? '')
  const end = parseTimePoint(parts[1] ?? '')
  if (start === null || end === null || end <= start) return null
  return { start, end }
}

const formatFraction = (units: number): string => {
  if (units === 0) return ''
  return `.${String(units).padStart(6, '0').replace(/0+$/u, '')}`
}

const formatTimePoint = (totalUnits: number): string => {
  if (!Number.isSafeInteger(totalUnits) || totalUnits < 0) {
    throw new Error('分镜拆分产生了无效时间点。')
  }
  const wholeSeconds = Math.floor(totalUnits / TIME_UNITS_PER_SECOND)
  const fraction = totalUnits % TIME_UNITS_PER_SECOND
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const seconds = wholeSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${formatFraction(fraction)}`
}

const formatRange = (start: number, end: number): string =>
  `${formatTimePoint(start)}–${formatTimePoint(end)}`

const formatDuration = (duration: number): string => {
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('分镜拆分产生了无效片段时长。')
  }
  const wholeSeconds = Math.floor(duration / TIME_UNITS_PER_SECOND)
  const fraction = duration % TIME_UNITS_PER_SECOND
  return `${wholeSeconds}${formatFraction(fraction)}s`
}

const findCanonicalColumn = (
  columns: readonly ShotTableColumn[],
  scope: ShotTableColumn['scope'],
  canonicalName: string,
  required: boolean,
): ShotTableColumn | null => {
  const matches = columns.filter((column) =>
    column.scope === scope
    && (column.key === canonicalName || column.label === canonicalName))
  if (matches.length > 1) {
    throw new Error(`分镜表存在多个“${canonicalName}”列，无法确定拆分时间轴。`)
  }
  if (matches.length === 0) {
    if (required) throw new Error(`分镜表缺少“${canonicalName}”列，无法按真实时间轴拆分。`)
    return null
  }
  return matches[0] ?? null
}

const parseTimelineRows = (
  table: ShotTableData,
  timelineColumn: ShotTableColumn,
): ParsedTimelineRow[] => table.rows.map((row, index) => {
  const rawRange = row.values[timelineColumn.key]?.trim() ?? ''
  const parsed = parseTimeRange(rawRange)
  if (!parsed) {
    throw new Error(
      `第 ${index + 1} 行“${timelineColumn.label}”不是可拆分的时间区间：${rawRange || '空值'}。请先改成例如 00:00:00–00:00:12.5。`,
    )
  }
  return { row, ...parsed }
})

const buildSegmentBoundaries = (
  sourceStart: number,
  sourceEnd: number,
  segmentCount: number,
): number[] => {
  const total = sourceEnd - sourceStart
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    sourceStart + Math.round((total * index) / segmentCount))
}

const collectShotBounds = (rows: readonly ClippedTimelineRow[]): Map<string, TimeRange> => {
  const bounds = new Map<string, TimeRange>()
  rows.forEach(({ row, localStart, localEnd }) => {
    const existing = bounds.get(row.shotId)
    bounds.set(row.shotId, existing
      ? { start: Math.min(existing.start, localStart), end: Math.max(existing.end, localEnd) }
      : { start: localStart, end: localEnd })
  })
  return bounds
}

const buildSegmentTable = (input: {
  table: ShotTableData
  parsedRows: readonly ParsedTimelineRow[]
  timelineColumn: ShotTableColumn
  shotRangeColumn: ShotTableColumn | null
  shotDurationColumn: ShotTableColumn | null
  sourceStart: number
  sourceEnd: number
  segmentIndex: number
  segmentCount: number
}): ShotTableData => {
  const clippedRows: ClippedTimelineRow[] = []
  input.parsedRows.forEach(({ row, start, end }) => {
    const overlapStart = Math.max(start, input.sourceStart)
    const overlapEnd = Math.min(end, input.sourceEnd)
    if (overlapEnd <= overlapStart) return
    clippedRows.push({
      row,
      localStart: overlapStart - input.sourceStart,
      localEnd: overlapEnd - input.sourceStart,
    })
  })
  if (clippedRows.length === 0) {
    throw new Error(
      `均匀拆分后的第 ${input.segmentIndex + 1} 段（${formatRange(input.sourceStart, input.sourceEnd)}）没有任何时序行。请先补齐分镜表时间轴中的空档。`,
    )
  }

  const shotBounds = collectShotBounds(clippedRows)
  const rows = clippedRows.map(({ row, localStart, localEnd }) => {
    const shotRange = shotBounds.get(row.shotId)
    if (!shotRange) throw new Error(`镜头 ${row.shotId} 缺少可追溯的拆分区间。`)
    const values = {
      ...row.values,
      [input.timelineColumn.key]: formatRange(localStart, localEnd),
      ...(input.shotRangeColumn
        ? { [input.shotRangeColumn.key]: formatRange(shotRange.start, shotRange.end) }
        : {}),
      ...(input.shotDurationColumn
        ? { [input.shotDurationColumn.key]: formatDuration(shotRange.end - shotRange.start) }
        : {}),
    }
    return { ...row, values }
  })
  const sourceTitle = input.table.overview['集数/标题']?.trim() ?? ''
  const segmentDuration = input.sourceEnd - input.sourceStart
  return {
    version: 1,
    columns: input.table.columns.map((column) => ({ ...column })),
    rows,
    overview: {
      ...input.table.overview,
      '集数/标题': sourceTitle
        ? `${sourceTitle} · 片段 ${input.segmentIndex + 1}/${input.segmentCount}`
        : `片段 ${input.segmentIndex + 1}/${input.segmentCount}`,
      总镜数: String(shotBounds.size),
      素材总时长: formatDuration(segmentDuration),
      节拍数: String(rows.length),
      来源时间区间: formatRange(input.sourceStart, input.sourceEnd),
    },
  }
}

export const createEvenShotTableSplitPlan = (
  sourceTable: ShotTableData,
  maxDurationSeconds = SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS,
): ShotTableSplitPlan => {
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new Error('分镜表拆分上限必须是大于 0 的有限秒数。')
  }
  const maxDuration = Math.round(maxDurationSeconds * TIME_UNITS_PER_SECOND)
  if (!Number.isSafeInteger(maxDuration) || maxDuration <= 0) {
    throw new Error('分镜表拆分上限超出可安全处理的时间精度。')
  }
  const normalized = normalizeShotTable(sourceTable)
  if (!normalized.ok) throw new Error(`分镜表数据无效：${normalized.issues.join('；')}`)
  const table = normalized.table
  const timelineColumn = findCanonicalColumn(table.columns, 'timeline', '时间段', true)
  if (!timelineColumn) throw new Error('分镜表缺少时序时间列。')
  const shotRangeColumn = findCanonicalColumn(table.columns, 'shot', '时间区间（镜头完整区间）', false)
  const shotDurationColumn = findCanonicalColumn(table.columns, 'shot', '时长', false)
  const parsedRows = parseTimelineRows(table, timelineColumn)
  const sourceStart = Math.min(...parsedRows.map((row) => row.start))
  const sourceEnd = Math.max(...parsedRows.map((row) => row.end))
  const totalDuration = sourceEnd - sourceStart
  if (!Number.isSafeInteger(totalDuration) || totalDuration <= 0) {
    throw new Error('分镜表时间轴没有形成有效的正时长区间。')
  }
  const segmentCount = Math.ceil(totalDuration / maxDuration)
  const boundaries = buildSegmentBoundaries(sourceStart, sourceEnd, segmentCount)
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const segmentStart = boundaries[index]
    const segmentEnd = boundaries[index + 1]
    if (segmentStart === undefined || segmentEnd === undefined || segmentEnd <= segmentStart) {
      throw new Error(`第 ${index + 1} 段没有形成有效的均匀时间边界。`)
    }
    const duration = segmentEnd - segmentStart
    if (duration > maxDuration) {
      throw new Error(`第 ${index + 1} 段时长 ${formatDuration(duration)} 超过 ${maxDurationSeconds}s 上限。`)
    }
    return {
      index,
      table: buildSegmentTable({
        table,
        parsedRows,
        timelineColumn,
        shotRangeColumn,
        shotDurationColumn,
        sourceStart: segmentStart,
        sourceEnd: segmentEnd,
        segmentIndex: index,
        segmentCount,
      }),
      sourceStartSeconds: segmentStart / TIME_UNITS_PER_SECOND,
      sourceEndSeconds: segmentEnd / TIME_UNITS_PER_SECOND,
      durationSeconds: duration / TIME_UNITS_PER_SECOND,
      sourceRangeLabel: formatRange(segmentStart, segmentEnd),
      durationLabel: formatDuration(duration),
    }
  })

  return {
    sourceStartSeconds: sourceStart / TIME_UNITS_PER_SECOND,
    sourceEndSeconds: sourceEnd / TIME_UNITS_PER_SECOND,
    totalDurationSeconds: totalDuration / TIME_UNITS_PER_SECOND,
    maxDurationSeconds,
    requiresSplit: segmentCount > 1,
    segments,
  }
}
