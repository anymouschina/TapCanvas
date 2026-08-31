import React from 'react'
import type { ProjectDto } from '../api/server'
import { PublishModal } from '../ui/PublishModal'
import { PublishSourcePickerModal, type PublishSource } from './PublishSourcePickerModal'
import type { UserShortFilmDto } from './useNeoTvData'

type VideoPublishFlowProps = {
  projects: ProjectDto[]
  projectCovers: Record<string, string>
  shortFilms: UserShortFilmDto[]
  shortFilmsLoading: boolean
  shortFilmsError: string
  opened: boolean
  onClose: () => void
}

export function VideoPublishFlow({
  projects,
  projectCovers,
  shortFilms,
  shortFilmsLoading,
  shortFilmsError,
  opened,
  onClose,
}: VideoPublishFlowProps): JSX.Element {
  const [source, setSource] = React.useState<PublishSource | null>(null)
  const [sourcePickerOpened, setSourcePickerOpened] = React.useState(false)

  const selectedProject = React.useMemo(() => {
    if (source?.kind === 'film') return null
    return projects.find((project) => project.id === source?.projectId) || null
  }, [projects, source])

  const selectedFilm = React.useMemo(() => {
    if (source?.kind !== 'film') return null
    return shortFilms.find((film) => film.id === source.id) || null
  }, [shortFilms, source])

  const selectedFilmProject = React.useMemo(() => {
    if (!selectedFilm?.projectId) return null
    return projects.find((project) => project.id === selectedFilm.projectId) || null
  }, [projects, selectedFilm])

  const closeFlow = React.useCallback(() => {
    setSource(null)
    setSourcePickerOpened(false)
    onClose()
  }, [onClose])

  const sourceProjectId = source?.kind === 'project' || source?.kind === 'chapter'
    ? source.projectId
    : selectedFilm?.projectId || null
  const sourceProjectName = selectedProject?.name
    || selectedFilmProject?.name
    || selectedFilm?.projectName
    || ''
  const sourceName = source?.kind === 'chapter'
    ? source.chapterTitle || `第${source.chapterIndex + 1}章`
    : selectedFilm?.name || selectedProject?.name || ''
  const sourceCoverUrl = selectedProject
    ? projectCovers[selectedProject.id] || selectedProject.templateCoverUrl?.trim() || ''
    : selectedFilm?.thumbnailUrl || ''
  const sourceLabel = source?.kind === 'chapter'
    ? `${sourceProjectName || '未命名项目'} · 第${source.chapterIndex + 1}章`
    : source?.kind === 'film'
      ? '短片'
      : source?.kind === 'project'
        ? '项目'
        : null
  const ownerType = source?.kind === 'chapter'
    ? 'chapter'
    : source?.kind === 'film'
      ? 'shortFilm'
      : source?.kind === 'project'
        ? 'project'
        : null
  const ownerId = source?.kind === 'chapter'
    ? source.chapterId
    : source?.kind === 'film'
      ? source.id
      : source?.kind === 'project'
        ? source.projectId
        : null

  return (
    <>
      <PublishModal
        opened={opened}
        onClose={closeFlow}
        projectId={sourceProjectId}
        projectName={sourceProjectName}
        sourceName={sourceName}
        sourceCoverUrl={sourceCoverUrl}
        sourceLabel={sourceLabel}
        ownerType={ownerType}
        ownerId={ownerId}
        sourceChapterTitle={source?.kind === 'chapter' ? source.chapterTitle : null}
        initialVideoUrl={selectedFilm?.videoUrl || null}
        initialCoverUrl={selectedFilm?.thumbnailUrl || null}
        onChooseSource={() => setSourcePickerOpened(true)}
      />

      <PublishSourcePickerModal
        projects={projects}
        projectCovers={projectCovers}
        shortFilms={shortFilms}
        shortFilmsLoading={shortFilmsLoading}
        shortFilmsError={shortFilmsError}
        opened={sourcePickerOpened}
        value={source}
        onClose={() => setSourcePickerOpened(false)}
        onConfirm={(nextSource) => {
          setSource(nextSource)
          setSourcePickerOpened(false)
        }}
      />
    </>
  )
}
