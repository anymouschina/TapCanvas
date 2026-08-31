import { describe, it, expect, vi } from 'vitest'
vi.mock('../../../api/server', () => ({
  uploadServerAssetFile: vi.fn(async (file: File) => ({ id: 'asset-1', data: { url: 'https://r2.example.com/' + file.name } })),
}))
import { uploadCanvasVideoBlob } from './uploadCanvasVideoBlob'

describe('uploadCanvasVideoBlob', () => {
  it('内容寻址 .mp4 命名 + 返回托管 URL', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' })
    Object.defineProperty(blob, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    })
    const r = await uploadCanvasVideoBlob({ blob, label: '样片', filePrefix: 'director-clip', ownerNodeId: 'n1' })
    expect(r.url).toMatch(/^https:\/\/r2\.example\.com\/director-clip-[0-9a-f]{16}\.mp4$/)
    expect(r.assetId).toBe('asset-1')
  })
})
