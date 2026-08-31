import { describe, expect, it } from 'vitest'
import { buildObjectStorageAssetUrl } from './objectStorageAssets'

const publicBases = {
  tos: 'https://tanvas-ai.tos-cn-guangzhou.volces.com',
  r2: 'https://file.beqlee.icu',
} as const

describe('buildObjectStorageAssetUrl', () => {
  it('adds the migrated legacy prefix for TOS', () => {
    expect(buildObjectStorageAssetUrl({
      provider: 'tos',
      publicBases,
      key: 'static/portal/hero.webp',
    })).toBe('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/static/portal/hero.webp')
  })

  it('uses the original object key for R2', () => {
    expect(buildObjectStorageAssetUrl({
      provider: 'r2',
      publicBases,
      key: 'static/portal/hero.webp',
    })).toBe('https://file.beqlee.icu/static/portal/hero.webp')
  })
})
