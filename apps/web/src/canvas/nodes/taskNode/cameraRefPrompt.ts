export type CameraRefShot =
  | 'closeUp'
  | 'mediumCloseUp'
  | 'mediumShot'
  | 'mediumFull'
  | 'fullShot'
  | 'wideShot'

export type CameraRefComposition =
  | 'none'
  | 'thirds'
  | 'center'
  | 'diagonal'
  | 'leadingLines'
  | 'framing'

export type CameraRefConfig = {
  azimuthDeg: number
  elevationDeg: number
  shot: CameraRefShot
  composition: CameraRefComposition
  focalMm: number
  aperture: number
  shutterDenominator: number
  iso: number
  masterMode: boolean
  filmMode: boolean
  includeStoryboardSheet: boolean
  extraPrompt: string
}

export const CAMERA_REF_F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16] as const
export const CAMERA_REF_SHUTTER_DENOMINATORS = [30, 60, 125, 250, 500, 1000] as const
export const CAMERA_REF_ISO_VALUES = [50, 100, 200, 400, 800, 1600, 3200] as const

export const CAMERA_REF_SHOTS: Array<{ value: CameraRefShot; labelZh: string; labelEn: string }> = [
  { value: 'closeUp', labelZh: '特写', labelEn: 'Close-up (face and shoulders)' },
  { value: 'mediumCloseUp', labelZh: '近景', labelEn: 'Medium close-up (chest up)' },
  { value: 'mediumShot', labelZh: '中景', labelEn: 'Medium shot (waist up)' },
  { value: 'mediumFull', labelZh: '中全景', labelEn: 'Medium full shot (knee up)' },
  { value: 'fullShot', labelZh: '全景', labelEn: 'Full shot (full body)' },
  { value: 'wideShot', labelZh: '远景', labelEn: 'Wide shot (full body in environment)' },
]

export const CAMERA_REF_COMPOSITIONS: Array<{ value: CameraRefComposition; labelZh: string; labelEn?: string }> = [
  { value: 'none', labelZh: '无' },
  { value: 'thirds', labelZh: '三分法', labelEn: 'rule of thirds composition' },
  { value: 'center', labelZh: '居中', labelEn: 'symmetrical center composition' },
  { value: 'diagonal', labelZh: '对角线', labelEn: 'diagonal composition' },
  { value: 'leadingLines', labelZh: '引导线', labelEn: 'leading lines composition' },
  { value: 'framing', labelZh: '框架', labelEn: 'frame within a frame composition' },
]

export const DEFAULT_CAMERA_REF_CONFIG: CameraRefConfig = {
  azimuthDeg: 85,
  elevationDeg: 14,
  shot: 'mediumShot',
  composition: 'center',
  focalMm: 50,
  aperture: 5.6,
  shutterDenominator: 125,
  iso: 100,
  masterMode: false,
  filmMode: false,
  includeStoryboardSheet: true,
  extraPrompt: '',
}

type CameraRefPreset = {
  id: string
  labelZh: string
  configPatch: Partial<CameraRefConfig>
}

export const CAMERA_REF_PRESETS: CameraRefPreset[] = [
  { id: 'right-profile', labelZh: '右侧面（约 85°）', configPatch: { azimuthDeg: 85 } },
  { id: 'front', labelZh: '正面（0°）', configPatch: { azimuthDeg: 0 } },
  { id: 'back', labelZh: '背面（180°）', configPatch: { azimuthDeg: 180 } },
  { id: 'left-profile', labelZh: '左侧面（270°）', configPatch: { azimuthDeg: 270 } },
  { id: 'front-right-3q', labelZh: '右前 3/4（45°）', configPatch: { azimuthDeg: 45 } },
  { id: 'rear-right-3q', labelZh: '右后 3/4（135°）', configPatch: { azimuthDeg: 135 } },
  { id: 'rear-left-3q', labelZh: '左后 3/4（225°）', configPatch: { azimuthDeg: 225 } },
  { id: 'front-left-3q', labelZh: '左前 3/4（315°）', configPatch: { azimuthDeg: 315 } },
]

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const clampFinite = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const normalizeInlineText = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

const normalizeDegrees = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  const normalized = ((value % 360) + 360) % 360
  return normalized === 360 ? 0 : normalized
}

const isShot = (value: unknown): value is CameraRefShot =>
  typeof value === 'string' && CAMERA_REF_SHOTS.some((s) => s.value === value)

const isComposition = (value: unknown): value is CameraRefComposition =>
  typeof value === 'string' && CAMERA_REF_COMPOSITIONS.some((c) => c.value === value)

export const normalizeCameraRefConfig = (value: unknown): CameraRefConfig => {
  const raw = isRecord(value) ? value : {}
  const azimuthDeg = clampFinite(raw.azimuthDeg, 0, 360, DEFAULT_CAMERA_REF_CONFIG.azimuthDeg)
  const elevationDeg = clampFinite(raw.elevationDeg, -45, 45, DEFAULT_CAMERA_REF_CONFIG.elevationDeg)
  const focalMm = clampFinite(raw.focalMm, 18, 200, DEFAULT_CAMERA_REF_CONFIG.focalMm)
  const aperture = clampFinite(raw.aperture, 1.0, 32, DEFAULT_CAMERA_REF_CONFIG.aperture)
  const shutterDenominator = clampFinite(raw.shutterDenominator, 1, 8000, DEFAULT_CAMERA_REF_CONFIG.shutterDenominator)
  const iso = clampFinite(raw.iso, 25, 25600, DEFAULT_CAMERA_REF_CONFIG.iso)

  return {
    azimuthDeg,
    elevationDeg,
    shot: isShot(raw.shot) ? raw.shot : DEFAULT_CAMERA_REF_CONFIG.shot,
    composition: isComposition(raw.composition) ? raw.composition : DEFAULT_CAMERA_REF_CONFIG.composition,
    focalMm,
    aperture,
    shutterDenominator,
    iso,
    masterMode: Boolean(raw.masterMode),
    filmMode: Boolean(raw.filmMode),
    includeStoryboardSheet: raw.includeStoryboardSheet === false ? false : true,
    extraPrompt: typeof raw.extraPrompt === 'string' ? raw.extraPrompt : DEFAULT_CAMERA_REF_CONFIG.extraPrompt,
  }
}

const formatNumber = (value: number, digits: number) => {
  if (!Number.isFinite(value)) return ''
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

const shotLabel = (shot: CameraRefShot): string => CAMERA_REF_SHOTS.find((s) => s.value === shot)?.labelEn || 'Medium shot (waist up)'

const compositionLabel = (composition: CameraRefComposition): string => {
  const label = CAMERA_REF_COMPOSITIONS.find((c) => c.value === composition)?.labelEn
  return typeof label === 'string' ? label : ''
}

const lensTypeLabel = (focalMm: number): string => {
  const mm = Math.round(Number.isFinite(focalMm) ? focalMm : 50)
  if (mm <= 20) return 'ultra-wide lens'
  if (mm <= 35) return 'wide-angle lens'
  if (mm <= 70) return 'standard lens'
  if (mm <= 135) return 'telephoto lens'
  return 'super-telephoto lens'
}

const viewLabelFromAzimuth = (azimuthDeg: number): string => {
  const a = normalizeDegrees(azimuthDeg)
  const octant = Math.round(a / 45) % 8
  switch (octant) {
    case 0:
      return 'Front view'
    case 1:
      return 'Front Right Three-Quarter view'
    case 2:
      return 'Right Side Profile view'
    case 3:
      return 'Rear Right Three-Quarter view'
    case 4:
      return 'Rear view'
    case 5:
      return 'Rear Left Three-Quarter view'
    case 6:
      return 'Left Side Profile view'
    case 7:
      return 'Front Left Three-Quarter view'
    default:
      return 'Front view'
  }
}

const pitchLabelFromElevation = (elevationDeg: number): string => {
  const el = Math.round(Number.isFinite(elevationDeg) ? elevationDeg : 0)
  if (el <= -35) return 'Extreme low-angle'
  if (el <= -20) return 'Low-angle'
  if (el <= -8) return 'Slightly low-angle'
  if (el <= 15) return 'Neutral eye-level perspective'
  if (el <= 25) return 'Slightly elevated high-angle'
  if (el <= 40) return 'High-angle'
  return "Bird's-eye"
}

export const buildCameraRefPrompt = (config: CameraRefConfig): string => {
  const azimuth = Math.round(normalizeDegrees(config.azimuthDeg))
  const elevation = Math.round(clampFinite(config.elevationDeg, -90, 90, 0))
  const focal = Math.round(clampFinite(config.focalMm, 1, 1000, 50))
  const aperture = clampFinite(config.aperture, 0.7, 64, 5.6)
  const shutter = Math.round(clampFinite(config.shutterDenominator, 1, 8000, 125))
  const iso = Math.round(clampFinite(config.iso, 25, 25600, 100))

  const composition = compositionLabel(config.composition)
  const shot = shotLabel(config.shot)
  const lensType = lensTypeLabel(focal)
  const view = viewLabelFromAzimuth(azimuth)
  const pitch = pitchLabelFromElevation(elevation)
  const extra = normalizeInlineText(config.extraPrompt)

  const sentences: string[] = [
    `Camera View: ${view} (${azimuth}° azimuth).`,
    `Camera Pitch: ${pitch} (${elevation}° elevation).`,
    `Composition: ${shot}${composition ? `, ${composition}` : ''}.`,
    `Settings: ${focal}mm ${lensType}, f/${formatNumber(aperture, 1)} aperture, 1/${shutter} shutter, ISO ${iso}.`,
  ]

  if (config.masterMode) {
    sentences.push(
      'Master Style: Wes Anderson style: symmetrical composition, flat staging, pastel color palette, whimsical precision.',
    )
  }
  if (config.filmMode) {
    sentences.push(
      'Film Simulation: Analog aesthetic, Kodak Portra 400, visible film grain, organic color grading, halation, soft highlight rolloff, vintage lens character.',
    )
  }

  sentences.push('Style requirements: Photorealistic cinematic style, detailed textures, natural lighting, high fidelity.')

  if (config.includeStoryboardSheet) {
    sentences.push('Create a single storyboard sheet with exactly 4 distinct panels arranged in a grid.')
  }

  const base = sentences.join(' ')
  return extra ? `${base} ${extra}` : base
}
