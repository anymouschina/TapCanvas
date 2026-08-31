import React from 'react'
import { Modal, Select } from '@mantine/core'
import { IconBook2, IconCheck, IconMovie, IconRefresh, IconVideoPlus, IconX } from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import type { UserShortFilmDto } from './useNeoTvData'
import { usePublishProjectChapters } from './usePublishProjectChapters'

type PickerTab = 'project' | 'chapter' | 'film'

export type PublishSource =
  | { kind: 'project'; projectId: string }
  | { kind: 'chapter'; projectId: string; chapterId: string; chapterTitle: string; chapterIndex: number }
  | { kind: 'film'; id: string }

type PublishSourcePickerModalProps = {
  projects: ProjectDto[]
  projectCovers: Record<string, string>
  shortFilms: UserShortFilmDto[]
  shortFilmsLoading: boolean
  shortFilmsError: string
  opened: boolean
  value: PublishSource | null
  onClose: () => void
  onConfirm: (source: PublishSource) => void
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN')
}

function initialTab(value: PublishSource | null): PickerTab {
  return value?.kind ?? 'project'
}

export function PublishSourcePickerModal({
  projects,
  projectCovers,
  shortFilms,
  shortFilmsLoading,
  shortFilmsError,
  opened,
  value,
  onClose,
  onConfirm,
}: PublishSourcePickerModalProps): JSX.Element {
  const firstProjectId = projects[0]?.id ?? ''
  const [tab, setTab] = React.useState<PickerTab>(() => initialTab(value))
  const [draft, setDraft] = React.useState<PublishSource | null>(value)
  const [chapterProjectId, setChapterProjectId] = React.useState('')
  const [chapterReloadKey, setChapterReloadKey] = React.useState(0)
  const chapterState = usePublishProjectChapters({
    enabled: opened && tab === 'chapter',
    projectId: chapterProjectId,
    reloadKey: chapterReloadKey,
  })

  React.useEffect(() => {
    if (!opened) return
    setDraft(value)
    setTab(initialTab(value))
    const preferredProjectId = value?.kind === 'chapter'
      ? value.projectId
      : value?.kind === 'project'
        ? value.projectId
        : firstProjectId
    setChapterProjectId(preferredProjectId)
  }, [firstProjectId, opened, value])

  const draftMatchesTab = draft?.kind === tab
    && (draft.kind !== 'chapter' || draft.projectId === chapterProjectId)
  const chapterStateMatchesProject = chapterState.projectId === chapterProjectId

  return (
    <Modal
      className="neo-publish-picker"
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      padding={0}
      centered
      size="min(900px, 92vw)"
      overlayProps={{ backgroundOpacity: 0.56, blur: 3 }}
    >
      <div className="neo-publish-picker__body">
        <header className="neo-publish-picker__header">
          <div className="neo-publish-picker__tabs" role="tablist" aria-label="关联来源类型">
            <button
              className={`neo-publish-picker__tab${tab === 'project' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'project'}
              onClick={() => setTab('project')}
            >
              项目
            </button>
            <button
              className={`neo-publish-picker__tab${tab === 'chapter' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'chapter'}
              onClick={() => {
                const preferredProjectId = draft?.kind === 'project' || draft?.kind === 'chapter'
                  ? draft.projectId
                  : firstProjectId
                setChapterProjectId(preferredProjectId)
                setTab('chapter')
              }}
            >
              章节
            </button>
            <button
              className={`neo-publish-picker__tab${tab === 'film' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'film'}
              onClick={() => setTab('film')}
            >
              短片
            </button>
          </div>
          <button className="neo-publish-picker__close" type="button" aria-label="关闭" onClick={onClose}>
            <IconX className="neo-publish-picker__close-icon" size={16} />
          </button>
        </header>

        <div className="neo-publish-picker__content">
          {tab === 'project' ? (
            <div className="neo-publish-picker__list">
              {projects.map((project) => {
                const selected = draft?.kind === 'project' && draft.projectId === project.id
                const coverUrl = projectCovers[project.id] || project.templateCoverUrl?.trim() || ''
                return (
                  <button
                    key={project.id}
                    className={`neo-publish-picker__item${selected ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft({ kind: 'project', projectId: project.id })}
                  >
                    <span className="neo-publish-picker__thumbnail">
                      {coverUrl ? (
                        <ManagedImage className="neo-publish-picker__image" src={coverUrl} alt={project.name} priority="visible" />
                      ) : (
                        <IconVideoPlus className="neo-publish-picker__placeholder" size={30} stroke={1.3} />
                      )}
                    </span>
                    <span className="neo-publish-picker__copy">
                      <strong className="neo-publish-picker__name">{project.name || '未命名项目'}</strong>
                      <span className="neo-publish-picker__date">{formatDate(project.updatedAt)}</span>
                    </span>
                    <span className="neo-publish-picker__check" aria-hidden="true">
                      {selected ? <IconCheck className="neo-publish-picker__check-icon" size={14} /> : null}
                    </span>
                  </button>
                )
              })}
              {projects.length === 0 ? <div className="neo-publish-picker__empty">暂无可选项目</div> : null}
            </div>
          ) : tab === 'chapter' ? (
            <div className="neo-publish-picker__chapters">
              {projects.length > 0 ? (
                <div className="neo-publish-picker__project-field">
                  <span className="neo-publish-picker__project-label">项目</span>
                  <Select
                    className="neo-publish-picker__project-select"
                    classNames={{
                      input: 'neo-publish-picker__project-select-input',
                      dropdown: 'neo-publish-picker__project-select-dropdown',
                      option: 'neo-publish-picker__project-select-option',
                    }}
                    aria-label="项目"
                    data={projects.map((project) => ({ value: project.id, label: project.name || '未命名项目' }))}
                    value={chapterProjectId}
                    onChange={(nextValue) => {
                      const nextProjectId = nextValue ?? ''
                      setChapterProjectId(nextProjectId)
                      setDraft((current) => current?.kind === 'chapter' && current.projectId !== nextProjectId ? null : current)
                    }}
                    searchable={projects.length > 8}
                    nothingFoundMessage="没有匹配项目"
                    allowDeselect={false}
                    comboboxProps={{ withinPortal: true, zIndex: 12_100 }}
                    size="sm"
                  />
                </div>
              ) : null}

              <div className="neo-publish-picker__chapter-list">
                {projects.length === 0 ? <div className="neo-publish-picker__empty">暂无可选项目</div> : null}
                {projects.length > 0 && chapterProjectId && (!chapterStateMatchesProject || chapterState.loading) ? (
                  <div className="neo-publish-picker__empty">正在加载章节</div>
                ) : null}
                {chapterStateMatchesProject && chapterState.error ? (
                  <div className="neo-publish-picker__empty neo-publish-picker__empty--error" role="alert">
                    <span className="neo-publish-picker__error-message">{chapterState.error}</span>
                    <button
                      className="neo-publish-picker__retry"
                      type="button"
                      aria-label="重新加载章节"
                      title="重新加载章节"
                      onClick={() => setChapterReloadKey((key) => key + 1)}
                    >
                      <IconRefresh className="neo-publish-picker__retry-icon" size={16} />
                    </button>
                  </div>
                ) : null}
                {chapterStateMatchesProject && !chapterState.loading && !chapterState.error && chapterProjectId && chapterState.items.map((chapter) => {
                  const selected = draft?.kind === 'chapter' && draft.chapterId === chapter.id
                  const chapterNumber = chapter.index + 1
                  return (
                    <button
                      className={`neo-publish-picker__chapter${selected ? ' is-selected' : ''}`}
                      key={chapter.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setDraft({
                        kind: 'chapter',
                        projectId: chapter.projectId,
                        chapterId: chapter.id,
                        chapterTitle: chapter.title || `第${chapterNumber}章`,
                        chapterIndex: chapter.index,
                      })}
                    >
                      <span className="neo-publish-picker__chapter-icon" aria-hidden="true">
                        <IconBook2 className="neo-publish-picker__chapter-icon-svg" size={18} />
                      </span>
                      <span className="neo-publish-picker__copy">
                        <strong className="neo-publish-picker__name">{chapter.title || `第${chapterNumber}章`}</strong>
                        <span className="neo-publish-picker__date">第{chapterNumber}章</span>
                      </span>
                      <span className="neo-publish-picker__check" aria-hidden="true">
                        {selected ? <IconCheck className="neo-publish-picker__check-icon" size={14} /> : null}
                      </span>
                    </button>
                  )
                })}
                {chapterStateMatchesProject && !chapterState.loading && !chapterState.error && chapterProjectId && chapterState.items.length === 0 ? (
                  <div className="neo-publish-picker__empty">该项目暂无章节</div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="neo-publish-picker__list">
              {shortFilmsLoading ? <div className="neo-publish-picker__empty">正在加载我的短片</div> : null}
              {shortFilmsError ? <div className="neo-publish-picker__empty neo-publish-picker__empty--error">{shortFilmsError}</div> : null}
              {!shortFilmsLoading && !shortFilmsError ? shortFilms.map((film) => {
                const selected = draft?.kind === 'film' && draft.id === film.id
                return (
                  <button
                    key={film.id}
                    className={`neo-publish-picker__item${selected ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft({ kind: 'film', id: film.id })}
                  >
                    <span className="neo-publish-picker__thumbnail">
                      {film.thumbnailUrl ? (
                        <ManagedImage className="neo-publish-picker__image" src={film.thumbnailUrl} alt={film.name} priority="visible" />
                      ) : (
                        <IconMovie className="neo-publish-picker__placeholder" size={30} stroke={1.3} />
                      )}
                    </span>
                    <span className="neo-publish-picker__copy">
                      <strong className="neo-publish-picker__name">{film.name}</strong>
                      <span className="neo-publish-picker__date">{formatDate(film.createdAt)}</span>
                    </span>
                    <span className="neo-publish-picker__check" aria-hidden="true">
                      {selected ? <IconCheck className="neo-publish-picker__check-icon" size={14} /> : null}
                    </span>
                  </button>
                )
              }) : null}
              {!shortFilmsLoading && !shortFilmsError && shortFilms.length === 0 ? (
                <div className="neo-publish-picker__empty">暂无已生成短片</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="neo-publish-picker__actions">
          <button className="neo-publish-picker__cancel" type="button" onClick={onClose}>取消</button>
          <button
            className="neo-publish-picker__continue"
            type="button"
            disabled={!draftMatchesTab}
            onClick={() => {
              if (draft && draftMatchesTab) onConfirm(draft)
            }}
          >
            确认选择
          </button>
        </div>
      </div>
    </Modal>
  )
}
