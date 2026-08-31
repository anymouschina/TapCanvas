export const CHAPTER_META_UPDATED_EVENT = 'tapcanvas:chapter-meta-updated'

export type ChapterMetaUpdate = {
  chapterId: string
  title: string
  summary: string
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function dispatchChapterMetaUpdate(detail: ChapterMetaUpdate): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChapterMetaUpdate>(CHAPTER_META_UPDATED_EVENT, { detail }))
}

export function readChapterMetaUpdate(event: Event): ChapterMetaUpdate | null {
  if (!(event instanceof CustomEvent)) return null
  const detail: unknown = event.detail
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const record = detail as Record<string, unknown>
  const chapterId = readText(record.chapterId).trim()
  const title = readText(record.title).trim()
  if (!chapterId || !title) return null
  return {
    chapterId,
    title,
    summary: readText(record.summary),
  }
}
