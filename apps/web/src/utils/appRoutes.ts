export const LANDING_PATH = '/'
export const STUDIO_PATH = '/studio'
export const GITHUB_OAUTH_CALLBACK_PATH = '/oauth/github'

export type StudioOwnerType = 'project' | 'chapter' | 'shot'
export type StudioPanel = 'nanoComic'

export function isStudioRoute(pathname?: string): boolean {
  const path =
    typeof pathname === 'string'
      ? pathname
      : typeof window !== 'undefined'
        ? window.location.pathname || ''
        : ''

  return path === STUDIO_PATH || path.startsWith(`${STUDIO_PATH}/`)
}

export function isGithubOauthCallbackRoute(pathname?: string): boolean {
  const path =
    typeof pathname === 'string'
      ? pathname
      : typeof window !== 'undefined'
        ? window.location.pathname || ''
        : ''

  return path === GITHUB_OAUTH_CALLBACK_PATH
}

export function buildStudioUrl(input?: string | null | {
  projectId?: string | null
  ownerType?: StudioOwnerType | null
  ownerId?: string | null
  flowId?: string | null
  panel?: StudioPanel | null
  chapter?: number | null
  shotId?: string | null
}): string {
  const options = typeof input === 'string' || input == null
    ? { projectId: input }
    : input
  const normalizedProjectId = typeof options.projectId === 'string' ? options.projectId.trim() : ''
  const normalizedOwnerType = options.ownerType === 'chapter' || options.ownerType === 'shot' || options.ownerType === 'project'
    ? options.ownerType
    : null
  const normalizedOwnerId = typeof options.ownerId === 'string' ? options.ownerId.trim() : ''
  const normalizedFlowId = typeof options.flowId === 'string' ? options.flowId.trim() : ''
  const normalizedPanel = options.panel === 'nanoComic' ? options.panel : null
  const normalizedChapter =
    typeof options.chapter === 'number' && Number.isFinite(options.chapter) && options.chapter > 0
      ? Math.trunc(options.chapter)
      : null
  const normalizedShotId = typeof options.shotId === 'string' ? options.shotId.trim() : ''

  try {
    const url = typeof window !== 'undefined'
      ? new URL(window.location.href)
      : new URL('https://tapcanvas.local')

    url.pathname = STUDIO_PATH
    url.search = ''
    url.hash = ''

    if (normalizedProjectId) {
      url.searchParams.set('projectId', normalizedProjectId)
    }
    if (normalizedOwnerType && normalizedOwnerId) {
      url.searchParams.set('ownerType', normalizedOwnerType)
      url.searchParams.set('ownerId', normalizedOwnerId)
    } else {
      url.searchParams.delete('ownerType')
      url.searchParams.delete('ownerId')
    }
    if (normalizedFlowId) {
      url.searchParams.set('flowId', normalizedFlowId)
    } else {
      url.searchParams.delete('flowId')
    }
    if (normalizedPanel) {
      url.searchParams.set('panel', normalizedPanel)
    } else {
      url.searchParams.delete('panel')
    }
    if (normalizedChapter) {
      url.searchParams.set('chapter', String(normalizedChapter))
    } else {
      url.searchParams.delete('chapter')
    }
    if (normalizedShotId) {
      url.searchParams.set('shotId', normalizedShotId)
    } else {
      url.searchParams.delete('shotId')
    }

    return `${url.pathname}${url.search}`
  } catch {
    const params = new URLSearchParams()
    if (normalizedProjectId) params.set('projectId', normalizedProjectId)
    if (normalizedOwnerType && normalizedOwnerId) {
      params.set('ownerType', normalizedOwnerType)
      params.set('ownerId', normalizedOwnerId)
    }
    if (normalizedFlowId) params.set('flowId', normalizedFlowId)
    if (normalizedPanel) params.set('panel', normalizedPanel)
    if (normalizedChapter) params.set('chapter', String(normalizedChapter))
    if (normalizedShotId) params.set('shotId', normalizedShotId)
    const search = params.toString()
    return search ? `${STUDIO_PATH}?${search}` : STUDIO_PATH
  }
}

export function buildProjectUrl(projectId: string): string {
  const normalizedProjectId = String(projectId || '').trim()
  return `/projects/${encodeURIComponent(normalizedProjectId)}`
}

export function buildProjectDirectoryUrl(projectId: string): string {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return '/projects'
  return `/projects?projectId=${encodeURIComponent(normalizedProjectId)}`
}

export function buildProjectChapterUrl(projectId: string, chapterId: string, shotId?: string | null): string {
  const normalizedProjectId = String(projectId || '').trim()
  const normalizedChapterId = String(chapterId || '').trim()
  const normalizedShotId = typeof shotId === 'string' ? shotId.trim() : ''
  if (normalizedShotId) {
    return `/projects/${encodeURIComponent(normalizedProjectId)}/chapters/${encodeURIComponent(normalizedChapterId)}/shots/${encodeURIComponent(normalizedShotId)}`
  }
  return `/projects/${encodeURIComponent(normalizedProjectId)}/chapters/${encodeURIComponent(normalizedChapterId)}`
}
