/** Read-only export of persisted per-clip video prompts, one chapter per episode. */
export type ChapterScriptPlanSummary = Readonly<{
  chapterId: string
  chapterIndex: number
  title: string
  executionId: string
  executionStatus: string
  plannedAt: string | null
  clipCount: number
  durationSeconds: number
}>

export type ChapterScriptPlansResponse = Readonly<{
  projectId: string
  items: ChapterScriptPlanSummary[]
}>

export const MAX_SCRIPT_EXPORT_CHAPTERS = 200

export function parseScriptExportSelection(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || !('chapterIds' in raw) || !Array.isArray(raw.chapterIds)) {
    throw new Error('请选择 1–200 个章节')
  }
  const ids: unknown[] = raw.chapterIds
  if (!ids.length || ids.length > MAX_SCRIPT_EXPORT_CHAPTERS
    || ids.some(id => typeof id !== 'string' || !id.trim())
    || new Set(ids).size !== ids.length) throw new Error('请选择 1–200 个不重复的章节')
  return ids.map(id => {
    if (typeof id !== 'string') throw new Error('章节编号必须为文本')
    return id
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseChapterScriptPlansResponse(raw: unknown, projectId: string): ChapterScriptPlansResponse {
  if (!isRecord(raw) || raw.projectId !== projectId || !Array.isArray(raw.items)) {
    throw new Error('章节剧本列表响应格式错误')
  }
  const chapterIds = new Set<string>()
  const items = raw.items.map((item: unknown): ChapterScriptPlanSummary => {
    if (!isRecord(item)) throw new Error('章节剧本列表响应格式错误')
    const { chapterId, chapterIndex, title, executionId, executionStatus, plannedAt, clipCount, durationSeconds } = item
    if (typeof chapterId !== 'string' || !chapterId.trim() || chapterIds.has(chapterId)
      || typeof chapterIndex !== 'number' || !Number.isSafeInteger(chapterIndex) || chapterIndex < 0
      || typeof title !== 'string' || !title.trim()
      || typeof executionId !== 'string' || !executionId.trim()
      || typeof executionStatus !== 'string' || !executionStatus.trim()
      || !(plannedAt === null || (typeof plannedAt === 'string' && plannedAt.trim().length > 0))
      || typeof clipCount !== 'number' || !Number.isSafeInteger(clipCount) || clipCount <= 0
      || typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('章节剧本列表响应格式错误')
    }
    chapterIds.add(chapterId)
    return { chapterId, chapterIndex, title, executionId, executionStatus, plannedAt, clipCount, durationSeconds }
  })
  return { projectId, items }
}
