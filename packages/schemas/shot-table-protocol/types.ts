export type ShotTableColumnScope = 'shot' | 'timeline'

export type ShotTableColumn = {
  key: string
  label: string
  scope: ShotTableColumnScope
}

export type ShotTableRow = {
  id: string
  shotId: string
  values: Record<string, string>
}

export type ShotTableData = {
  version: 1
  overview: Record<string, string>
  columns: ShotTableColumn[]
  rows: ShotTableRow[]
}

export type ShotTableAnalysisShot = {
  shot: Record<string, string>
  timeline: Array<Record<string, string>>
}

export type ShotTableAnalysisPayload = {
  version: 1
  overview: Record<string, string>
  shots: ShotTableAnalysisShot[]
}

export type ShotTableAnalysisPathSegment = string | number

export type ShotTableAnalysisViolationCode =
  | 'column_contract_invalid'
  | 'json_empty'
  | 'json_invalid'
  | 'expected_object'
  | 'expected_array'
  | 'expected_string'
  | 'missing_field'
  | 'unexpected_field'
  | 'empty_array'
  | 'invalid_version'
  | 'invalid_shot_count'
  | 'duplicate_shot_number'
  | 'invalid_time_range'
  | 'invalid_duration'
  | 'duration_mismatch'
  | 'non_contiguous_time_range'
  | 'time_range_outside_parent'
  | 'non_observation_value'

export type ShotTableAnalysisExpectedValue =
  | 'column_contract'
  | 'json'
  | 'object'
  | 'array'
  | 'non_empty_array'
  | 'string'
  | 'version_1'
  | 'declared_fields_only'
  | 'shot_count_matching_array'
  | 'unique_shot_number'
  | 'time_range'
  | 'positive_duration'
  | 'duration_matching_range'
  | 'contiguous_time_range'
  | 'time_range_inside_parent'
  | 'empty_observation_only_field'

export type ShotTableAnalysisActualValue =
  | 'missing'
  | 'null'
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'undefined'
  | 'other'

export type ShotTableAnalysisViolation = {
  code: ShotTableAnalysisViolationCode
  path: ShotTableAnalysisPathSegment[]
  expected: ShotTableAnalysisExpectedValue
  actual: ShotTableAnalysisActualValue
  message: string
}

export type ShotTableAnalysisDetailedResult =
  | {
      ok: true
      table: ShotTableData
      document: ShotTableAnalysisPayload
    }
  | {
      ok: false
      issues: string[]
      violations: ShotTableAnalysisViolation[]
      document: unknown | null
    }

export type ShotTableParseResult =
  | { ok: true; table: ShotTableData }
  | { ok: false; issues: string[] }

export type ShotTableParseOptions = {
  expectedColumns?: readonly ShotTableColumn[]
}

export type ShotTableAnalysisValidationOptions = {
  /** media-worker 实测的媒体时长；传入后必须与总览及最后一镜尾时码一致。 */
  expectedDurationSeconds?: number
  /** 容纳媒体封装与毫秒舍入的误差，默认 0.25 秒。 */
  durationToleranceSeconds?: number
}

export const isShotTableRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
