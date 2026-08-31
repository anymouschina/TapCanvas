import { describe, expect, it } from 'vitest'
import { NEW_API_AUTO_VENDOR, resolveCatalogVideoVendor } from './modelRouting'

describe('catalog model routing', () => {
  it('routes a catalog video model through new-api auto selection', () => {
    expect(resolveCatalogVideoVendor({ modelKey: 'sd2' })).toBe(NEW_API_AUTO_VENDOR)
  })

  it('preserves an explicit vendor on an existing node', () => {
    expect(
      resolveCatalogVideoVendor({ explicitVendor: 'VEO', modelKey: 'veo-3.1' }),
    ).toBe('veo')
  })

  it('rejects a node without a model instead of inventing one', () => {
    expect(() => resolveCatalogVideoVendor({ modelKey: '  ' })).toThrow('视频模型未配置')
  })
})
