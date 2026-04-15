import { describe, expect, it } from 'vitest'

import {
  getCameraPreviewPoint,
  getLightPreviewPoint,
  LIGHT_PREVIEW_DISTANCE,
  orbitAnglesFromPoint,
  orbitPointFromAngles,
  snapPointToDistance,
  toCameraControlFromPoint,
  toLightControlFromPoint,
} from '../../src/canvas/nodes/taskNode/imageView3dMath'

describe('image view 3d math', () => {
  it('round-trips orbit points and angles for camera placement', () => {
    const point = orbitPointFromAngles({
      azimuthDeg: 90,
      elevationDeg: 18,
      distance: 3.2,
    })
    const orbit = orbitAnglesFromPoint(point)

    expect(Math.round(orbit.azimuthDeg)).toBe(90)
    expect(Math.round(orbit.elevationDeg)).toBe(18)
    expect(orbit.distance).toBeCloseTo(3.2, 5)
  })

  it('projects light handles back onto the fixed preview radius', () => {
    const point = snapPointToDistance({ x: 9, y: 3, z: 1 }, LIGHT_PREVIEW_DISTANCE)
    const length = Math.sqrt(point.x ** 2 + point.y ** 2 + point.z ** 2)

    expect(length).toBeCloseTo(LIGHT_PREVIEW_DISTANCE, 5)
  })

  it('derives camera and light control configs from dragged preview points', () => {
    const cameraControl = toCameraControlFromPoint(
      {
        enabled: false,
        presetId: 'front',
        azimuthDeg: 0,
        elevationDeg: 0,
        distance: 2.4,
      },
      getCameraPreviewPoint({
        enabled: true,
        presetId: 'right',
        azimuthDeg: 90,
        elevationDeg: 12,
        distance: 2.8,
      }),
    )
    const lightControl = toLightControlFromPoint(
      {
        enabled: false,
        presetId: 'front',
        azimuthDeg: 0,
        elevationDeg: 12,
        intensity: 40,
        colorHex: '#FFFFFF',
      },
      getLightPreviewPoint({
        enabled: true,
        presetId: 'topRight',
        azimuthDeg: 45,
        elevationDeg: 24,
        intensity: 60,
        colorHex: '#FFFFFF',
      }),
    )

    expect(cameraControl.enabled).toBe(true)
    expect(Math.round(cameraControl.azimuthDeg)).toBe(90)
    expect(Math.round(cameraControl.elevationDeg)).toBe(12)
    expect(cameraControl.distance).toBeCloseTo(2.8, 4)

    expect(lightControl.enabled).toBe(true)
    expect(Math.round(lightControl.azimuthDeg)).toBe(45)
    expect(Math.round(lightControl.elevationDeg)).toBe(24)
    expect(lightControl.intensity).toBe(40)
  })

  it('preserves the current control when drag math receives non-finite coordinates', () => {
    const currentCamera = {
      enabled: true,
      presetId: 'right' as const,
      azimuthDeg: 90,
      elevationDeg: 14,
      distance: 2.7,
    }
    const currentLight = {
      enabled: true,
      presetId: 'topRight' as const,
      azimuthDeg: 45,
      elevationDeg: 24,
      intensity: 66,
      colorHex: '#FFFFFF',
    }

    const cameraControl = toCameraControlFromPoint(currentCamera, {
      x: Number.NaN,
      y: 0,
      z: 1,
    })
    const lightControl = toLightControlFromPoint(currentLight, {
      x: 1,
      y: Number.POSITIVE_INFINITY,
      z: 1,
    })

    expect(cameraControl).toEqual(currentCamera)
    expect(lightControl).toEqual(currentLight)
  })
})
