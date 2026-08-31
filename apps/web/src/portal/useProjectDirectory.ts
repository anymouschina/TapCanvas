import React from 'react'
import type { ProjectDto } from '../api/server'
import {
  canMoveNode,
  createFolder,
  deleteEmptyFolder,
  deleteProjectNodes,
  ensureProjectNodesExist,
  moveNode,
  placeProjectNode,
  renameNode,
  renameProjectNodes,
  type ProjectFsState,
} from '../projects/projectFs'
import { loadProjectDirectory, persistProjectDirectory } from './projectDirectoryRepository'

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

const DIRECTORY_CONFLICT_CODES = new Set([
  'project_directory_create_conflict',
  'project_directory_asset_conflict',
  'project_directory_revision_conflict',
  'project_directory_multiple_sources',
])

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export type ProjectDirectoryController = {
  state: ProjectFsState | null
  loading: boolean
  saving: boolean
  conflicted: boolean
  error: string
  retry: () => void
  createFolder: (parentId: string, name: string) => Promise<void>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveNode: (nodeId: string, targetFolderId: string) => Promise<void>
  canMoveNode: (nodeId: string, targetFolderId: string) => boolean
  placeProject: (folderId: string, project: Pick<ProjectDto, 'id' | 'name'>) => Promise<void>
  renameProject: (projectId: string, name: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
}

export function useProjectDirectory(
  authToken: string | null,
  projects: Array<Pick<ProjectDto, 'id' | 'name'>>,
): ProjectDirectoryController {
  const [state, setState] = React.useState<ProjectFsState | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [conflicted, setConflicted] = React.useState(false)
  const [error, setError] = React.useState('')
  const [reloadNonce, setReloadNonce] = React.useState(0)
  const [readyRevision, setReadyRevision] = React.useState(0)
  const stateRef = React.useRef<ProjectFsState | null>(null)
  const assetIdRef = React.useRef<string | null>(null)
  const updatedAtRef = React.useRef<string | null>(null)
  const operationTailRef = React.useRef<Promise<void>>(Promise.resolve())
  const pendingOperationIdsRef = React.useRef(new Set<number>())
  const nextOperationIdRef = React.useRef(0)
  const conflictRef = React.useRef(false)
  const loadRevisionRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const projectsRef = React.useRef(projects)
  projectsRef.current = projects

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const applyState = React.useCallback((nextState: ProjectFsState | null): void => {
    stateRef.current = nextState
    setState(nextState)
  }, [])

  React.useEffect(() => {
    const revision = loadRevisionRef.current + 1
    loadRevisionRef.current = revision
    operationTailRef.current = Promise.resolve()
    pendingOperationIdsRef.current.clear()
    conflictRef.current = false
    assetIdRef.current = null
    updatedAtRef.current = null
    applyState(null)
    setError('')
    setConflicted(false)
    setSaving(false)

    if (!authToken) {
      setLoading(false)
      return
    }

    setLoading(true)
    void loadProjectDirectory()
      .then((loaded) => {
        if (!mountedRef.current || loadRevisionRef.current !== revision) return
        assetIdRef.current = loaded.assetId
        updatedAtRef.current = loaded.updatedAt
        applyState(loaded.state)
        setReadyRevision((current) => current + 1)
      })
      .catch((loadError: unknown) => {
        if (!mountedRef.current || loadRevisionRef.current !== revision) return
        applyState(null)
        setError(resolveErrorMessage(loadError, '项目目录加载失败'))
      })
      .finally(() => {
        if (mountedRef.current && loadRevisionRef.current === revision) setLoading(false)
      })
  }, [applyState, authToken, reloadNonce])

  const commit = React.useCallback(async (
    transform: (current: ProjectFsState) => ProjectFsState,
  ): Promise<void> => {
    const scopeRevision = loadRevisionRef.current
    const operationId = nextOperationIdRef.current + 1
    nextOperationIdRef.current = operationId

    const run = async (): Promise<void> => {
      if (!mountedRef.current) throw new Error('项目目录页面已关闭，目录操作已取消')
      if (loadRevisionRef.current !== scopeRevision) throw new Error('用户作用域已切换，目录操作已取消')
      if (conflictRef.current) throw new Error('项目目录存在并发冲突，请重新加载后再操作')
      const current = stateRef.current
      if (!current) throw new Error('项目目录尚未就绪')
      const next = transform(current)
      if (next === current) return

      pendingOperationIdsRef.current.add(operationId)
      setSaving(true)
      setError('')
      applyState(next)
      try {
        const persisted = await persistProjectDirectory({
          assetId: assetIdRef.current,
          expectedUpdatedAt: updatedAtRef.current,
          state: next,
        })
        if (!persisted.assetId || !persisted.updatedAt) {
          throw new Error('项目目录保存响应缺少资产版本')
        }
        if (!mountedRef.current || loadRevisionRef.current !== scopeRevision) return
        assetIdRef.current = persisted.assetId
        updatedAtRef.current = persisted.updatedAt
        applyState(persisted.state)
      } catch (persistError: unknown) {
        const message = `项目目录保存失败：${resolveErrorMessage(persistError, '未知错误')}`
        if (mountedRef.current && loadRevisionRef.current === scopeRevision) {
          const conflict = DIRECTORY_CONFLICT_CODES.has(readErrorCode(persistError) ?? '')
          if (conflict) {
            conflictRef.current = true
            setConflicted(true)
          } else {
            applyState(current)
          }
          setError(message)
        }
        throw new Error(message)
      }
    }

    const result = operationTailRef.current.then(run)
    operationTailRef.current = result.catch(() => undefined)
    try {
      await result
    } finally {
      pendingOperationIdsRef.current.delete(operationId)
      if (mountedRef.current) setSaving(pendingOperationIdsRef.current.size > 0)
    }
  }, [applyState])

  React.useEffect(() => {
    if (!authToken || loading || readyRevision === 0 || !stateRef.current) return
    void commit((current) => ensureProjectNodesExist(current, projectsRef.current)).catch(
      (syncError: unknown) => {
        if (!mountedRef.current || loadRevisionRef.current === 0) return
        setError(resolveErrorMessage(syncError, '项目列表与目录同步失败'))
      },
    )
  }, [authToken, commit, loading, projects, readyRevision])

  const retry = React.useCallback(() => {
    if (pendingOperationIdsRef.current.size > 0) return
    setReloadNonce((current) => current + 1)
  }, [])

  const createFolderInDirectory = React.useCallback(
    (parentId: string, name: string) => commit((current) => createFolder(current, parentId, name)),
    [commit],
  )
  const renameFolderInDirectory = React.useCallback(
    (folderId: string, name: string) => commit((current) => renameNode(current, folderId, name)),
    [commit],
  )
  const deleteFolderInDirectory = React.useCallback(
    (folderId: string) => commit((current) => deleteEmptyFolder(current, folderId)),
    [commit],
  )
  const moveNodeInDirectory = React.useCallback(
    (nodeId: string, targetFolderId: string) => commit((current) => moveNode(current, nodeId, targetFolderId)),
    [commit],
  )
  const canMoveNodeInDirectory = React.useCallback((nodeId: string, targetFolderId: string): boolean => {
    const current = stateRef.current
    return current ? canMoveNode(current, nodeId, targetFolderId) : false
  }, [])
  const placeProjectInDirectory = React.useCallback(
    (folderId: string, project: Pick<ProjectDto, 'id' | 'name'>) => (
      commit((current) => placeProjectNode(current, folderId, project))
    ),
    [commit],
  )
  const renameProjectInDirectory = React.useCallback(
    (projectId: string, name: string) => commit((current) => renameProjectNodes(current, projectId, name)),
    [commit],
  )
  const removeProjectFromDirectory = React.useCallback(
    (projectId: string) => commit((current) => deleteProjectNodes(current, projectId)),
    [commit],
  )

  return {
    state,
    loading,
    saving,
    conflicted,
    error,
    retry,
    createFolder: createFolderInDirectory,
    renameFolder: renameFolderInDirectory,
    deleteFolder: deleteFolderInDirectory,
    moveNode: moveNodeInDirectory,
    canMoveNode: canMoveNodeInDirectory,
    placeProject: placeProjectInDirectory,
    renameProject: renameProjectInDirectory,
    removeProject: removeProjectFromDirectory,
  }
}
