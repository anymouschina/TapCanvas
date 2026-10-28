import type { SubtitleSegment } from './types'

/** One editable clip's source interval and composition position, in microseconds. */
export type ClipWindow = {
  sourceUrl: string
  sourceInstanceId: string
  sourceOffsetUs: number
  trimStart: number
  trimEnd: number
  duration: number
  timelineStartUs: number
}

export type SubtitleSourceRange = {
  sourceUrl: string
  sourceInstanceId: string
  startUs: number
  endUs: number
}

export type TimelineSubtitle = {
  startUs: number
  endUs: number
  text: string
  /** A visible instance ID, distinct from the persisted source segment ID. */
  segmentId: string
  sourceSegmentId?: string
  sourceRanges?: SubtitleSourceRange[]
}

/** Anonymous inputs are distinguished by occurrence within their own URL, not global order. */
export function subtitleSourceInstanceIds(sources: Array<{ url: string; sourceInstanceId?: string }>): string[] {
  const occurrences = new Map<string, number>()
  const ids = sources.map((source) => {
    const occurrence = occurrences.get(source.url) ?? 0
    occurrences.set(source.url, occurrence + 1)
    return source.sourceInstanceId ?? JSON.stringify([source.url, occurrence])
  })
  if (new Set(ids).size !== ids.length) throw new Error('视频素材实例标识重复')
  return ids
}

/** Invert a composition interval through every intersecting cut. */
export function subtitleSourceRanges(startUs: number, endUs: number, windows: ClipWindow[]): SubtitleSourceRange[] {
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || startUs < 0 || endUs <= startUs) {
    throw new Error('字幕时间范围无效')
  }
  const ranges: SubtitleSourceRange[] = []
  for (const window of windows) {
    const duration = window.duration - window.trimStart - window.trimEnd
    const start = Math.max(startUs, window.timelineStartUs)
    const end = Math.min(endUs, window.timelineStartUs + duration)
    if (end <= start) continue
    const sourceStart = window.sourceOffsetUs + window.trimStart
    const range = { sourceUrl: window.sourceUrl, sourceInstanceId: window.sourceInstanceId,
      startUs: Math.round(sourceStart + start - window.timelineStartUs),
      endUs: Math.round(sourceStart + end - window.timelineStartUs) }
    const previous = ranges[ranges.length - 1]
    if (previous && previous.sourceInstanceId === range.sourceInstanceId && previous.sourceUrl === range.sourceUrl && previous.endUs === range.startUs) previous.endUs = range.endUs
    else ranges.push(range)
  }
  if (ranges.length === 0) throw new Error('字幕时间范围未落在任何视频素材内')
  return ranges
}

/** Project each occurrence independently; only continuous source cuts form one editable instance. */
export function projectSegmentsToTimeline(segments: SubtitleSegment[], windows: ClipWindow[]): TimelineSubtitle[] {
  const out: TimelineSubtitle[] = []
  for (const segment of segments) {
    let previous: TimelineSubtitle | undefined
    const instanceCounts = new Map<string, number>()
    for (const window of windows) {
      if (segment.sourceUrl !== window.sourceUrl || (segment.sourceInstanceId !== undefined && segment.sourceInstanceId !== window.sourceInstanceId)) continue
      const usedStart = window.sourceOffsetUs + window.trimStart
      const usedEnd = window.sourceOffsetUs + window.duration - window.trimEnd
      const start = Math.max(segment.startUs, usedStart)
      const end = Math.min(segment.endUs, usedEnd)
      if (end <= start) continue
      const startUs = window.timelineStartUs + start - usedStart
      const endUs = window.timelineStartUs + end - usedStart
      const range = { sourceUrl: window.sourceUrl, sourceInstanceId: window.sourceInstanceId, startUs: start, endUs: end }
      const previousRange = previous?.sourceRanges?.[0]
      if (previous && previousRange && previousRange.sourceInstanceId === window.sourceInstanceId && previous.endUs === startUs && previousRange.endUs === start) {
        previous.endUs = endUs
        previousRange.endUs = end
      } else {
        const instanceIndex = instanceCounts.get(window.sourceInstanceId) ?? 0
        instanceCounts.set(window.sourceInstanceId, instanceIndex + 1)
        previous = { startUs, endUs, text: segment.text,
          segmentId: JSON.stringify([segment.id, window.sourceInstanceId, instanceIndex]),
          sourceSegmentId: segment.id, sourceRanges: [range] }
        out.push(previous)
      }
    }
  }
  return out.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
}

type SubtitleInstanceEdit = { startUs: number; endUs: number } | { text: string } | { delete: true }

function subtractRanges(segment: SubtitleSourceRange, removed: SubtitleSourceRange[]): SubtitleSourceRange[] {
  return removed.reduce<SubtitleSourceRange[]>((remaining, range) => remaining.flatMap((part) => {
    if (part.sourceUrl !== range.sourceUrl || part.sourceInstanceId !== range.sourceInstanceId || range.endUs <= part.startUs || range.startUs >= part.endUs) return [part]
    return [
      ...(range.startUs > part.startUs ? [{ ...part, endUs: range.startUs }] : []),
      ...(range.endUs < part.endUs ? [{ ...part, startUs: range.endUs }] : []),
    ]
  }), [segment])
}

/** Replace only the selected visible instance; keep hidden source text and all other occurrences. */
export function editTimelineSubtitle(
  segments: SubtitleSegment[], windows: ClipWindow[], instanceId: string,
  edit: SubtitleInstanceEdit, createId: () => string,
): { segments: SubtitleSegment[]; selectedSegmentId: string | null } {
  const target = projectSegmentsToTimeline(segments, windows).find((item) => item.segmentId === instanceId)
  const original = segments.find((segment) => segment.id === target?.sourceSegmentId)
  const originalRanges = target?.sourceRanges
  if (!target || !original || !originalRanges?.length) throw new Error('找不到所选字幕实例，请重新选择字幕')
  const replacements = 'delete' in edit ? [] : 'text' in edit ? originalRanges : subtitleSourceRanges(edit.startUs, edit.endUs, windows)
  const text = 'text' in edit ? edit.text : original.text
  const sourceInstances = original.sourceInstanceId !== undefined ? [original.sourceInstanceId]
    : [...new Set(windows.filter((window) => window.sourceUrl === original.sourceUrl).map((window) => window.sourceInstanceId))]
  const preserved = sourceInstances.flatMap((sourceInstanceId) => subtractRanges({ sourceUrl: original.sourceUrl, sourceInstanceId, startUs: original.startUs, endUs: original.endUs }, originalRanges)
    .map((range): SubtitleSegment => ({ ...original, ...range, id: createId() })))
  const updated = replacements.map((range, index): SubtitleSegment => ({ ...original, ...range, id: index === 0 ? original.id : createId(), text }))
  const next = segments.flatMap((segment) => segment.id === original.id ? [...preserved, ...updated] : [segment])
  const selected = updated[0] && projectSegmentsToTimeline(next, windows).find((item) => item.sourceSegmentId === updated[0].id)
  return { segments: next, selectedSegmentId: selected?.segmentId ?? null }
}
