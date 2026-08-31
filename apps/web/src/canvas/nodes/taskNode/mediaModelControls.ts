import type { ModelOption } from '../../../config/models'
import type {
  ImageModelCatalogConfig,
  VideoModelCatalogConfig,
} from '../../../config/modelCatalogMeta'
import { normalizeVideoResolution } from '../../../utils/videoBillingSpec'
import { normalizeOrientation, type Orientation } from '../../../utils/orientation'

export const DEFAULT_IMAGE_ASPECT_RATIO = '16:9'

export function formatImageResolutionOptionLabel(label: string, value: string): string {
  const trimmedValue = String(value || '').trim()
  const trimmedLabel = String(label || '').trim()
  return trimmedLabel.endsWith('输出') && trimmedValue
    ? trimmedValue
    : trimmedLabel || trimmedValue
}

export function getTaskNodeModelDisplayLabel(
  option: Pick<ModelOption, 'label' | 'modelAlias' | 'modelKey' | 'value'> | null | undefined,
): string {
  const alias = typeof option?.modelAlias === 'string' ? option.modelAlias.trim() : ''
  if (alias) return alias
  const modelKey = typeof option?.modelKey === 'string' ? option.modelKey.trim() : ''
  if (modelKey) return modelKey
  const label = typeof option?.label === 'string' ? option.label.trim() : ''
  if (label) return label
  return typeof option?.value === 'string' ? option.value.trim() : ''
}

export function readCatalogTags(option: ModelOption): readonly string[] {
  const meta = option.meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return []
  const tags = (meta as Record<string, unknown>).tags
  if (!Array.isArray(tags)) return []
  return tags
    .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
    .filter(Boolean)
}

export function isCatalogAudioType(option: ModelOption, audioType: 'speech' | 'music'): boolean {
  return readCatalogTags(option).includes(`tapcanvas:audio-type=${audioType}`)
}

export function readCatalogTagValue(option: ModelOption | null | undefined, key: string): string {
  const prefix = `${key.trim().toLowerCase()}=`
  if (!prefix || !option) return ''
  const tag = readCatalogTags(option).find((item) => item.startsWith(prefix))
  return tag ? tag.slice(prefix.length).trim() : ''
}

export function normalizeImageAspect(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.toLowerCase() === 'auto') return DEFAULT_IMAGE_ASPECT_RATIO
  return raw
}

export function normalizeImageSizeSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

export function normalizeImageResolutionSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

export function normalizeImageQualitySetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function formatImageQualityOptionLabel(label: string, value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low') return '低画质'
  if (normalized === 'medium' || normalized === 'standard' || normalized === 'auto') return '标准画质'
  if (normalized === 'high' || normalized === 'hd') return '高画质'
  return label.trim() || value
}

function normalizeImageBillingSpecSegment(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return ''
  return raw.replace(/:/g, '_').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}

function hasPricingSpec(modelOption: ModelOption | null | undefined, specKey: string): boolean {
  const normalized = specKey.trim()
  if (!normalized) return false
  return Boolean(modelOption?.pricing?.specCosts?.some((spec) => spec.enabled && spec.specKey === normalized))
}

export function buildImageBillingSpecKeyForOption(input: {
  modelOption: ModelOption | null | undefined
  aspect: string
  imageSize: string
  imageResolution: string
  imageQuality?: string
}): string | null {
  const resolution =
    normalizeImageBillingSpecSegment(input.imageResolution) ||
    normalizeImageBillingSpecSegment(input.imageSize)
  if (!resolution) return null
  const aspect = normalizeImageBillingSpecSegment(input.aspect)
  const quality = normalizeImageBillingSpecSegment(input.imageQuality)
  const identifiers = [
    input.modelOption?.value,
    input.modelOption?.modelAlias,
    input.modelOption?.modelKey,
  ].map((value) => String(value || '').trim().toLowerCase())
  const isOfficialGptImage2 = identifiers.includes('gpt-image-2-official')
  const candidates = [
    ...(quality ? [`image:${resolution}:${quality}`] : []),
    ...(isOfficialGptImage2 && aspect && quality ? [`image:${aspect}:${resolution}:${quality}`] : []),
    ...(isOfficialGptImage2 && aspect && !quality ? [`image:${aspect}:${resolution}:high`] : []),
    ...(aspect && !quality ? [`image:${aspect}:${resolution}:auto`] : []),
    `image:${resolution}`,
  ]
  return candidates.find((specKey) => hasPricingSpec(input.modelOption, specKey)) || null
}

export function pickImageAspectValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageAspect(current)
  const allowed = config.aspectRatioOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultAspectRatio && allowed.includes(config.defaultAspectRatio)) return config.defaultAspectRatio
    return allowed[0] ?? null
  }
  return config.defaultAspectRatio || null
}

export function pickImageSizeValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageSizeSetting(current)
  const allowed = config.imageSizeOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultImageSize && allowed.includes(config.defaultImageSize)) return config.defaultImageSize
    return allowed[0] ?? null
  }
  return config.defaultImageSize || null
}

export function pickImageResolutionValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageResolutionSetting(current)
  const allowed = config.resolutionOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    return allowed[0] ?? null
  }
  return null
}

export function pickImageQualityValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageQualitySetting(current)
  const allowed = config.qualityOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultQuality && allowed.includes(config.defaultQuality)) return config.defaultQuality
    return allowed[0] ?? null
  }
  return config.defaultQuality || null
}

export function pickVideoDurationValue(config: VideoModelCatalogConfig | null, current: number): number | null {
  if (!config || !config.durationOptions.length) return null
  const allowed = config.durationOptions.map((option) => option.value)
  if (allowed.includes(current)) return current
  if (typeof config.defaultDurationSeconds === 'number' && allowed.includes(config.defaultDurationSeconds)) {
    return config.defaultDurationSeconds
  }
  return allowed[0] ?? null
}

export function pickVideoSizeValue(config: VideoModelCatalogConfig | null, current: string): string | null {
  if (!config || !config.sizeOptions.length) return null
  const normalizedCurrent = current.trim().replace(/\s+/g, '')
  const allowed = config.sizeOptions.map((option) => option.value)
  if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
  if (config.defaultSize && allowed.includes(config.defaultSize)) return config.defaultSize
  return allowed[0] ?? null
}

export function pickVideoResolutionValue(config: VideoModelCatalogConfig | null, current: string): string | null {
  if (!config || !config.resolutionOptions.length) return null
  const normalizedCurrent = normalizeVideoResolution(current)
  const allowed = config.resolutionOptions.map((option) => option.value)
  if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
  if (config.defaultResolution && allowed.includes(config.defaultResolution)) return config.defaultResolution
  return allowed[0] ?? null
}

export function pickVideoOrientationValue(
  config: VideoModelCatalogConfig | null,
  current: Orientation,
): Orientation | null {
  if (!config || !config.orientationOptions.length) return null
  const allowed = config.orientationOptions.map((option) => option.value)
  if (allowed.includes(current)) return current
  if (config.defaultOrientation && allowed.includes(config.defaultOrientation)) return config.defaultOrientation
  return allowed[0] ?? null
}

function inferOrientationFromAspect(value: string): Orientation | null {
  const raw = value.trim()
  if (!raw) return null
  const match = raw.match(/^(\d+)\s*[:/xX]\s*(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return height > width ? 'portrait' : 'landscape'
}

export function resolveVideoOrientationValue(params: {
  currentOrientation: unknown
  size: string
  aspect: string
  config: VideoModelCatalogConfig | null
}): Orientation {
  const normalizedSize = params.size.trim().replace(/\s+/g, '')
  const sizeRule = normalizedSize && params.config
    ? params.config.sizeOptions.find((option) => option.value === normalizedSize) || null
    : null
  if (sizeRule?.orientation) return sizeRule.orientation
  if (sizeRule?.aspectRatio) {
    const inferredFromSizeRule = inferOrientationFromAspect(sizeRule.aspectRatio)
    if (inferredFromSizeRule) return inferredFromSizeRule
  }
  const inferredFromAspect = inferOrientationFromAspect(params.aspect)
  if (inferredFromAspect) return inferredFromAspect
  if (typeof params.currentOrientation === 'string' && params.currentOrientation.trim()) {
    return normalizeOrientation(params.currentOrientation)
  }
  return 'landscape'
}
