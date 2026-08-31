import React from 'react'
import {
  IconCheck,
  IconFolder,
  IconLayoutGrid,
  IconPlus,
  IconTopologyStar3,
  IconX,
} from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import type { ProjectFsFolderNode } from '../projects/projectFs'
import { ProjectCardActionsMenu } from './ProjectCardActionsMenu'

export type CanvasHubCardSize = 'small' | 'medium' | 'large'

export type CanvasHubFolderEntry = {
  node: ProjectFsFolderNode
  childCount: number
}

export type CanvasHubProjectEntry = {
  nodeId: string
  project: ProjectDto
  cover: string
  location: string | null
}

export type CanvasHubProjectGridProps = {
  cardSize: CanvasHubCardSize
  authenticated: boolean
  loading: boolean
  creatingProject: boolean
  directorySaving: boolean
  directoryConflicted: boolean
  showFolderComposer: boolean
  sharingProjectId: string | null
  managingProjectId: string | null
  shareAvailable: boolean
  folders: CanvasHubFolderEntry[]
  projects: CanvasHubProjectEntry[]
  dragNodeId: string | null
  onDragNodeChange: (nodeId: string | null) => void
  onCreateProject: () => void
  onCloseFolderComposer: () => void
  onCreateFolder: (name: string) => Promise<boolean>
  onOpenFolder: (folderId: string) => void
  canMoveNode: (nodeId: string, folderId: string) => boolean
  onMoveNode: (nodeId: string, folderId: string) => Promise<boolean>
  onOpenProject: (projectId: string) => void
  onRenameProject: (project: ProjectDto) => void
  onDeleteProject: (project: ProjectDto) => void
  onToggleShare: (project: ProjectDto) => Promise<void>
}

const PROJECT_SKELETON_KEYS = [
  'canvas-a',
  'canvas-b',
  'canvas-c',
  'canvas-d',
  'canvas-e',
  'canvas-f',
  'canvas-g',
] as const

const DIRECTORY_NODE_MIME = 'application/x-tapcanvas-project-directory-node'

function formatProjectDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间无效'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function CanvasHubProjectGrid({
  cardSize,
  authenticated,
  loading,
  creatingProject,
  directorySaving,
  directoryConflicted,
  showFolderComposer,
  sharingProjectId,
  managingProjectId,
  shareAvailable,
  folders,
  projects,
  dragNodeId,
  onDragNodeChange,
  onCreateProject,
  onCloseFolderComposer,
  onCreateFolder,
  onOpenFolder,
  canMoveNode,
  onMoveNode,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onToggleShare,
}: CanvasHubProjectGridProps): JSX.Element {
  const [folderDraft, setFolderDraft] = React.useState('')
  const [folderError, setFolderError] = React.useState('')
  const [dropFolderId, setDropFolderId] = React.useState<string | null>(null)
  const directoryBusy = directorySaving || directoryConflicted

  React.useEffect(() => {
    if (!showFolderComposer) {
      setFolderDraft('')
      setFolderError('')
    }
  }, [showFolderComposer])

  const submitFolder = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const name = folderDraft.trim()
    if (!name) {
      setFolderError('分组名称不能为空')
      return
    }
    const created = await onCreateFolder(name)
    if (created) {
      setFolderDraft('')
      setFolderError('')
      onCloseFolderComposer()
    }
  }

  const beginDrag = (event: React.DragEvent<HTMLElement>, nodeId: string): void => {
    if (directoryBusy) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData(DIRECTORY_NODE_MIME, nodeId)
    event.dataTransfer.effectAllowed = 'move'
    onDragNodeChange(nodeId)
  }

  const finishDrag = (): void => {
    setDropFolderId(null)
    onDragNodeChange(null)
  }

  return (
    <section className={`canvas-hub-grid is-${cardSize}`} aria-label="画布列表" aria-busy={loading || directorySaving}>
      <button className="canvas-hub-card canvas-hub-card--create" type="button" disabled={creatingProject} onClick={onCreateProject}>
        <span className="canvas-hub-card__create-icon"><IconPlus className="canvas-hub-card__plus" size={20} /></span>
        <span className="canvas-hub-card__create-text">新建无限画布</span>
      </button>

      {showFolderComposer ? (
        <form className="canvas-hub-card canvas-hub-folder-form" onSubmit={(event) => void submitFolder(event)}>
          <IconFolder className="canvas-hub-folder-form__icon" size={28} stroke={1.5} />
          <input
            className="canvas-hub-folder-form__input"
            value={folderDraft}
            autoFocus
            maxLength={120}
            placeholder="分组名称"
            aria-label="新分组名称"
            aria-invalid={Boolean(folderError)}
            onChange={(event) => {
              setFolderDraft(event.currentTarget.value)
              setFolderError('')
            }}
          />
          <div className="canvas-hub-folder-form__actions">
            <button className="canvas-hub-folder-form__action" type="submit" aria-label="创建分组" disabled={directorySaving}>
              <IconCheck className="canvas-hub-folder-form__action-icon" size={15} />
            </button>
            <button className="canvas-hub-folder-form__action" type="button" aria-label="取消创建分组" onClick={onCloseFolderComposer}>
              <IconX className="canvas-hub-folder-form__action-icon" size={15} />
            </button>
          </div>
          {folderError ? <span className="canvas-hub-folder-form__error" role="alert">{folderError}</span> : null}
        </form>
      ) : null}

      {loading ? PROJECT_SKELETON_KEYS.map((key) => (
        <div className="canvas-hub-card canvas-hub-card--skeleton" aria-hidden="true" key={key}>
          <span className="canvas-hub-card__media tc-portal-skeleton" />
          <span className="canvas-hub-card__info">
            <span className="canvas-hub-card__name-skeleton tc-portal-skeleton" />
            <span className="canvas-hub-card__meta-skeleton tc-portal-skeleton" />
          </span>
        </div>
      )) : null}

      {!loading && authenticated ? folders.map(({ node, childCount }) => {
        const canDrop = Boolean(dragNodeId && canMoveNode(dragNodeId, node.id))
        return (
          <article
            className={`canvas-hub-card canvas-hub-folder-card${dropFolderId === node.id ? ' is-drop-target' : ''}`}
            key={node.id}
            draggable={!directoryBusy}
            aria-label={`分组：${node.name}`}
            onDragStart={(event) => beginDrag(event, node.id)}
            onDragEnd={finishDrag}
            onDragOver={(event) => {
              if (!canDrop) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropFolderId(node.id)
            }}
            onDragLeave={() => setDropFolderId((current) => current === node.id ? null : current)}
            onDrop={(event) => {
              event.preventDefault()
              setDropFolderId(null)
              const sourceNodeId = event.dataTransfer.getData(DIRECTORY_NODE_MIME) || dragNodeId
              if (sourceNodeId && canMoveNode(sourceNodeId, node.id)) {
                void onMoveNode(sourceNodeId, node.id)
              }
            }}
          >
            <button className="canvas-hub-folder-card__open" type="button" onClick={() => onOpenFolder(node.id)}>
              <span className="canvas-hub-folder-card__glyph">
                <IconFolder className="canvas-hub-folder-card__icon" size={38} stroke={1.35} />
              </span>
              <span className="canvas-hub-folder-card__content">
                <strong className="canvas-hub-folder-card__name">{node.name}</strong>
                <span className="canvas-hub-folder-card__meta">{childCount} 项内容</span>
              </span>
            </button>
          </article>
        )
      }) : null}

      {!loading && authenticated ? projects.map(({ nodeId, project, cover, location }) => {
        const collaborative = project.access === 'team_edit' || Boolean(project.teamShared)
        const owner = project.access !== 'team_edit'
        const sharing = sharingProjectId === project.id
        const managing = managingProjectId === project.id
        return (
          <article
            className="canvas-hub-card"
            key={project.id}
            draggable={!directoryBusy}
            aria-label={`画布：${project.name}`}
            onDragStart={(event) => beginDrag(event, nodeId)}
            onDragEnd={finishDrag}
          >
            <button className="canvas-hub-card__open" type="button" onClick={() => onOpenProject(project.id)}>
              <span className="canvas-hub-card__media">
                {cover ? (
                  <ManagedImage className="canvas-hub-card__image" src={cover} alt={project.name} priority="visible" />
                ) : (
                  <span className="canvas-hub-card__placeholder"><IconLayoutGrid className="canvas-hub-card__placeholder-icon" size={48} stroke={1} /></span>
                )}
                {collaborative ? <span className="canvas-hub-card__collab">协作</span> : null}
                {project.projectKind === 'ai_workflow' ? <span className="canvas-hub-card__ai-workflow"><IconTopologyStar3 className="canvas-hub-card__ai-workflow-icon" size={11} />AI 编排</span> : null}
              </span>
              <span className="canvas-hub-card__info">
                <strong className="canvas-hub-card__name">{project.name}</strong>
                {location ? <span className="canvas-hub-card__location">{location}</span> : null}
                <span className="canvas-hub-card__meta">编辑于 {formatProjectDate(project.updatedAt)}</span>
              </span>
            </button>
            {owner ? (
              <ProjectCardActionsMenu
                project={project}
                managing={managing}
                sharing={sharing}
                shareAvailable={shareAvailable}
                onRename={onRenameProject}
                onDelete={onDeleteProject}
                onToggleShare={onToggleShare}
              />
            ) : null}
          </article>
        )
      }) : null}
    </section>
  )
}
