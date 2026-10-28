import type { TimelineSubtitle } from './timeline'

export type SubtitleTimingEdit = 'move' | 'start' | 'end'
export type SubtitleTiming = { startUs: number; endUs: number }
export type SubtitleTimelineItem = {
  key: string
  subtitle: TimelineSubtitle
  lane: number
  leftPx: number
  widthPx: number
}
export type SubtitleTimelineLayout = { items: SubtitleTimelineItem[]; laneCount: number }

/** Adjacent intervals share a lane; overlapping intervals occupy separate lanes. */
export function layoutSubtitleTimeline(
  subtitles: TimelineSubtitle[],
  pxPerUs: number,
  totalUs: number,
): SubtitleTimelineLayout {
  if (!Number.isFinite(pxPerUs) || pxPerUs <= 0 || !Number.isFinite(totalUs) || totalUs <= 0) {
    return { items: [], laneCount: 0 }
  }
  const occurrences = new Map<string, number>()
  const ordered = subtitles.map((subtitle, sourceIndex) => {
    if (!Number.isFinite(subtitle.startUs) || !Number.isFinite(subtitle.endUs) || subtitle.endUs <= subtitle.startUs) {
      throw new RangeError(`字幕 ${subtitle.segmentId} 的时间区间无效`)
    }
    const occurrence = occurrences.get(subtitle.segmentId) ?? 0
    occurrences.set(subtitle.segmentId, occurrence + 1)
    return { subtitle, sourceIndex, key: `${subtitle.segmentId}:${occurrence}` }
  }).sort((a, b) => a.subtitle.startUs - b.subtitle.startUs
    || a.subtitle.endUs - b.subtitle.endUs || a.sourceIndex - b.sourceIndex)

  const occupiedUntilUs: number[] = []
  const items = ordered.map(({ subtitle, key }) => {
    let lane = occupiedUntilUs.findIndex((endUs) => endUs <= subtitle.startUs)
    if (lane < 0) lane = occupiedUntilUs.length
    occupiedUntilUs[lane] = subtitle.endUs
    const leftPx = Math.max(0, subtitle.startUs) * pxPerUs
    const visibleEndPx = Math.min(totalUs, subtitle.endUs) * pxPerUs
    return { key, subtitle, lane, leftPx, widthPx: Math.max(0, visibleEndPx - leftPx) }
  })
  return { items, laneCount: occupiedUntilUs.length }
}

/** Edits integer microseconds, preserving duration on moves and one microsecond on trims. */
export function updateSubtitleTiming(
  edit: SubtitleTimingEdit,
  startUs: number,
  endUs: number,
  deltaUs: number,
  totalUs: number,
): SubtitleTiming {
  if (![startUs, endUs, deltaUs, totalUs].every(Number.isFinite)
    || startUs < 0 || endUs <= startUs || endUs > totalUs || totalUs < 1) {
    throw new RangeError('字幕改时需要位于时间线内的有效区间')
  }
  const delta = Math.round(deltaUs)
  if (edit === 'move') {
    const durationUs = endUs - startUs
    const nextStartUs = Math.max(0, Math.min(totalUs - durationUs, startUs + delta))
    return { startUs: nextStartUs, endUs: nextStartUs + durationUs }
  }
  if (edit === 'start') {
    return { startUs: Math.max(0, Math.min(endUs - 1, startUs + delta)), endUs }
  }
  return { startUs, endUs: Math.max(startUs + 1, Math.min(totalUs, endUs + delta)) }
}

export function formatSubtitleTimelineTime(timeUs: number): string {
  const hundredths = Math.max(0, Math.floor(timeUs / 10_000))
  const wholeSeconds = Math.floor(hundredths / 100)
  return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`
}
