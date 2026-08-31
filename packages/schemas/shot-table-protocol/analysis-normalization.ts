import { resolveShotTableColumnContract } from './column-contract'
import { DEFAULT_SHOT_TABLE_COLUMNS, SHOT_TABLE_OVERVIEW_ORDER } from './defaults'
import { inspectShotTableAnalysisInvariants } from './analysis-invariants'
import { isShotTableRecord } from './types'
import type {
  ShotTableAnalysisActualValue,
  ShotTableAnalysisDetailedResult,
  ShotTableAnalysisPathSegment,
  ShotTableAnalysisPayload,
  ShotTableAnalysisShot,
  ShotTableAnalysisViolation,
  ShotTableAnalysisValidationOptions,
  ShotTableColumn,
  ShotTableParseResult,
  ShotTableRow,
} from './types'

type StringRecordResult = {
  value: Record<string, string> | null
  violations: ShotTableAnalysisViolation[]
}

const readActualValue = (value: unknown, present = true): ShotTableAnalysisActualValue => {
  if (!present) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'undefined') return 'undefined'
  return 'other'
}

const violation = (
  input: Omit<ShotTableAnalysisViolation, 'path'> & {
    path: readonly ShotTableAnalysisPathSegment[]
  },
): ShotTableAnalysisViolation => ({ ...input, path: [...input.path] })

const failure = (
  document: unknown | null,
  violations: ShotTableAnalysisViolation[],
): ShotTableAnalysisDetailedResult => ({
  ok: false,
  issues: violations.map((entry) => entry.message),
  violations,
  document,
})

const readExactStringRecord = (
  value: unknown,
  expectedKeys: readonly string[],
  context: string,
  path: readonly ShotTableAnalysisPathSegment[],
): StringRecordResult => {
  if (!isShotTableRecord(value)) {
    return {
      value: null,
      violations: [violation({
        code: 'expected_object',
        path,
        expected: 'object',
        actual: readActualValue(value),
        message: `${context}不是对象。`,
      })],
    }
  }

  const violations: ShotTableAnalysisViolation[] = []
  const expected = new Set(expectedKeys)
  for (const key of expectedKeys) {
    const present = Object.prototype.hasOwnProperty.call(value, key)
    if (!present) {
      violations.push(violation({
        code: 'missing_field',
        path: [...path, key],
        expected: 'string',
        actual: 'missing',
        message: `${context}缺少字段：${key}。`,
      }))
      continue
    }
    const raw = value[key]
    if (typeof raw !== 'string') {
      violations.push(violation({
        code: 'expected_string',
        path: [...path, key],
        expected: 'string',
        actual: readActualValue(raw),
        message: `${context}的“${key}”不是字符串。`,
      }))
    }
  }
  for (const key of Object.keys(value)) {
    if (expected.has(key)) continue
    violations.push(violation({
      code: 'unexpected_field',
      path: [...path, key],
      expected: 'declared_fields_only',
      actual: readActualValue(value[key]),
      message: `${context}包含未声明字段：${key}。`,
    }))
  }
  if (violations.length > 0) return { value: null, violations }

  const output: Record<string, string> = {}
  for (const key of expectedKeys) {
    const raw = value[key]
    if (typeof raw === 'string') output[key] = raw.trim()
  }
  return { value: output, violations: [] }
}

const readAnalysisShot = (
  value: unknown,
  index: number,
  shotKeys: readonly string[],
  timelineKeys: readonly string[],
): { value: ShotTableAnalysisShot | null; violations: ShotTableAnalysisViolation[] } => {
  const context = `第 ${index + 1} 个镜头`
  const path: ShotTableAnalysisPathSegment[] = ['shots', index]
  if (!isShotTableRecord(value)) {
    return {
      value: null,
      violations: [violation({
        code: 'expected_object',
        path,
        expected: 'object',
        actual: readActualValue(value),
        message: `${context}不是对象。`,
      })],
    }
  }

  const violations: ShotTableAnalysisViolation[] = []
  const rootKeys = new Set(['shot', 'timeline'])
  for (const key of Object.keys(value)) {
    if (rootKeys.has(key)) continue
    violations.push(violation({
      code: 'unexpected_field',
      path: [...path, key],
      expected: 'declared_fields_only',
      actual: readActualValue(value[key]),
      message: `${context}包含未声明字段：${key}。`,
    }))
  }

  let shot: StringRecordResult
  if (!Object.prototype.hasOwnProperty.call(value, 'shot')) {
    shot = {
      value: null,
      violations: [violation({
        code: 'missing_field',
        path: [...path, 'shot'],
        expected: 'object',
        actual: 'missing',
        message: `${context}缺少 shot 对象。`,
      })],
    }
  } else {
    shot = readExactStringRecord(value.shot, shotKeys, `${context}的 shot`, [...path, 'shot'])
  }
  violations.push(...shot.violations)

  const timeline: Array<Record<string, string>> = []
  if (!Object.prototype.hasOwnProperty.call(value, 'timeline')) {
    violations.push(violation({
      code: 'missing_field',
      path: [...path, 'timeline'],
      expected: 'array',
      actual: 'missing',
      message: `${context}缺少 timeline 数组。`,
    }))
  } else if (!Array.isArray(value.timeline)) {
    violations.push(violation({
      code: 'expected_array',
      path: [...path, 'timeline'],
      expected: 'array',
      actual: readActualValue(value.timeline),
      message: `${context}的 timeline 不是数组。`,
    }))
  } else if (value.timeline.length === 0) {
    violations.push(violation({
      code: 'empty_array',
      path: [...path, 'timeline'],
      expected: 'non_empty_array',
      actual: 'array',
      message: `${context}的 timeline 至少需要一个时序段。`,
    }))
  } else {
    value.timeline.forEach((entry, timelineIndex) => {
      const parsed = readExactStringRecord(
        entry,
        timelineKeys,
        `${context}第 ${timelineIndex + 1} 个时序`,
        [...path, 'timeline', timelineIndex],
      )
      violations.push(...parsed.violations)
      if (parsed.value) timeline.push(parsed.value)
    })
  }

  return violations.length > 0 || !shot.value
    ? { value: null, violations }
    : { value: { shot: shot.value, timeline }, violations: [] }
}

export const normalizeShotTableAnalysisDetailed = (
  value: unknown,
  columns: readonly ShotTableColumn[] = DEFAULT_SHOT_TABLE_COLUMNS,
  options: ShotTableAnalysisValidationOptions = {},
): ShotTableAnalysisDetailedResult => {
  const resolved = resolveShotTableColumnContract(columns)
  if (!resolved.ok) {
    return failure(value, resolved.issues.map((message) => violation({
      code: 'column_contract_invalid',
      path: [],
      expected: 'column_contract',
      actual: 'other',
      message,
    })))
  }
  if (!isShotTableRecord(value)) {
    return failure(value, [violation({
      code: 'expected_object',
      path: [],
      expected: 'object',
      actual: readActualValue(value),
      message: '分镜分析结果不是对象。',
    })])
  }

  const violations: ShotTableAnalysisViolation[] = []
  const rootKeys = new Set(['version', 'overview', 'shots'])
  for (const key of Object.keys(value)) {
    if (rootKeys.has(key)) continue
    violations.push(violation({
      code: 'unexpected_field',
      path: [key],
      expected: 'declared_fields_only',
      actual: readActualValue(value[key]),
      message: `分镜分析结果包含未声明字段：${key}。`,
    }))
  }
  if (value.version !== 1) {
    violations.push(violation({
      code: 'invalid_version',
      path: ['version'],
      expected: 'version_1',
      actual: readActualValue(value.version, Object.prototype.hasOwnProperty.call(value, 'version')),
      message: '分镜分析结果版本必须为 1。',
    }))
  }

  let overview: StringRecordResult
  if (!Object.prototype.hasOwnProperty.call(value, 'overview')) {
    overview = {
      value: null,
      violations: [violation({
        code: 'missing_field',
        path: ['overview'],
        expected: 'object',
        actual: 'missing',
        message: '分镜分析结果缺少 overview 对象。',
      })],
    }
  } else {
    overview = readExactStringRecord(
      value.overview,
      SHOT_TABLE_OVERVIEW_ORDER,
      '镜头总览',
      ['overview'],
    )
  }
  violations.push(...overview.violations)

  const shots: ShotTableAnalysisShot[] = []
  if (!Object.prototype.hasOwnProperty.call(value, 'shots')) {
    violations.push(violation({
      code: 'missing_field',
      path: ['shots'],
      expected: 'array',
      actual: 'missing',
      message: '分镜分析结果缺少 shots 数组。',
    }))
  } else if (!Array.isArray(value.shots)) {
    violations.push(violation({
      code: 'expected_array',
      path: ['shots'],
      expected: 'array',
      actual: readActualValue(value.shots),
      message: '分镜分析结果的 shots 不是数组。',
    }))
  } else if (value.shots.length === 0) {
    violations.push(violation({
      code: 'empty_array',
      path: ['shots'],
      expected: 'non_empty_array',
      actual: 'array',
      message: '分镜分析结果至少需要一个镜头。',
    }))
  } else {
    const shotKeys = resolved.value.shotColumns.map((column) => column.key)
    const timelineKeys = resolved.value.timelineColumns.map((column) => column.key)
    value.shots.forEach((entry, index) => {
      const parsed = readAnalysisShot(entry, index, shotKeys, timelineKeys)
      violations.push(...parsed.violations)
      if (parsed.value) shots.push(parsed.value)
    })
  }
  if (violations.length > 0 || !overview.value) return failure(value, violations)

  const payload: ShotTableAnalysisPayload = {
    version: 1,
    overview: overview.value,
    shots,
  }
  const invariantViolations = inspectShotTableAnalysisInvariants(payload, options).map((entry) => violation({
    ...entry,
    actual: 'string',
  }))
  if (invariantViolations.length > 0) return failure(value, invariantViolations)
  const rows: ShotTableRow[] = []
  payload.shots.forEach((entry, shotIndex) => {
    const shotId = `shot-${shotIndex + 1}`
    entry.timeline.forEach((timeline, timelineIndex) => {
      rows.push({
        id: `${shotId}-segment-${timelineIndex + 1}`,
        shotId,
        values: Object.fromEntries(resolved.value.columns.map((column) => [
          column.key,
          column.scope === 'shot' ? entry.shot[column.key] ?? '' : timeline[column.key] ?? '',
        ])),
      })
    })
  })

  return {
    ok: true,
    document: payload,
    table: {
      version: 1,
      overview: payload.overview,
      columns: resolved.value.columns,
      rows,
    },
  }
}

export const normalizeShotTableAnalysis = (
  value: unknown,
  columns: readonly ShotTableColumn[] = DEFAULT_SHOT_TABLE_COLUMNS,
  options: ShotTableAnalysisValidationOptions = {},
): ShotTableParseResult => {
  const result = normalizeShotTableAnalysisDetailed(value, columns, options)
  return result.ok ? { ok: true, table: result.table } : { ok: false, issues: result.issues }
}

export const inspectShotTableAnalysisJson = (
  rawText: string,
  columns: readonly ShotTableColumn[] = DEFAULT_SHOT_TABLE_COLUMNS,
  options: ShotTableAnalysisValidationOptions = {},
): ShotTableAnalysisDetailedResult => {
  const text = rawText.trim()
  if (!text) {
    return failure(null, [violation({
      code: 'json_empty',
      path: [],
      expected: 'json',
      actual: 'missing',
      message: '分镜分析 JSON 为空。',
    })])
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error: unknown) {
    return failure(null, [violation({
      code: 'json_invalid',
      path: [],
      expected: 'json',
      actual: 'string',
      message: `分镜分析结果不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    })])
  }
  return normalizeShotTableAnalysisDetailed(parsed, columns, options)
}

export const parseShotTableAnalysisJson = (
  rawText: string,
  columns: readonly ShotTableColumn[] = DEFAULT_SHOT_TABLE_COLUMNS,
  options: ShotTableAnalysisValidationOptions = {},
): ShotTableParseResult => {
  const result = inspectShotTableAnalysisJson(rawText, columns, options)
  return result.ok ? { ok: true, table: result.table } : { ok: false, issues: result.issues }
}
