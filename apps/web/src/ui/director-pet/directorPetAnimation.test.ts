import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_PET_SPRITE_SHEETS,
  resolveDirectorPetFrameIndex,
  resolveDirectorPetFrameOffset,
} from './directorPetAnimation'

const DIRECTOR_PET_STATES = ['idle', 'working', 'peek', 'playful', 'idea', 'gacha', 'gaming'] as const

describe('director pet animation', () => {
  it('provides one real remote sprite sheet for every state', () => {
    for (const state of DIRECTOR_PET_STATES) {
      const sheet = DIRECTOR_PET_SPRITE_SHEETS[state]
      expect(sheet.src).toMatch(/^https:\/\//)
      expect(sheet.frameCount).toBe(4)
      expect(sheet.columns).toBe(2)
    }
  })

  it('loops every sequence without exceeding its sprite sheet', () => {
    for (const state of DIRECTOR_PET_STATES) {
      for (let step = 0; step < 48; step += 1) {
        expect(resolveDirectorPetFrameIndex(state, step, false)).toBeGreaterThanOrEqual(0)
        expect(resolveDirectorPetFrameIndex(state, step, false)).toBeLessThan(
          DIRECTOR_PET_SPRITE_SHEETS[state].frameCount,
        )
      }
    }
  })

  it('pins every state to its first frame when paused', () => {
    for (const state of DIRECTOR_PET_STATES) {
      expect(resolveDirectorPetFrameIndex(state, 7, true)).toBe(0)
    }
  })

  it('keeps edge peek completely still', () => {
    for (let step = 0; step < 48; step += 1) {
      expect(resolveDirectorPetFrameIndex('peek', step, false)).toBe(0)
    }
  })

  it('keeps idle visually still between occasional blinks', () => {
    for (let step = 0; step < 14; step += 1) {
      expect(resolveDirectorPetFrameIndex('idle', step, false)).toBe(0)
    }
    expect(resolveDirectorPetFrameIndex('idle', 14, false)).toBe(2)
    expect(resolveDirectorPetFrameIndex('idle', 15, false)).toBe(2)
    expect(resolveDirectorPetFrameIndex('idle', 16, false)).toBe(0)
  })

  it('maps each 2x2 frame to a stable clipped-sheet offset', () => {
    const sheet = DIRECTOR_PET_SPRITE_SHEETS.idea
    expect(resolveDirectorPetFrameOffset(sheet, 0)).toEqual({ xPercent: 0, yPercent: 0, widthPercent: 200, heightPercent: 200 })
    expect(resolveDirectorPetFrameOffset(sheet, 1)).toEqual({ xPercent: -50, yPercent: 0, widthPercent: 200, heightPercent: 200 })
    expect(resolveDirectorPetFrameOffset(sheet, 2)).toEqual({ xPercent: 0, yPercent: -50, widthPercent: 200, heightPercent: 200 })
    expect(resolveDirectorPetFrameOffset(sheet, 3)).toEqual({ xPercent: -50, yPercent: -50, widthPercent: 200, heightPercent: 200 })
  })
})
