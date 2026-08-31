import { describe, expect, it } from 'vitest'

import {
  arcPointToAzimuth,
  arcPointToElevation,
  azimuthToArcPoint,
  elevationToArcPoint,
} from './imageView3dMath'

describe('azimuth arc mapping', () => {
  it('round-trips every 45° azimuth through the arc and back', () => {
    for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const point = azimuthToArcPoint(az)
      const back = arcPointToAzimuth(point.leftPct - 50, point.topPct - 50)
      expect(back).toBeCloseTo(az, 1)
    }
  })

  it('places azimuth 0 at bottom-center (front) and 180 at top-center (rear)', () => {
    const front = azimuthToArcPoint(0)
    expect(front.leftPct).toBeCloseTo(50, 5)
    expect(front.topPct).toBeGreaterThan(50)

    const rear = azimuthToArcPoint(180)
    expect(rear.leftPct).toBeCloseTo(50, 5)
    expect(rear.topPct).toBeLessThan(50)
  })

  it('normalizes results into [0, 360)', () => {
    // left of center, on the horizontal axis -> 270°
    expect(arcPointToAzimuth(-31, 0)).toBeCloseTo(270, 1)
    const wrapped = arcPointToAzimuth(0, 15.5)
    expect(wrapped).toBeGreaterThanOrEqual(0)
    expect(wrapped).toBeLessThan(360)
  })
})

describe('elevation arc mapping', () => {
  it('round-trips elevation through the vertical arc and back', () => {
    for (const el of [-45, -30, -15, 0, 15, 30, 45]) {
      const point = elevationToArcPoint(el)
      const back = arcPointToElevation(point.topPct - 50)
      expect(back).toBeCloseTo(el, 1)
    }
  })

  it('puts positive elevation (looking down) above center and negative below', () => {
    expect(elevationToArcPoint(45).topPct).toBeLessThan(50)
    expect(elevationToArcPoint(-45).topPct).toBeGreaterThan(50)
    expect(elevationToArcPoint(0).topPct).toBeCloseTo(50, 5)
  })

  it('clamps out-of-range elevation to ±45', () => {
    expect(elevationToArcPoint(120).topPct).toBeCloseTo(elevationToArcPoint(45).topPct, 5)
    // a drag far past the top of the arc must not exceed +45
    expect(arcPointToElevation(-40)).toBeLessThanOrEqual(45)
    expect(arcPointToElevation(40)).toBeGreaterThanOrEqual(-45)
  })
})
