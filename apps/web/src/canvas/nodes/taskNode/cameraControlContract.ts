import { hostedAssetUrl } from '../../../config/objectStorageAssets'

const ICON_BASE = hostedAssetUrl('gen/camera-icons')

export const CAMERA_BODIES = [
  { key: 'imax_keighley', label: 'IMAX Keighley', iconUrl: `${ICON_BASE}/camera/imax_keighley.png` },
  { key: 'arri_alexa35', label: 'ARRI Alexa 35', iconUrl: `${ICON_BASE}/camera/arri_alexa35.png` },
  { key: 'arri_alexa_lf', label: 'ARRI Alexa LF', iconUrl: `${ICON_BASE}/camera/arri_alexa_lf.png` },
  { key: 'red_komodo', label: 'RED Komodo', iconUrl: `${ICON_BASE}/camera/red_komodo.png` },
  { key: 'sony_venice2', label: 'Sony Venice 2', iconUrl: `${ICON_BASE}/camera/sony_venice2.png` },
  { key: 'blackmagic_ursa', label: 'Blackmagic URSA', iconUrl: `${ICON_BASE}/camera/blackmagic_ursa.png` },
] as const

export const CAMERA_LENSES = [
  { key: 'cooke_speed_panchro', label: 'Cooke Speed Panchro', iconUrl: `${ICON_BASE}/lens/cooke_speed_panchro.png` },
  { key: 'zeiss_master_prime', label: 'Zeiss Master Prime', iconUrl: `${ICON_BASE}/lens/zeiss_master_prime.png` },
  { key: 'leica_summilux_c', label: 'Leica Summilux-C', iconUrl: `${ICON_BASE}/lens/leica_summilux_c.png` },
  { key: 'panavision_ultra_speed', label: 'Panavision Ultra Speed', iconUrl: `${ICON_BASE}/lens/panavision_ultra_speed.png` },
  { key: 'arri_signature_prime', label: 'ARRI Signature Prime', iconUrl: `${ICON_BASE}/lens/arri_signature_prime.png` },
] as const

export const CAMERA_FOCALS = [
  { key: '14mm', label: '14mm' },
  { key: '21mm', label: '21mm' },
  { key: '24mm', label: '24mm' },
  { key: '35mm', label: '35mm' },
  { key: '50mm', label: '50mm' },
  { key: '85mm', label: '85mm' },
  { key: '100mm', label: '100mm' },
] as const

export const CAMERA_APERTURES = [
  { key: 'f/1.4', label: 'f/1.4', iconUrl: `${ICON_BASE}/aperture/f_1.4.png` },
  { key: 'f/2', label: 'f/2', iconUrl: `${ICON_BASE}/aperture/f_2.png` },
  { key: 'f/2.8', label: 'f/2.8', iconUrl: `${ICON_BASE}/aperture/f_2.8.png` },
  { key: 'f/4', label: 'f/4', iconUrl: `${ICON_BASE}/aperture/f_4.png` },
  { key: 'f/5.6', label: 'f/5.6', iconUrl: `${ICON_BASE}/aperture/f_5.6.png` },
  { key: 'f/8', label: 'f/8', iconUrl: `${ICON_BASE}/aperture/f_8.png` },
  { key: 'f/11', label: 'f/11', iconUrl: `${ICON_BASE}/aperture/f_11.png` },
] as const

export interface CinematicCameraValue {
  enabled: boolean
  cameraKey: string
  lensKey: string
  focalKey: string
  apertureKey: string
}

export function buildCinematicCameraPrompt(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const cameraValue = value as Partial<CinematicCameraValue>
  if (!cameraValue.enabled) return ''
  const camera = CAMERA_BODIES.find((item) => item.key === cameraValue.cameraKey)?.label
  const lens = CAMERA_LENSES.find((item) => item.key === cameraValue.lensKey)?.label
  const focal = CAMERA_FOCALS.find((item) => item.key === cameraValue.focalKey)?.label
  const aperture = CAMERA_APERTURES.find((item) => item.key === cameraValue.apertureKey)?.label
  const parts: string[] = []
  if (camera) parts.push(`机身：${camera}`)
  if (lens) parts.push(`镜头：${lens}`)
  if (focal) parts.push(`焦距：${focal}`)
  if (aperture) parts.push(`光圈：${aperture}`)
  return parts.length > 0
    ? `摄影机参数（${parts.join('；')}），呈现对应焦段透视、景深与镜头特有的光学质感。`
    : ''
}
