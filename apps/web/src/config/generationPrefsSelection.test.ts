import { describe, expect, it } from 'vitest'
import type { ModelOption } from './models'
import {
  resolveCompleteImageGenerationPrefs,
  resolveCompleteVideoGenerationPrefs,
} from './generationPrefsSelection'

const imageOptions: ModelOption[] = [
  {
    value: 'image-display',
    label: 'Image',
    modelKey: 'image-request-key',
    meta: {
      imageOptions: {
        imageSizeOptions: [{ value: '1K', label: '1K' }],
      },
    },
  },
]

const videoOptions: ModelOption[] = [
  {
    value: 'minimax-h3',
    label: 'MiniMax H3',
    modelKey: 'minimax-h3-request-key',
    meta: {
      videoOptions: {
        resolutionOptions: [
          { value: '768p', label: '768P' },
          { value: '1440p', label: '1440P' },
        ],
        sizeOptions: [
          { value: '16:9', label: '16:9', aspectRatio: '16:9' },
          { value: '9:16', label: '9:16', aspectRatio: '9:16' },
        ],
      },
    },
  },
]

describe('generationPrefsSelection', () => {
  it('only resolves a complete image model and size pair', () => {
    expect(resolveCompleteImageGenerationPrefs({
      options: imageOptions,
      imageModel: 'image-display',
      imageSize: '1K',
    })).toEqual({ imageModel: 'image-request-key', imageSize: '1K' })
    expect(resolveCompleteImageGenerationPrefs({
      options: imageOptions,
      imageModel: 'image-display',
      imageSize: '2K',
    })).toBeNull()
  })

  it('rejects a video model paired with a resolution from another model', () => {
    expect(resolveCompleteVideoGenerationPrefs({
      options: videoOptions,
      videoModel: 'minimax-h3',
      videoResolution: '480p',
      videoAspect: '16:9',
    })).toBeNull()
  })

  it('resolves an atomic video model, resolution, and aspect tuple', () => {
    expect(resolveCompleteVideoGenerationPrefs({
      options: videoOptions,
      videoModel: 'minimax-h3',
      videoResolution: '768P',
      videoSize: '16:9',
    })).toEqual({
      videoModel: 'minimax-h3-request-key',
      videoResolution: '768p',
      videoAspect: '16:9',
    })
  })
})


describe('complete image quality selection', () => {
  const options: ModelOption[] = [{
    value: 'image-quality', label: 'Image quality', modelKey: 'image-quality-key',
    meta: { imageOptions: { imageSizeOptions: ['1K'], qualityOptions: ['high', 'max'] } },
  }]
  it('includes supported quality in the atomic preference and rejects incomplete or stale values', () => {
    expect(resolveCompleteImageGenerationPrefs({ options, imageModel: 'image-quality', imageSize: '1K', imageQuality: 'max' })).toEqual({ imageModel: 'image-quality-key', imageSize: '1K', imageQuality: 'max' })
    expect(resolveCompleteImageGenerationPrefs({ options, imageModel: 'image-quality', imageSize: '1K' })).toBeNull()
    expect(resolveCompleteImageGenerationPrefs({ options, imageModel: 'image-quality', imageSize: '1K', imageQuality: 'retired' })).toBeNull()
  })
})
