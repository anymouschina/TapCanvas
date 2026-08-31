import React from 'react'
import {
  listServerAssets,
  fetchHomepageDecoration,
  EMPTY_HOMEPAGE_DECORATION,
  type CarouselSlide,
  type HomepageDecoration,
  type ProjectDto,
  type PublicAssetDto,
  type ServerAssetDto,
} from '../api/server'
import { useProjectLibrary } from './useProjectLibrary'
import { loadPortalCarouselSlides, loadPortalPublishedVideos } from './portalDataLoader'
import { buildGenerationHistoryItems } from '../ui/generationHistory'

export type UserShortFilmDto = {
  id: string
  name: string
  projectId: string | null
  projectName: string | null
  videoUrl: string
  thumbnailUrl: string | null
  createdAt: string
}

const shortFilmAssetRequests = new Map<string, Promise<ServerAssetDto[]>>()

function loadShortFilmAssets(authScope: string): Promise<ServerAssetDto[]> {
  const current = shortFilmAssetRequests.get(authScope)
  if (current) return current
  const request = listServerAssets({ kind: 'generation', limit: 96 })
    .then(({ items }) => items)
    .finally(() => {
      if (shortFilmAssetRequests.get(authScope) === request) shortFilmAssetRequests.delete(authScope)
    })
  shortFilmAssetRequests.set(authScope, request)
  return request
}

function readUserShortFilms(
  assets: Awaited<ReturnType<typeof listServerAssets>>['items'],
  projectNameById: ReadonlyMap<string, string>,
): UserShortFilmDto[] {
  const seenUrls = new Set<string>()
  const films: UserShortFilmDto[] = []
  for (const item of buildGenerationHistoryItems(assets)) {
    if (item.kind !== 'video' || seenUrls.has(item.url)) continue
    seenUrls.add(item.url)
    const projectId = item.projectId
    films.push({
      id: item.id,
      name: item.title,
      projectId,
      projectName: projectId ? projectNameById.get(projectId) || null : null,
      videoUrl: item.url,
      thumbnailUrl: item.thumbnailUrl || null,
      createdAt: item.createdAt,
    })
  }
  return films
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

export type NeoTvData = {
  projects: ProjectDto[]
  projectCovers: Record<string, string>
  projectsLoading: boolean
  projectsError: string
  slides: CarouselSlide[]
  slidesLoading: boolean
  slidesError: string
  decoration: HomepageDecoration
  decorationLoading: boolean
  decorationError: string
  videos: PublicAssetDto[]
  videosLoading: boolean
  videosError: string
  updateVideoFavorite: (assetId: string, favorited: boolean) => void
  shortFilms: UserShortFilmDto[]
  shortFilmsLoading: boolean
  shortFilmsError: string
  createProject: (name: string) => Promise<ProjectDto>
  registerProject: (project: ProjectDto) => void
  unregisterProject: (projectId: string) => void
  reloadProjects: () => void
}

export function useNeoTvData(authToken: string | null): NeoTvData {
  const projectLibrary = useProjectLibrary(authToken, 18)
  const [slides, setSlides] = React.useState<CarouselSlide[]>([])
  const [slidesLoading, setSlidesLoading] = React.useState(true)
  const [slidesError, setSlidesError] = React.useState('')
  const [decoration, setDecoration] = React.useState<HomepageDecoration>(EMPTY_HOMEPAGE_DECORATION)
  const [decorationLoading, setDecorationLoading] = React.useState(true)
  const [decorationError, setDecorationError] = React.useState('')
  const [videos, setVideos] = React.useState<PublicAssetDto[]>([])
  const [videosLoading, setVideosLoading] = React.useState(true)
  const [videosError, setVideosError] = React.useState('')
  const [shortFilmAssets, setShortFilmAssets] = React.useState<ServerAssetDto[]>([])
  const [shortFilmsLoading, setShortFilmsLoading] = React.useState(false)
  const [shortFilmsError, setShortFilmsError] = React.useState('')
  const updateVideoFavorite = React.useCallback((assetId: string, favorited: boolean): void => {
    setVideos((current) => current.map((asset) => {
      if (asset.id !== assetId) return asset
      const currentCount = asset.favoriteCount ?? 0
      return {
        ...asset,
        favorited,
        favoriteCount: Math.max(0, currentCount + (favorited ? 1 : -1)),
      }
    }))
  }, [])
  const projectNameById = React.useMemo(
    () => new Map(projectLibrary.projects.map((project) => [project.id, project.name])),
    [projectLibrary.projects],
  )
  const shortFilms = React.useMemo(
    () => readUserShortFilms(shortFilmAssets, projectNameById),
    [projectNameById, shortFilmAssets],
  )
  React.useEffect(() => {
    let active = true
    setSlidesLoading(true)
    void loadPortalCarouselSlides()
      .then((items) => {
        if (!active) return
        setSlides(items)
        setSlidesError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        setSlides([])
        setSlidesError(resolveErrorMessage(error, '活动内容加载失败'))
      })
      .finally(() => {
        if (active) setSlidesLoading(false)
      })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    let active = true
    setDecorationLoading(true)
    void fetchHomepageDecoration()
      .then((value) => {
        if (!active) return
        setDecoration(value)
        setDecorationError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        setDecorationError(resolveErrorMessage(error, '首页装修加载失败'))
      })
      .finally(() => {
        if (active) setDecorationLoading(false)
      })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    let active = true
    if (!authToken) {
      setShortFilmAssets([])
      setShortFilmsLoading(false)
      setShortFilmsError('')
      return () => { active = false }
    }
    setShortFilmsLoading(true)
    setShortFilmsError('')
    void loadShortFilmAssets(authToken)
      .then((items) => {
        if (!active) return
        setShortFilmAssets(items)
      })
      .catch((error: unknown) => {
        if (!active) return
        setShortFilmAssets([])
        setShortFilmsError(resolveErrorMessage(error, '我的短片加载失败'))
      })
      .finally(() => {
        if (active) setShortFilmsLoading(false)
      })
    return () => { active = false }
  }, [authToken])

  React.useEffect(() => {
    let active = true
    setVideosLoading(true)
    void loadPortalPublishedVideos(authToken, 60)
      .then((items) => {
        if (!active) return
        setVideos(items)
        setVideosError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        setVideos([])
        setVideosError(resolveErrorMessage(error, 'Neo TV 作品加载失败'))
      })
      .finally(() => {
        if (active) setVideosLoading(false)
      })
    return () => { active = false }
  }, [authToken])

  return {
    projects: projectLibrary.projects,
    projectCovers: projectLibrary.projectCovers,
    projectsLoading: projectLibrary.loading,
    projectsError: projectLibrary.error,
    slides,
    slidesLoading,
    slidesError,
    decoration,
    decorationLoading,
    decorationError,
    videos,
    videosLoading,
    videosError,
    updateVideoFavorite,
    shortFilms,
    shortFilmsLoading,
    shortFilmsError,
    createProject: projectLibrary.createProject,
    registerProject: projectLibrary.registerProject,
    unregisterProject: projectLibrary.unregisterProject,
    reloadProjects: projectLibrary.reload,
  }
}
