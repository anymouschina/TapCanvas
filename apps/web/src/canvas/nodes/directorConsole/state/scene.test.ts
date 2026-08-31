import { describe, expect, it } from 'vitest'
import { createDefaultDirectorConsoleData } from '../types'
import { setSkyboxPitch } from './scene'

describe('directorConsole panorama calibration', () => {
  it('rounds and clamps the panorama horizon pitch to the rendering contract', () => {
    const base = createDefaultDirectorConsoleData()
    expect(setSkyboxPitch(base, 12.6).scene.skyboxPitch).toBe(13)
    expect(setSkyboxPitch(base, -90).scene.skyboxPitch).toBe(-45)
    expect(setSkyboxPitch(base, 90).scene.skyboxPitch).toBe(45)
  })

  it('stores the neutral pitch as an absent optional field', () => {
    const base = createDefaultDirectorConsoleData()
    expect(setSkyboxPitch(base, 0).scene.skyboxPitch).toBeUndefined()
  })
})
