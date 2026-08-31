import { describe, expect, it } from 'vitest'
import {
  clampDirectorPetPosition,
  defaultDirectorPetPosition,
  DIRECTOR_PET_HEIGHT,
  DIRECTOR_PET_VISIBLE_HEAD_WIDTH,
  DIRECTOR_PET_WIDTH,
  placeDirectorPetAtWall,
  resolveDirectorPetWallSide,
  settleDirectorPetPosition,
} from './directorPetPosition'

describe('director pet positioning', () => {
  it('starts near the lower-right canvas edge', () => {
    const position = defaultDirectorPetPosition({ width: 1440, height: 900 })
    expect(position.x).toBe(1440 - DIRECTOR_PET_WIDTH - 18)
    expect(position.y).toBe(900 - DIRECTOR_PET_HEIGHT - 86)
  })

  it('clamps a restored position into a resized viewport', () => {
    expect(clampDirectorPetPosition({ x: 1200, y: -300 }, { width: 390, height: 844 })).toEqual({
      x: 390 - DIRECTOR_PET_VISIBLE_HEAD_WIDTH,
      y: 0,
    })
  })

  it('keeps the full vertical body in view and a head-width visible against a wall', () => {
    expect(clampDirectorPetPosition({ x: -900, y: 900 }, { width: 1440, height: 900 })).toEqual({
      x: -(DIRECTOR_PET_WIDTH - DIRECTOR_PET_VISIBLE_HEAD_WIDTH),
      y: 900 - DIRECTOR_PET_HEIGHT,
    })
  })

  it('snaps a partially hidden pet to the wall instead of leaving an arbitrary sliver', () => {
    expect(settleDirectorPetPosition({ x: -12, y: 240 }, { width: 1440, height: 900 })).toEqual({
      x: -(DIRECTOR_PET_WIDTH - DIRECTOR_PET_VISIBLE_HEAD_WIDTH),
      y: 240,
    })
    expect(settleDirectorPetPosition({ x: 1380, y: 240 }, { width: 1440, height: 900 })).toEqual({
      x: 1440 - DIRECTOR_PET_VISIBLE_HEAD_WIDTH,
      y: 240,
    })
  })

  it('identifies and preserves the active wall after a viewport resize', () => {
    const position = placeDirectorPetAtWall('right', 320, { width: 1024, height: 768 })
    expect(position).toEqual({ x: 1024 - DIRECTOR_PET_VISIBLE_HEAD_WIDTH, y: 320 })
    expect(resolveDirectorPetWallSide(position, { width: 1024, height: 768 })).toBe('right')
    expect(placeDirectorPetAtWall('right', position.y, { width: 390, height: 844 })).toEqual({
      x: 390 - DIRECTOR_PET_VISIBLE_HEAD_WIDTH,
      y: 320,
    })
  })
})
