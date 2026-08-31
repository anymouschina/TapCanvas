import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  buildImageBillingSpecKeyForOption,
  formatImageQualityOptionLabel,
  formatImageResolutionOptionLabel,
  getTaskNodeModelDisplayLabel,
  isCatalogAudioType,
  normalizeImageAspect,
  normalizeImageResolutionSetting,
  readCatalogTagValue,
  resolveVideoOrientationValue,
} from './mediaModelControls'

describe('mediaModelControls', () => {
  it('normalizes catalog labels and image settings', () => {
    expect(formatImageResolutionOptionLabel('高清输出', '2K')).toBe('2K')
    expect(formatImageQualityOptionLabel('High', 'high')).toBe('高画质')
    expect(normalizeImageAspect('auto')).toBe(DEFAULT_IMAGE_ASPECT_RATIO)
    expect(normalizeImageResolutionSetting(' 2 K ')).toBe('2K')
  })

  it('reads model identity and catalog tags from live model metadata', () => {
    const option: ModelOption = {
      value: 'speech-model',
      label: 'Speech Model',
      modelKey: 'provider/speech-v1',
      modelAlias: 'speech-v1',
      meta: {
        tags: ['tapcanvas:audio-type=speech', 'voice-family=doubao'],
      },
    }

    expect(getTaskNodeModelDisplayLabel(option)).toBe('speech-v1')
    expect(isCatalogAudioType(option, 'speech')).toBe(true)
    expect(isCatalogAudioType(option, 'music')).toBe(false)
    expect(readCatalogTagValue(option, 'voice-family')).toBe('doubao')
  })

  it('selects the first enabled matching billing spec without inventing a fallback', () => {
    const option: ModelOption = {
      value: 'gpt-image-2-official',
      label: 'GPT Image 2',
      pricing: {
        cost: 2,
        enabled: true,
        specCosts: [
          { specKey: 'image:2k:high', cost: 4, enabled: true },
          { specKey: 'image:2k', cost: 2, enabled: true },
        ],
      },
    }

    expect(buildImageBillingSpecKeyForOption({
      modelOption: option,
      aspect: '16:9',
      imageSize: '',
      imageResolution: '2K',
      imageQuality: 'high',
    })).toBe('image:2k:high')

    expect(buildImageBillingSpecKeyForOption({
      modelOption: { ...option, pricing: { ...option.pricing!, specCosts: [] } },
      aspect: '16:9',
      imageSize: '',
      imageResolution: '2K',
      imageQuality: 'high',
    })).toBeNull()
  })

  it('derives video orientation from explicit aspect before the stored orientation', () => {
    expect(resolveVideoOrientationValue({
      currentOrientation: 'landscape',
      size: '',
      aspect: '9:16',
      config: null,
    })).toBe('portrait')
  })
})
