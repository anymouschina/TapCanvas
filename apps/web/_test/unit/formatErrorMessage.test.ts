import { describe, expect, it } from 'vitest'
import { formatErrorMessage } from '../../src/canvas/utils/formatErrorMessage'

describe('formatErrorMessage', () => {
  it('handles primitive and Error inputs', () => {
    expect(formatErrorMessage('failed')).toBe('failed')
    expect(formatErrorMessage(429)).toBe('429')
    expect(formatErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('prefers message/code pair when present', () => {
    expect(formatErrorMessage({ code: 'yunwu_request_failed', message: 'IMAGE_SAFETY' }))
      .toBe('yunwu_request_failed: IMAGE_SAFETY')
  })

  it('falls back to nested error payload', () => {
    expect(formatErrorMessage({ error: { message: 'nested failed' } })).toBe('nested failed')
    expect(formatErrorMessage({ error: 'upstream timeout' })).toBe('upstream timeout')
  })
})
