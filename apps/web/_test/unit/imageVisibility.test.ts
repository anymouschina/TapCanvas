import { describe, expect, it } from 'vitest'
import { shouldKeepMainImageMounted } from '../../src/canvas/nodes/taskNode/components/imageVisibility'

describe('image visibility gating', () => {
  it('does not mount when no image exists', () => {
    expect(shouldKeepMainImageMounted({
      hasImageUrl: false,
      selected: false,
      viewportVisible: false,
      hasEverBeenVisible: false,
      viewportMoving: false,
    })).toBe(false)
  })

  it('keeps selected and visible images mounted', () => {
    expect(shouldKeepMainImageMounted({
      hasImageUrl: true,
      selected: true,
      viewportVisible: false,
      hasEverBeenVisible: false,
      viewportMoving: false,
    })).toBe(true)

    expect(shouldKeepMainImageMounted({
      hasImageUrl: true,
      selected: false,
      viewportVisible: true,
      hasEverBeenVisible: false,
      viewportMoving: false,
    })).toBe(true)
  })

  it('keeps an already-seen image mounted while the viewport is moving', () => {
    expect(shouldKeepMainImageMounted({
      hasImageUrl: true,
      selected: false,
      viewportVisible: false,
      hasEverBeenVisible: true,
      viewportMoving: true,
    })).toBe(true)
  })

  it('releases offscreen images again after viewport movement ends', () => {
    expect(shouldKeepMainImageMounted({
      hasImageUrl: true,
      selected: false,
      viewportVisible: false,
      hasEverBeenVisible: true,
      viewportMoving: false,
    })).toBe(false)
  })
})
