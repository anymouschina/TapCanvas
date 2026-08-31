export const REMOTE_IMAGE_URL_REGEX = /^https?:\/\//i

export const isRemoteUrl = (url?: string | null) => {
  if (!url) return false
  return REMOTE_IMAGE_URL_REGEX.test(url)
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
