import type { ProjectBookListItemDto } from '../api/server'

function readTimestampMs(value: string): number {
  const parsed = Date.parse(String(value || '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortProjectBooksByUpdatedAt(books: readonly ProjectBookListItemDto[]): ProjectBookListItemDto[] {
  return [...books].sort((left, right) => {
    const diff = readTimestampMs(right.updatedAt) - readTimestampMs(left.updatedAt)
    if (diff !== 0) return diff
    return String(left.title || '').localeCompare(String(right.title || ''))
  })
}

export function pickPrimaryProjectBook(books: readonly ProjectBookListItemDto[]): ProjectBookListItemDto | null {
  const sorted = sortProjectBooksByUpdatedAt(books)
  return sorted[0] || null
}
