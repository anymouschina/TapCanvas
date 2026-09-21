import type { UserGenerationPrefsDto } from '../api/server'
import {
  constrainImageModelCatalogConfigByPricing,
  constrainVideoModelCatalogConfigByPricing,
  parseImageModelCatalogConfig,
  parseVideoModelCatalogConfig,
} from './modelCatalogMeta'
import type { ModelOption } from './models'
import {
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
} from './useModelOptions'
import { normalizeVideoResolution } from '../utils/videoBillingSpec'

export type CompleteImageGenerationPrefs = Required<
  Pick<UserGenerationPrefsDto, 'imageModel' | 'imageSize'>
> & Pick<UserGenerationPrefsDto, 'imageQuality' | 'imageAspect' | 'imageResolution' | 'imageCount'>

export type CompleteVideoGenerationPrefs = Required<
  Pick<UserGenerationPrefsDto, 'videoModel' | 'videoResolution' | 'videoAspect'>
> & Pick<UserGenerationPrefsDto, 'videoDuration' | 'videoCount' | 'videoGenerateAudio'>

function normalizeCompactValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

export function resolveCompleteImageGenerationPrefs(input: Readonly<{
  options: readonly ModelOption[]
  imageModel: string
  imageSize: string
  imageQuality?: string
  imageAspect?: string
  imageCount?: number
  imageResolution?: string
}>): CompleteImageGenerationPrefs | null {
  const option = findModelOptionByIdentifier(input.options, input.imageModel)
  if (!option) return null
  const config = constrainImageModelCatalogConfigByPricing(
    parseImageModelCatalogConfig(option.meta),
    option.pricing,
  )
  if (!config) return null
  const supportedOptions = config.imageSizeOptions.length > 0
    ? config.imageSizeOptions
    : config.resolutionOptions
  const candidates = [input.imageSize, input.imageResolution]
    .map(normalizeCompactValue)
    .filter(Boolean)
  const supported = supportedOptions.find((candidate) => candidates.includes(candidate.value))
  if (!supported) return null
  const imageModel = getModelOptionRequestAlias(input.options, option.value)
  if (!imageModel) return null
  const quality = config.qualityOptions.find((option) => option.value === input.imageQuality)
  if (config.qualityOptions.length > 0 && !quality) return null
  if (input.imageResolution && config.resolutionOptions.length > 0 && !config.resolutionOptions.some((o) => o.value === input.imageResolution)) return null
  if (input.imageAspect && config.aspectRatioOptions.length > 0 && !config.aspectRatioOptions.some((o) => o.value === input.imageAspect)) return null
  return {
    imageModel, imageSize: supported.value,
    ...(quality ? { imageQuality: quality.value } : {}),
    ...(input.imageAspect ? { imageAspect: input.imageAspect } : {}),
    ...(input.imageResolution ? { imageResolution: config.resolutionOptions.length ? input.imageResolution : supported.value } : {}),
    ...(input.imageCount ? { imageCount: input.imageCount } : {}),
  }
}

export function resolveCompleteVideoGenerationPrefs(input: Readonly<{
  options: readonly ModelOption[]
  videoModel: string
  videoResolution: string
  videoSize?: string
  videoAspect?: string
  videoDuration?: number
  videoCount?: number
  videoGenerateAudio?: boolean
}>): CompleteVideoGenerationPrefs | null {
  const option = findModelOptionByIdentifier(input.options, input.videoModel)
  if (!option) return null
  const config = constrainVideoModelCatalogConfigByPricing(
    parseVideoModelCatalogConfig(option.meta),
    option.pricing,
  )
  if (!config) return null
  const normalizedResolution = normalizeVideoResolution(input.videoResolution)
  const resolution = config.resolutionOptions.find(
    (candidate) => candidate.value === normalizedResolution,
  )
  const aspectCandidates = [input.videoSize, input.videoAspect]
    .map(normalizeCompactValue)
    .filter(Boolean)
  const aspect = config.sizeOptions.find((candidate) => {
    const declaredAspect = normalizeCompactValue(candidate.aspectRatio)
    return aspectCandidates.includes(candidate.value) || Boolean(
      declaredAspect && aspectCandidates.includes(declaredAspect),
    )
  })
  const videoModel = getModelOptionRequestAlias(input.options, option.value)
  if (!videoModel || !resolution || !aspect) return null
  if (input.videoDuration && config.durationOptions.length > 0 && !config.durationOptions.some((o) => Number(o.value) === input.videoDuration)) return null
  return {
    ...(input.videoDuration ? { videoDuration: input.videoDuration } : {}),
    ...(input.videoCount ? { videoCount: input.videoCount } : {}),
    ...(config.supportsNativeAudio && typeof input.videoGenerateAudio === 'boolean' ? { videoGenerateAudio: input.videoGenerateAudio } : {}),
    videoModel,
    videoResolution: resolution.value,
    videoAspect: aspect.value,
  }
}
