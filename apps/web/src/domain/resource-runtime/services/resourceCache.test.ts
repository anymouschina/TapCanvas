import { describe, expect, it } from 'vitest'
import { estimateDecodedImageBytes } from './resourceCache'

describe('estimateDecodedImageBytes', () => {
  it('accounts for a decoded RGBA surface rather than compressed transfer bytes', () => {
    expect(estimateDecodedImageBytes(1024, 576)).toBe(2_359_296)
  })

  it('rejects invalid dimensions', () => {
    expect(estimateDecodedImageBytes(0, 576)).toBeNull()
    expect(estimateDecodedImageBytes(Number.NaN, 576)).toBeNull()
  })
})
