import type {
  ShotTableAnalysisExpectedValue,
  ShotTableAnalysisPathSegment,
  ShotTableAnalysisPayload,
  ShotTableAnalysisValidationOptions,
  ShotTableAnalysisViolationCode,
} from './types'

export type ShotTableAnalysisInvariantIssue = {
  code: ShotTableAnalysisViolationCode
  path: ShotTableAnalysisPathSegment[]
  expected: ShotTableAnalysisExpectedValue
  message: string
}

type TimeRange = {
  startSeconds: number
  endSeconds: number
}

const INTERNAL_TIME_TOLERANCE_SECONDS = 0.002
const DEFAULT_DURATION_TOLERANCE_SECONDS = 0.25

const issue = (
  code: ShotTableAnalysisViolationCode,
  path: readonly ShotTableAnalysisPathSegment[],
  expected: ShotTableAnalysisExpectedValue,
  message: string,
): ShotTableAnalysisInvariantIssue => ({ code, path: [...path], expected, message })

const parseFraction = (value: string | undefined): number => {
  if (!value) return 0
  return Number(`0.${value}`)
}

const parseTimestampSeconds = (rawValue: string): number | null => {
  const value = rawValue.trim()
  const secondsMatch = value.match(/^(\d+(?:\.\d+)?)\s*(?:s|秒)$/i)
  if (secondsMatch?.[1]) {
    const seconds = Number(secondsMatch[1])
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  }

  const clockMatch = value.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{1,3}))?$/)
  if (!clockMatch?.[1] || !clockMatch[2]) return null
  const leading = Number(clockMatch[1])
  const middle = Number(clockMatch[2])
  const trailing = clockMatch[3] === undefined ? null : Number(clockMatch[3])
  const fraction = parseFraction(clockMatch[4])
  if (![leading, middle, fraction].every(Number.isFinite)) return null
  return trailing === null
    ? leading * 60 + middle + fraction
    : leading * 3600 + middle * 60 + trailing + fraction
}

const parseTimeRange = (rawValue: string): TimeRange | null => {
  const match = rawValue.trim().match(/^(.+?)\s*(?:-|\u2013|\u2014|~|～|至)\s*(.+)$/)
  if (!match?.[1] || !match[2]) return null
  const startSeconds = parseTimestampSeconds(match[1])
  const endSeconds = parseTimestampSeconds(match[2])
  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) return null
  return { startSeconds, endSeconds }
}

const parseDurationSeconds = (rawValue: string): number | null => {
  const seconds = parseTimestampSeconds(rawValue)
  return seconds !== null && seconds > 0 ? seconds : null
}

const differsByMoreThan = (left: number, right: number, tolerance: number): boolean =>
  Math.abs(left - right) > tolerance

const durationText = (seconds: number): string => `${seconds.toFixed(3)}s`

export const inspectShotTableAnalysisInvariants = (
  payload: ShotTableAnalysisPayload,
  options: ShotTableAnalysisValidationOptions = {},
): ShotTableAnalysisInvariantIssue[] => {
  const issues: ShotTableAnalysisInvariantIssue[] = []
  const inferredBeatCount = payload.overview['节拍数'] ?? ''
  if (inferredBeatCount !== '') {
    issues.push(issue(
      'non_observation_value',
      ['overview', '节拍数'],
      'empty_observation_only_field',
      '一阶视频观察表不推断创作节拍，“节拍数”必须为空字符串。',
    ))
  }
  const countText = payload.overview['总镜数'] ?? ''
  if (!/^[1-9]\d*$/.test(countText) || Number(countText) !== payload.shots.length) {
    issues.push(issue(
      'invalid_shot_count',
      ['overview', '总镜数'],
      'shot_count_matching_array',
      `镜头总览的“总镜数”必须是 ${payload.shots.length}，实际为“${countText}”。`,
    ))
  }

  const overviewDurationText = payload.overview['素材总时长'] ?? ''
  const overviewDuration = parseDurationSeconds(overviewDurationText)
  if (overviewDuration === null) {
    issues.push(issue(
      'invalid_duration',
      ['overview', '素材总时长'],
      'positive_duration',
      '镜头总览的“素材总时长”必须是可解析的正数时长，例如 25.000s。',
    ))
  }

  const durationTolerance = options.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS
  if (!Number.isFinite(durationTolerance) || durationTolerance < 0) {
    throw new Error('durationToleranceSeconds 必须是非负有限数。')
  }
  const expectedDuration = options.expectedDurationSeconds
  if (expectedDuration !== undefined && (!Number.isFinite(expectedDuration) || expectedDuration <= 0)) {
    throw new Error('expectedDurationSeconds 必须是正有限数。')
  }
  if (
    overviewDuration !== null
    && expectedDuration !== undefined
    && differsByMoreThan(overviewDuration, expectedDuration, durationTolerance)
  ) {
    issues.push(issue(
      'duration_mismatch',
      ['overview', '素材总时长'],
      'duration_matching_range',
      `素材总时长 ${durationText(overviewDuration)} 与媒体探针时长 ${durationText(expectedDuration)} 不一致。`,
    ))
  }

  const seenShotNumbers = new Set<string>()
  let previousShotEnd: number | null = null
  let finalShotEnd: number | null = null

  payload.shots.forEach((entry, shotIndex) => {
    const shotPath: ShotTableAnalysisPathSegment[] = ['shots', shotIndex, 'shot']
    const shotNumber = entry.shot['镜号'] ?? ''
    if (!shotNumber || seenShotNumbers.has(shotNumber)) {
      issues.push(issue(
        'duplicate_shot_number',
        [...shotPath, '镜号'],
        'unique_shot_number',
        shotNumber
          ? `镜号“${shotNumber}”重复，每个连续镜头必须有唯一镜号。`
          : '镜号不能为空。',
      ))
    } else {
      seenShotNumbers.add(shotNumber)
    }

    const shotRangeText = entry.shot['时间区间（镜头完整区间）'] ?? ''
    const shotRange = parseTimeRange(shotRangeText)
    if (!shotRange) {
      issues.push(issue(
        'invalid_time_range',
        [...shotPath, '时间区间（镜头完整区间）'],
        'time_range',
        `第 ${shotIndex + 1} 个镜头的完整区间无法解析：“${shotRangeText}”。`,
      ))
    }

    const shotDurationText = entry.shot['时长'] ?? ''
    const shotDuration = parseDurationSeconds(shotDurationText)
    if (shotDuration === null) {
      issues.push(issue(
        'invalid_duration',
        [...shotPath, '时长'],
        'positive_duration',
        `第 ${shotIndex + 1} 个镜头的时长无法解析：“${shotDurationText}”。`,
      ))
    }

    if (shotRange) {
      if (shotIndex === 0 && differsByMoreThan(shotRange.startSeconds, 0, INTERNAL_TIME_TOLERANCE_SECONDS)) {
        issues.push(issue(
          'non_contiguous_time_range',
          [...shotPath, '时间区间（镜头完整区间）'],
          'contiguous_time_range',
          `第一个镜头必须从 0.000s 开始，实际从 ${durationText(shotRange.startSeconds)} 开始。`,
        ))
      }
      if (
        previousShotEnd !== null
        && differsByMoreThan(shotRange.startSeconds, previousShotEnd, INTERNAL_TIME_TOLERANCE_SECONDS)
      ) {
        issues.push(issue(
          'non_contiguous_time_range',
          [...shotPath, '时间区间（镜头完整区间）'],
          'contiguous_time_range',
          `第 ${shotIndex + 1} 个镜头应从 ${durationText(previousShotEnd)} 无缝开始，实际为 ${durationText(shotRange.startSeconds)}。`,
        ))
      }
      previousShotEnd = shotRange.endSeconds
      finalShotEnd = shotRange.endSeconds
      if (
        shotDuration !== null
        && differsByMoreThan(
          shotDuration,
          shotRange.endSeconds - shotRange.startSeconds,
          INTERNAL_TIME_TOLERANCE_SECONDS,
        )
      ) {
        issues.push(issue(
          'duration_mismatch',
          [...shotPath, '时长'],
          'duration_matching_range',
          `第 ${shotIndex + 1} 个镜头的时长 ${durationText(shotDuration)} 与完整区间长度 ${durationText(shotRange.endSeconds - shotRange.startSeconds)} 不一致。`,
        ))
      }
    }

    let previousTimelineEnd: number | null = null
    entry.timeline.forEach((timeline, timelineIndex) => {
      const timelinePath: ShotTableAnalysisPathSegment[] = ['shots', shotIndex, 'timeline', timelineIndex, '时间段']
      const rangeText = timeline['时间段'] ?? ''
      const range = parseTimeRange(rangeText)
      if (!range) {
        issues.push(issue(
          'invalid_time_range',
          timelinePath,
          'time_range',
          `第 ${shotIndex + 1} 个镜头第 ${timelineIndex + 1} 个时序段无法解析：“${rangeText}”。`,
        ))
        return
      }
      if (
        shotRange
        && (
          range.startSeconds < shotRange.startSeconds - INTERNAL_TIME_TOLERANCE_SECONDS
          || range.endSeconds > shotRange.endSeconds + INTERNAL_TIME_TOLERANCE_SECONDS
        )
      ) {
        issues.push(issue(
          'time_range_outside_parent',
          timelinePath,
          'time_range_inside_parent',
          `第 ${shotIndex + 1} 个镜头第 ${timelineIndex + 1} 个时序段超出所属镜头完整区间。`,
        ))
      }
      const expectedStart = previousTimelineEnd ?? shotRange?.startSeconds ?? null
      if (
        expectedStart !== null
        && differsByMoreThan(range.startSeconds, expectedStart, INTERNAL_TIME_TOLERANCE_SECONDS)
      ) {
        issues.push(issue(
          'non_contiguous_time_range',
          timelinePath,
          'contiguous_time_range',
          `第 ${shotIndex + 1} 个镜头第 ${timelineIndex + 1} 个时序段应从 ${durationText(expectedStart)} 开始，实际为 ${durationText(range.startSeconds)}。`,
        ))
      }
      previousTimelineEnd = range.endSeconds
    })
    if (
      shotRange
      && previousTimelineEnd !== null
      && differsByMoreThan(previousTimelineEnd, shotRange.endSeconds, INTERNAL_TIME_TOLERANCE_SECONDS)
    ) {
      issues.push(issue(
        'non_contiguous_time_range',
        ['shots', shotIndex, 'timeline', entry.timeline.length - 1, '时间段'],
        'contiguous_time_range',
        `第 ${shotIndex + 1} 个镜头的时序段必须覆盖到镜头尾 ${durationText(shotRange.endSeconds)}，实际结束于 ${durationText(previousTimelineEnd)}。`,
      ))
    }
  })

  if (
    finalShotEnd !== null
    && overviewDuration !== null
    && differsByMoreThan(finalShotEnd, overviewDuration, INTERNAL_TIME_TOLERANCE_SECONDS)
  ) {
    issues.push(issue(
      'duration_mismatch',
      ['overview', '素材总时长'],
      'duration_matching_range',
      `素材总时长 ${durationText(overviewDuration)} 与最后一镜尾时码 ${durationText(finalShotEnd)} 不一致。`,
    ))
  }
  if (
    finalShotEnd !== null
    && expectedDuration !== undefined
    && differsByMoreThan(finalShotEnd, expectedDuration, durationTolerance)
  ) {
    issues.push(issue(
      'duration_mismatch',
      ['shots', payload.shots.length - 1, 'shot', '时间区间（镜头完整区间）'],
      'duration_matching_range',
      `最后一镜尾时码 ${durationText(finalShotEnd)} 与媒体探针时长 ${durationText(expectedDuration)} 不一致。`,
    ))
  }

  return issues
}
