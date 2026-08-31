import { describe, expect, it } from 'vitest'
import { buildNeoTvWatchPath } from './neoTvNavigation'

describe('buildNeoTvWatchPath', () => {
  it('builds a direct viewer path for a published work', () => {
    expect(buildNeoTvWatchPath('work-123')).toBe('/neo-tv?watch=work-123')
  })

  it('encodes asset ids before placing them in the query string', () => {
    expect(buildNeoTvWatchPath('work/a b')).toBe('/neo-tv?watch=work%2Fa%20b')
  })

  it('rejects an empty work id instead of navigating to an unrelated page', () => {
    expect(() => buildNeoTvWatchPath('  ')).toThrow('Neo TV 作品 ID 不能为空')
  })
})
