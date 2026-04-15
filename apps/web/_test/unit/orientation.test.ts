import { describe, expect, it } from 'vitest'
import { normalizeOrientation } from '../../src/utils/orientation'

describe('normalizeOrientation', () => {
  it('returns landscape by default', () => {
    expect(normalizeOrientation(undefined)).toBe('landscape')
    expect(normalizeOrientation(null)).toBe('landscape')
    expect(normalizeOrientation('')).toBe('landscape')
  })

  it('normalizes known portrait/landscape hints', () => {
    expect(normalizeOrientation('portrait')).toBe('portrait')
    expect(normalizeOrientation('竖屏')).toBe('portrait')
    expect(normalizeOrientation('landscape')).toBe('landscape')
    expect(normalizeOrientation('横向')).toBe('landscape')
  })

  it('infers orientation from aspect ratio', () => {
    expect(normalizeOrientation('9:16')).toBe('portrait')
    expect(normalizeOrientation('16:9')).toBe('landscape')
    expect(normalizeOrientation('1:1')).toBe('landscape')
  })
})
