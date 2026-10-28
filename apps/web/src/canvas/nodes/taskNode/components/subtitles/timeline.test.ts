import { describe, expect, it } from 'vitest'
import { editTimelineSubtitle, projectSegmentsToTimeline, subtitleSourceInstanceIds, subtitleSourceRanges, type ClipWindow } from './timeline'
import type { SubtitleSegment } from './types'

const S = 1_000_000
const segment: SubtitleSegment = { id: 'caption', sourceUrl: 'a.mp4', startUs: S, endUs: 7 * S, text: '原台词', source: 'auto' }
function window(overrides: Partial<ClipWindow> = {}): ClipWindow {
  return { sourceUrl: 'a.mp4', sourceInstanceId: 'a-1', sourceOffsetUs: 0, duration: 10 * S, trimStart: 0, trimEnd: 0, timelineStartUs: 0, ...overrides }
}
function edit(segments: SubtitleSegment[], windows: ClipWindow[], targetIndex: number, start: number, end: number) {
  let seq = 0
  return editTimelineSubtitle(segments, windows, projectSegmentsToTimeline(segments, windows)[targetIndex].segmentId,
    { startUs: start, endUs: end }, () => `new-${++seq}`)
}
function visible(segments: SubtitleSegment[], windows: ClipWindow[]) {
  return projectSegmentsToTimeline(segments, windows).map(({ startUs, endUs, text }) => ({ startUs, endUs, text }))
}

describe('editable subtitle source mapping', () => {
  it('inverts cropped, split-offset windows and rounds to integer microseconds', () => {
    expect(subtitleSourceRanges(0.4, 2 * S, [window({ sourceOffsetUs: 4 * S, trimStart: S })])).toEqual([
      { sourceUrl: 'a.mp4', sourceInstanceId: 'a-1', startUs: 5 * S, endUs: 7 * S },
    ])
  })

  it('keeps anonymous occurrence IDs stable when different URLs reorder, and rejects duplicate explicit IDs', () => {
    expect(subtitleSourceInstanceIds([{ url: 'a' }, { url: 'b' }, { url: 'a' }])).toEqual([
      '["a",0]', '["b",0]', '["a",1]',
    ])
    expect(subtitleSourceInstanceIds([{ url: 'b' }, { url: 'a' }, { url: 'a' }])).toEqual([
      '["b",0]', '["a",0]', '["a",1]',
    ])
    expect(() => subtitleSourceInstanceIds([{ url: 'a', sourceInstanceId: 'same' }, { url: 'b', sourceInstanceId: 'same' }])).toThrow('标识重复')
  })

  it('merges continuous split pieces, even when another subtitle overlaps', () => {
    const windows = [window({ duration: 4 * S }), window({ sourceOffsetUs: 4 * S, duration: 6 * S, timelineStartUs: 4 * S })]
    const subtitles = projectSegmentsToTimeline([segment, { ...segment, id: 'other', startUs: 2 * S, endUs: 3 * S }], windows)
    expect(subtitles.filter((item) => item.sourceSegmentId === 'caption')).toHaveLength(1)
    expect(subtitles[0]).toMatchObject({ startUs: S, endUs: 7 * S })
    const result = edit([segment], windows, 0, 2 * S, 8 * S)
    expect(visible(result.segments, windows)).toEqual([{ startUs: 2 * S, endUs: 8 * S, text: '原台词' }])
  })

  it('preserves cut-away text and a separate projection after a discontinuous source cut', () => {
    const windows = [window({ trimStart: 2 * S, duration: 4 * S }), window({ sourceOffsetUs: 6 * S, duration: 4 * S, timelineStartUs: 2 * S })]
    expect(projectSegmentsToTimeline([segment], windows)).toHaveLength(2)
    const result = edit([segment], windows, 0, S / 2, 2 * S)
    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ startUs: S, endUs: 2 * S, text: '原台词' }),
      expect.objectContaining({ startUs: 4 * S, endUs: 7 * S, text: '原台词' }),
    ]))
    expect(visible(result.segments, windows)).toEqual([
      { startUs: S / 2, endUs: 2 * S, text: '原台词' },
      { startUs: 2 * S, endUs: 3 * S, text: '原台词' },
    ])
  })

  it('isolates a repeated URL instance and restores the edit after serialization/reordering', () => {
    const windows = [window(), window({ sourceInstanceId: 'a-2', timelineStartUs: 10 * S })]
    const result = edit([segment], windows, 1, 12 * S, 18 * S)
    expect(visible(result.segments, windows)).toEqual([
      { startUs: S, endUs: 7 * S, text: '原台词' },
      { startUs: 12 * S, endUs: 18 * S, text: '原台词' },
    ])
    const restored: SubtitleSegment[] = JSON.parse(JSON.stringify(result.segments))
    expect(visible(restored, [window({ sourceInstanceId: 'a-2' }), window({ timelineStartUs: 10 * S })])).toEqual([
      { startUs: 2 * S, endUs: 8 * S, text: '原台词' },
      { startUs: 11 * S, endUs: 17 * S, text: '原台词' },
    ])
  })

  it('maps a moved subtitle across different and repeated sources while preserving unrelated instances and all text', () => {
    const windows = [window(), window({ sourceUrl: 'b.mp4', sourceInstanceId: 'b', timelineStartUs: 10 * S }), window({ sourceInstanceId: 'a-2', timelineStartUs: 20 * S })]
    const result = edit([segment], windows, 0, 9 * S, 22 * S)
    expect(visible(result.segments, windows)).toEqual([
      { startUs: 9 * S, endUs: 10 * S, text: '原台词' },
      { startUs: 10 * S, endUs: 20 * S, text: '原台词' },
      { startUs: 20 * S, endUs: 22 * S, text: '原台词' },
      { startUs: 21 * S, endUs: 27 * S, text: '原台词' },
    ])
    expect(result.segments.every((item) => item.text === '原台词')).toBe(true)
  })

  it('updates/deletes only the selected visible text and leaves cropped/other occurrences intact', () => {
    const windows = [window({ trimStart: 2 * S }), window({ sourceInstanceId: 'a-2', timelineStartUs: 8 * S })]
    let seq = 0
    const target = projectSegmentsToTimeline([segment], windows)[0].segmentId
    const edited = editTimelineSubtitle([segment], windows, target, { text: '新台词' }, () => `text-${++seq}`)
    expect(visible(edited.segments, windows)).toEqual([
      { startUs: 0, endUs: 5 * S, text: '新台词' },
      { startUs: 9 * S, endUs: 15 * S, text: '原台词' },
    ])
    const deleted = editTimelineSubtitle(edited.segments, windows, edited.selectedSegmentId!, { delete: true }, () => `delete-${++seq}`)
    expect(visible(deleted.segments, windows)).toEqual([{ startUs: 9 * S, endUs: 15 * S, text: '原台词' }])
    expect(deleted.segments).toEqual(expect.arrayContaining([expect.objectContaining({ startUs: S, endUs: 2 * S, text: '原台词' })]))
  })

  it('rejects invalid or unmapped edits instead of deleting the source caption', () => {
    expect(() => edit([segment], [window()], 0, 4, 4)).toThrow('时间范围无效')
    expect(() => edit([segment], [window()], 0, 11 * S, 12 * S)).toThrow('未落在')
    expect(() => editTimelineSubtitle([segment], [window()], 'missing', { delete: true }, () => 'new')).toThrow('找不到')
  })
})
