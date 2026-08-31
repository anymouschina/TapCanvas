export type ChapterActivityRecord = {
  id: string
  lastWorkedAt?: string | null
  updatedAt?: string | null
}

function readActivityTimestamp(chapter: ChapterActivityRecord): number {
  const timestamp = Date.parse(String(chapter.lastWorkedAt || chapter.updatedAt || ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function pickMostRecentChapter<TChapter extends ChapterActivityRecord>(
  chapters: readonly TChapter[],
): TChapter | null {
  let mostRecent: TChapter | null = null
  let mostRecentTimestamp = Number.NEGATIVE_INFINITY

  for (const chapter of chapters) {
    const timestamp = readActivityTimestamp(chapter)
    if (mostRecent === null || timestamp > mostRecentTimestamp) {
      mostRecent = chapter
      mostRecentTimestamp = timestamp
    }
  }

  return mostRecent
}
