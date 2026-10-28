import { describe, expect, it } from 'vitest'
import { formatSubtitleTimelineTime, layoutSubtitleTimeline, updateSubtitleTiming } from './subtitleTimelineLayout'
import type { TimelineSubtitle } from './timeline'

const subtitle = (segmentId: string, startUs: number, endUs: number): TimelineSubtitle => ({ segmentId, startUs, endUs, text: segmentId })

describe('layoutSubtitleTimeline', () => {
  it('sorts by time without mutating input and reuses only unoccupied lanes', () => {
    const input = [subtitle('after', 2_000_000, 3_000_000), subtitle('first', 0, 2_000_000), subtitle('overlap', 1_000_000, 3_000_000)]
    const layout = layoutSubtitleTimeline(input, 0.0001, 4_000_000)
    expect(layout.laneCount).toBe(2)
    expect(layout.items.map((item) => [item.subtitle.segmentId, item.lane])).toEqual([['first', 0], ['overlap', 1], ['after', 0]])
    expect(input[0].segmentId).toBe('after')
  })

  it('keeps short intervals at their actual width and repeated ids distinct', () => {
    const layout = layoutSubtitleTimeline([subtitle('repeat', 0, 100_000), subtitle('repeat', 500_000, 600_000)], 0.0001, 1_000_000)
    expect(layout.items.map((item) => item.key)).toEqual(['repeat:0', 'repeat:1'])
    expect(layout.items.map((item) => item.widthPx)).toEqual([10, 10])
    expect(layoutSubtitleTimeline([subtitle('tiny', 0, 1)], 0.0001, 1_000_000).items[0].widthPx).toBe(0.0001)
  })

  it('clips geometry at timeline boundaries and handles an empty timeline', () => {
    const layout = layoutSubtitleTimeline([subtitle('crossing', -100, 1_100)], 1, 1_000)
    expect(layout.items[0]).toMatchObject({ leftPx: 0, widthPx: 1_000 })
    expect(layoutSubtitleTimeline([], 0.0001, 0)).toEqual({ items: [], laneCount: 0 })
    expect(layoutSubtitleTimeline([], Number.NaN, 1_000)).toEqual({ items: [], laneCount: 0 })
  })

  it('exposes malformed timing instead of rendering a fabricated interval', () => {
    expect(() => layoutSubtitleTimeline([subtitle('invalid', 100, 100)], 1, 1_000)).toThrow('时间区间无效')
    expect(() => layoutSubtitleTimeline([subtitle('invalid', Number.NaN, 100)], 1, 1_000)).toThrow('时间区间无效')
  })
})

describe('updateSubtitleTiming', () => {
  it('preserves duration and clamps moves to both timeline boundaries', () => {
    expect(updateSubtitleTiming('move', 1_000_000, 2_000_000, 500_000, 5_000_000)).toEqual({ startUs: 1_500_000, endUs: 2_500_000 })
    expect(updateSubtitleTiming('move', 1_000_000, 2_000_000, -9_000_000, 5_000_000)).toEqual({ startUs: 0, endUs: 1_000_000 })
    expect(updateSubtitleTiming('move', 1_000_000, 2_000_000, 9_000_000, 5_000_000)).toEqual({ startUs: 4_000_000, endUs: 5_000_000 })
  })

  it('keeps either edge in bounds with at least one microsecond of duration', () => {
    expect(updateSubtitleTiming('start', 1_000_000, 2_000_000, -2_000_000, 5_000_000)).toEqual({ startUs: 0, endUs: 2_000_000 })
    expect(updateSubtitleTiming('start', 1_000_000, 2_000_000, 2_000_000, 5_000_000)).toEqual({ startUs: 1_999_999, endUs: 2_000_000 })
    expect(updateSubtitleTiming('end', 1_000_000, 2_000_000, 4_000_000, 5_000_000)).toEqual({ startUs: 1_000_000, endUs: 5_000_000 })
    expect(updateSubtitleTiming('end', 1_000_000, 2_000_000, -2_000_000, 5_000_000)).toEqual({ startUs: 1_000_000, endUs: 1_000_001 })
  })

  it('rounds pointer deltas to integer microseconds and rejects invalid source timing', () => {
    expect(updateSubtitleTiming('move', 10, 20, 0.6, 100)).toEqual({ startUs: 11, endUs: 21 })
    expect(() => updateSubtitleTiming('move', 10, 20, Number.NaN, 100)).toThrow('有效区间')
    expect(() => updateSubtitleTiming('move', 10, 200, 0, 100)).toThrow('有效区间')
  })
})

it('formats timeline time to hundredths without wrapping minutes', () => {
  expect(formatSubtitleTimelineTime(62_340_000)).toBe('01:02.34')
  expect(formatSubtitleTimelineTime(3_600_000_000)).toBe('60:00.00')
})
