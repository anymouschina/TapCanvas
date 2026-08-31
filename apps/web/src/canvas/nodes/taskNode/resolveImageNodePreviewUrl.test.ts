import { describe, expect, it } from 'vitest'
import { resolveImageNodePreviewUrl } from './resolveImageNodePreviewUrl'

describe('resolveImageNodePreviewUrl', () => {
  it('prefers the selected result thumbnail over original image URLs', () => {
    expect(resolveImageNodePreviewUrl({
      imagePrimaryIndex: 1,
      imageUrl: 'https://example.com/direct-original.jpg',
      imageResults: [
        { url: 'https://example.com/first-original.jpg', thumbnailUrl: 'https://example.com/first-thumb.jpg' },
        { url: 'https://example.com/selected-original.jpg', thumbnailUrl: 'https://example.com/selected-thumb.jpg' },
      ],
    })).toBe('https://example.com/selected-thumb.jpg')
  })

  it('uses node-level thumbnails before any original URL', () => {
    expect(resolveImageNodePreviewUrl({
      imageThumbnailUrl: 'https://example.com/node-thumb.jpg',
      imageResults: [{ url: 'https://example.com/original.jpg' }],
    })).toBe('https://example.com/node-thumb.jpg')
  })

  it('preserves the existing original URL chain when no thumbnail exists', () => {
    expect(resolveImageNodePreviewUrl({
      imagePrimaryIndex: 1,
      imageResults: [
        { url: 'https://example.com/first.jpg' },
        { url: 'https://example.com/selected.jpg' },
      ],
    })).toBe('https://example.com/selected.jpg')
    expect(resolveImageNodePreviewUrl({ imageUrl: 'https://example.com/direct.jpg' }))
      .toBe('https://example.com/direct.jpg')
  })
})
