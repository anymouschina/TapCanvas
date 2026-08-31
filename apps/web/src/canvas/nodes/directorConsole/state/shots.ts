// 创建镜头·景别选择器：把一条景别预设套到激活相机上。
// 以目标角色为锚，确定性算出 机位位置/注视点/FOV/荷兰角/焦距，使取景命中该景别。
// 角色默认朝 +Z（正面），rotation[1] 为朝向偏航；高度/距离随 uniformScale 缩放。
import type { CharacterObj, Vec3 } from '../types'
import { fovFromFocal } from './lens'

const DEG2RAD = Math.PI / 180

export type ShotRecipe = { distance: number; lookAtHeight: number; camHeight: number; azimuthDeg: number; roll?: number }
export type ShotPreset = {
  id: string
  label: string
  group: '单人' | '双人'
  focalMm: number
  recipe: ShotRecipe
  /** 过肩反打：相机置于前景角色肩后，框另一角色 */
  ots?: boolean
}

// 景别距离/高度以 ~1.8m 主体、平视为基准；俯/仰通过 camHeight 偏移体现。
export const SHOT_PRESETS: ShotPreset[] = [
  // —— 单人 ——
  { id: 'ecu', label: '极近特写·平视·脸', group: '单人', focalMm: 85, recipe: { distance: 0.5, lookAtHeight: 1.62, camHeight: 1.62, azimuthDeg: 0 } },
  { id: 'cu', label: '特写·平视·肩上', group: '单人', focalMm: 85, recipe: { distance: 0.9, lookAtHeight: 1.58, camHeight: 1.58, azimuthDeg: 0 } },
  { id: 'mcu', label: '中近景·平视·腰上', group: '单人', focalMm: 50, recipe: { distance: 1.5, lookAtHeight: 1.45, camHeight: 1.5, azimuthDeg: 0 } },
  { id: 'ms', label: '中景·平视', group: '单人', focalMm: 50, recipe: { distance: 2.2, lookAtHeight: 1.2, camHeight: 1.45, azimuthDeg: 0 } },
  { id: 'american', label: '美式中景·牛仔景', group: '单人', focalMm: 35, recipe: { distance: 2.8, lookAtHeight: 1.05, camHeight: 1.4, azimuthDeg: 0 } },
  { id: 'full', label: '全身景·平视', group: '单人', focalMm: 35, recipe: { distance: 4.2, lookAtHeight: 1.0, camHeight: 1.3, azimuthDeg: 0 } },
  { id: 'threequarter', label: '三分之四侧·腰上', group: '单人', focalMm: 50, recipe: { distance: 1.8, lookAtHeight: 1.4, camHeight: 1.5, azimuthDeg: 35 } },
  { id: 'low-angle', label: '低机位仰拍·全身', group: '单人', focalMm: 35, recipe: { distance: 3.5, lookAtHeight: 1.3, camHeight: 0.5, azimuthDeg: 12 } },
  { id: 'dutch', label: '荷兰角·中景', group: '单人', focalMm: 40, recipe: { distance: 2.4, lookAtHeight: 1.35, camHeight: 1.5, azimuthDeg: 18, roll: 12 } },
  { id: 'establish', label: '全景建立·高机位俯', group: '单人', focalMm: 24, recipe: { distance: 7, lookAtHeight: 1.0, camHeight: 3.2, azimuthDeg: 15 } },
  { id: 'extreme-wide', label: '大远景·高机位俯', group: '单人', focalMm: 24, recipe: { distance: 12, lookAtHeight: 1.0, camHeight: 4.5, azimuthDeg: 20 } },
  // —— 双人 ——
  { id: 'two-shot', label: '双人同框·平视·腰上', group: '双人', focalMm: 35, recipe: { distance: 3.2, lookAtHeight: 1.3, camHeight: 1.5, azimuthDeg: 25 } },
  { id: 'ots-a', label: '过肩反打 A·胸上', group: '双人', focalMm: 50, recipe: { distance: 2.0, lookAtHeight: 1.45, camHeight: 1.55, azimuthDeg: 0 }, ots: true },
  { id: 'ots-b', label: '过肩反打 B·胸上', group: '双人', focalMm: 50, recipe: { distance: 2.0, lookAtHeight: 1.45, camHeight: 1.55, azimuthDeg: 0 }, ots: true },
  { id: 'side-two', label: '侧面双人·中景', group: '双人', focalMm: 50, recipe: { distance: 3.0, lookAtHeight: 1.25, camHeight: 1.45, azimuthDeg: 90 } },
]

export type ShotResult = { position: Vec3; lookAt: Vec3; fovDeg: number; roll: number; focalLengthMm: number; apertureF?: number }

/** 把景别预设套到激活相机。second 为第二角色（双人/过肩用，缺省时降级为单人取景）。 */
export function applyShotPreset(preset: ShotPreset, subject: CharacterObj, second?: CharacterObj): ShotResult {
  const fovDeg = fovFromFocal(preset.focalMm)
  const roll = preset.recipe.roll ?? 0
  if (preset.ots && second) return otsShot(preset, subject, second, fovDeg, roll)

  const s = subject.uniformScale || 1
  const r = preset.recipe
  const yaw = subject.rotation[1] + r.azimuthDeg * DEG2RAD
  const dir: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)] // 主体→相机方向（正面旋转 azimuth）
  const base = subject.position
  const dist = r.distance * s
  const position: Vec3 = [round(base[0] + dir[0] * dist), round(r.camHeight * s), round(base[2] + dir[2] * dist)]
  const lookAt: Vec3 = [round(base[0]), round(r.lookAtHeight * s), round(base[2])]
  return { position, lookAt, fovDeg, roll, focalLengthMm: preset.focalMm }
}

/** 过肩反打：相机在前景角色 fg 肩后，框目标 target。A/B 分别取左右肩。 */
function otsShot(preset: ShotPreset, fg: CharacterObj, target: CharacterObj, fovDeg: number, roll: number): ShotResult {
  const s = target.uniformScale || 1
  const r = preset.recipe
  const dx = fg.position[0] - target.position[0]
  const dz = fg.position[2] - target.position[2]
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len, uz = dz / len // target→fg 单位向量
  const sideSign = preset.id.endsWith('b') ? -1 : 1
  const px = -uz * sideSign, pz = ux * sideSign // 垂直方向（取左/右肩）
  const sideOffset = 0.4 * s
  const behind = r.distance * s
  const base = target.position
  const position: Vec3 = [round(base[0] + ux * behind + px * sideOffset), round(r.camHeight * s), round(base[2] + uz * behind + pz * sideOffset)]
  const lookAt: Vec3 = [round(base[0]), round(r.lookAtHeight * s), round(base[2])]
  return { position, lookAt, fovDeg, roll, focalLengthMm: preset.focalMm }
}

const round = (v: number) => Math.round(v * 1000) / 1000
