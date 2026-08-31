import React from 'react'
import {
  cloneProject,
  listPublicProjects,
  type ProjectDto,
} from '../api/server'
import { LoginModal } from '../auth/LoginModal'
import { useAuth } from '../auth/store'
import {
  buildProjectFsIndex,
  pathToRoot,
  type ProjectFsFolderNode,
} from '../projects/projectFs'
import { toast } from '../ui/toast'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { useRouteNavigationLease, type RouteNavigationLease } from '../utils/useRouteNavigationLease'
import { PortalHeader } from './PortalHeader'
import { useHomepagePreviewSnapshot } from './homepagePreviewSnapshot'
import { PortalFooter } from './PortalFooter'
import { useProjectLibrary } from './useProjectLibrary'
import { useProjectDirectory } from './useProjectDirectory'
import { useProjectManagementActions } from './useProjectManagementActions'
import { ProjectRenameModal } from './ProjectRenameModal'
import { CanvasHubDirectoryBar } from './CanvasHubDirectoryBar'
import {
  CanvasHubTemplateRail,
  isConfiguredCanvasTemplate,
  type ConfiguredCanvasTemplate,
} from './CanvasHubTemplateRail'
import { CanvasHubToolbar } from './CanvasHubToolbar'
import {
  CanvasHubProjectGrid,
  type CanvasHubCardSize,
  type CanvasHubFolderEntry,
  type CanvasHubProjectEntry,
} from './CanvasHubProjectGrid'
import type { ProjectScope } from './NeoTvProjectShelf'
import './portal.css'
import './CanvasHubPage.css'
import './CanvasHubProjectDirectory.css'

const PAGE_SIZE = 24

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

type PendingProjectPlacement = {
  project: ProjectDto
  folderId: string
  message: string
}

export default function CanvasHubPage(): JSX.Element {
  const previewSnapshot = useHomepagePreviewSnapshot()
  const auth = useAuth()
  const acquireRouteNavigationLease = useRouteNavigationLease()
  const [scope, setScope] = React.useState<ProjectScope>('all')
  const [query, setQuery] = React.useState('')
  const [cardSize, setCardSize] = React.useState<CanvasHubCardSize>('medium')
  const [page, setPage] = React.useState(1)
  const [creating, setCreating] = React.useState(false)
  const [cloningTemplateId, setCloningTemplateId] = React.useState<string | null>(null)
  const [activeFolderId, setActiveFolderId] = React.useState('root')
  const [showFolderComposer, setShowFolderComposer] = React.useState(false)
  const [dragNodeId, setDragNodeId] = React.useState<string | null>(null)
  const [pendingPlacement, setPendingPlacement] = React.useState<PendingProjectPlacement | null>(null)
  const [loginOpen, setLoginOpen] = React.useState(false)
  const [templates, setTemplates] = React.useState<ConfiguredCanvasTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = React.useState(true)
  const [templatesError, setTemplatesError] = React.useState('')
  const previewTemplates = React.useMemo(() => {
    if (!previewSnapshot) return templates
    return templates
      .map((template, index) => ({ template, index }))
      .sort((left, right) => (
        (previewSnapshot.templateWeights[right.template.id] ?? 0)
        - (previewSnapshot.templateWeights[left.template.id] ?? 0)
        || left.index - right.index
      ))
      .map(({ template }) => template)
  }, [previewSnapshot, templates])
  const projectLibrary = useProjectLibrary(auth.token, 36)
  const {
    projects,
    projectCovers,
    loading,
    error,
    createProject,
    registerProject,
    unregisterProject,
    reload: reloadProjects,
  } = projectLibrary
  const directory = useProjectDirectory(auth.token, projects)
  const projectActions = useProjectManagementActions({
    directory,
    registerProject,
    unregisterProject,
    reloadProjects,
  })

  React.useEffect(() => {
    let active = true
    setTemplatesLoading(true)
    listPublicProjects()
      .then((items) => {
        if (!active) return
        setTemplates(items.filter(isConfiguredCanvasTemplate).slice(0, 12))
        setTemplatesError('')
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setTemplates([])
        setTemplatesError(resolveErrorMessage(loadError, '公开模板加载失败'))
      })
      .finally(() => {
        if (active) setTemplatesLoading(false)
      })
    return () => { active = false }
  }, [])

  const directoryIndex = React.useMemo(
    () => directory.state ? buildProjectFsIndex(directory.state) : null,
    [directory.state],
  )

  React.useEffect(() => {
    const state = directory.state
    if (!state) return
    const activeFolder = state.nodesById[activeFolderId]
    if (!activeFolder || activeFolder.kind !== 'folder') setActiveFolderId(state.rootId)
  }, [activeFolderId, directory.state])

  const directoryPath = React.useMemo((): ProjectFsFolderNode[] => {
    if (!directory.state) return []
    return pathToRoot(directory.state, activeFolderId)
  }, [activeFolderId, directory.state])

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const folderEntries = React.useMemo((): CanvasHubFolderEntry[] => {
    if (!directory.state || !directoryIndex || normalizedQuery) return []
    return (directoryIndex.childrenByFolderId.get(activeFolderId) ?? [])
      .filter((node): node is ProjectFsFolderNode => node.kind === 'folder')
      .map((node) => ({
        node,
        childCount: directoryIndex.childrenByFolderId.get(node.id)?.length ?? 0,
      }))
  }, [activeFolderId, directory.state, directoryIndex, normalizedQuery])

  const visibleProjectEntries = React.useMemo((): CanvasHubProjectEntry[] => {
    const directoryState = directory.state
    if (!directoryState || !directoryIndex) return []
    return projects.flatMap((project): CanvasHubProjectEntry[] => {
      const collaborative = project.access === 'team_edit' || Boolean(project.teamShared)
      const matchesScope = scope === 'all'
        || (scope === 'collab' && collaborative)
        || (scope === 'personal' && !collaborative)
      if (!matchesScope || (normalizedQuery && !project.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery))) {
        return []
      }
      const node = directoryIndex.projectNodeByProjectId.get(project.id)
      if (!node || (!normalizedQuery && node.parentId !== activeFolderId)) return []
      const location = normalizedQuery
        ? pathToRoot(directoryState, node.parentId).map((folder) => folder.name).join(' / ')
        : null
      return [{
        nodeId: node.id,
        project,
        cover: projectCovers[project.id] || project.templateCoverUrl?.trim() || '',
        location,
      }]
    })
  }, [activeFolderId, directory.state, directoryIndex, normalizedQuery, projectCovers, projects, scope])

  const pageCount = Math.max(1, Math.ceil(visibleProjectEntries.length / PAGE_SIZE))
  const pageProjects = React.useMemo(
    () => visibleProjectEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, visibleProjectEntries],
  )
  React.useEffect(() => setPage(1), [activeFolderId, query, scope])
  React.useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount])
  React.useEffect(() => setShowFolderComposer(false), [activeFolderId])

  const placeCreatedProject = React.useCallback(async (
    project: ProjectDto,
    folderId: string,
    navigationLease: RouteNavigationLease,
  ): Promise<boolean> => {
    try {
      await directory.placeProject(folderId, project)
      if (!navigationLease.isCurrent()) return true
      setPendingPlacement(null)
      spaNavigate(buildStudioUrl({
        projectId: project.id,
        ownerType: 'project',
        ownerId: project.id,
      }))
      return true
    } catch (placementError: unknown) {
      const message = resolveErrorMessage(placementError, '保存画布分组失败')
      setPendingPlacement({ project, folderId, message })
      toast(`画布已创建，但保存到分组失败：${message}`, 'error')
      return false
    }
  }, [directory])

  const handleCreate = React.useCallback(() => {
    if (!auth.token) {
      setLoginOpen(true)
      return
    }
    if (creating) return
    const navigationLease = acquireRouteNavigationLease()
    setCreating(true)
    void (async () => {
      try {
        const project = await createProject('未命名画布')
        await placeCreatedProject(project, activeFolderId, navigationLease)
      } catch (createError: unknown) {
        toast(resolveErrorMessage(createError, '新建画布失败'), 'error')
      } finally {
        setCreating(false)
      }
    })()
  }, [acquireRouteNavigationLease, activeFolderId, auth.token, createProject, creating, placeCreatedProject])

  const handleUseTemplate = React.useCallback((template: ProjectDto) => {
    if (!auth.token) {
      setLoginOpen(true)
      return
    }
    if (cloningTemplateId) return
    const navigationLease = acquireRouteNavigationLease()
    setCloningTemplateId(template.id)
    void (async () => {
      try {
        const project = await cloneProject(template.id, template.templateTitle?.trim() || template.name)
        registerProject(project)
        await placeCreatedProject(project, activeFolderId, navigationLease)
      } catch (cloneError: unknown) {
        toast(resolveErrorMessage(cloneError, '模板克隆失败'), 'error')
      } finally {
        setCloningTemplateId(null)
      }
    })()
  }, [acquireRouteNavigationLease, activeFolderId, auth.token, cloningTemplateId, placeCreatedProject, registerProject])

  const handleCreateFolder = React.useCallback(async (name: string): Promise<boolean> => {
    try {
      await directory.createFolder(activeFolderId, name)
      toast('分组已创建', 'success')
      return true
    } catch (folderError: unknown) {
      toast(resolveErrorMessage(folderError, '创建分组失败'), 'error')
      return false
    }
  }, [activeFolderId, directory])

  const handleRenameCurrentFolder = React.useCallback(async (name: string): Promise<boolean> => {
    try {
      await directory.renameFolder(activeFolderId, name)
      toast('分组已重命名', 'success')
      return true
    } catch (renameError: unknown) {
      toast(resolveErrorMessage(renameError, '重命名分组失败'), 'error')
      return false
    }
  }, [activeFolderId, directory])

  const handleDeleteCurrentFolder = React.useCallback(async (): Promise<boolean> => {
    const currentFolder = directory.state?.nodesById[activeFolderId]
    if (!currentFolder || currentFolder.kind !== 'folder' || !currentFolder.parentId) return false
    try {
      await directory.deleteFolder(activeFolderId)
      setActiveFolderId(currentFolder.parentId)
      toast('空分组已删除', 'success')
      return true
    } catch (deleteError: unknown) {
      toast(resolveErrorMessage(deleteError, '删除分组失败'), 'error')
      return false
    }
  }, [activeFolderId, directory])

  const handleMoveNode = React.useCallback(async (
    nodeId: string,
    folderId: string,
  ): Promise<boolean> => {
    try {
      await directory.moveNode(nodeId, folderId)
      toast('已移动到目标分组', 'success')
      return true
    } catch (moveError: unknown) {
      toast(resolveErrorMessage(moveError, '移动分组内容失败'), 'error')
      return false
    }
  }, [directory])

  const retryPendingPlacement = React.useCallback(async (): Promise<void> => {
    if (!pendingPlacement) return
    const navigationLease = acquireRouteNavigationLease()
    await placeCreatedProject(pendingPlacement.project, pendingPlacement.folderId, navigationLease)
  }, [acquireRouteNavigationLease, pendingPlacement, placeCreatedProject])

  return (
    <div className="canvas-hub-page">
      <PortalHeader active="projects" />
      <div className="tc-portal-scroll-area">
        <main className="canvas-hub-main">
        <CanvasHubTemplateRail
          templates={previewTemplates}
          loading={templatesLoading}
          error={templatesError}
          cloningTemplateId={cloningTemplateId}
          onUseTemplate={handleUseTemplate}
        />

        <CanvasHubToolbar
          scope={scope}
          cardSize={cardSize}
          query={query}
          authenticated={Boolean(auth.token)}
          creating={creating}
          directoryReady={Boolean(directory.state)}
          directorySaving={directory.saving}
          directoryConflicted={directory.conflicted}
          onScopeChange={setScope}
          onCardSizeChange={setCardSize}
          onQueryChange={setQuery}
          onCreateProject={handleCreate}
          onToggleFolderComposer={() => setShowFolderComposer((currentValue) => !currentValue)}
        />

        {error ? <div className="canvas-hub-state is-error" role="alert">{error}</div> : null}
        {pendingPlacement ? (
          <div className="canvas-hub-partial" role="alert">
            <span className="canvas-hub-partial__message">
              画布“{pendingPlacement.project.name}”已创建，但尚未保存到目标分组：{pendingPlacement.message}
            </span>
            <div className="canvas-hub-partial__actions">
              <button className="canvas-hub-partial__action" type="button" disabled={directory.saving} onClick={() => void retryPendingPlacement()}>
                重试保存分组
              </button>
              <button
                className="canvas-hub-partial__action is-secondary"
                type="button"
                onClick={() => {
                  const projectId = pendingPlacement.project.id
                  setPendingPlacement(null)
                  spaNavigate(buildStudioUrl({ projectId }))
                }}
              >
                仍然打开画布
              </button>
            </div>
          </div>
        ) : null}
        {projectActions.pendingCleanup ? (
          <div className="canvas-hub-partial" role="alert">
            <span className="canvas-hub-partial__message">
              画布“{projectActions.pendingCleanup.projectName}”已删除，但分组目录记录尚未清理：{projectActions.pendingCleanup.message}
            </span>
            <div className="canvas-hub-partial__actions">
              <button
                className="canvas-hub-partial__action"
                type="button"
                disabled={directory.saving}
                onClick={() => void projectActions.retryPendingCleanup()}
              >
                重试清理
              </button>
            </div>
          </div>
        ) : null}
        {!loading && !auth.token ? (
          <div className="canvas-hub-state canvas-hub-state--login">
            <span className="canvas-hub-state__text">登录后查看和继续你的画布</span>
            <button className="canvas-hub-state__action" type="button" onClick={() => setLoginOpen(true)}>登录</button>
          </div>
        ) : null}
        {auth.token && directory.loading ? (
          <div className="canvas-hub-directory-loading" role="status">正在加载项目分组</div>
        ) : null}
        {auth.token && !directory.loading && !directory.state && directory.error ? (
          <div className="canvas-hub-directory-failure" role="alert">
            <span className="canvas-hub-directory-failure__message">{directory.error}</span>
            <button className="canvas-hub-directory-failure__retry" type="button" onClick={directory.retry}>重新加载分组</button>
          </div>
        ) : null}
        {auth.token && directory.state ? (
          <CanvasHubDirectoryBar
            path={directoryPath}
            saving={directory.saving}
            conflicted={directory.conflicted}
            error={directory.error}
            dragNodeId={dragNodeId}
            onNavigate={setActiveFolderId}
            canMoveNode={directory.canMoveNode}
            onMoveNode={handleMoveNode}
            onRenameCurrent={handleRenameCurrentFolder}
            onDeleteCurrent={handleDeleteCurrentFolder}
            onRetry={directory.retry}
          />
        ) : null}
        {!loading
          && auth.token
          && directory.state
          && folderEntries.length === 0
          && visibleProjectEntries.length === 0
          && !error
          && !directory.error ? (
            <div className="canvas-hub-state">{normalizedQuery ? '没有匹配的画布' : '当前分组还没有画布'}</div>
          ) : null}

        {!auth.token || directory.state ? (
          <CanvasHubProjectGrid
            cardSize={cardSize}
            authenticated={Boolean(auth.token)}
            loading={loading || directory.loading}
            creatingProject={creating}
            directorySaving={directory.saving}
            directoryConflicted={directory.conflicted}
            showFolderComposer={Boolean(auth.token && showFolderComposer)}
            sharingProjectId={projectActions.sharingProjectId}
            managingProjectId={projectActions.managingProjectId}
            shareAvailable={projectActions.shareAvailable}
            folders={folderEntries}
            projects={pageProjects}
            dragNodeId={dragNodeId}
            onDragNodeChange={setDragNodeId}
            onCreateProject={handleCreate}
            onCloseFolderComposer={() => setShowFolderComposer(false)}
            onCreateFolder={handleCreateFolder}
            onOpenFolder={setActiveFolderId}
            canMoveNode={directory.canMoveNode}
            onMoveNode={handleMoveNode}
            onOpenProject={(projectId) => spaNavigate(buildStudioUrl({ projectId }))}
            onRenameProject={projectActions.renameProject}
            onDeleteProject={projectActions.deleteProject}
            onToggleShare={projectActions.toggleShare}
          />
        ) : null}

        {auth.token && pageCount > 1 ? (
          <nav className="canvas-hub-pagination" aria-label="画布分页">
            <button className="canvas-hub-pagination__button" type="button" disabled={page <= 1} aria-label="上一页" onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
            <span className="canvas-hub-pagination__info">{page} / {pageCount}</span>
            <button className="canvas-hub-pagination__button" type="button" disabled={page >= pageCount} aria-label="下一页" onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>›</button>
          </nav>
          ) : null}
        </main>
        <PortalFooter />
      </div>
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />
      <ProjectRenameModal
        project={projectActions.renameTarget}
        draft={projectActions.renameDraft}
        busy={projectActions.managingProjectId === projectActions.renameTarget?.id}
        onDraftChange={projectActions.setRenameDraft}
        onClose={projectActions.closeRename}
        onSubmit={projectActions.submitRename}
      />
    </div>
  )
}
