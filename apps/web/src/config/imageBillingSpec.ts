import { resolveImageBillingSpec } from '../../../../packages/schemas/image-billing-contract'
import type { ImageModelCatalogConfig } from './modelCatalogMeta'

/** Only catalogued dimensions can select a specification price. */
export function resolveCatalogImageBillingSpec(input: {
  config: ImageModelCatalogConfig
  resolution?: string
  imageSize?: string
  aspectRatio?: string
  quality?: string
  specKeys: readonly string[]
}): string | null {
  const hasResolution = input.config.resolutionOptions.length > 0
    || input.config.imageSizeOptions.length > 0
  if (!hasResolution && input.config.qualityOptions.length === 0) {
    const size = input.aspectRatio?.trim().toLowerCase()
    const sizeIsConfigured = input.config.aspectRatioOptions.some((option) => option.value.toLowerCase() === size)
    const sizeSpec = sizeIsConfigured
      ? input.specKeys.find((key) => key.toLowerCase() === `image:${size}`)
      : undefined
    if (sizeSpec) return sizeSpec
  }
  if (!hasResolution && input.config.qualityOptions.length === 0 && input.specKeys.length === 0) return null
  return resolveImageBillingSpec(input)
}
