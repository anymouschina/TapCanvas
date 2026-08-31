import type { SubtitleSegment } from './types'

/** 时间线上一个可见片段窗口（EditableClip 的投影视图） */
export type ClipWindow = {
  sourceUrl: string
  /** 本片段 0 点在源视频里的位置（µs；split 产生的后半段 > 0） */
  sourceOffsetUs: number
  trimStart: number
  trimEnd: number
  /** 本片段自身总时长（µs，split 后是子段时长） */
  duration: number
  /** 本片段在合成时间线上的起点（µs） */
  timelineStartUs: number
}

export type TimelineSubtitle = {
  startUs: number
  endUs: number
  text: string
  segmentId: string
}

/**
 * 把源相对时间的字幕段投影到合成时间线：
 * 与窗口 used 区间求交、截断，跨 split 边界的同段合并回一条。
 * 完全被裁掉的段不出现在结果里。
 */
export function projectSegmentsToTimeline(
  segments: SubtitleSegment[],
  windows: ClipWindow[],
): TimelineSubtitle[] {
  const out: TimelineSubtitle[] = []
  for (const w of windows) {
    const usedStart = w.sourceOffsetUs + w.trimStart
    const usedEnd = w.sourceOffsetUs + w.duration - w.trimEnd
    if (usedEnd <= usedStart) continue
    for (const seg of segments) {
      if (seg.sourceUrl !== w.sourceUrl) continue
      const s = Math.max(seg.startUs, usedStart)
      const e = Math.min(seg.endUs, usedEnd)
      if (e - s <= 0) continue
      out.push({
        startUs: w.timelineStartUs + (s - usedStart),
        endUs: w.timelineStartUs + (e - usedStart),
        text: seg.text,
        segmentId: seg.id,
      })
    }
  }
  out.sort((a, b) => a.startUs - b.startUs)
  const merged: TimelineSubtitle[] = []
  for (const t of out) {
    const last = merged[merged.length - 1]
    if (last && last.segmentId === t.segmentId && Math.abs(t.startUs - last.endUs) < 1_000) {
      last.endUs = t.endUs
    } else {
      merged.push({ ...t })
    }
  }
  return merged
}
