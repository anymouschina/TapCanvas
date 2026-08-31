import React from 'react'
import {
  deleteProject,
  shareProjectWithTeam,
  upsertProject,
  type ProjectDto,
} from '../api/server'
import { toast } from '../ui/toast'
import { useActiveTeamId } from '../ui/team/activeTeam'
import type { ProjectDirectoryController } from './useProjectDirectory'

type ProjectManagementDirectory = Pick<ProjectDirectoryController, 'removeProject' | 'renameProject'>

type ProjectManagementActionsInput = {
  directory: ProjectManagementDirectory
  registerProject: (project: ProjectDto) => void
  unregisterProject: (projectId: string) => void
  reloadProjects: () => void
}

export type PendingProjectCleanup = {
  projectId: string
  projectName: string
  message: string
}

export type ProjectManagementActions = {
  managingProjectId: string | null
  sharingProjectId: string | null
  shareAvailable: boolean
  pendingCleanup: PendingProjectCleanup | null
  renameTarget: ProjectDto | null
  renameDraft: string
  setRenameDraft: (name: string) => void
  closeRename: () => void
  submitRename: () => Promise<void>
  renameProject: (project: ProjectDto) => void
  deleteProject: (project: ProjectDto) => void
  toggleShare: (project: ProjectDto) => Promise<void>
  retryPendingCleanup: () => Promise<void>
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

export function useProjectManagementActions({
  directory,
  registerProject,
  unregisterProject,
  reloadProjects,
}: ProjectManagementActionsInput): ProjectManagementActions {
  const activeTeamId = useActiveTeamId()
  const [managingProjectId, setManagingProjectId] = React.useState<string | null>(null)
  const [sharingProjectId, setSharingProjectId] = React.useState<string | null>(null)
  const [pendingCleanup, setPendingCleanup] = React.useState<PendingProjectCleanup | null>(null)
  const [renameTarget, setRenameTarget] = React.useState<ProjectDto | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const shareAvailable = Boolean(
    activeTeamId
    && activeTeamId !== 'personal'
    && !activeTeamId.startsWith('personal_'),
  )

  const renameProject = React.useCallback((project: ProjectDto): void => {
    setRenameTarget(project)
    setRenameDraft(project.name)
  }, [])

  const closeRename = React.useCallback((): void => {
    if (managingProjectId) return
    setRenameTarget(null)
    setRenameDraft('')
  }, [managingProjectId])

  const submitRename = React.useCallback(async (): Promise<void> => {
    if (!renameTarget || managingProjectId) return
    const name = renameDraft.trim()
    if (!name) {
      toast('画布名称不能为空', 'error')
      return
    }
    if (name === renameTarget.name) {
      closeRename()
      return
    }
    setManagingProjectId(renameTarget.id)
    try {
      const updated = await upsertProject({ id: renameTarget.id, name })
      registerProject(updated)
      try {
        await directory.renameProject(renameTarget.id, updated.name)
        toast('画布已重命名', 'success')
      } catch (directoryError: unknown) {
        toast(`画布已重命名，但分组目录同步失败：${resolveErrorMessage(directoryError, '未知错误')}`, 'warning')
      }
      setRenameTarget(null)
      setRenameDraft('')
    } catch (renameError: unknown) {
      toast(resolveErrorMessage(renameError, '画布重命名失败'), 'error')
    } finally {
      setManagingProjectId(null)
    }
  }, [closeRename, directory, managingProjectId, registerProject, renameDraft, renameTarget])

  const removeProject = React.useCallback((project: ProjectDto): void => {
    const sharingNotice = project.teamShared ? '该画布当前已共享到团队。\n' : ''
    const confirmed = window.confirm(
      `删除画布“${project.name}”？\n\n${sharingNotice}此操作会删除项目及其画布数据，且无法撤销。`,
    )
    if (!confirmed) return

    setManagingProjectId(project.id)
    void (async () => {
      try {
        await deleteProject(project.id)
        unregisterProject(project.id)
        try {
          await directory.removeProject(project.id)
          setPendingCleanup((current) => current?.projectId === project.id ? null : current)
          toast('画布已删除', 'success')
        } catch (directoryError: unknown) {
          const message = resolveErrorMessage(directoryError, '未知错误')
          setPendingCleanup({ projectId: project.id, projectName: project.name, message })
          toast(`画布已删除，但分组目录清理失败：${message}`, 'warning')
        }
      } catch (deleteError: unknown) {
        toast(resolveErrorMessage(deleteError, '画布删除失败'), 'error')
      } finally {
        setManagingProjectId(null)
      }
    })()
  }, [directory, unregisterProject])

  const toggleShare = React.useCallback(async (project: ProjectDto): Promise<void> => {
    if (!activeTeamId || !shareAvailable || project.access === 'team_edit') {
      toast('请先切换到要共享的真实团队', 'error')
      return
    }
    const shared = !Boolean(project.teamShared)
    setSharingProjectId(project.id)
    try {
      await shareProjectWithTeam(project.id, { teamId: activeTeamId, shared })
      reloadProjects()
      toast(shared ? '项目已共享到当前团队' : '项目已从当前团队移除', 'success')
    } catch (shareError: unknown) {
      toast(resolveErrorMessage(shareError, shared ? '共享项目失败' : '取消共享失败'), 'error')
    } finally {
      setSharingProjectId(null)
    }
  }, [activeTeamId, reloadProjects, shareAvailable])

  const retryPendingCleanup = React.useCallback(async (): Promise<void> => {
    if (!pendingCleanup) return
    try {
      await directory.removeProject(pendingCleanup.projectId)
      setPendingCleanup(null)
      toast('已清理删除项目的分组记录', 'success')
    } catch (cleanupError: unknown) {
      const message = resolveErrorMessage(cleanupError, '未知错误')
      setPendingCleanup((current) => current ? { ...current, message } : current)
      toast(`分组目录清理失败：${message}`, 'error')
    }
  }, [directory, pendingCleanup])

  return {
    managingProjectId,
    sharingProjectId,
    shareAvailable,
    pendingCleanup,
    renameTarget,
    renameDraft,
    setRenameDraft,
    closeRename,
    submitRename,
    renameProject,
    deleteProject: removeProject,
    toggleShare,
    retryPendingCleanup,
  }
}
