import { describe, expect, it } from 'vitest'

import {
  formatHomepagePreviewLocation,
  resolveHomepagePreviewLocation,
} from './homepagePreviewNavigation'

describe('homepage preview navigation', () => {
  it('keeps configured surfaces on their live draft renderers', () => {
    expect(resolveHomepagePreviewLocation('/')).toEqual({ kind: 'homepage', href: '/' })
    expect(resolveHomepagePreviewLocation('/home/')).toEqual({ kind: 'homepage', href: '/' })
    expect(resolveHomepagePreviewLocation('/login')).toEqual({ kind: 'login', href: '/login' })
  })

  it('keeps other TapCanvas routes inside the embedded preview', () => {
    const location = resolveHomepagePreviewLocation('/neo-tv?watch=asset-1#player')
    expect(location).toEqual({ kind: 'embedded', href: '/neo-tv?watch=asset-1#player' })
    if (!location) throw new Error('Expected an embedded preview location')
    expect(formatHomepagePreviewLocation(location)).toBe('tapcanvas.com/neo-tv?watch=asset-1#player')
  })

  it('rejects external destinations from the internal preview router', () => {
    expect(resolveHomepagePreviewLocation('https://example.com/projects')).toBeNull()
    expect(resolveHomepagePreviewLocation('mailto:test@example.com')).toBeNull()
  })
})
