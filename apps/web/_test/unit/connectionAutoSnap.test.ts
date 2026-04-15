import { describe, expect, it } from 'vitest'
import {
  getPointToRectDistance,
  screenPathIntersectsRect,
  type MeasurablePath,
  type ScreenPoint,
} from '../../src/canvas/utils/connectionAutoSnap'

const createLinearPath = (from: ScreenPoint, to: ScreenPoint): MeasurablePath => {
  const totalLength = Math.hypot(to.x - from.x, to.y - from.y)

  return {
    getTotalLength: () => totalLength,
    getPointAtLength: (distance) => {
      const ratio = totalLength === 0
        ? 0
        : Math.max(0, Math.min(1, distance / totalLength))
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      } as DOMPoint
    },
  }
}

describe('getPointToRectDistance', () => {
  it('returns zero when the point is inside the rectangle', () => {
    expect(getPointToRectDistance({ x: 20, y: 20 }, { left: 10, top: 10, right: 30, bottom: 30 })).toBe(0)
  })

  it('returns the shortest distance to the rectangle boundary', () => {
    expect(getPointToRectDistance({ x: 40, y: 20 }, { left: 10, top: 10, right: 30, bottom: 30 })).toBe(10)
  })
})

describe('screenPathIntersectsRect', () => {
  it('detects intersections even when sample points stay outside the rectangle', () => {
    const path = createLinearPath({ x: 0, y: 0 }, { x: 100, y: 0 })

    expect(
      screenPathIntersectsRect(path, { left: 45, top: -10, right: 55, bottom: 10 }, 40),
    ).toBe(true)
  })

  it('returns false when the path misses the rectangle', () => {
    const path = createLinearPath({ x: 0, y: 0 }, { x: 100, y: 0 })

    expect(
      screenPathIntersectsRect(path, { left: 45, top: 20, right: 55, bottom: 40 }),
    ).toBe(false)
  })
})
