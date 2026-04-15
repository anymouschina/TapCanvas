import type {
  ImageCameraControlConfig,
  ImageLightControlConfig,
} from '@tapcanvas/image-view-controls'

export type OrbitPoint3D = {
  x: number
  y: number
  z: number
}

export const CAMERA_DISTANCE_MIN = 0.7
export const CAMERA_DISTANCE_MAX = 3.8
export const LIGHT_PREVIEW_DISTANCE = 3.1

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number, fallback = min): number {
  const safeValue = finiteOr(value, fallback)
  return Math.min(max, Math.max(min, safeValue))
}

function normalizeDegrees(value: number, fallback = 0): number {
  const safeValue = finiteOr(value, fallback)
  const normalized = ((safeValue % 360) + 360) % 360
  return normalized === 360 ? 0 : normalized
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI
}

export function orbitPointFromAngles(input: {
  azimuthDeg: number
  elevationDeg: number
  distance: number
}): OrbitPoint3D {
  const distance = clamp(input.distance, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX, CAMERA_DISTANCE_MIN)
  const azimuthRad = degToRad(normalizeDegrees(input.azimuthDeg, 0))
  const elevationRad = degToRad(clamp(input.elevationDeg, -45, 60, 0))
  const horizontalRadius = Math.cos(elevationRad) * distance

  return {
    x: Math.sin(azimuthRad) * horizontalRadius,
    y: Math.sin(elevationRad) * distance,
    z: Math.cos(azimuthRad) * horizontalRadius,
  }
}

export function orbitAnglesFromPoint(point: OrbitPoint3D): {
  azimuthDeg: number
  elevationDeg: number
  distance: number
} {
  const safeX = finiteOr(point.x, 0)
  const safeY = finiteOr(point.y, 0)
  const safeZ = finiteOr(point.z, CAMERA_DISTANCE_MIN)
  const distance = Math.sqrt(safeX ** 2 + safeY ** 2 + safeZ ** 2)
  if (distance < 0.0001) {
    return {
      azimuthDeg: 0,
      elevationDeg: 0,
      distance: CAMERA_DISTANCE_MIN,
    }
  }

  const azimuthDeg = normalizeDegrees(radToDeg(Math.atan2(safeX, safeZ)), 0)
  const elevationDeg = clamp(radToDeg(Math.asin(clamp(safeY / distance, -1, 1, 0))), -45, 60, 0)

  return {
    azimuthDeg,
    elevationDeg,
    distance: clamp(distance, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX, CAMERA_DISTANCE_MIN),
  }
}

function hasFinitePoint(point: OrbitPoint3D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

export function snapPointToDistance(point: OrbitPoint3D, distance: number): OrbitPoint3D {
  const safeX = finiteOr(point.x, 0)
  const safeY = finiteOr(point.y, 0)
  const safeZ = finiteOr(point.z, distance)
  const currentLength = Math.sqrt(safeX ** 2 + safeY ** 2 + safeZ ** 2)
  const targetLength = Math.max(finiteOr(distance, LIGHT_PREVIEW_DISTANCE), 0.0001)
  if (currentLength < 0.0001) {
    return {
      x: 0,
      y: 0,
      z: targetLength,
    }
  }

  const scale = targetLength / currentLength
  return {
    x: safeX * scale,
    y: safeY * scale,
    z: safeZ * scale,
  }
}

export function toCameraControlFromPoint(
  current: ImageCameraControlConfig,
  point: OrbitPoint3D,
): ImageCameraControlConfig {
  if (!hasFinitePoint(point)) {
    return {
      ...current,
      enabled: true,
    }
  }
  const orbit = orbitAnglesFromPoint(point)
  return {
    ...current,
    enabled: true,
    azimuthDeg: orbit.azimuthDeg,
    elevationDeg: clamp(orbit.elevationDeg, -45, 45),
    distance: orbit.distance,
  }
}

export function toLightControlFromPoint(
  current: ImageLightControlConfig,
  point: OrbitPoint3D,
): ImageLightControlConfig {
  if (!hasFinitePoint(point)) {
    return {
      ...current,
      enabled: true,
    }
  }
  const snappedPoint = snapPointToDistance(point, LIGHT_PREVIEW_DISTANCE)
  const orbit = orbitAnglesFromPoint(snappedPoint)
  return {
    ...current,
    enabled: true,
    azimuthDeg: orbit.azimuthDeg,
    elevationDeg: clamp(orbit.elevationDeg, -45, 60),
  }
}

export function getCameraPreviewPoint(control: ImageCameraControlConfig): OrbitPoint3D {
  return orbitPointFromAngles({
    azimuthDeg: control.azimuthDeg,
    elevationDeg: control.elevationDeg,
    distance: control.distance,
  })
}

export function getLightPreviewPoint(control: ImageLightControlConfig): OrbitPoint3D {
  return orbitPointFromAngles({
    azimuthDeg: control.azimuthDeg,
    elevationDeg: control.elevationDeg,
    distance: LIGHT_PREVIEW_DISTANCE,
  })
}

export function mapLightIntensityToSceneIntensity(intensity: number): number {
  const normalized = clamp(intensity, 0, 100)
  if (normalized <= 0) return 0
  return 0.25 + normalized / 34
}
