import { describe, expect, it } from 'vitest'
import { isSafetyBlockedError, resolveTaskErrorDisplay } from '../../src/runner/taskErrorClassifier'

describe('taskErrorClassifier', () => {
  it('detects safety-blocked errors from message and upstream payload', () => {
    expect(isSafetyBlockedError({ message: 'IMAGE_SAFETY' })).toBe(true)
    expect(
      isSafetyBlockedError({
        details: { upstreamData: { error: { code: 'channel:image_generation_failed', message: 'blocked by policy' } } },
      }),
    ).toBe(true)
  })

  it('marks generic 429 as quota-like and appends hint', () => {
    const out = resolveTaskErrorDisplay({ status: 429, message: 'rate limited' }, 'fallback')
    expect(out.isQuotaLike429).toBe(true)
    expect(out.enhancedMsg).toContain('API配额已用尽')
  })

  it('does not mark safety-related 429 as quota-like', () => {
    const out = resolveTaskErrorDisplay({ status: 429, message: 'IMAGE_SAFETY' }, 'fallback')
    expect(out.isQuotaLike429).toBe(false)
    expect(out.enhancedMsg).toBe('IMAGE_SAFETY')
  })

  it('keeps non-429 errors unchanged', () => {
    const out = resolveTaskErrorDisplay({ status: 500, message: 'server error' }, 'fallback')
    expect(out.isQuotaLike429).toBe(false)
    expect(out.enhancedMsg).toBe('server error')
  })
})
