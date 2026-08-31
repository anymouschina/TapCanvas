import {
  createProjectChapter,
  getProjectBookIndex,
  listProjectBooks,
  listProjectChapters,
  updateChapter,
} from '../api/server'

type SyncProjectChaptersResult = {
  createdCount: number
  chapterId?: string
  totalSourceChapters: number
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
