import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadReferenceSheetImageSource } from '../../src/runner/referenceSheet'

class SuccessfulImage {
  crossOrigin = ''
  naturalWidth = 640
  naturalHeight = 480
  width = 640
  height = 480
  onload: null | (() => void) = null
  onerror: null | (() => void) = null

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.()
    })
  }
}

describe('referenceSheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads direct image element before falling back to fetch/blob', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('fetch should not be used when direct image load succeeds')
    })
    vi.stubGlobal('Image', SuccessfulImage)
    vi.stubGlobal('fetch', fetchSpy)

    const loaded = await loadReferenceSheetImageSource('https://example.com/reference.png')
    try {
      expect(loaded.width).toBe(640)
      expect(loaded.height).toBe(480)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      loaded.dispose()
    }
  })
})
