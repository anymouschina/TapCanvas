import { describe, expect, it } from 'vitest'
import { parseImageModelCatalogConfig } from '../../src/config/modelCatalogMeta'

describe('parseImageModelCatalogConfig', () => {
  it('reads image aspect ratio and size options from imageOptions', () => {
    const config = parseImageModelCatalogConfig({
      imageOptions: {
        defaultAspectRatio: '16:9',
        defaultImageSize: '2K',
        aspectRatioOptions: ['16:9', { value: '9:16', label: '竖屏' }, '16:9'],
        imageSizeOptions: [
          { value: '2K', label: '2K' },
          '4K',
        ],
        controls: [
          { key: 'aspect', binding: 'aspectRatio', label: '比例' },
          { key: 'size', binding: 'imageSize', label: '尺寸' },
        ],
        supportsReferenceImages: true,
        supportsTextToImage: true,
        supportsImageToImage: true,
      },
    })

    expect(config).toEqual({
      defaultAspectRatio: '16:9',
      defaultImageSize: '2K',
      aspectRatioOptions: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '竖屏' },
      ],
      imageSizeOptions: [
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' },
      ],
      resolutionOptions: [],
      controls: [
        { key: 'aspect', binding: 'aspectRatio', label: '比例', optionSource: 'aspectRatioOptions' },
        { key: 'size', binding: 'imageSize', label: '尺寸', optionSource: 'imageSizeOptions' },
      ],
      supportsReferenceImages: true,
      supportsTextToImage: true,
      supportsImageToImage: true,
    })
  })

  it('returns null when image config metadata is empty', () => {
    expect(parseImageModelCatalogConfig({ imageOptions: {} })).toBeNull()
  })
})
