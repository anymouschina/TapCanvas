import {
  constrainVideoModelCatalogConfigByPricing,
  parseVideoModelCatalogConfig,
} from './modelCatalogMeta'
import type { ModelOption } from './models'

export type GenerationPreferenceOption = Readonly<{
  value: string
  label: string
}>

export type VideoGenerationPreferenceCatalog = Readonly<{
  resolutionOptions: readonly GenerationPreferenceOption[]
  aspectOptions: readonly GenerationPreferenceOption[]
  defaultResolution: string
  defaultAspect: string
}>

function uniqueOptions(options: readonly GenerationPreferenceOption[]): GenerationPreferenceOption[] {
  const seen = new Set<string>()
  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false
    seen.add(option.value)
    return true
  })
}

export function resolveVideoGenerationPreferenceCatalog(
  option: ModelOption | null,
): VideoGenerationPreferenceCatalog | null {
  if (!option) return null
  const config = constrainVideoModelCatalogConfigByPricing(
    parseVideoModelCatalogConfig(option.meta),
    option.pricing,
  )
  if (!config) return null

  const resolutionOptions = uniqueOptions(config.resolutionOptions)
  const aspectOptions = uniqueOptions(
    config.sizeOptions.map((sizeOption) => ({
      value: sizeOption.aspectRatio || sizeOption.value,
      label: sizeOption.label,
    })),
  )
  const defaultSizeOption = config.sizeOptions.find((sizeOption) => sizeOption.value === config.defaultSize)
    ?? config.sizeOptions[0]
    ?? null
  const defaultResolution = resolutionOptions.some((item) => item.value === config.defaultResolution)
    ? config.defaultResolution ?? ''
    : resolutionOptions[0]?.value ?? ''
  const defaultAspectCandidate = defaultSizeOption?.aspectRatio || defaultSizeOption?.value || ''
  const defaultAspect = aspectOptions.some((item) => item.value === defaultAspectCandidate)
    ? defaultAspectCandidate
    : aspectOptions[0]?.value ?? ''

  return {
    resolutionOptions,
    aspectOptions,
    defaultResolution,
    defaultAspect,
  }
}
