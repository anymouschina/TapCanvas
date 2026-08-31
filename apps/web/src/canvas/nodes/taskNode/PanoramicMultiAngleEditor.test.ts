import { describe, expect, it } from 'vitest'
import {
  multiAngleFovToZoom,
  multiAngleZoomLabel,
  multiAngleZoomToFov,
} from './PanoramicMultiAngleEditor'
import { resolveLibTvEditorScale } from './libTvEditorDisplay'

describe('LibTV multi-angle parameter contract', () => {
  it('maps the visual camera FOV to the 0/5/10 zoom contract', () => {
    expect(multiAngleFovToZoom(110)).toBe(0)
    expect(multiAngleFovToZoom(75)).toBe(5)
    expect(multiAngleFovToZoom(35)).toBe(10)
    expect(multiAngleZoomToFov(5)).toBe(75)
  })

  it('uses the same panorama, medium and close-up labels', () => {
    expect(multiAngleZoomLabel(0)).toBe('全景')
    expect(multiAngleZoomLabel(5)).toBe('中景')
    expect(multiAngleZoomLabel(10)).toBe('特写')
  })

  it('keeps the editor compact at low canvas zoom without making it unreadable', () => {
    expect(resolveLibTvEditorScale(0.22)).toBeCloseTo(0.632)
    expect(resolveLibTvEditorScale(0.8)).toBeCloseTo(0.98)
    expect(resolveLibTvEditorScale(1.4)).toBe(1)
  })
})
