import { describe, expect, it } from 'vitest'
import { resolvePortalPageRoute } from './PortalRouter'

describe('resolvePortalPageRoute', () => {
  it('keeps /canvas as the only project-library route', () => {
    expect(resolvePortalPageRoute('/canvas')).toBe('canvas-hub')
    expect(resolvePortalPageRoute('/canvas/')).toBe('canvas-hub')
    expect(resolvePortalPageRoute('/workflows')).toBeNull()
    expect(resolvePortalPageRoute('/workflows/')).toBeNull()
  })

  it('keeps the exact /projects route assigned to Neo TV', () => {
    expect(resolvePortalPageRoute('/projects')).toBe('neo-tv')
    expect(resolvePortalPageRoute('/projects/')).toBe('neo-tv')
    expect(resolvePortalPageRoute('/projects/project-1')).toBeNull()
  })

  it('routes the prompt library and individual prompt pages through the portal runtime', () => {
    expect(resolvePortalPageRoute('/prompts')).toBe('prompts')
    expect(resolvePortalPageRoute('/prompts/')).toBe('prompts')
    expect(resolvePortalPageRoute('/prompts/prompt-1')).toBe('prompt-detail')
    expect(resolvePortalPageRoute('/prompts/prompt-1/extra')).toBeNull()
  })
})
