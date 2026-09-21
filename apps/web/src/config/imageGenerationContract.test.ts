import { describe, expect, it } from 'vitest'
import type { ModelOption } from './models'
import { compileImageGenerationExtras } from './imageGenerationContract'
import { buildImageBillingSpecKeyForOption, pickImageQualityValue } from '../canvas/nodes/taskNode/mediaModelControls'
import { parseImageModelCatalogConfig } from './modelCatalogMeta'
import { resolveModelGenerationCredits } from './modelPricing'

function model(qualities: string[] = []): ModelOption {
  return {
    value: 'catalog-image', label: 'Catalog image',
    meta: { imageOptions: { imageSizeOptions: ['1K', '2K'], qualityOptions: qualities,
      ...(qualities.length ? { defaultQuality: 'low' } : {}) } },
    pricing: { cost: 30, enabled: true, specCosts: [{ specKey: 'image:2k', cost: 30, enabled: true }] },
  }
}

describe('image quote and submission contract', () => {
  it('uses catalogued pixel-size prices and clears unsupported retained resolution fields', () => {
    const option: ModelOption = {
      value: 'pixel-image', label: 'Pixel image',
      meta: { imageOptions: { aspectRatioOptions: ['1024x1024', '2048x2048'], defaultAspectRatio: '1024x1024' } },
      pricing: { cost: 20, enabled: true, specCosts: [
        { specKey: 'image:1024x1024', cost: 20, enabled: true },
        { specKey: 'image:2048x2048', cost: 30, enabled: true },
      ] },
    }
    for (const [size, cost] of [['1024x1024', 20], ['2048x2048', 30]] as const) {
      const spec = buildImageBillingSpecKeyForOption({ modelOption: option, aspect: size, imageSize: '4K', imageResolution: '4k' })
      expect(spec).toBe(`image:${size}`)
      expect(resolveModelGenerationCredits({ kind: 'image', modelOption: option, specKey: spec })).toBe(cost)
      const extras = compileImageGenerationExtras({ aspectRatio: size, resolution: '4k', imageSize: '4K' }, option)
      expect(extras.specKey).toBe(spec)
      expect(extras.aspectRatio).toBe(size)
      expect(extras).not.toHaveProperty('resolution')
      expect(extras).not.toHaveProperty('imageSize')
    }
  })

  it('quotes fixed per-image pricing despite dimensions retained from a previous model', () => {
    const option: ModelOption = {
      value: 'fixed-image', label: 'Fixed image',
      meta: { imageOptions: { supportsTextToImage: true } },
      pricing: { cost: 13, enabled: true, specCosts: [] },
    }
    const quoted = buildImageBillingSpecKeyForOption({ modelOption: option, aspect: '16:9',
      imageSize: '2K', imageResolution: '2k', imageQuality: 'high' })
    expect(quoted).toBeNull()
    expect(resolveModelGenerationCredits({ kind: 'image', modelOption: option, specKey: quoted, quantity: 2 })).toBe(26)
    const submitted = compileImageGenerationExtras({ imageSize: '2K', resolution: '2k',
      quality: 'high', specKey: 'image:2k:high', billingSpecKey: 'image:2k:high' }, option)
    expect(submitted).not.toHaveProperty('specKey')
    expect(submitted).not.toHaveProperty('billingSpecKey')
    expect(submitted).not.toHaveProperty('quality')
  })

  it('uses the same 30-credit 2K row after switching away from a quality-priced model', () => {
    const option = model()
    const quoted = buildImageBillingSpecKeyForOption({ modelOption: option, aspect: '16:9',
      imageSize: '2K', imageResolution: '', imageQuality: 'high' })
    const submitted = compileImageGenerationExtras({ imageSize: '2K', aspectRatio: '16:9',
      quality: 'high', specKey: 'image:2k:high', billingSpecKey: 'image:2k:high' }, option)
    expect(quoted).toBe('image:2k')
    expect(submitted.specKey).toBe(quoted)
    expect(submitted.billingSpecKey).toBe(quoted)
    expect(submitted).not.toHaveProperty('quality')
    expect(resolveModelGenerationCredits({ kind: 'image', modelOption: option, specKey: quoted })).toBe(30)
    expect(pickImageQualityValue(parseImageModelCatalogConfig(option.meta), 'high')).toBeNull()
  })

  it('does not quote the base price when a paid quality price is missing', () => {
    const option = model(['low', 'high'])
    expect(buildImageBillingSpecKeyForOption({ modelOption: option, aspect: '16:9',
      imageSize: '2K', imageResolution: '', imageQuality: 'high' })).toBe('image:2k:high')
    expect(resolveModelGenerationCredits({ kind: 'image', modelOption: option, specKey: 'image:2k:high' })).toBe(0)
    expect(compileImageGenerationExtras({ imageSize: '2K', quality: 'high', specKey: 'image:2k' }, option))
      .toMatchObject({ quality: 'high', specKey: 'image:2k:high' })
  })

  it('honors published aspect-qualified prices without model-name branches', () => {
    const option = model(['low', 'high'])
    option.pricing!.specCosts = [{ specKey: 'image:16_9:2k:high', cost: 60, enabled: true }]
    const extras = compileImageGenerationExtras({ imageSize: '2K', aspectRatio: '16:9', quality: 'high' }, option)
    expect(extras.specKey).toBe('image:16_9:2k:high')
  })

  it('rejects an invalid quality for a supported dimension', () => {
    expect(() => compileImageGenerationExtras({ imageSize: '2K', quality: 'unknown' }, model(['low', 'high'])))
      .toThrow('当前模型不支持画质')
  })
})
