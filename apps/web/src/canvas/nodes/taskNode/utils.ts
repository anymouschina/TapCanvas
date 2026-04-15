export const REMOTE_IMAGE_URL_REGEX = /^https?:\/\//i

export const isRemoteUrl = (url?: string | null) => {
  if (!url) return false
  return REMOTE_IMAGE_URL_REGEX.test(url)
}

export const normalizeClipRange = (val: unknown): { start: number; end: number } | null => {
  if (!val || typeof val !== 'object') return null
  const start = Number((val as { start?: unknown }).start)
  const end = Number((val as { end?: unknown }).end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end <= start) return null
  return { start, end }
}

export const syncDraftWithExternalValue = (input: {
  previousExternalValue: string
  nextExternalValue: string
  currentDraft: string
}) => {
  if (input.previousExternalValue === input.nextExternalValue) {
    return input.currentDraft
  }
  return input.nextExternalValue
}

export const pickOnlyBookId = (books: ReadonlyArray<{ bookId?: string | null }>) => {
  const uniqueBookIds = Array.from(
    new Set(
      books
        .map((book) => (typeof book.bookId === 'string' ? book.bookId.trim() : ''))
        .filter(Boolean),
    ),
  )
  return uniqueBookIds.length === 1 ? uniqueBookIds[0] : ''
}
