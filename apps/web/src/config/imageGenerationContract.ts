import { resolveImageQuality } from '../../../../packages/schemas/image-billing-contract'
import { resolveCatalogImageBillingSpec } from './imageBillingSpec'
import type { ModelOption } from './models'
import { parseImageModelCatalogConfig } from './modelCatalogMeta'

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

/** Compile the same catalog dimensions used for the price shown in the UI. */
export function compileImageGenerationExtras(
  extras: Record<string, unknown>, modelOption: ModelOption,
): Record<string, unknown> {
  const config = parseImageModelCatalogConfig(modelOption.meta)
  if (!config) throw new Error('当前模型缺少有效的图片参数合同')
  const quality = resolveImageQuality({
    quality: text(extras.quality),
    qualityOptions: config.qualityOptions.map((option) => option.value),
    defaultQuality: config.defaultQuality,
  })
  const spec = resolveCatalogImageBillingSpec({
    config,
    resolution: text(extras.resolution) || text(extras.imageResolution),
    imageSize: text(extras.imageSize) || config.defaultImageSize,
    aspectRatio: text(extras.aspectRatio) || config.defaultAspectRatio,
    quality,
    specKeys: modelOption.pricing?.specCosts.map((row) => row.specKey) ?? [],
  })
  const compiled = { ...extras }
  if (config.resolutionOptions.length === 0 && config.imageSizeOptions.length === 0) {
    delete compiled.resolution
    delete compiled.imageResolution
    delete compiled.imageSize
    delete compiled.image_size
  }
  delete compiled.quality
  delete compiled.specKey
  delete compiled.billingSpecKey
  if (quality) compiled.quality = quality
  if (spec) {
    compiled.specKey = spec
    compiled.billingSpecKey = spec
  }
  return compiled
}
