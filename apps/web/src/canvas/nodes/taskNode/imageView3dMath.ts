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

// ─── Orbit arc mapping (2D preview drag handles) ───────────────────────────
// Maps camera azimuth/elevation to/from points on the preview's orbit guide
// ellipses, so each angle can be dragged on its own arc (single-axis control).
// Half-axes match the guide ellipses in ImageViewPreviewLite:
//   horizontal guide: width 62% / height 31%  -> half-axes 31% / 15.5%
//   vertical guide:   width 31% / height 62%  -> half-axes 15.5% / 31%
// Points are expressed in percent of the square stage; helpers that take a
// pointer offset receive it as (pointerPct - 50) on each axis.

export const AZIMUTH_ARC_HALF_X = 31
export const AZIMUTH_ARC_HALF_Y = 15.5
export const ELEVATION_ARC_HALF_X = 15.5
export const ELEVATION_ARC_HALF_Y = 31
// Visible vertical arc span used for the ±45° elevation range.
const ELEVATION_ARC_SPAN_DEG = 60

export type ArcPointPct = { leftPct: number; topPct: number }

export function azimuthToArcPoint(azimuthDeg: number): ArcPointPct {
  const rad = degToRad(normalizeDegrees(azimuthDeg, 0))
  return {
    leftPct: 50 + AZIMUTH_ARC_HALF_X * Math.sin(rad),
    topPct: 50 + AZIMUTH_ARC_HALF_Y * Math.cos(rad),
  }
}

export function arcPointToAzimuth(dxPct: number, dyPct: number): number {
  const x = finiteOr(dxPct, 0) / AZIMUTH_ARC_HALF_X
  const y = finiteOr(dyPct, 0) / AZIMUTH_ARC_HALF_Y
  return normalizeDegrees(radToDeg(Math.atan2(x, y)), 0)
}

export function elevationToArcPoint(elevationDeg: number): ArcPointPct {
  const el = clamp(elevationDeg, -45, 45, 0)
  const theta = degToRad((el / 45) * ELEVATION_ARC_SPAN_DEG)
  return {
    leftPct: 50 + ELEVATION_ARC_HALF_X * Math.cos(theta),
    topPct: 50 - ELEVATION_ARC_HALF_Y * Math.sin(theta),
  }
}

export function arcPointToElevation(dyPct: number): number {
  const sin = clamp(-finiteOr(dyPct, 0) / ELEVATION_ARC_HALF_Y, -1, 1, 0)
  const thetaDeg = radToDeg(Math.asin(sin))
  return clamp((thetaDeg / ELEVATION_ARC_SPAN_DEG) * 45, -45, 45, 0)
}
