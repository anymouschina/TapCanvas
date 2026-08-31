import { describe, expect, it } from 'vitest'
import { isCanvasTextInteractionTarget } from './isCanvasTextInteractionTarget'

describe('isCanvasTextInteractionTarget', () => {
  it('keeps read-only text selection surfaces out of canvas shortcuts', () => {
    const surface = document.createElement('div')
    surface.dataset.canvasTextSelection = ''
    const nested = document.createElement('span')
    surface.append(nested)

    expect(isCanvasTextInteractionTarget(surface)).toBe(true)
    expect(isCanvasTextInteractionTarget(nested)).toBe(true)
  })

  it('recognizes native editing controls', () => {
    const input = document.createElement('input')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')

    expect(isCanvasTextInteractionTarget(input)).toBe(true)
    expect(isCanvasTextInteractionTarget(editable)).toBe(true)
  })

  it('does not claim ordinary canvas elements', () => {
    expect(isCanvasTextInteractionTarget(document.createElement('div'))).toBe(false)
  })
})
