import { describe, expect, it } from 'vitest'
import { isRemoteUrl, normalizeClipRange, pickOnlyBookId, syncDraftWithExternalValue } from '../../src/canvas/nodes/taskNode/utils'

describe('task node utils', () => {
  it('detects remote urls', () => {
    expect(isRemoteUrl('https://example.com/a.png')).toBe(true)
    expect(isRemoteUrl('http://example.com/a.png')).toBe(true)
    expect(isRemoteUrl('/local/a.png')).toBe(false)
    expect(isRemoteUrl('data:image/png;base64,abc')).toBe(false)
  })

  it('normalizes valid clip ranges', () => {
    expect(normalizeClipRange({ start: 1, end: 2 })).toEqual({ start: 1, end: 2 })
    expect(normalizeClipRange({ start: '1', end: '3' })).toEqual({ start: 1, end: 3 })
  })

  it('rejects invalid clip ranges', () => {
    expect(normalizeClipRange(null)).toBeNull()
    expect(normalizeClipRange({ start: 2, end: 2 })).toBeNull()
    expect(normalizeClipRange({ start: 3, end: 2 })).toBeNull()
    expect(normalizeClipRange({ start: 'a', end: 3 })).toBeNull()
  })

  it('keeps local draft when external value did not change', () => {
    expect(
      syncDraftWithExternalValue({
        previousExternalValue: '旧角色名',
        nextExternalValue: '旧角色名',
        currentDraft: '新角色名',
      }),
    ).toBe('新角色名')
  })

  it('resyncs local draft when external value changes', () => {
    expect(
      syncDraftWithExternalValue({
        previousExternalValue: '旧角色名',
        nextExternalValue: '新角色名',
        currentDraft: '本地暂存',
      }),
    ).toBe('新角色名')
  })

  it('picks the only available book id', () => {
    expect(pickOnlyBookId([{ bookId: 'book-1' }])).toBe('book-1')
    expect(pickOnlyBookId([{ bookId: ' book-1 ' }, { bookId: 'book-1' }])).toBe('book-1')
  })

  it('does not guess a book id when multiple books exist', () => {
    expect(pickOnlyBookId([{ bookId: 'book-1' }, { bookId: 'book-2' }])).toBe('')
    expect(pickOnlyBookId([])).toBe('')
  })
})
