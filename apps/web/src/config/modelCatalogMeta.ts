import { normalizeOrientation, type Orientation } from '../utils/orientation'
import { normalizeVideoResolution } from '../utils/videoBillingSpec'
import type { ModelOptionPricing } from './models'

type UnknownRecord = Record<string, unknown>

export type VideoModelDurationOption = {
  value: number
  label: string
  priceLabel?: string
}

export type VideoModelSizeOption = {
  value: string
  label: string
  orientation?: Orientation
  aspectRatio?: string
  priceLabel?: string
}

export type VideoModelOrientationOption = {
  value: Orientation
  label: string
  size?: string
  aspectRatio?: string
}

export type VideoModelResolutionOption = {
  value: string
  label: string
  priceLabel?: string
}

export type ImageModelAspectRatioOption = {
  value: string
  label: string
}

export type ImageModelResolutionOption = {
  value: string
  label: string
  priceLabel?: string
}

export type ImageModelControlBinding = 'aspectRatio' | 'imageSize' | 'resolution' | 'quality'

export type ImageModelSizeWhenSelected = {
  /** 限制比例选项；缺省 = 使用模型全局选项 */
  aspectRatioOptions?: string[]
  /** 选中该尺寸时隐藏的控件 */
  hides?: ImageModelControlBinding[]
}

export type ImageModelSizeOption = {
  value: string
  label: string
  priceLabel?: string
  whenSelected?: ImageModelSizeWhenSelected
}

export type ImageModelControlOptionSource =
  | 'aspectRatioOptions'
  | 'imageSizeOptions'
  | 'resolutionOptions'
  | 'qualityOptions'

export type ImageModelControlConfig = {
  key: string
  label: string
  binding: ImageModelControlBinding
  optionSource: ImageModelControlOptionSource
}

export type ImageModelCatalogConfig = {
  defaultAspectRatio?: string
  defaultImageSize?: string
  defaultQuality?: string
  aspectRatioOptions: ImageModelAspectRatioOption[]
  imageSizeOptions: ImageModelSizeOption[]
  resolutionOptions: ImageModelResolutionOption[]
  qualityOptions: ImageModelResolutionOption[]
  controls: ImageModelControlConfig[]
  supportsReferenceImages?: boolean
  supportsTextToImage?: boolean
  supportsImageToImage?: boolean
}

export type VideoModelControlBinding = 'durationSeconds' | 'size' | 'resolution' | 'orientation'

export type VideoModelControlOptionSource =
  | 'durationOptions'
  | 'sizeOptions'
  | 'resolutionOptions'
  | 'orientationOptions'

export type VideoModelControlConfig = {
  key: string
  label: string
  binding: VideoModelControlBinding
  optionSource: VideoModelControlOptionSource
}

export type VideoModelCatalogConfig = {
  defaultDurationSeconds?: number
  defaultSize?: string
  defaultResolution?: string
  defaultOrientation?: Orientation
  durationOptions: VideoModelDurationOption[]
  sizeOptions: VideoModelSizeOption[]
  resolutionOptions: VideoModelResolutionOption[]
  orientationOptions: VideoModelOrientationOption[]
  controls: VideoModelControlConfig[]
  maxReferenceImages?: number
  maxReferenceVideos?: number
  maxReferenceAudios?: number
  maxReferenceMedia?: number
  maxReferenceVideoDurationSeconds?: number
  maxReferenceAudioDurationSeconds?: number
  maxVideoExtensionDurationSeconds?: number
  maxNestedVideoDurationSeconds?: number
  maxUltraLongDurationSeconds?: number
  supportsMultimodalReferences?: boolean
  supportsReferenceImages?: boolean
  supportsReferenceVideos?: boolean
  supportsReferenceAudios?: boolean
  supportsAudioOnlyReference?: boolean
  supportsFirstLastFrame?: boolean
  supportsVideoEditing?: boolean
  supportsVideoSubjectRemoval?: boolean
  supportsVideoSubtitleRemoval?: boolean
  supportsVideoExtension?: boolean
  supportsUltraLongVideo?: boolean
  supportsTimestampPrompt?: boolean
  supportsNativeAudio?: boolean
}

export const DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT = 8

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asPositiveNumber(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(num) || num <= 0) return null
  return num
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeCompactString(value: unknown): string {
  return asTrimmedString(value).replace(/\s+/g, '')
}

function parseImageAspectRatioOption(value: unknown): ImageModelAspectRatioOption | null {
  if (typeof value === 'string') {
    const normalized = normalizeCompactString(value)
    if (!normalized) return null
    return { value: normalized, label: normalized }
  }
  if (!isRecord(value)) return null
  const aspectRatio = normalizeCompactString(value.value ?? value.aspectRatio ?? value.aspect_ratio)
  if (!aspectRatio) return null
  const label = asTrimmedString(value.label) || aspectRatio
  return {
    value: aspectRatio,
    label,
  }
}

function parseImageSizeWhenSelected(value: unknown): ImageModelSizeWhenSelected | undefined {
  if (!isRecord(value)) return undefined
  const aspectRatioOptions = Array.isArray(value.aspectRatioOptions)
    ? value.aspectRatioOptions.map(normalizeCompactString).filter(Boolean)
    : undefined
  const hides = Array.isArray(value.hides)
    ? value.hides
        .map((v) => parseImageControlBinding(v))
        .filter((v): v is ImageModelControlBinding => v !== null)
    : undefined
  if (!aspectRatioOptions?.length && !hides?.length) return undefined
  return {
    ...(aspectRatioOptions?.length ? { aspectRatioOptions } : {}),
    ...(hides?.length ? { hides } : {}),
  }
}

function parseImageSizeOption(value: unknown): ImageModelSizeOption | null {
  if (typeof value === 'string') {
    const normalized = normalizeCompactString(value)
    if (!normalized) return null
    return { value: normalized, label: normalized }
  }
  if (!isRecord(value)) return null
  const size = normalizeCompactString(
    value.value ?? value.size ?? value.imageSize ?? value.image_size,
  )
  if (!size) return null
  const label = asTrimmedString(value.label) || size
  const priceLabel = asTrimmedString(value.priceLabel ?? value.price)
  const whenSelected = parseImageSizeWhenSelected(value.whenSelected)
  return {
    value: size,
    label,
    ...(priceLabel ? { priceLabel } : {}),
    ...(whenSelected ? { whenSelected } : {}),
  }
}

function parseImageResolutionOption(value: unknown): ImageModelResolutionOption | null {
  if (typeof value === 'string') {
    const normalized = normalizeCompactString(value)
    if (!normalized) return null
    return { value: normalized, label: normalized }
  }
  if (!isRecord(value)) return null
  const resolution = normalizeCompactString(
    value.value ?? value.resolution ?? value.imageResolution ?? value.image_resolution,
  )
  if (!resolution) return null
  const label = asTrimmedString(value.label) || resolution
  const priceLabel = asTrimmedString(value.priceLabel ?? value.price)
  return {
    value: resolution,
    label,
    ...(priceLabel ? { priceLabel } : {}),
  }
}

function parseImageControlBinding(value: unknown): ImageModelControlBinding | null {
  const raw = asTrimmedString(value).toLowerCase()
  if (!raw) return null
  if (raw === 'aspectratio' || raw === 'aspect' || raw === 'ratio') {
    return 'aspectRatio'
  }
  if (
    raw === 'imagesize' ||
    raw === 'size' ||
    raw === 'outputsize' ||
    raw === 'dimensions'
  ) {
    return 'imageSize'
  }
  if (raw === 'resolution' || raw === 'imageresolution' || raw === 'outputresolution') {
    return 'resolution'
  }
  if (raw === 'quality' || raw === 'imagequality' || raw === 'outputquality') {
    return 'quality'
  }
  return null
}

function defaultImageControlLabel(binding: ImageModelControlBinding): string {
  if (binding === 'aspectRatio') return '比例'
  if (binding === 'resolution') return '分辨率'
  if (binding === 'quality') return '画质'
  return '尺寸'
}

function defaultImageControlOptionSource(
  binding: ImageModelControlBinding,
): ImageModelControlOptionSource {
  if (binding === 'aspectRatio') return 'aspectRatioOptions'
  if (binding === 'resolution') return 'resolutionOptions'
  if (binding === 'quality') return 'qualityOptions'
  return 'imageSizeOptions'
}

function parseImageControlOptionSource(
  value: unknown,
  binding: ImageModelControlBinding,
): ImageModelControlOptionSource {
  const raw = asTrimmedString(value).toLowerCase()
  if (raw === 'aspectratiooptions' || raw === 'aspectratio' || raw === 'ratio') {
    return 'aspectRatioOptions'
  }
  if (
    raw === 'imagesizeoptions' ||
    raw === 'imagesize' ||
    raw === 'size' ||
    raw === 'outputsize'
  ) {
    return 'imageSizeOptions'
  }
  if (raw === 'resolutionoptions' || raw === 'resolution' || raw === 'outputresolution') {
    return 'resolutionOptions'
  }
  if (raw === 'qualityoptions' || raw === 'quality' || raw === 'outputquality') {
    return 'qualityOptions'
  }
  return defaultImageControlOptionSource(binding)
}

function parseImageControlConfig(
  key: string,
  value: unknown,
): ImageModelControlConfig | null {
  if (typeof value === 'string') {
    const binding = parseImageControlBinding(value)
    if (!binding) return null
    return {
      key: key || binding,
      label: defaultImageControlLabel(binding),
      binding,
      optionSource: defaultImageControlOptionSource(binding),
    }
  }
  if (!isRecord(value)) return null
  const binding = parseImageControlBinding(value.binding ?? value.field ?? value.modelField ?? key)
  if (!binding) return null
  const label = asTrimmedString(value.label) || defaultImageControlLabel(binding)
  return {
    key: asTrimmedString(value.key) || key || binding,
    label,
    binding,
    optionSource: parseImageControlOptionSource(
      value.optionSource ?? value.options ?? value.source,
      binding,
    ),
  }
}

function parseImageControlConfigs(root: UnknownRecord): ImageModelControlConfig[] {
  const controlsSource = Array.isArray(root.controls) ? root.controls : []
  const controlsFromArray = controlsSource
    .map((value, index) => parseImageControlConfig(`control_${index + 1}`, value))
    .filter((item): item is ImageModelControlConfig => item !== null)
  if (controlsFromArray.length) {
    return dedupeByValue(controlsFromArray.map((item) => ({ ...item, value: item.key }))).map(
      ({ value: _value, ...rest }) => rest,
    )
  }

  const mappingSource = isRecord(root.controlMappings)
    ? root.controlMappings
    : isRecord(root.controlMap)
      ? root.controlMap
      : null
  if (!mappingSource) return []
  return Object.entries(mappingSource)
    .map(([key, value]) => parseImageControlConfig(key, value))
    .filter((item): item is ImageModelControlConfig => item !== null)
}

function parseDurationOption(value: unknown): VideoModelDurationOption | null {
  if (typeof value === 'number' || typeof value === 'string') {
    const num = asPositiveNumber(value)
    if (num == null) return null
    return { value: Math.trunc(num), label: `${Math.trunc(num)}s` }
  }
  if (!isRecord(value)) return null
  const duration = asPositiveNumber(value.value ?? value.duration ?? value.seconds)
  if (duration == null) return null
  const label = asTrimmedString(value.label) || `${Math.trunc(duration)}s`
  const priceLabel = asTrimmedString(value.priceLabel ?? value.price)
  return {
    value: Math.trunc(duration),
    label,
    ...(priceLabel ? { priceLabel } : {}),
  }
}

function parseSizeOption(value: unknown): VideoModelSizeOption | null {
  if (typeof value === 'string') {
    const normalized = normalizeCompactString(value)
    if (!normalized) return null
    return { value: normalized, label: normalized }
  }
  if (!isRecord(value)) return null
  const size = normalizeCompactString(value.value ?? value.size)
  if (!size) return null
  const label = asTrimmedString(value.label) || size
  const aspectRatio = asTrimmedString(value.aspectRatio ?? value.aspect_ratio)
  const priceLabel = asTrimmedString(value.priceLabel ?? value.price)
  const orientationRaw = value.orientation ?? value.direction
  const orientation =
    typeof orientationRaw === 'undefined' ? undefined : normalizeOrientation(orientationRaw)
  return {
    value: size,
    label,
    ...(orientation ? { orientation } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(priceLabel ? { priceLabel } : {}),
  }
}

function parseOrientationOption(value: unknown): VideoModelOrientationOption | null {
  if (typeof value === 'string') {
    const normalized = normalizeOrientation(value)
    return {
      value: normalized,
      label: normalized === 'portrait' ? '竖屏' : '横屏',
    }
  }
  if (!isRecord(value)) return null
  const orientationRaw = value.value ?? value.orientation
  if (typeof orientationRaw === 'undefined') return null
  const normalized = normalizeOrientation(orientationRaw)
  const label =
    asTrimmedString(value.label) || (normalized === 'portrait' ? '竖屏' : '横屏')
  const size = asTrimmedString(value.size).replace(/\s+/g, '')
  const aspectRatio = asTrimmedString(value.aspectRatio ?? value.aspect_ratio)
  return {
    value: normalized,
    label,
    ...(size ? { size } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
  }
}

function parseResolutionOption(value: unknown): VideoModelResolutionOption | null {
  if (typeof value === 'string') {
    const normalized = normalizeVideoResolution(value)
    if (!normalized) return null
    return { value: normalized, label: normalized }
  }
  if (!isRecord(value)) return null
  const resolution = normalizeVideoResolution(value.value ?? value.resolution)
  if (!resolution) return null
  const label = asTrimmedString(value.label) || resolution
  const priceLabel = asTrimmedString(value.priceLabel ?? value.price)
  return {
    value: resolution,
    label,
    ...(priceLabel ? { priceLabel } : {}),
  }
}

function parseControlBinding(value: unknown): VideoModelControlBinding | null {
  const raw = asTrimmedString(value).toLowerCase()
  if (!raw) return null
  if (
    raw === 'duration' ||
    raw === 'durationseconds' ||
    raw === 'videoDurationSeconds'.toLowerCase()
  ) {
    return 'durationSeconds'
  }
  if (
    raw === 'size' ||
    raw === 'videosize' ||
    raw === 'ratio' ||
    raw === 'aspectratio'
  ) {
    return 'size'
  }
  if (raw === 'resolution' || raw === 'videoresolution' || raw === 'outputresolution') {
    return 'resolution'
  }
  if (raw === 'orientation' || raw === 'direction') {
    return 'orientation'
  }
  return null
}

function defaultControlLabel(binding: VideoModelControlBinding): string {
  if (binding === 'durationSeconds') return '时长'
  if (binding === 'resolution') return '分辨率'
  if (binding === 'orientation') return '方向'
  return '画幅'
}

function defaultControlOptionSource(binding: VideoModelControlBinding): VideoModelControlOptionSource {
  if (binding === 'durationSeconds') return 'durationOptions'
  if (binding === 'resolution') return 'resolutionOptions'
  if (binding === 'orientation') return 'orientationOptions'
  return 'sizeOptions'
}

function parseControlOptionSource(
  value: unknown,
  binding: VideoModelControlBinding,
): VideoModelControlOptionSource {
  const raw = asTrimmedString(value).toLowerCase()
  if (raw === 'durationoptions' || raw === 'duration') return 'durationOptions'
  if (raw === 'resolutionoptions' || raw === 'resolution' || raw === 'outputresolution') {
    return 'resolutionOptions'
  }
  if (raw === 'orientationoptions' || raw === 'orientation') return 'orientationOptions'
  if (raw === 'sizeoptions' || raw === 'size' || raw === 'ratio' || raw === 'aspectratio') {
    return 'sizeOptions'
  }
  return defaultControlOptionSource(binding)
}

function parseControlConfig(
  key: string,
  value: unknown,
): VideoModelControlConfig | null {
  if (typeof value === 'string') {
    const binding = parseControlBinding(value)
    if (!binding) return null
    return {
      key: key || binding,
      label: defaultControlLabel(binding),
      binding,
      optionSource: defaultControlOptionSource(binding),
    }
  }
  if (!isRecord(value)) return null
  const binding = parseControlBinding(value.binding ?? value.field ?? value.modelField ?? key)
  if (!binding) return null
  const label = asTrimmedString(value.label) || defaultControlLabel(binding)
  return {
    key: asTrimmedString(value.key) || key || binding,
    label,
    binding,
    optionSource: parseControlOptionSource(
      value.optionSource ?? value.options ?? value.source,
      binding,
    ),
  }
}

function parseVideoControlConfigs(root: UnknownRecord): VideoModelControlConfig[] {
  const controlsSource = Array.isArray(root.controls) ? root.controls : []
  const controlsFromArray = controlsSource
    .map((value, index) => parseControlConfig(`control_${index + 1}`, value))
    .filter((item): item is VideoModelControlConfig => item !== null)
  if (controlsFromArray.length) return dedupeByValue(controlsFromArray.map((item) => ({ ...item, value: item.key }))).map(({ value: _value, ...rest }) => rest)

  const mappingSource = isRecord(root.controlMappings)
    ? root.controlMappings
    : isRecord(root.controlMap)
      ? root.controlMap
      : null
  if (mappingSource) {
    const controlsFromMapping = Object.entries(mappingSource)
      .map(([key, value]) => parseControlConfig(key, value))
      .filter((item): item is VideoModelControlConfig => item !== null)
    if (controlsFromMapping.length) return controlsFromMapping
  }

  const inferredControls: VideoModelControlConfig[] = []
  if (Array.isArray(root.durationOptions) && root.durationOptions.length > 0) {
    inferredControls.push({
      key: 'duration',
      label: '时长',
      binding: 'durationSeconds',
      optionSource: 'durationOptions',
    })
  }
  if (
    (Array.isArray(root.sizeOptions) && root.sizeOptions.length > 0) ||
    (Array.isArray(root.aspectRatioOptions) && root.aspectRatioOptions.length > 0)
  ) {
    inferredControls.push({
      key: 'size',
      label: '画幅',
      binding: 'size',
      optionSource: 'sizeOptions',
    })
  }
  const resolutionOptions = Array.isArray(root.resolutionOptions)
    ? root.resolutionOptions
    : Array.isArray(root.outputResolutionOptions)
      ? root.outputResolutionOptions
      : []
  if (resolutionOptions.length > 0) {
    inferredControls.push({
      key: 'resolution',
      label: '分辨率',
      binding: 'resolution',
      optionSource: 'resolutionOptions',
    })
  }
  if (Array.isArray(root.orientationOptions) && root.orientationOptions.length > 0) {
    inferredControls.push({
      key: 'orientation',
      label: '方向',
      binding: 'orientation',
      optionSource: 'orientationOptions',
    })
  }
  return inferredControls
}

function dedupeByValue<T extends { value: string | number }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = String(item.value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseImageModelCatalogConfig(meta: unknown): ImageModelCatalogConfig | null {
  if (!isRecord(meta)) return null
  const root = isRecord(meta.imageOptions)
    ? meta.imageOptions
    : isRecord(meta.imageConfig)
      ? meta.imageConfig
      : isRecord(meta.image)
        ? meta.image
        : meta

  const aspectRatioSource = Array.isArray(root.aspectRatioOptions) ? root.aspectRatioOptions : []
  const imageSizeSource = Array.isArray(root.imageSizeOptions)
    ? root.imageSizeOptions
    : Array.isArray(root.sizeOptions)
      ? root.sizeOptions
      : []
  const resolutionSource = Array.isArray(root.resolutionOptions)
    ? root.resolutionOptions
    : Array.isArray(root.outputResolutionOptions)
      ? root.outputResolutionOptions
      : []
  const qualitySource = Array.isArray(root.qualityOptions) ? root.qualityOptions : []

  const aspectRatioOptions = dedupeByValue(
    aspectRatioSource
      .map(parseImageAspectRatioOption)
      .filter((item): item is ImageModelAspectRatioOption => item !== null),
  )
  const imageSizeOptions = dedupeByValue(
    imageSizeSource
      .map(parseImageSizeOption)
      .filter((item): item is ImageModelSizeOption => item !== null),
  )
  const resolutionOptions = dedupeByValue(
    resolutionSource
      .map(parseImageResolutionOption)
      .filter((item): item is ImageModelResolutionOption => item !== null),
  )
  const qualityOptions = dedupeByValue(
    qualitySource
      .map(parseImageResolutionOption)
      .filter((item): item is ImageModelResolutionOption => item !== null),
  )

  const defaultAspectRatio = normalizeCompactString(
    root.defaultAspectRatio ?? root.defaultAspect ?? root.aspectRatio,
  )
  const defaultImageSize = normalizeCompactString(
    root.defaultImageSize ?? root.defaultSize ?? root.imageSize ?? root.image_size,
  )
  const defaultQuality = normalizeCompactString(root.defaultQuality ?? root.quality)
  const controls = parseImageControlConfigs(root)
  const supportsReferenceImages = asOptionalBoolean(root.supportsReferenceImages)
  const supportsTextToImage = asOptionalBoolean(root.supportsTextToImage)
  const supportsImageToImage = asOptionalBoolean(root.supportsImageToImage)

  if (
    !aspectRatioOptions.length &&
    !imageSizeOptions.length &&
    !resolutionOptions.length &&
    !qualityOptions.length &&
    !controls.length &&
    !defaultAspectRatio &&
    !defaultImageSize &&
    !defaultQuality &&
    typeof supportsReferenceImages === 'undefined' &&
    typeof supportsTextToImage === 'undefined' &&
    typeof supportsImageToImage === 'undefined'
  ) {
    return null
  }

  return {
    ...(defaultAspectRatio ? { defaultAspectRatio } : {}),
    ...(defaultImageSize ? { defaultImageSize } : {}),
    ...(defaultQuality ? { defaultQuality } : {}),
    aspectRatioOptions,
    imageSizeOptions,
    resolutionOptions,
    qualityOptions,
    controls,
    ...(typeof supportsReferenceImages === 'boolean' ? { supportsReferenceImages } : {}),
    ...(typeof supportsTextToImage === 'boolean' ? { supportsTextToImage } : {}),
    ...(typeof supportsImageToImage === 'boolean' ? { supportsImageToImage } : {}),
  }
}

export function parseVideoModelCatalogConfig(meta: unknown): VideoModelCatalogConfig | null {
  if (!isRecord(meta)) return null
  const root = isRecord(meta.videoOptions)
    ? meta.videoOptions
    : isRecord(meta.videoConfig)
      ? meta.videoConfig
      : isRecord(meta.video)
        ? meta.video
        : meta

  const durationSource = Array.isArray(root.durationOptions) ? root.durationOptions : []
  const sizeSource = Array.isArray(root.sizeOptions) && root.sizeOptions.length > 0
    ? root.sizeOptions
    : Array.isArray(root.aspectRatioOptions)
      ? root.aspectRatioOptions
      : []
  const resolutionSource = Array.isArray(root.resolutionOptions)
    ? root.resolutionOptions
    : Array.isArray(root.outputResolutionOptions)
      ? root.outputResolutionOptions
      : []
  const orientationSource = Array.isArray(root.orientationOptions) ? root.orientationOptions : []

  const durationOptions = dedupeByValue(
    durationSource
      .map(parseDurationOption)
      .filter((item): item is VideoModelDurationOption => item !== null),
  )
  const sizeOptions = dedupeByValue(
    sizeSource
      .map(parseSizeOption)
      .filter((item): item is VideoModelSizeOption => item !== null),
  )
  const resolutionOptions = dedupeByValue(
    resolutionSource
      .map(parseResolutionOption)
      .filter((item): item is VideoModelResolutionOption => item !== null),
  )
  const orientationOptions = dedupeByValue(
    orientationSource
      .map(parseOrientationOption)
      .filter((item): item is VideoModelOrientationOption => item !== null),
  )

  const defaultDuration = asPositiveNumber(root.defaultDurationSeconds ?? root.defaultDuration)
  const defaultSize = normalizeCompactString(root.defaultSize)
  const defaultResolution = normalizeVideoResolution(
    root.defaultResolution ?? root.defaultOutputResolution ?? root.outputResolution,
  )
  const defaultOrientationRaw = root.defaultOrientation
  const defaultOrientation =
    typeof defaultOrientationRaw === 'undefined'
      ? undefined
      : normalizeOrientation(defaultOrientationRaw)
  const controls = parseVideoControlConfigs(root)

  const maxReferenceImages = asPositiveNumber(root.maxReferenceImages)
  const maxReferenceVideos = asPositiveNumber(root.maxReferenceVideos)
  const maxReferenceAudios = asPositiveNumber(root.maxReferenceAudios)
  const maxReferenceMedia = asPositiveNumber(root.maxReferenceMedia)
  const maxReferenceVideoDurationSeconds = asPositiveNumber(root.maxReferenceVideoDurationSeconds)
  const maxReferenceAudioDurationSeconds = asPositiveNumber(root.maxReferenceAudioDurationSeconds)
  const maxVideoExtensionDurationSeconds = asPositiveNumber(root.maxVideoExtensionDurationSeconds)
  const maxNestedVideoDurationSeconds = asPositiveNumber(root.maxNestedVideoDurationSeconds)
  const maxUltraLongDurationSeconds = asPositiveNumber(root.maxUltraLongDurationSeconds)
  const supportsMultimodalReferences = asOptionalBoolean(root.supportsMultimodalReferences)
  const supportsReferenceImages = asOptionalBoolean(root.supportsReferenceImages)
  const supportsReferenceVideos = asOptionalBoolean(root.supportsReferenceVideos)
  const supportsReferenceAudios = asOptionalBoolean(root.supportsReferenceAudios)
  const supportsAudioOnlyReference = asOptionalBoolean(root.supportsAudioOnlyReference)
  const supportsFirstLastFrame = asOptionalBoolean(root.supportsFirstLastFrame)
  const supportsVideoEditing = asOptionalBoolean(root.supportsVideoEditing)
  const supportsVideoSubjectRemoval = asOptionalBoolean(root.supportsVideoSubjectRemoval)
  const supportsVideoSubtitleRemoval = asOptionalBoolean(root.supportsVideoSubtitleRemoval)
  const supportsVideoExtension = asOptionalBoolean(root.supportsVideoExtension)
  const supportsUltraLongVideo = asOptionalBoolean(root.supportsUltraLongVideo)
  const supportsTimestampPrompt = asOptionalBoolean(root.supportsTimestampPrompt)
  const supportsNativeAudio = asOptionalBoolean(root.supportsNativeAudio)
  const hasCapabilityConfig = [
    maxReferenceImages,
    maxReferenceVideos,
    maxReferenceAudios,
    maxReferenceMedia,
    maxReferenceVideoDurationSeconds,
    maxReferenceAudioDurationSeconds,
    maxVideoExtensionDurationSeconds,
    maxNestedVideoDurationSeconds,
    maxUltraLongDurationSeconds,
    supportsMultimodalReferences,
    supportsReferenceImages,
    supportsReferenceVideos,
    supportsReferenceAudios,
    supportsAudioOnlyReference,
    supportsFirstLastFrame,
    supportsVideoEditing,
    supportsVideoSubjectRemoval,
    supportsVideoSubtitleRemoval,
    supportsVideoExtension,
    supportsUltraLongVideo,
    supportsTimestampPrompt,
    supportsNativeAudio,
  ].some((value) => typeof value !== 'undefined' && value !== null)

  if (!durationOptions.length && !sizeOptions.length && !resolutionOptions.length && !orientationOptions.length && !controls.length && defaultDuration == null && !defaultSize && !defaultResolution && !defaultOrientation && !hasCapabilityConfig) {
    return null
  }

  return {
    ...(defaultDuration != null ? { defaultDurationSeconds: Math.trunc(defaultDuration) } : {}),
    ...(defaultSize ? { defaultSize } : {}),
    ...(defaultResolution ? { defaultResolution } : {}),
    ...(defaultOrientation ? { defaultOrientation } : {}),
    durationOptions,
    sizeOptions,
    resolutionOptions,
    orientationOptions,
    controls,
    ...(maxReferenceImages != null ? { maxReferenceImages: Math.trunc(maxReferenceImages) } : {}),
    ...(maxReferenceVideos != null ? { maxReferenceVideos: Math.trunc(maxReferenceVideos) } : {}),
    ...(maxReferenceAudios != null ? { maxReferenceAudios: Math.trunc(maxReferenceAudios) } : {}),
    ...(maxReferenceMedia != null ? { maxReferenceMedia: Math.trunc(maxReferenceMedia) } : {}),
    ...(maxReferenceVideoDurationSeconds != null ? { maxReferenceVideoDurationSeconds } : {}),
    ...(maxReferenceAudioDurationSeconds != null ? { maxReferenceAudioDurationSeconds } : {}),
    ...(maxVideoExtensionDurationSeconds != null ? { maxVideoExtensionDurationSeconds } : {}),
    ...(maxNestedVideoDurationSeconds != null ? { maxNestedVideoDurationSeconds } : {}),
    ...(maxUltraLongDurationSeconds != null ? { maxUltraLongDurationSeconds } : {}),
    ...(typeof supportsMultimodalReferences === 'boolean' ? { supportsMultimodalReferences } : {}),
    ...(typeof supportsReferenceImages === 'boolean' ? { supportsReferenceImages } : {}),
    ...(typeof supportsReferenceVideos === 'boolean' ? { supportsReferenceVideos } : {}),
    ...(typeof supportsReferenceAudios === 'boolean' ? { supportsReferenceAudios } : {}),
    ...(typeof supportsAudioOnlyReference === 'boolean' ? { supportsAudioOnlyReference } : {}),
    ...(typeof supportsFirstLastFrame === 'boolean' ? { supportsFirstLastFrame } : {}),
    ...(typeof supportsVideoEditing === 'boolean' ? { supportsVideoEditing } : {}),
    ...(typeof supportsVideoSubjectRemoval === 'boolean' ? { supportsVideoSubjectRemoval } : {}),
    ...(typeof supportsVideoSubtitleRemoval === 'boolean' ? { supportsVideoSubtitleRemoval } : {}),
    ...(typeof supportsVideoExtension === 'boolean' ? { supportsVideoExtension } : {}),
    ...(typeof supportsUltraLongVideo === 'boolean' ? { supportsUltraLongVideo } : {}),
    ...(typeof supportsTimestampPrompt === 'boolean' ? { supportsTimestampPrompt } : {}),
    ...(typeof supportsNativeAudio === 'boolean' ? { supportsNativeAudio } : {}),
  }
}

type ParsedVideoPricingSpec = {
  durationSeconds: number
  resolution: string
}

function parseVideoPricingSpecKey(specKey: string): ParsedVideoPricingSpec | null {
  const normalized = specKey.trim().toLowerCase()
  const match = normalized.match(/^video:([a-z0-9x_-]+):(\d+)s$/i)
  if (!match) return null
  const resolution = normalizeVideoResolution(match[1] || '')
  const durationSeconds = Number(match[2] || '')
  if (!resolution || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null
  }
  return {
    durationSeconds: Math.trunc(durationSeconds),
    resolution,
  }
}

export function constrainVideoModelCatalogConfigByPricing(
  config: VideoModelCatalogConfig | null,
  pricing: ModelOptionPricing | null | undefined,
): VideoModelCatalogConfig | null {
  if (!config || !pricing) return config

  const pricedSpecs = pricing.specCosts
    .filter((spec) => spec.enabled !== false)
    .map((spec) => parseVideoPricingSpecKey(spec.specKey))
    .filter((spec): spec is ParsedVideoPricingSpec => spec !== null)

  if (!pricedSpecs.length) return config

  const pricedDurationSet = new Set<number>(pricedSpecs.map((spec) => spec.durationSeconds))
  const pricedResolutionSet = new Set<string>(pricedSpecs.map((spec) => spec.resolution))

  const durationOptions = config.durationOptions.length
    ? config.durationOptions.filter((option) => pricedDurationSet.has(option.value))
    : Array.from(pricedDurationSet)
        .sort((a, b) => a - b)
        .map((value) => ({ value, label: `${value}s` }))

  const resolutionOptions = config.resolutionOptions.length
    ? config.resolutionOptions.filter((option) => pricedResolutionSet.has(normalizeVideoResolution(option.value)))
    : Array.from(pricedResolutionSet)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }))

  const defaultDurationSeconds =
    typeof config.defaultDurationSeconds === 'number' && pricedDurationSet.has(config.defaultDurationSeconds)
      ? config.defaultDurationSeconds
      : durationOptions[0]?.value

  const normalizedDefaultResolution = config.defaultResolution
    ? normalizeVideoResolution(config.defaultResolution)
    : ''
  const defaultResolution = normalizedDefaultResolution && pricedResolutionSet.has(normalizedDefaultResolution)
    ? normalizedDefaultResolution
    : resolutionOptions[0]?.value

  const controls = config.controls.filter((control) => {
    if (control.binding === 'durationSeconds') return durationOptions.length > 0
    if (control.binding === 'resolution') return resolutionOptions.length > 0
    return true
  })

  const {
    defaultDurationSeconds: _defaultDurationSeconds,
    defaultResolution: _defaultResolution,
    ...restConfig
  } = config

  return {
    ...restConfig,
    ...(typeof defaultDurationSeconds === 'number' ? { defaultDurationSeconds } : {}),
    ...(defaultResolution ? { defaultResolution } : {}),
    durationOptions,
    resolutionOptions,
    controls,
  }
}

type ParsedImagePricingSpec = {
  aspectRatio: string | null
  resolution: string
  quality: string | null
}

export type ImageModelPricingSelection = Readonly<{
  aspectRatio: string
  imageSize: string
  resolution: string
  quality: string
}>

function imageQualitySortRank(value: string): number {
  switch (value) {
    case 'auto':
      return 0
    case 'low':
      return 1
    case 'medium':
    case 'standard':
      return 2
    case 'high':
    case 'hd':
      return 3
    default:
      return 4
  }
}

function denormalizeImageAspectSegment(value: string): string | null {
  const raw = asTrimmedString(value).toLowerCase()
  if (!raw) return null
  const match = raw.match(/^(\d+)_+(\d+)$/)
  if (match) return `${match[1]}:${match[2]}`
  const compact = raw.replace(/\s+/g, '')
  if (/^\d+[:x]\d+$/i.test(compact)) return compact.replace(/x/i, ':')
  return null
}

function parseImagePricingSpecKey(specKey: string): ParsedImagePricingSpec | null {
  const normalized = asTrimmedString(specKey).toLowerCase()
  if (!normalized.startsWith('image:')) return null
  const parts = normalized.split(':').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 2) {
    return {
      aspectRatio: null,
      resolution: parts[1],
      quality: null,
    }
  }
  if (parts.length === 3) {
    return {
      aspectRatio: null,
      resolution: parts[1],
      quality: parts[2],
    }
  }
  if (parts.length >= 4) {
    const aspectRatio = denormalizeImageAspectSegment(parts[1])
    const resolution = parts[2]
    if (!aspectRatio || !resolution) return null
    return {
      aspectRatio,
      resolution,
      quality: parts[3] || null,
    }
  }
  return null
}

export function findImageModelPricingSpec(
  pricing: ModelOptionPricing | null | undefined,
  selection: ImageModelPricingSelection,
): ModelOptionPricing['specCosts'][number] | null {
  if (!pricing) return null
  const resolution = normalizeCompactString(selection.resolution || selection.imageSize).toLowerCase()
  const aspectRatio = normalizeCompactString(selection.aspectRatio)
  const quality = normalizeCompactString(selection.quality).toLowerCase()
  if (!resolution) return null

  const matches = pricing.specCosts.flatMap((spec) => {
    if (spec.enabled === false) return []
    const parsed = parseImagePricingSpecKey(spec.specKey)
    if (!parsed || parsed.resolution !== resolution) return []
    if (parsed.aspectRatio && parsed.aspectRatio !== aspectRatio) return []
    if (parsed.quality && parsed.quality !== quality) return []
    const specificity = Number(Boolean(parsed.aspectRatio)) + Number(Boolean(parsed.quality))
    return [{ spec, specificity }]
  })
  matches.sort((left, right) => right.specificity - left.specificity)
  return matches[0]?.spec ?? null
}

export function constrainImageModelCatalogConfigByPricing(
  config: ImageModelCatalogConfig | null,
  pricing: ModelOptionPricing | null | undefined,
): ImageModelCatalogConfig | null {
  if (!pricing) return config

  const pricedSpecs = pricing.specCosts
    .filter((spec) => spec.enabled !== false)
    .map((spec) => parseImagePricingSpecKey(spec.specKey))
    .filter((spec): spec is ParsedImagePricingSpec => spec !== null)

  if (!pricedSpecs.length) return config

  const pricedResolutionSet = new Set(pricedSpecs.map((spec) => spec.resolution))
  const pricedAspectSet = new Set(
    pricedSpecs
      .map((spec) => spec.aspectRatio)
      .filter((aspectRatio): aspectRatio is string => Boolean(aspectRatio)),
  )
  const pricedQualitySet = new Set(
    pricedSpecs
      .map((spec) => spec.quality)
      .filter((quality): quality is string => Boolean(quality)),
  )

  const base: ImageModelCatalogConfig = config ?? {
    aspectRatioOptions: [],
    imageSizeOptions: [],
    resolutionOptions: [],
    qualityOptions: [],
    controls: [],
  }

  const imageSizeOptions = base.imageSizeOptions.length
    ? base.imageSizeOptions.filter((option) =>
        pricedResolutionSet.has(normalizeCompactString(option.value).toLowerCase()),
      )
    : Array.from(pricedResolutionSet)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value.toUpperCase() }))

  const resolutionOptions = base.resolutionOptions.length
    ? base.resolutionOptions.filter((option) =>
        pricedResolutionSet.has(normalizeCompactString(option.value).toLowerCase()),
      )
    : []

  const qualityOptions = base.qualityOptions.length
    ? base.qualityOptions.filter((option) =>
        pricedQualitySet.size === 0 ||
        pricedQualitySet.has(normalizeCompactString(option.value).toLowerCase()),
      )
    : Array.from(pricedQualitySet)
        .sort((a, b) => imageQualitySortRank(a) - imageQualitySortRank(b) || a.localeCompare(b))
        .map((value) => ({ value, label: value }))

  const aspectRatioOptions = base.aspectRatioOptions.length
    ? base.aspectRatioOptions.filter((option) => pricedAspectSet.size === 0 || pricedAspectSet.has(option.value))
    : Array.from(pricedAspectSet)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }))

  const defaultImageSize =
    base.defaultImageSize &&
    pricedResolutionSet.has(normalizeCompactString(base.defaultImageSize).toLowerCase())
      ? base.defaultImageSize
      : imageSizeOptions[0]?.value

  const defaultAspectRatio =
    base.defaultAspectRatio && (pricedAspectSet.size === 0 || pricedAspectSet.has(base.defaultAspectRatio))
      ? base.defaultAspectRatio
      : aspectRatioOptions[0]?.value

  const defaultQuality =
    base.defaultQuality &&
    (pricedQualitySet.size === 0 ||
      pricedQualitySet.has(normalizeCompactString(base.defaultQuality).toLowerCase()))
      ? base.defaultQuality
      : qualityOptions[0]?.value

  return {
    ...(defaultAspectRatio ? { defaultAspectRatio } : {}),
    ...(defaultImageSize ? { defaultImageSize } : {}),
    ...(defaultQuality ? { defaultQuality } : {}),
    aspectRatioOptions,
    imageSizeOptions,
    resolutionOptions,
    qualityOptions,
    controls: base.controls.filter((control) => control.binding !== 'quality' || qualityOptions.length > 0),
    ...(typeof base.supportsReferenceImages === 'boolean' ? { supportsReferenceImages: base.supportsReferenceImages } : {}),
    ...(typeof base.supportsTextToImage === 'boolean' ? { supportsTextToImage: base.supportsTextToImage } : {}),
    ...(typeof base.supportsImageToImage === 'boolean' ? { supportsImageToImage: base.supportsImageToImage } : {}),
  }
}

export function formatVideoOptionLabel(label: string, priceLabel?: string): string {
  const trimmedLabel = label.trim()
  const trimmedPrice = typeof priceLabel === 'string' ? priceLabel.trim() : ''
  if (!trimmedPrice) return trimmedLabel
  return `${trimmedLabel} ${trimmedPrice}`
}
