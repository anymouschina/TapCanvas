import React from 'react'
import { IconLayoutGrid, IconPlus, IconSearch } from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { ProjectCardActionsMenu } from './ProjectCardActionsMenu'

export type ProjectScope = 'all' | 'personal' | 'collab'
const PROJECT_SKELETON_KEYS = ['project-a', 'project-b', 'project-c'] as const

type NeoTvProjectShelfProps = {
  projects: ProjectDto[]
  projectCovers: Record<string, string>
  loading: boolean
  error: string
  signedIn: boolean
  scope: ProjectScope
  query: string
  busy: boolean
  managingProjectId: string | null
  sharingProjectId: string | null
  shareAvailable: boolean
  onScopeChange: (scope: ProjectScope) => void
  onQueryChange: (query: string) => void
  onCreate: () => void
  onLogin: () => void
  onRenameProject: (project: ProjectDto) => void
  onDeleteProject: (project: ProjectDto) => void
  onToggleShare: (project: ProjectDto) => Promise<void>
  expanded?: boolean
}

function formatProjectDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function NeoTvProjectShelf({
  projects,
  projectCovers,
  loading,
  error,
  signedIn,
  scope,
  query,
  busy,
  managingProjectId,
  sharingProjectId,
  shareAvailable,
  onScopeChange,
  onQueryChange,
  onCreate,
  onLogin,
  onRenameProject,
  onDeleteProject,
  onToggleShare,
  expanded = false,
}: NeoTvProjectShelfProps): JSX.Element {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const visibleProjects = React.useMemo(() => projects.filter((project) => {
    const matchesScope = scope === 'all'
      || (scope === 'collab' && (project.access === 'team_edit' || project.teamShared))
      || (scope === 'personal' && project.access !== 'team_edit' && !project.teamShared)
    return matchesScope && (!normalizedQuery || project.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
  }), [normalizedQuery, projects, scope])

  return (
    <section className={`neo-tv-project-shelf${expanded ? ' is-expanded' : ''}`} aria-label="我的画布">
      <header className="neo-tv-project-shelf__header">
        <div className="neo-tv-project-shelf__tabs" role="tablist" aria-label="项目范围">
          {([
            ['all', '全部'],
            ['personal', '个人'],
            ['collab', '协作'],
          ] as const).map(([value, label]) => (
            <button
              className={`neo-tv-project-shelf__tab${scope === value ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={scope === value}
              key={value}
              onClick={() => onScopeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="neo-tv-project-shelf__tools">
          <label className="neo-tv-project-shelf__search">
            <IconSearch className="neo-tv-project-shelf__search-icon" size={14} />
            <input
              className="neo-tv-project-shelf__search-input"
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="搜索"
            />
          </label>
          <button
            className="neo-tv-project-shelf__view-all"
            type="button"
            onClick={() => {
              if (expanded) {
                onScopeChange('all')
                onQueryChange('')
                return
              }
              spaNavigate('/canvas')
            }}
          >
            所有画布
            <span className="neo-tv-project-shelf__view-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </header>

      {error ? <div className="neo-tv-inline-state neo-tv-inline-state--error" role="alert">{error}</div> : null}
      {!loading && signedIn && visibleProjects.length === 0 && !error ? (
        <div className="neo-tv-inline-state">当前范围还没有画布</div>
      ) : null}

      <div className="neo-tv-project-shelf__grid" aria-busy={loading}>
        <button
          className="neo-tv-canvas-card neo-tv-canvas-card--create"
          type="button"
          disabled={busy}
          onClick={signedIn ? onCreate : onLogin}
        >
          <span className="neo-tv-canvas-card__create-icon">
            <IconPlus className="neo-tv-canvas-card__plus" size={24} />
          </span>
          <span className="neo-tv-canvas-card__create-text">新建画布</span>
        </button>
        {loading ? PROJECT_SKELETON_KEYS.map((key) => (
          <div className="neo-tv-canvas-card neo-tv-canvas-card--skeleton tc-portal-skeleton" aria-hidden="true" key={key} />
        )) : null}
        {signedIn ? visibleProjects.slice(0, expanded ? visibleProjects.length : 3).map((project) => {
          const cover = projectCovers[project.id] || project.templateCoverUrl?.trim() || ''
          return (
            <article
              className="neo-tv-canvas-card"
              key={project.id}
            >
              <button
                className="neo-tv-canvas-card__open"
                type="button"
                onClick={() => spaNavigate(buildStudioUrl({ projectId: project.id }))}
              >
                <span className="neo-tv-canvas-card__media">
                  {cover ? (
                    <ManagedImage
                      className="neo-tv-canvas-card__image"
                      src={cover}
                      alt={project.name}
                      priority="visible"
                    />
                  ) : (
                    <span className="neo-tv-canvas-card__placeholder">
                      <IconLayoutGrid className="neo-tv-canvas-card__placeholder-icon" size={42} stroke={1.1} />
                    </span>
                  )}
                  <span className="neo-tv-canvas-card__info">
                    <strong className="neo-tv-canvas-card__name">{project.name || '未命名项目'}</strong>
                    <span className="neo-tv-canvas-card__date">{formatProjectDate(project.updatedAt)}</span>
                  </span>
                </span>
              </button>
              <ProjectCardActionsMenu
                project={project}
                managing={managingProjectId === project.id}
                sharing={sharingProjectId === project.id}
                shareAvailable={shareAvailable}
                onRename={onRenameProject}
                onDelete={onDeleteProject}
                onToggleShare={onToggleShare}
              />
            </article>
          )
        }) : null}
      </div>
    </section>
  )
}
