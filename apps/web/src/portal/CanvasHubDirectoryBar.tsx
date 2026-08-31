import React from 'react'
import {
  IconCheck,
  IconChevronRight,
  IconEdit,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import type { ProjectFsFolderNode } from '../projects/projectFs'

export type CanvasHubDirectoryBarProps = {
  path: ProjectFsFolderNode[]
  saving: boolean
  conflicted: boolean
  error: string
  dragNodeId: string | null
  onNavigate: (folderId: string) => void
  canMoveNode: (nodeId: string, folderId: string) => boolean
  onMoveNode: (nodeId: string, folderId: string) => Promise<boolean>
  onRenameCurrent: (name: string) => Promise<boolean>
  onDeleteCurrent: () => Promise<boolean>
  onRetry: () => void
}

export function CanvasHubDirectoryBar({
  path,
  saving,
  conflicted,
  error,
  dragNodeId,
  onNavigate,
  canMoveNode,
  onMoveNode,
  onRenameCurrent,
  onDeleteCurrent,
  onRetry,
}: CanvasHubDirectoryBarProps): JSX.Element | null {
  const currentFolder = path[path.length - 1]
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [inputError, setInputError] = React.useState('')
  const [dropFolderId, setDropFolderId] = React.useState<string | null>(null)

  React.useEffect(() => {
    setEditing(false)
    setDraft(currentFolder?.name ?? '')
    setInputError('')
  }, [currentFolder?.id, currentFolder?.name])

  if (!currentFolder) return null
  const isRoot = currentFolder.parentId === null

  const submitRename = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const name = draft.trim()
    if (!name) {
      setInputError('分组名称不能为空')
      return
    }
    const renamed = await onRenameCurrent(name)
    if (renamed) {
      setEditing(false)
      setInputError('')
    }
  }

  const deleteCurrent = async (): Promise<void> => {
    const confirmed = window.confirm(`删除空分组“${currentFolder.name}”？`)
    if (!confirmed) return
    await onDeleteCurrent()
  }

  return (
    <section className="canvas-hub-directory" aria-label="画布分组导航">
      <div className="canvas-hub-directory__row">
        <nav className="canvas-hub-breadcrumbs" aria-label="当前分组路径">
          {path.map((folder, index) => {
            const canDrop = Boolean(dragNodeId && canMoveNode(dragNodeId, folder.id))
            return (
              <React.Fragment key={folder.id}>
                {index > 0 ? <IconChevronRight className="canvas-hub-breadcrumbs__separator" size={13} /> : null}
                <button
                  className={`canvas-hub-breadcrumbs__item${dropFolderId === folder.id ? ' is-drop-target' : ''}`}
                  type="button"
                  aria-current={folder.id === currentFolder.id ? 'page' : undefined}
                  onClick={() => onNavigate(folder.id)}
                  onDragOver={(event) => {
                    if (!canDrop) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropFolderId(folder.id)
                  }}
                  onDragLeave={() => setDropFolderId((current) => current === folder.id ? null : current)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDropFolderId(null)
                    if (dragNodeId && canDrop) void onMoveNode(dragNodeId, folder.id)
                  }}
                >
                  {folder.name}
                </button>
              </React.Fragment>
            )
          })}
        </nav>

        <div className="canvas-hub-directory__actions">
          {saving ? <span className="canvas-hub-directory__saving" role="status">正在保存分组</span> : null}
          {!isRoot && !editing ? (
            <button
              className="canvas-hub-directory__action"
              type="button"
              aria-label="重命名当前分组"
              title="重命名分组"
              disabled={saving || conflicted}
              onClick={() => {
                setDraft(currentFolder.name)
                setEditing(true)
              }}
            >
              <IconEdit className="canvas-hub-directory__action-icon" size={15} />
            </button>
          ) : null}
          {!isRoot ? (
            <button
              className="canvas-hub-directory__action is-danger"
              type="button"
              aria-label="删除当前空分组"
              title="删除空分组"
              disabled={saving || conflicted}
              onClick={() => void deleteCurrent()}
            >
              <IconTrash className="canvas-hub-directory__action-icon" size={15} />
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form className="canvas-hub-directory__rename" onSubmit={(event) => void submitRename(event)}>
          <input
            className="canvas-hub-directory__rename-input"
            value={draft}
            autoFocus
            maxLength={120}
            aria-label="分组名称"
            aria-invalid={Boolean(inputError)}
            onChange={(event) => {
              setDraft(event.currentTarget.value)
              setInputError('')
            }}
          />
          <button className="canvas-hub-directory__rename-action" type="submit" aria-label="保存分组名称" disabled={saving}>
            <IconCheck className="canvas-hub-directory__rename-icon" size={15} />
          </button>
          <button className="canvas-hub-directory__rename-action" type="button" aria-label="取消重命名" onClick={() => setEditing(false)}>
            <IconX className="canvas-hub-directory__rename-icon" size={15} />
          </button>
          {inputError ? <span className="canvas-hub-directory__rename-error" role="alert">{inputError}</span> : null}
        </form>
      ) : null}

      {error ? (
        <div className="canvas-hub-directory__error" role="alert">
          <span className="canvas-hub-directory__error-text">{error}</span>
          <button className="canvas-hub-directory__retry" type="button" disabled={saving} onClick={onRetry}>
            <IconRefresh className="canvas-hub-directory__retry-icon" size={14} />
            <span className="canvas-hub-directory__retry-label">重新加载</span>
          </button>
        </div>
      ) : null}
    </section>
  )
}
