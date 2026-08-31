import { describe, expect, it } from 'vitest'

import { resolveVideoInputPosterUrl, resolveVideoPosterUrl } from './videoPosterUrl'

describe('videoPosterUrl', () => {
  it('keeps an output poster ahead of the generation input poster', () => {
    expect(resolveVideoPosterUrl(
      { thumbnailUrl: 'https://assets.example/output.jpg' },
      'https://assets.example/input.jpg',
    )).toBe('https://assets.example/output.jpg')
  })

  it('uses a real input reference as the temporary poster when output has no thumbnail', () => {
    expect(resolveVideoInputPosterUrl({
      referenceImages: ['https://assets.example/keyframe.png'],
    })).toBe('https://assets.example/keyframe.png')
  })

  it('rejects non-image and non-http placeholder values', () => {
    expect(resolveVideoInputPosterUrl({
      referenceImages: ['blob:temporary', 'not-a-url'],
    })).toBeNull()
  })
})
