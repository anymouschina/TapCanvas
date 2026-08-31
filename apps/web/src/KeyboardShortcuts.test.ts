import { describe, expect, it } from 'vitest'
import { isCanvasCompositionKeyEvent } from './KeyboardShortcuts'

describe('isCanvasCompositionKeyEvent', () => {
  it('recognizes standard IME composition keyboard events', () => {
    expect(isCanvasCompositionKeyEvent({ isComposing: true, keyCode: 0 })).toBe(true)
  })

  it('recognizes Safari and legacy WebKit composition keyboard events', () => {
    expect(isCanvasCompositionKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true)
  })

  it('leaves ordinary keyboard events available to canvas shortcuts', () => {
    expect(isCanvasCompositionKeyEvent({ isComposing: false, keyCode: 27 })).toBe(false)
  })
})
