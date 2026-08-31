import { describe, expect, it } from 'vitest'
import { recomposeImageLayerUrls } from './imageLayerRecompose'

describe('recomposeImageLayerUrls', () => {
  it('requires at least one hosted layer', async () => {
    await expect(recomposeImageLayerUrls([])).rejects.toThrow('至少需要一个真实图层资产')
  })
})
