import React from 'react'

import {
  getMemoryContext,
  type MemoryContextSectionDto,
  type MemoryEntryDto,
} from '../api/server'

export type MemoryLensScope = Readonly<{
  projectId?: string
  bookId?: string
  chapterId?: string
}>

export type MemoryLensGroup = Readonly<{
  key: string
  label: string
  items: MemoryEntryDto[]
}>

export type MemoryLensState = Readonly<{
  groups: MemoryLensGroup[]
  itemCount: number
  summaryText: string
  loading: boolean
  error: string | null
  reload: () => void
}>

const MEMORY_GROUPS: ReadonlyArray<{
  key: string
  label: string
  select: (context: MemoryContextSectionDto) => MemoryEntryDto[]
}> = [
  { key: 'preferences', label: '长期偏好', select: (context) => context.userPreferences },
  { key: 'project', label: '项目事实', select: (context) => context.projectFacts },
  { key: 'book', label: '书籍事实', select: (context) => context.bookFacts },
  { key: 'chapter', label: '章节事实', select: (context) => context.chapterFacts },
  { key: 'artifacts', label: '资产线索', select: (context) => context.artifactRefs },
  { key: 'project-rollup', label: '项目摘要', select: (context) => context.rollups.project },
  { key: 'book-rollup', label: '书籍摘要', select: (context) => context.rollups.book },
  { key: 'chapter-rollup', label: '章节摘要', select: (context) => context.rollups.chapter },
] as const

function normalizeScope(scope: MemoryLensScope): MemoryLensScope {
  const projectId = scope.projectId?.trim()
  const bookId = scope.bookId?.trim()
  const chapterId = scope.chapterId?.trim()
  return {
    ...(projectId ? { projectId } : {}),
    ...(bookId ? { bookId } : {}),
    ...(chapterId ? { chapterId } : {}),
  }
}

export function groupMemoryLensEntries(context: MemoryContextSectionDto): MemoryLensGroup[] {
  const seen = new Set<string>()
  const groups: MemoryLensGroup[] = []
  for (const definition of MEMORY_GROUPS) {
    const items = definition.select(context).filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    if (items.length > 0) groups.push({ key: definition.key, label: definition.label, items })
  }
  return groups
}

export function useMemoryLens(scope: MemoryLensScope, enabled: boolean): MemoryLensState {
  const normalizedScope = React.useMemo(
    () => normalizeScope(scope),
    [scope.bookId, scope.chapterId, scope.projectId],
  )
  const scopeKey = `${normalizedScope.projectId ?? ''}:${normalizedScope.bookId ?? ''}:${normalizedScope.chapterId ?? ''}`
  const [reloadToken, setReloadToken] = React.useState(0)
  const [groups, setGroups] = React.useState<MemoryLensGroup[]>([])
  const [summaryText, setSummaryText] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    void getMemoryContext({
      ...normalizedScope,
      limitPerScope: 8,
      recentConversationLimit: 1,
    }).then((response) => {
      if (cancelled) return
      setGroups(groupMemoryLensEntries(response.context))
      setSummaryText(response.summaryText.trim())
    }).catch((cause: unknown) => {
      if (cancelled) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, normalizedScope, reloadToken, scopeKey])

  return {
    groups,
    itemCount: groups.reduce((count, group) => count + group.items.length, 0),
    summaryText,
    loading,
    error,
    reload: () => setReloadToken((current) => current + 1),
  }
}
