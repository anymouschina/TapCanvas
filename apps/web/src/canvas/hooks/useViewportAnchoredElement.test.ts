import { describe, expect, it } from 'vitest'
import {
  positionViewportAnchoredElement,
  resolveViewportAnchorTransform,
} from './useViewportAnchoredElement'

describe('viewport anchored overlays', () => {
  it('positions a point through a compositor transform', () => {
    expect(resolveViewportAnchorTransform(
      [12, -8, 0.5],
      { kind: 'point', x: 100, y: 80 },
    )).toBe('translate3d(62px, 32px, 0)')
  })

  it('keeps a selection toolbar above the viewport floor', () => {
    expect(resolveViewportAnchorTransform(
      [0, -200, 1],
      { kind: 'center-above', x: 300, y: 100, offsetY: 44, minimumY: 8 },
    )).toBe('translate3d(300px, 8px, 0) translateX(-50%)')
  })

  it('writes only the element transform for imperative viewport updates', () => {
    const element = document.createElement('div')
    positionViewportAnchoredElement(
      element,
      [20, 30, 2],
      { kind: 'right-center', x: 40, y: 25, offsetX: 12 },
    )

    expect(element.style.transform).toBe('translate3d(112px, 80px, 0) translateY(-50%)')
    expect(element.style.left).toBe('')
    expect(element.style.top).toBe('')
  })
})
