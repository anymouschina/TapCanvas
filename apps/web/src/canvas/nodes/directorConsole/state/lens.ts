// 镜头光学：焦距 ↔ 垂直 FOV 换算（全画幅 36×24，three PerspectiveCamera 用垂直 FOV），
// 以及常用镜头预设。focalLengthMm 与 fovDeg 在面板中始终成对写入，避免漂移。
const SENSOR_HEIGHT_MM = 24 // 全画幅传感器高度
const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

/** 焦距(mm) → 垂直 FOV(度) */
export function fovFromFocal(focalMm: number): number {
  const f = Math.max(1, focalMm)
  return Math.round(2 * Math.atan(SENSOR_HEIGHT_MM / (2 * f)) * RAD2DEG * 10) / 10
}

/** 垂直 FOV(度) → 焦距(mm) */
export function focalFromFov(fovDeg: number): number {
  const fov = Math.min(170, Math.max(1, fovDeg))
  return Math.round(SENSOR_HEIGHT_MM / (2 * Math.tan((fov * DEG2RAD) / 2)) * 10) / 10
}

export type LensPreset = { id: string; label: string; focalMm: number; apertureF: number }
export const LENS_PRESETS: LensPreset[] = [
  { id: 'wide', label: '广角 24mm', focalMm: 24, apertureF: 4 },
  { id: 'standard', label: '标准 50mm', focalMm: 50, apertureF: 2.8 },
  { id: 'portrait', label: '人像 85mm', focalMm: 85, apertureF: 1.8 },
  { id: 'tele', label: '长焦 135mm', focalMm: 135, apertureF: 2.8 },
]
