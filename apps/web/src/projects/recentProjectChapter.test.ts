import { describe, expect, it } from 'vitest'
import { pickMostRecentChapter } from './recentProjectChapter'

describe('pickMostRecentChapter', () => {
  it('prefers the latest lastWorkedAt over chapter update order', () => {
    const result = pickMostRecentChapter([
      { id: 'chapter-newer-update', updatedAt: '2026-08-01T10:00:00.000Z' },
      { id: 'chapter-last-worked', lastWorkedAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
    ])

    expect(result?.id).toBe('chapter-last-worked')
  })

  it('returns the first chapter when activity timestamps are absent', () => {
    const chapters = [{ id: 'chapter-1' }, { id: 'chapter-2' }]
    expect(pickMostRecentChapter(chapters)).toBe(chapters[0])
  })

  it('returns null for a project without chapters', () => {
    expect(pickMostRecentChapter([])).toBeNull()
  })
})
