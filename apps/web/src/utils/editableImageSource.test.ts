import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEditableImageBlob } from './editableImageSource'

describe('fetchEditableImageBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bypasses polluted browser cache for remote editable images', async () => {
    const fetchMock = vi.fn(async () => new Response('image-bytes', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchEditableImageBlob('https://assets.example.com/image.png')
    expect(result.type).toBe('image/png')
    await expect(result.text()).resolves.toBe('image-bytes')
    expect(fetchMock).toHaveBeenCalledWith('https://assets.example.com/image.png', {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'reload',
    })
  })

  it('rejects non-image responses before they reach a canvas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not an image', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))

    await expect(fetchEditableImageBlob('https://assets.example.com/image.png'))
      .rejects.toThrow('资源类型为 text/html')
  })
})
