import { describe, expect, it } from 'vitest'
import { buildImageDeliveryUrl } from './imageUrlTransform'

const TOS_IMAGE = 'https://tanvas-ai.tos-cn-guangzhou.volces.com/gen/images/example.png'

describe('buildImageDeliveryUrl', () => {
  it('builds a bounded WebP variant for a TOS image', () => {
    const output = new URL(buildImageDeliveryUrl(TOS_IMAGE, { width: 512 }))

    expect(output.origin + output.pathname).toBe(TOS_IMAGE)
    expect(output.searchParams.get('x-tos-process')).toBe('image/resize,w_512,m_lfit/format,webp')
  })

  it('keeps focused-original requests unchanged', () => {
    expect(buildImageDeliveryUrl(TOS_IMAGE)).toBe(TOS_IMAGE)
  })

  it('does not invent transform contracts for R2 or third-party hosts', () => {
    const r2Image = 'https://file.beqlee.icu/gen/images/example.png'
    const thirdPartyImage = 'https://images.example.com/example.png'

    expect(buildImageDeliveryUrl(r2Image, { width: 512 })).toBe(r2Image)
    expect(buildImageDeliveryUrl(thirdPartyImage, { width: 512 })).toBe(thirdPartyImage)
  })

  it('preserves existing query parameters and does not stack TOS transforms', () => {
    const first = buildImageDeliveryUrl(`${TOS_IMAGE}?version=2`, { width: 1024 })
    const second = buildImageDeliveryUrl(first, { width: 512 })
    const output = new URL(second)

    expect(output.searchParams.get('version')).toBe('2')
    expect(output.searchParams.getAll('x-tos-process')).toEqual(['image/resize,w_1024,m_lfit/format,webp'])
  })

  it('unwraps historical Cloudflare variants before applying the TOS contract', () => {
    const legacy = 'https://tanvas-ai.tos-cn-guangzhou.volces.com/cdn-cgi/image/width=512/gen/images/example.png'
    const output = new URL(buildImageDeliveryUrl(legacy, { width: 512 }))

    expect(output.pathname).toBe('/gen/images/example.png')
    expect(output.searchParams.get('x-tos-process')).toBe('image/resize,w_512,m_lfit/format,webp')
  })

  it('leaves animated and vector formats untouched', () => {
    expect(buildImageDeliveryUrl(TOS_IMAGE.replace('.png', '.gif'), { width: 512 }))
      .toBe(TOS_IMAGE.replace('.png', '.gif'))
    expect(buildImageDeliveryUrl(TOS_IMAGE.replace('.png', '.svg'), { width: 512 }))
      .toBe(TOS_IMAGE.replace('.png', '.svg'))
  })
})
