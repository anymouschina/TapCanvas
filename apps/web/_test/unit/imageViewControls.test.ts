import { describe, expect, it } from 'vitest'
import {
  appendImageViewPrompt,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
} from '@tapcanvas/image-view-controls'

describe('image view controls prompt helpers', () => {
  it('normalizes camera control and preserves enable state', () => {
    const normalized = normalizeImageCameraControl({
      enabled: true,
      azimuthDeg: 450,
      elevationDeg: 18,
      distance: 3.2,
    })

    expect(normalized.enabled).toBe(true)
    expect(normalized.azimuthDeg).toBe(90)
    expect(normalized.elevationDeg).toBe(18)
    expect(normalized.distance).toBe(3.2)
  })

  it('normalizes lighting rig colors and range', () => {
    const normalized = normalizeImageLightingRig({
      main: {
        enabled: true,
        azimuthDeg: 45,
        elevationDeg: 16,
        intensity: 50,
        colorHex: '#fff',
      },
      fill: {
        enabled: true,
        azimuthDeg: 315,
        elevationDeg: 8,
        intensity: 24,
        colorHex: '#44AAFF',
      },
    })

    expect(normalized.main.colorHex).toBe('#FFFFFF')
    expect(normalized.fill.colorHex).toBe('#44AAFF')
    expect(normalized.fill.intensity).toBe(24)
  })

  it('appends camera and lighting clauses to the base prompt', () => {
    const prompt = appendImageViewPrompt('保留原图人物和环境关系', {
      cameraControl: {
        enabled: true,
        azimuthDeg: 90,
        elevationDeg: 18,
        distance: 3.3,
      },
      lightingRig: {
        main: {
          enabled: true,
          azimuthDeg: 45,
          elevationDeg: 16,
          intensity: 50,
          colorHex: '#FFFFFF',
        },
        fill: {
          enabled: true,
          azimuthDeg: 315,
          elevationDeg: 8,
          intensity: 24,
          colorHex: '#C7D2FE',
        },
      },
    })

    expect(prompt).toContain('保留原图人物和环境关系')
    expect(prompt).toContain('Camera control: right side view')
    expect(prompt).toContain('Lighting control:')
    expect(prompt).toContain('Fill light:')
  })
})
