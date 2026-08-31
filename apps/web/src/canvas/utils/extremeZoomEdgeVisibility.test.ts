import { describe, expect, it } from 'vitest'
import { shouldHideEdgesAtZoom } from './extremeZoomEdgeVisibility'

describe('extreme zoom edge visibility', () => {
  it('hides edges at the minimum zoom range', () => {
    expect(shouldHideEdgesAtZoom(0.3, false)).toBe(true)
    expect(shouldHideEdgesAtZoom(0.32, false)).toBe(true)
  })

  it('restores edges only after crossing the upper hysteresis threshold', () => {
    expect(shouldHideEdgesAtZoom(0.34, true)).toBe(true)
    expect(shouldHideEdgesAtZoom(0.359, true)).toBe(true)
    expect(shouldHideEdgesAtZoom(0.36, true)).toBe(false)
  })

  it('keeps edges visible above the lower threshold', () => {
    expect(shouldHideEdgesAtZoom(0.321, false)).toBe(false)
    expect(shouldHideEdgesAtZoom(1, false)).toBe(false)
  })
})
