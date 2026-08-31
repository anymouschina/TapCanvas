import React from 'react'
import {
  listServerAssets,
  listProjectsPaginated,
  upsertProject,
  type ProjectDto,
  type ServerAssetDto,
} from '../api/server'
import { useActiveTeamId } from '../ui/team/activeTeam'

type ProjectPage = Awaited<ReturnType<typeof listProjectsPaginated>>

const projectPageRequests = new Map<string, Promise<ProjectPage>>()
const projectCoverRequests = new Map<string, Promise<ServerAssetDto[]>>()

function readProjectCoverUrl(asset: ServerAssetDto): string {
  if (!asset.data || typeof asset.data !== 'object' || Array.isArray(asset.data)) return ''
  const value = (asset.data as Record<string, unknown>).imageUrl
  return typeof value === 'string' ? value.trim() : ''
}

function loadProjectPage(
  authScope: string,
  input: Parameters<typeof listProjectsPaginated>[0],
): Promise<ProjectPage> {
  const key = [authScope, input?.teamId || 'personal', input?.cursor || 'first', input?.limit || 30].join(':')
  const current = projectPageRequests.get(key)
  if (current) return current
  const request = listProjectsPaginated(input).finally(() => {
    if (projectPageRequests.get(key) === request) projectPageRequests.delete(key)
  })
  projectPageRequests.set(key, request)
  return request
}

function loadProjectCovers(authScope: string, projectIds: string[]): Promise<ServerAssetDto[]> {
  if (projectIds.length === 0) return Promise.resolve([])
  const normalizedIds = Array.from(new Set(projectIds.map((id) => id.trim()).filter(Boolean))).sort()
  const key = `${authScope}:${normalizedIds.join(',')}`
  const current = projectCoverRequests.get(key)
  if (current) return current
  const request = listServerAssets({
    projectIds: normalizedIds,
    kind: 'projectCoverMeta',
    limit: Math.min(200, Math.max(normalizedIds.length * 3, normalizedIds.length)),
  }).then(({ items }) => items).finally(() => {
    if (projectCoverRequests.get(key) === request) projectCoverRequests.delete(key)
  })
  projectCoverRequests.set(key, request)
  return request
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

function appendUniqueProjects(current: ProjectDto[], incoming: ProjectDto[]): ProjectDto[] {
  if (incoming.length === 0) return current
  const existingIds = new Set(current.map((project) => project.id))
  const additions = incoming.filter((project) => !existingIds.has(project.id))
  return additions.length > 0 ? [...current, ...additions] : current
}

export type ProjectLibrary = {
  projects: ProjectDto[]
  projectCovers: Record<string, string>
  loading: boolean
  error: string
  createProject: (name: string) => Promise<ProjectDto>
  registerProject: (project: ProjectDto) => void
  unregisterProject: (projectId: string) => void
  reload: () => void
}

export function useProjectLibrary(authToken: string | null, coverLimit: number | null): ProjectLibrary {
  const [projects, setProjects] = React.useState<ProjectDto[]>([])
  const [projectCovers, setProjectCovers] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [reloadNonce, setReloadNonce] = React.useState(0)
  const activeTeamId = useActiveTeamId()

  React.useEffect(() => {
    let active = true
    if (!authToken) {
      setProjects([])
      setProjectCovers({})
      setError('')
      setLoading(false)
      return () => { active = false }
    }

    setLoading(true)
    setError('')
    setProjectCovers({})
    let coverSlotsRemaining = coverLimit == null ? Number.POSITIVE_INFINITY : coverLimit
    const reportProblem = (message: string): void => {
      if (!active) return
      setError((current) => current ? `${current}；${message}` : message)
    }
    const loadCovers = async (loadedProjects: ProjectDto[]): Promise<void> => {
      const projectsForCovers = Number.isFinite(coverSlotsRemaining)
        ? loadedProjects.slice(0, Math.max(0, coverSlotsRemaining))
        : loadedProjects
      coverSlotsRemaining -= projectsForCovers.length
      if (projectsForCovers.length === 0) return
      try {
        const covers: Record<string, string> = {}
        const projectIdsWithoutTemplateCover: string[] = []
        for (const project of projectsForCovers) {
          const templateCoverUrl = project.templateCoverUrl?.trim() || ''
          if (templateCoverUrl) covers[project.id] = templateCoverUrl
          else projectIdsWithoutTemplateCover.push(project.id)
        }
        const coverAssets = await loadProjectCovers(authToken, projectIdsWithoutTemplateCover)
        if (!active) return
        for (const asset of coverAssets) {
          const projectId = asset.projectId?.trim() || ''
          if (!projectId || covers[projectId]) continue
          const imageUrl = readProjectCoverUrl(asset)
          if (imageUrl) covers[projectId] = imageUrl
        }
        setProjectCovers((current) => ({ ...current, ...covers }))
      } catch (coverError: unknown) {
        reportProblem(resolveErrorMessage(coverError, '画布封面加载失败'))
      }
    }

    void (async () => {
      let cursor: string | null = null
      try {
        const firstPage = await loadProjectPage(authToken, {
          limit: 30,
          teamId: activeTeamId || undefined,
        })
        if (!active) return
        setProjects(firstPage.items)
        setLoading(false)
        void loadCovers(firstPage.items)
        cursor = firstPage.nextCursor
      } catch (loadError: unknown) {
        if (!active) return
        setProjects([])
        setProjectCovers({})
        setError(resolveErrorMessage(loadError, '画布加载失败'))
        setLoading(false)
        return
      }

      while (active && cursor) {
        try {
          const page = await loadProjectPage(authToken, {
            limit: 100,
            cursor,
            teamId: activeTeamId || undefined,
          })
          if (!active) return
          setProjects((current) => appendUniqueProjects(current, page.items))
          void loadCovers(page.items)
          cursor = page.nextCursor
        } catch (paginationError: unknown) {
          reportProblem(resolveErrorMessage(paginationError, '后续画布加载失败'))
          return
        }
      }
    })()

    return () => { active = false }
  }, [activeTeamId, authToken, coverLimit, reloadNonce])

  const createProject = React.useCallback(
    async (name: string): Promise<ProjectDto> => {
      const project = await upsertProject({ name, teamId: activeTeamId })
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
      return project
    },
    [activeTeamId],
  )
  const registerProject = React.useCallback((project: ProjectDto): void => {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
  }, [])
  const unregisterProject = React.useCallback((projectId: string): void => {
    setProjects((current) => current.filter((project) => project.id !== projectId))
    setProjectCovers((current) => {
      if (!(projectId in current)) return current
      const next = { ...current }
      delete next[projectId]
      return next
    })
  }, [])
  const reload = React.useCallback((): void => {
    setReloadNonce((current) => current + 1)
  }, [])

  return { projects, projectCovers, loading, error, createProject, registerProject, unregisterProject, reload }
}
