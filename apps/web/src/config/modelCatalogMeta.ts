import { normalizeOrientation, type Orientation } from '../utils/orientation'
import { normalizeVideoResolution } from '../utils/videoBillingSpec'

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

export type ImageModelSizeOption = {
  value: string
  label: string
  priceLabel?: string
}

export type ImageModelResolutionOption = {
  value: string
  label: string
  priceLabel?: string
}

export type ImageModelControlBinding = 'aspectRatio' | 'imageSize' | 'resolution'

export type ImageModelControlOptionSource =
  | 'aspectRatioOptions'
  | 'imageSizeOptions'
  | 'resolutionOptions'

export type ImageModelControlConfig = {
  key: string
  label: string
  binding: ImageModelControlBinding
  optionSource: ImageModelControlOptionSource
}

export type ImageModelCatalogConfig = {
  defaultAspectRatio?: string
  defaultImageSize?: string
  aspectRatioOptions: ImageModelAspectRatioOption[]
  imageSizeOptions: ImageModelSizeOption[]
  resolutionOptions: ImageModelResolutionOption[]
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
}

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
  return {
    value: size,
    label,
    ...(priceLabel ? { priceLabel } : {}),
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
  return null
}

function defaultImageControlLabel(binding: ImageModelControlBinding): string {
  if (binding === 'aspectRatio') return '比例'
  if (binding === 'resolution') return '分辨率'
  return '尺寸'
}

function defaultImageControlOptionSource(
  binding: ImageModelControlBinding,
): ImageModelControlOptionSource {
  if (binding === 'aspectRatio') return 'aspectRatioOptions'
  if (binding === 'resolution') return 'resolutionOptions'
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
  if (!mappingSource) return []
  return Object.entries(mappingSource)
    .map(([key, value]) => parseControlConfig(key, value))
    .filter((item): item is VideoModelControlConfig => item !== null)
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

  const defaultAspectRatio = normalizeCompactString(
    root.defaultAspectRatio ?? root.defaultAspect ?? root.aspectRatio,
  )
  const defaultImageSize = normalizeCompactString(
    root.defaultImageSize ?? root.defaultSize ?? root.imageSize ?? root.image_size,
  )
  const controls = parseImageControlConfigs(root)
  const supportsReferenceImages = asOptionalBoolean(root.supportsReferenceImages)
  const supportsTextToImage = asOptionalBoolean(root.supportsTextToImage)
  const supportsImageToImage = asOptionalBoolean(root.supportsImageToImage)

  if (
    !aspectRatioOptions.length &&
    !imageSizeOptions.length &&
    !resolutionOptions.length &&
    !controls.length &&
    !defaultAspectRatio &&
    !defaultImageSize &&
    typeof supportsReferenceImages === 'undefined' &&
    typeof supportsTextToImage === 'undefined' &&
    typeof supportsImageToImage === 'undefined'
  ) {
    return null
  }

  return {
    ...(defaultAspectRatio ? { defaultAspectRatio } : {}),
    ...(defaultImageSize ? { defaultImageSize } : {}),
    aspectRatioOptions,
    imageSizeOptions,
    resolutionOptions,
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
  const sizeSource = Array.isArray(root.sizeOptions) ? root.sizeOptions : []
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

  if (!durationOptions.length && !sizeOptions.length && !resolutionOptions.length && !orientationOptions.length && !controls.length && defaultDuration == null && !defaultSize && !defaultResolution && !defaultOrientation) {
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
  }
}

export function formatVideoOptionLabel(label: string, priceLabel?: string): string {
  const trimmedLabel = label.trim()
  const trimmedPrice = typeof priceLabel === 'string' ? priceLabel.trim() : ''
  if (!trimmedPrice) return trimmedLabel
  return `${trimmedLabel} ${trimmedPrice}`
}
