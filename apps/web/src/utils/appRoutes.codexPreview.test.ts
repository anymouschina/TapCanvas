import { describe, expect, it } from 'vitest'
import { resolveCodexPreviewId } from './appRoutes'

describe('resolveCodexPreviewId', () => {
  it('accepts only a bounded structural preview id', () => {
    const previewId = 'preview_1234567890abcdef'
    expect(resolveCodexPreviewId(`/preview/${previewId}`)).toBe(previewId)
    expect(resolveCodexPreviewId(`/preview/${previewId}/`)).toBe(previewId)
    expect(resolveCodexPreviewId('/preview/short')).toBeNull()
    expect(resolveCodexPreviewId(`/preview/${previewId}/extra`)).toBeNull()
    expect(resolveCodexPreviewId('/preview/%2e%2e%2fsecret')).toBeNull()
  })
})
