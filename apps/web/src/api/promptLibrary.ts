import { apiFetch, apiURL } from './server'

export type PromptMediaKind = 'image' | 'video'
export type PromptLibrarySort = 'likes_desc' | 'name_asc' | 'time_asc' | 'time_desc'

export type PromptLibraryModel = {
  slug: string
  name: string
}

export type PromptLibraryMedia = {
  id: string
  kind: PromptMediaKind
  url: string
  thumbnailUrl: string | null
  width: number | null
  height: number | null
  order: number
}

export type PromptLibraryCard = {
  id: string
  title: string
  description: string | null
  promptText: string
  mediaType: PromptMediaKind
  authorLabel: string
  publishedAt: string | null
  models: PromptLibraryModel[]
  media: PromptLibraryMedia[]
  likes?: number
  comments?: number
}

export type PromptLibraryDetail = PromptLibraryCard & {
  promptTextOriginal: string | null
  categories: string[]
  sourceUrl: string
  originalSourceUrl: string | null
  originalLanguage: string | null
  metrics: {
    likes: number
    views: number
    shares: number
    comments: number
    bookmarks: number
    quotes: number
  }
  viewerLiked: boolean
  communityComments: PromptLibraryComment[]
}

export type PromptLibraryComment = {
  id: string
  content: string
  authorName: string
  createdAt: string
  canDelete: boolean
}

export type PromptLibraryPageResult = {
  items: PromptLibraryCard[]
  total: number
  page: number
  pageSize: number
  facets: PromptLibraryFacets
}

export type PromptLibraryFacets = {
  media: Array<{ kind: PromptMediaKind; count: number }>
  models: Array<{ slug: string; name: string; count: number }>
  allMediaCount: number
  allModelCount: number
}

export type PromptLibraryCrawlRun = {
  id: string
  targetSite: string
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'
  discoveredCount: number
  processedCount: number
  importedCount: number
  deduplicatedCount: number
  skippedCount: number
  failedCount: number
  currentUrl: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PromptLibrarySummary = {
  entryCount: number
  mediaCount: number
  sourceCount: number
  modelCount: number
}

async function readApiError(response: Response, fallback: string): Promise<never> {
  const payload: unknown = await response.json().catch(() => null)
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const message = Reflect.get(payload, 'error') ?? Reflect.get(payload, 'message')
    if (typeof message === 'string' && message.trim()) throw new Error(message.trim())
  }
  throw new Error(`${fallback}（HTTP ${response.status}）`)
}

function normalizePromptLibraryDetail(payload: unknown): PromptLibraryDetail {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('提示词详情响应格式不合法')
  }
  const record = payload as Record<string, unknown>
  const rawMetrics = record.metrics
  const metrics = rawMetrics && typeof rawMetrics === 'object' && !Array.isArray(rawMetrics)
    ? rawMetrics as Record<string, unknown>
    : {}
  const likes = typeof record.likes === 'number' ? record.likes : typeof metrics.likes === 'number' ? metrics.likes : 0
  const comments = typeof record.comments === 'number' ? record.comments : typeof metrics.comments === 'number' ? metrics.comments : 0
  return {
    ...record,
    likes,
    comments,
    viewerLiked: record.viewerLiked === true,
    communityComments: Array.isArray(record.communityComments) ? record.communityComments : [],
  } as unknown as PromptLibraryDetail
}

export async function listPromptLibrary(input: {
  query?: string
  model?: string
  mediaType?: PromptMediaKind
  sort?: PromptLibrarySort
  page?: number
  pageSize?: number
} = {}): Promise<PromptLibraryPageResult> {
  const url = apiURL('/prompt-library')
  if (input.query) url.searchParams.set('query', input.query)
  if (input.model) url.searchParams.set('model', input.model)
  if (input.mediaType) url.searchParams.set('mediaType', input.mediaType)
  // The default sort is a server concern. Omitting it preserves the original
  // query contract and lets older API instances apply their own default while
  // newer instances use the likes-first default.
  if (input.sort && input.sort !== 'likes_desc') url.searchParams.set('sort', input.sort)
  url.searchParams.set('page', String(input.page ?? 1))
  url.searchParams.set('pageSize', String(input.pageSize ?? 24))
  const response = await apiFetch(url, { credentials: 'include' })
  if (!response.ok) return readApiError(response, '加载提示词失败')
  return response.json() as Promise<PromptLibraryPageResult>
}

export async function getPromptLibraryDetail(id: string): Promise<PromptLibraryDetail> {
  const response = await apiFetch(apiURL(`/prompt-library/${encodeURIComponent(id)}`), { credentials: 'include' })
  if (!response.ok) return readApiError(response, '加载提示词详情失败')
  return normalizePromptLibraryDetail(await response.json())
}

export async function togglePromptLibraryLike(id: string): Promise<{ liked: boolean; likes: number }> {
  const response = await apiFetch(apiURL(`/prompt-library/${encodeURIComponent(id)}/like`), { method: 'POST', credentials: 'include' })
  if (!response.ok) return readApiError(response, '更新点赞失败')
  return response.json() as Promise<{ liked: boolean; likes: number }>
}

export async function listPromptLibraryComments(id: string): Promise<PromptLibraryComment[]> {
  const response = await apiFetch(apiURL(`/prompt-library/${encodeURIComponent(id)}/comments`), { credentials: 'include' })
  if (!response.ok) return readApiError(response, '加载评论失败')
  return response.json() as Promise<PromptLibraryComment[]>
}

export async function createPromptLibraryComment(id: string, content: string): Promise<PromptLibraryComment> {
  const response = await apiFetch(apiURL(`/prompt-library/${encodeURIComponent(id)}/comments`), {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
  })
  if (!response.ok) return readApiError(response, '发表评论失败')
  return response.json() as Promise<PromptLibraryComment>
}

export async function deletePromptLibraryComment(commentId: string): Promise<void> {
  const response = await apiFetch(apiURL(`/prompt-library/comments/${encodeURIComponent(commentId)}`), { method: 'DELETE', credentials: 'include' })
  if (!response.ok) return readApiError(response, '删除评论失败')
}

export async function getPromptLibrarySummary(): Promise<PromptLibrarySummary> {
  const response = await apiFetch(apiURL('/admin/prompt-library/summary'), { credentials: 'include' })
  if (!response.ok) return readApiError(response, '加载提示词采集概览失败')
  return response.json() as Promise<PromptLibrarySummary>
}

export async function listPromptLibraryCrawls(): Promise<PromptLibraryCrawlRun[]> {
  const response = await apiFetch(apiURL('/admin/prompt-library/crawls'), { credentials: 'include' })
  if (!response.ok) return readApiError(response, '加载提示词采集记录失败')
  return response.json() as Promise<PromptLibraryCrawlRun[]>
}

export async function startPromptLibraryCrawl(): Promise<PromptLibraryCrawlRun> {
  const response = await apiFetch(apiURL('/admin/prompt-library/crawls'), { method: 'POST', credentials: 'include' })
  if (!response.ok) return readApiError(response, '启动提示词采集失败')
  return response.json() as Promise<PromptLibraryCrawlRun>
}

export async function resumePromptLibraryCrawl(id: string): Promise<PromptLibraryCrawlRun> {
  const response = await apiFetch(apiURL(`/admin/prompt-library/crawls/${encodeURIComponent(id)}/resume`), { method: 'POST', credentials: 'include' })
  if (!response.ok) return readApiError(response, '继续提示词采集失败')
  return response.json() as Promise<PromptLibraryCrawlRun>
}
