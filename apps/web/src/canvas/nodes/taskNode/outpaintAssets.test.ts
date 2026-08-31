import { describe, expect, it, vi } from 'vitest'
import { createCenteredOutpaintAssets } from './outpaintAssets'

vi.mock('../../../api/server', () => ({
  fetchProxiedImageBlob: vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
}))

describe('createCenteredOutpaintAssets', () => {
  it('rejects non-expanding scale values before reading the source', async () => {
    await expect(createCenteredOutpaintAssets('https://example.com/image.png', 1)).rejects.toThrow('扩图倍率')
  })
})
