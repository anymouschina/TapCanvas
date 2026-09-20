import { describe, expect, it, vi } from 'vitest'
import { canonicalLocalUrl, startAtCanonicalOrigin } from './localOrigin'

describe('canonical local browser origin', () => {
  it.each(['127.0.0.1', '[::1]'])('preserves navigation and OAuth data from %s', (host) => {
    expect(canonicalLocalUrl(`http://${host}:5175/oauth/github?code=a%2Bb&state=s&ref=ABCDEF#return`))
      .toBe('http://localhost:5175/oauth/github?code=a%2Bb&state=s&ref=ABCDEF#return')
  })

  it('preserves HTTPS and preview ports', () => {
    expect(canonicalLocalUrl('https://127.0.0.1:4173/studio?flowId=one'))
      .toBe('https://localhost:4173/studio?flowId=one')
  })

  it.each([
    'http://localhost:5175/studio',
    'https://tapcanvas.example/studio',
    'http://192.168.1.10:5175/studio',
    'https://127.0.0.1.attacker.example/studio',
    'file:///tmp/index.html',
  ])('leaves other origins alone: %s', (href) => {
    expect(canonicalLocalUrl(href)).toBeNull()
  })

  it('redirects before importing any auth or application code', async () => {
    const replace = vi.fn()
    const start = vi.fn(async () => undefined)
    await startAtCanonicalOrigin({ href: 'http://127.0.0.1:5175/studio', replace }, start)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('http://localhost:5175/studio')
    expect(start).not.toHaveBeenCalled()
  })

  it('starts once on the canonical origin without a redirect loop', async () => {
    const replace = vi.fn()
    const start = vi.fn(async () => undefined)
    await startAtCanonicalOrigin({ href: 'http://localhost:5175/studio', replace }, start)
    expect(replace).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('propagates application startup failures', async () => {
    const failure = new Error('startup failed')
    await expect(startAtCanonicalOrigin(
      { href: 'http://localhost:5175/', replace: vi.fn() },
      async () => { throw failure },
    )).rejects.toBe(failure)
  })
})
