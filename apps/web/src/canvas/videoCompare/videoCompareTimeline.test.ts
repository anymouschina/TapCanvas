import { describe, expect, it } from 'vitest'
import {
  clampComparisonTime,
  formatVideoCompareTime,
  resolveComparisonDuration,
  resolveCorrespondingVideoTime,
} from './videoCompareTime'

describe('video compare timeline', () => {
  it('uses one absolute comparison clock and clamps each video at its real end', () => {
    expect(resolveComparisonDuration([5, 8])).toBe(8)
    expect(resolveCorrespondingVideoTime(3.5, 5)).toBe(3.5)
    expect(resolveCorrespondingVideoTime(7, 5)).toBe(5)
    expect(clampComparisonTime(9, 8)).toBe(8)
  })

  it('formats the shared timecode without inventing metadata', () => {
    expect(formatVideoCompareTime(0)).toBe('00:00.0')
    expect(formatVideoCompareTime(65.42)).toBe('01:05.4')
  })
})
