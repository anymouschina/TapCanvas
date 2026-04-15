import {
  createProjectChapter,
  getProjectBookIndex,
  listProjectBooks,
  listProjectChapters,
  updateChapter,
  type ChapterDto,
} from '../api/server'

type EnsureProjectChapterBootstrapResult = {
  changed: boolean
  chapterId?: string
}

type SyncProjectChaptersResult = {
  createdCount: number
  chapterId?: string
  totalSourceChapters: number
}

function isBindablePlaceholderChapter(chapter: ChapterDto): boolean {
  if (chapter.sourceBookChapter) return false
  const normalizedTitle = String(chapter.title || '').trim()
  const normalizedSummary = String(chapter.summary || '').trim()
  if (normalizedSummary) return false
  return !normalizedTitle || /^第\s*1\s*章$/i.test(normalizedTitle) || /未命名/.test(normalizedTitle)
}

export async function ensureProjectHasAutoBoundFirstChapter(projectId: string): Promise<EnsureProjectChapterBootstrapResult> {
  const [books, chapters] = await Promise.all([
    listProjectBooks(projectId),
    listProjectChapters(projectId),
  ])
  const primaryBook = books[0]
  if (!primaryBook?.bookId) return { changed: false }
  const index = await getProjectBookIndex(projectId, primaryBook.bookId, { bypassThrottle: true })
  const firstSourceChapter = (index.chapters || [])[0]
  if (!firstSourceChapter) return { changed: false }

  const alreadyMapped = chapters.find((item) => item.sourceBookId === primaryBook.bookId && item.sourceBookChapter === firstSourceChapter.chapter) || null
  if (alreadyMapped) {
    return { changed: false, chapterId: alreadyMapped.id }
  }

  const placeholder = chapters.find((item) => isBindablePlaceholderChapter(item)) || null
  if (placeholder) {
    const updated = await updateChapter(placeholder.id, {
      title: firstSourceChapter.title || placeholder.title || '第1章',
      summary: firstSourceChapter.summary || firstSourceChapter.coreConflict || '',
      sourceBookId: primaryBook.bookId,
      sourceBookChapter: firstSourceChapter.chapter,
    })
    return { changed: true, chapterId: updated.id }
  }

  if (chapters.length === 0) {
    const created = await createProjectChapter(projectId, {
      title: firstSourceChapter.title || '第1章',
      summary: firstSourceChapter.summary || firstSourceChapter.coreConflict || '',
    })
    const updated = await updateChapter(created.id, {
      title: firstSourceChapter.title || created.title || '第1章',
      summary: firstSourceChapter.summary || firstSourceChapter.coreConflict || '',
      sourceBookId: primaryBook.bookId,
      sourceBookChapter: firstSourceChapter.chapter,
    })
    return { changed: true, chapterId: updated.id }
  }

  return { changed: false }
}

export async function syncProjectChaptersFromPrimaryBook(
  projectId: string,
  options?: { limit?: number },
): Promise<SyncProjectChaptersResult> {
  const [books, chapters] = await Promise.all([
    listProjectBooks(projectId),
    listProjectChapters(projectId),
  ])
  const primaryBook = books[0]
  if (!primaryBook?.bookId) {
    return {
      createdCount: 0,
      totalSourceChapters: 0,
    }
  }
  const index = await getProjectBookIndex(projectId, primaryBook.bookId, { bypassThrottle: true })
  const sourceChapters = index.chapters || []
  if (sourceChapters.length === 0) {
    return {
      createdCount: 0,
      totalSourceChapters: 0,
    }
  }

  const mappedSourceChapterNos = new Set(
    chapters
      .map((chapter) => (chapter.sourceBookId === primaryBook.bookId ? chapter.sourceBookChapter : null))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  )
  const missing = sourceChapters.filter((item) => !mappedSourceChapterNos.has(item.chapter))
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.max(1, Math.trunc(options.limit))
      : null
  const targetItems = limit ? missing.slice(0, limit) : missing

  let firstCreatedChapterId: string | undefined
  for (const item of targetItems) {
    const created = await createProjectChapter(projectId, {
      title: item.title || `第${item.chapter}章`,
      summary: item.summary || item.coreConflict || '',
    })
    const updated = await updateChapter(created.id, {
      title: item.title || created.title || `第${item.chapter}章`,
      summary: item.summary || item.coreConflict || '',
      sourceBookId: primaryBook.bookId,
      sourceBookChapter: item.chapter,
    })
    if (!firstCreatedChapterId) firstCreatedChapterId = updated.id
  }

  return {
    createdCount: targetItems.length,
    chapterId: firstCreatedChapterId,
    totalSourceChapters: sourceChapters.length,
  }
}
