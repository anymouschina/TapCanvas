import type { ImageLightPresetId } from '@tapcanvas/image-view-controls'

export type LibTvLightDirectionPreset = {
  key: string
  label: string
  presetId: ImageLightPresetId
  azimuthDeg: number
  elevationDeg: number
}

export type LibTvBrightnessLevel = {
  value: number
  label: string
}

export type LibTvLightingParameterInput = Readonly<{
  directionEnabled: boolean
  brightnessEnabled: boolean
  colorEnabled: boolean
  rimEnabled: boolean
  smartMode: boolean
  mainDirectionKey: string
  rimDirectionKey: string
  colorHex: string
  brightness: number
  smartPrompt: string
  referenceImageUrl: string | null
}>

export type LibTvLightingOperationParameters = Readonly<{
  UI_KeyLight?: string
  UI_RimLight?: string
  UI_LightColor?: string
  UI_LightBrightness?: number
  prompt?: string
  Reference_Image_Intent?: string
}>

const HORIZONTAL_LIGHT_DIRECTIONS = [
  { key: 'front', label: '前方', presetId: 'front', azimuthDeg: 0 },
  { key: 'front-right', label: '右前', presetId: 'topRight', azimuthDeg: 45 },
  { key: 'right', label: '右侧', presetId: 'right', azimuthDeg: 90 },
  { key: 'back-right', label: '右后', presetId: 'back', azimuthDeg: 135 },
  { key: 'back', label: '后方', presetId: 'back', azimuthDeg: 180 },
  { key: 'back-left', label: '左后', presetId: 'back', azimuthDeg: 225 },
  { key: 'left', label: '左侧', presetId: 'left', azimuthDeg: 270 },
  { key: 'front-left', label: '左前', presetId: 'topLeft', azimuthDeg: 315 },
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  presetId: ImageLightPresetId
  azimuthDeg: number
}>

function buildDirectionBand(input: {
  keyPrefix: string
  labelPrefix: string
  elevationDeg: number
}): LibTvLightDirectionPreset[] {
  return HORIZONTAL_LIGHT_DIRECTIONS.map((direction) => ({
    key: input.keyPrefix ? `${input.keyPrefix}-${direction.key}` : direction.key,
    label: `${input.labelPrefix}${direction.label}`,
    presetId: direction.presetId,
    azimuthDeg: direction.azimuthDeg,
    elevationDeg: input.elevationDeg,
  }))
}

export const LIBTV_MAIN_LIGHT_DIRECTIONS: LibTvLightDirectionPreset[] = [
  ...buildDirectionBand({ keyPrefix: '', labelPrefix: '', elevationDeg: 8 }),
  ...buildDirectionBand({ keyPrefix: 'high', labelPrefix: '高', elevationDeg: 42 }),
  ...buildDirectionBand({ keyPrefix: 'low', labelPrefix: '低', elevationDeg: -30 }),
  { key: 'top', label: '顶部', presetId: 'top', azimuthDeg: 0, elevationDeg: 60 },
  { key: 'bottom', label: '底部', presetId: 'bottom', azimuthDeg: 0, elevationDeg: -45 },
]

export const LIBTV_RIM_LIGHT_DIRECTIONS: LibTvLightDirectionPreset[] = [
  { key: 'back-right', label: '右后', presetId: 'back', azimuthDeg: 135, elevationDeg: 8 },
  { key: 'back', label: '后方', presetId: 'back', azimuthDeg: 180, elevationDeg: 8 },
  { key: 'back-left', label: '左后', presetId: 'back', azimuthDeg: 225, elevationDeg: 8 },
  { key: 'high-back-right', label: '高右后', presetId: 'back', azimuthDeg: 135, elevationDeg: 42 },
  { key: 'high-back', label: '高后', presetId: 'back', azimuthDeg: 180, elevationDeg: 42 },
  { key: 'high-back-left', label: '高左后', presetId: 'back', azimuthDeg: 225, elevationDeg: 42 },
  { key: 'low-back-right', label: '低右后', presetId: 'back', azimuthDeg: 135, elevationDeg: -30 },
  { key: 'low-back', label: '低后', presetId: 'back', azimuthDeg: 180, elevationDeg: -30 },
  { key: 'low-back-left', label: '低左后', presetId: 'back', azimuthDeg: 225, elevationDeg: -30 },
]

export const LIBTV_BRIGHTNESS_LEVELS: LibTvBrightnessLevel[] = [
  { value: 10, label: '暗调' },
  { value: 25, label: '柔和' },
  { value: 50, label: '均衡' },
  { value: 75, label: '明亮' },
  { value: 100, label: '过曝' },
]

function wrappedAzimuthDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360
  return Math.min(distance, 360 - distance)
}

export function findClosestLightDirection(
  presets: LibTvLightDirectionPreset[],
  input: { azimuthDeg: number; elevationDeg: number },
): LibTvLightDirectionPreset {
  const first = presets[0]
  if (!first) throw new Error('灯光方向预设不能为空')
  return presets.reduce((best, preset) => {
    const bestDistance = wrappedAzimuthDistance(best.azimuthDeg, input.azimuthDeg)
      + Math.abs(best.elevationDeg - input.elevationDeg) * 1.5
    const nextDistance = wrappedAzimuthDistance(preset.azimuthDeg, input.azimuthDeg)
      + Math.abs(preset.elevationDeg - input.elevationDeg) * 1.5
    return nextDistance < bestDistance ? preset : best
  }, first)
}

export function snapBrightnessToLibTvLevel(value: number): number {
  const first = LIBTV_BRIGHTNESS_LEVELS[0]
  if (!first) throw new Error('亮度档位不能为空')
  return LIBTV_BRIGHTNESS_LEVELS.reduce(
    (best, level) => Math.abs(level.value - value) < Math.abs(best.value - value) ? level : best,
    first,
  ).value
}

export function buildLibTvLightingOperationParameters(
  input: LibTvLightingParameterInput,
): LibTvLightingOperationParameters {
  const prompt = input.smartPrompt.trim()
  const referenceImageUrl = input.referenceImageUrl?.trim() || ''
  return {
    ...(input.directionEnabled ? { UI_KeyLight: input.mainDirectionKey } : {}),
    ...(input.rimEnabled ? { UI_RimLight: input.rimDirectionKey } : {}),
    ...(input.colorEnabled ? { UI_LightColor: input.colorHex } : {}),
    ...(input.brightnessEnabled ? { UI_LightBrightness: snapBrightnessToLibTvLevel(input.brightness) } : {}),
    ...(input.smartMode && prompt ? { prompt } : {}),
    ...(input.smartMode && referenceImageUrl ? { Reference_Image_Intent: referenceImageUrl } : {}),
  }
}

export function cameraFovToImageDistance(fovDeg: number): number {
  const normalized = Math.max(28, Math.min(110, fovDeg))
  const ratio = (normalized - 28) / (110 - 28)
  return Number((0.7 + ratio * (3.8 - 0.7)).toFixed(2))
}

export function resolveMultiAnglePresetPrompt(presetKey: string, currentPrompt: string): string {
  if (presetKey === 'fisheye' && !currentPrompt.trim()) {
    return '极度特写镜头，广角镜头，边缘带有鱼眼畸变效果'
  }
  return currentPrompt
}
