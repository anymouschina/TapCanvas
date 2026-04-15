import React from 'react'
import { AppShell, Group, Title, ActionIcon, Box, Text, Paper, Stack, TextInput, Button, Divider, Breadcrumbs, Anchor, Modal, Badge, ScrollArea, Menu, Textarea, Select, FileInput, Progress, Collapse, SimpleGrid, Alert } from '@mantine/core'
import { IconArrowLeft, IconFolderPlus, IconFilePlus, IconSearch, IconChevronRight, IconFolder, IconLayoutGrid, IconDots, IconTrash, IconEdit, IconPhoto, IconArrowRight, IconSparkles, IconBooks, IconLayoutKanban } from '@tabler/icons-react'
import GithubGate from '../auth/GithubGate'
import { useAuth } from '../auth/store'
import { listProjectChapters, listProjects, upsertProject, deleteProject, listServerAssets, createServerAsset, updateServerAssetData, type ChapterDto, type ProjectDto } from '../api/server'
import { buildProjectDirectoryUrl, buildProjectUrl, buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { createDefaultFs, listChildren, pathToRoot, createFolder, createProjectNode, renameNode, deleteNode, moveNode, ensureProjectNodesExist, type ProjectFsNode, type ProjectFsState } from './projectFs'
import ProjectAssetsViewer from './ProjectAssetsViewer'
import ProjectArtStylePresetPicker from './ProjectArtStylePresetPicker'
import { ensureProjectHasAutoBoundFirstChapter, syncProjectChaptersFromPrimaryBook } from './projectChapterBootstrap'
import {
  DEFAULT_PROJECT_SETUP_PROFILE,
  type ProjectSetupProfile,
  upsertProjectSetupProfile,
} from './projectSetupProfile'
import {
  PROJECT_DIRECTOR_MANUAL_PRESETS,
  applyArtStylePresetToProfile,
  applyDirectorManualPresetToProfile,
  getArtStylePresetById,
  getDirectorManualPresetById,
} from './projectPresetLibrary'
import { uploadProjectText } from '../ui/projectTextUpload'
import { toast } from '../ui/toast'
import { FeatureTour, type FeatureTourStep } from '../ui/tour/FeatureTour'
import { PanelCard } from '../ui/PanelCard'
import { InlinePanel } from '../ui/InlinePanel'
import CanvasEntryButton from '../ui/CanvasEntryButton'
import './projectManager.css'

type CreateKind = 'folder' | 'project'
const PROJECT_FS_KIND = 'projectFsState'
const PROJECT_FS_ASSET_NAME = 'Project Tree'

type ProjectCreateDraft = Pick<
  ProjectSetupProfile,
  | 'projectType'
  | 'creationMode'
  | 'intro'
  | 'artStylePresetId'
  | 'artStyleName'
  | 'styleDirectives'
  | 'directorManualPresetId'
  | 'directorManual'
  | 'videoRatio'
  | 'imageModel'
  | 'videoModel'
  | 'imageQuality'
>

type CreateProjectStage = 'idle' | 'creating-project' | 'uploading-text' | 'finalizing'

type CreateUploadProgress = {
  completed: number
  total: number
}

type ProjectOverviewCard = {
  project: ProjectDto
  chapterCount: number
  recentChapter: ChapterDto | null
}

function getCreateProjectStageLabel(stage: CreateProjectStage): string {
  if (stage === 'creating-project') return '正在创建项目容器…'
  if (stage === 'uploading-text') return '正在上传并导入原文…'
  if (stage === 'finalizing') return '正在保存项目设定…'
  return ''
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

function parseProjectIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const u = new URL(window.location.href)
    const pid = u.searchParams.get('projectId')
    return pid ? String(pid) : null
  } catch {
    return null
  }
}

function NodeIcon({ node }: { node: ProjectFsNode }) {
  if (node.kind === 'folder') return <IconFolder className="tc-pm__node-icon tc-pm__node-icon--folder" size={16} />
  return <IconLayoutGrid className="tc-pm__node-icon tc-pm__node-icon--project" size={16} />
}

function isValidProjectFsState(value: unknown): value is ProjectFsState {
  if (!value || typeof value !== 'object') return false
  const v = value as any
  if (v.version !== 1) return false
  if (typeof v.rootId !== 'string' || !v.rootId.trim()) return false
  if (!v.nodesById || typeof v.nodesById !== 'object') return false
  return true
}

export default function ProjectManagerPage(): JSX.Element {
  const auth = useAuth()
  const [fs, setFs] = React.useState<ProjectFsState>(() => createDefaultFs())
  const [fsAssetId, setFsAssetId] = React.useState<string | null>(null)
  const [fsReady, setFsReady] = React.useState(false)
  const [activeFolderId, setActiveFolderId] = React.useState<string>(() => fs.rootId)
  const [projects, setProjects] = React.useState<ProjectDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createKind, setCreateKind] = React.useState<CreateKind>('project')
  const [nameDraft, setNameDraft] = React.useState('')
  const [projectDraft, setProjectDraft] = React.useState<ProjectCreateDraft>(() => ({
    projectType: DEFAULT_PROJECT_SETUP_PROFILE.projectType,
    creationMode: DEFAULT_PROJECT_SETUP_PROFILE.creationMode,
    intro: DEFAULT_PROJECT_SETUP_PROFILE.intro,
    artStylePresetId: DEFAULT_PROJECT_SETUP_PROFILE.artStylePresetId,
    artStyleName: DEFAULT_PROJECT_SETUP_PROFILE.artStyleName,
    styleDirectives: DEFAULT_PROJECT_SETUP_PROFILE.styleDirectives,
    directorManualPresetId: DEFAULT_PROJECT_SETUP_PROFILE.directorManualPresetId,
    directorManual: DEFAULT_PROJECT_SETUP_PROFILE.directorManual,
    videoRatio: DEFAULT_PROJECT_SETUP_PROFILE.videoRatio,
    imageModel: DEFAULT_PROJECT_SETUP_PROFILE.imageModel,
    videoModel: DEFAULT_PROJECT_SETUP_PROFILE.videoModel,
    imageQuality: DEFAULT_PROJECT_SETUP_PROFILE.imageQuality,
  }))
  const [projectTextFile, setProjectTextFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [createStage, setCreateStage] = React.useState<CreateProjectStage>('idle')
  const [createUploadProgress, setCreateUploadProgress] = React.useState<CreateUploadProgress | null>(null)
  const [createError, setCreateError] = React.useState<string>('')
  const [createAdvancedOpen, setCreateAdvancedOpen] = React.useState(false)
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [renameNodeId, setRenameNodeId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [assetsViewerProject, setAssetsViewerProject] = React.useState<{ id: string; name: string } | null>(null)
  const [contextMenu, setContextMenu] = React.useState<{
    x: number
    y: number
    folderId: string
    nodeId: string | null
  } | null>(null)
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(
    () => new Set([fs.rootId]),
  )
  const [dragNodeId, setDragNodeId] = React.useState<string | null>(null)
  const [dropFolderId, setDropFolderId] = React.useState<string | null>(null)
  const [projectOverviewCards, setProjectOverviewCards] = React.useState<ProjectOverviewCard[]>([])
  const [focusedProjectId, setFocusedProjectId] = React.useState<string | null>(null)
  const fsSaveTimerRef = React.useRef<number | null>(null)
  const [managerTourOpen, setManagerTourOpen] = React.useState(false)

  React.useEffect(() => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      next.add(fs.rootId)
      return next
    })
  }, [fs.rootId])

  React.useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  React.useEffect(() => {
    if (!auth.user) {
      setProjects([])
      setFs(createDefaultFs())
      setFsAssetId(null)
      setFsReady(false)
      return
    }
    setLoading(true)
    setFsReady(false)
    Promise.all([
      listProjects(),
      listServerAssets({ limit: 20, kind: PROJECT_FS_KIND }),
    ])
      .then(async ([ps, assetsRes]) => {
        setProjects(ps)
        const fsAsset = assetsRes.items.find((it) => !it.projectId) || null
        const raw = fsAsset?.data as any
        const persistedStateCandidate =
          raw && typeof raw === 'object'
            ? (raw.state ?? raw)
            : null
        const nextFs = ensureProjectNodesExist(
          isValidProjectFsState(persistedStateCandidate)
            ? persistedStateCandidate
            : createDefaultFs(),
          ps.map((p) => ({ id: p.id, name: p.name })),
        )
        setFs(nextFs)
        setFsAssetId(fsAsset?.id || null)
        const overviewCards = await Promise.all(
          ps.map(async (project) => {
            const chapters = await listProjectChapters(project.id).catch(() => [] as ChapterDto[])
            const recentChapter = [...chapters].sort((left, right) => {
              const leftTs = Date.parse(String(left.lastWorkedAt || left.updatedAt || ''))
              const rightTs = Date.parse(String(right.lastWorkedAt || right.updatedAt || ''))
              return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0)
            })[0] || null
            return {
              project,
              chapterCount: chapters.length,
              recentChapter,
            }
          }),
        )
        setProjectOverviewCards(
          overviewCards.sort((left, right) => {
            const leftTs = Date.parse(String(left.recentChapter?.lastWorkedAt || left.recentChapter?.updatedAt || left.project.updatedAt || ''))
            const rightTs = Date.parse(String(right.recentChapter?.lastWorkedAt || right.recentChapter?.updatedAt || right.project.updatedAt || ''))
            return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0)
          }),
        )
      })
      .catch(() => {
        setProjects([])
        setFs(createDefaultFs())
        setFsAssetId(null)
        setProjectOverviewCards([])
      })
      .finally(() => {
        setLoading(false)
        setFsReady(true)
      })
  }, [auth.user?.sub])

  React.useEffect(() => {
    if (!auth.user || !fsReady) return
    if (fsSaveTimerRef.current != null) {
      window.clearTimeout(fsSaveTimerRef.current)
    }
    fsSaveTimerRef.current = window.setTimeout(() => {
      const payload = {
        kind: PROJECT_FS_KIND,
        version: 1,
        state: fs,
      }
      const persist = async () => {
        try {
          if (fsAssetId) {
            await updateServerAssetData(fsAssetId, payload)
            return
          }
          const created = await createServerAsset({
            name: PROJECT_FS_ASSET_NAME,
            data: payload,
            projectId: null,
          })
          setFsAssetId(created.id)
        } catch (error) {
          console.error('保存项目目录失败', error)
        }
      }
      void persist()
    }, 300)

    return () => {
      if (fsSaveTimerRef.current != null) {
        window.clearTimeout(fsSaveTimerRef.current)
        fsSaveTimerRef.current = null
      }
    }
  }, [auth.user?.sub, fs, fsReady, fsAssetId])

  React.useEffect(() => {
    if (!auth.user) return
    const syncFocusedProjectId = () => {
      const pid = parseProjectIdFromUrl()
      setFocusedProjectId(pid && pid.trim() ? pid.trim() : null)
    }
    syncFocusedProjectId()
    window.addEventListener('popstate', syncFocusedProjectId)
    return () => {
      window.removeEventListener('popstate', syncFocusedProjectId)
    }
  }, [auth.user?.sub])

  const managerTourSeenKey = React.useMemo(
    () => (auth.user?.sub ? `tapcanvas-project-manager-tour:v2:${String(auth.user.sub)}` : ''),
    [auth.user?.sub],
  )

  React.useEffect(() => {
    if (!managerTourSeenKey) return
    try {
      if (window.localStorage.getItem(managerTourSeenKey) !== '1') {
        setManagerTourOpen(true)
      }
    } catch {
      setManagerTourOpen(true)
    }
  }, [managerTourSeenKey])

  const closeManagerTour = React.useCallback(() => {
    setManagerTourOpen(false)
    if (!managerTourSeenKey) return
    try {
      window.localStorage.setItem(managerTourSeenKey, '1')
    } catch {}
  }, [managerTourSeenKey])

  const managerTourSteps: FeatureTourStep[] = React.useMemo(() => [
    {
      id: 'manager-path',
      target: 'project-manager-path',
      title: '先理解这里负责什么',
      description: '这里主要负责创建项目、查看项目资产和打开最近章节，不是逐章制作页面。',
    },
    {
      id: 'manager-create',
      target: 'project-manager-create',
      title: '从这里启动新项目',
      description: '推荐直接上传原文创建项目，并在创建时锁定画风和导演规则。',
    },
    {
      id: 'manager-grid',
      target: 'project-manager-grid',
      title: '项目创建后从这里进入',
      description: '打开项目后会进入画布，并直接展开最近章节对应的漫剧工作台抽屉，而不是停在文件树里。',
    },
  ], [])

  const crumbs = React.useMemo(() => pathToRoot(fs, activeFolderId), [fs, activeFolderId])
  const children = React.useMemo(() => listChildren(fs, activeFolderId), [fs, activeFolderId])
  const hasCustomGroups = React.useMemo(
    () => Object.values(fs.nodesById).some((node) => node.kind === 'folder' && node.id !== fs.rootId),
    [fs.nodesById, fs.rootId],
  )
  const showGroupingUi = true
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return children
    return Object.values(fs.nodesById)
      .filter((n) => n.id !== fs.rootId)
      .filter((n) => n.name.toLowerCase().includes(q) || (n.kind === 'project' && n.projectId.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
  }, [children, fs.nodesById, fs.rootId, query])

  const treeQuery = query.trim().toLowerCase()
  const matchesTreeNode = React.useCallback((nodeId: string): boolean => {
    if (!treeQuery) return true
    const node = fs.nodesById[nodeId]
    if (!node) return false
    const selfMatched =
      node.name.toLowerCase().includes(treeQuery) ||
      (node.kind === 'project' && node.projectId.toLowerCase().includes(treeQuery))
    if (selfMatched) return true
    if (node.kind !== 'folder') return false
    const kids = listChildren(fs, node.id)
    return kids.some((child) => matchesTreeNode(child.id))
  }, [fs, treeQuery])

  const openCreate = (kind: CreateKind) => {
    setCreateKind(kind)
    setNameDraft('')
    setCreateStage('idle')
    setCreateUploadProgress(null)
    setCreateError('')
    setCreateAdvancedOpen(false)
    setProjectDraft({
      projectType: DEFAULT_PROJECT_SETUP_PROFILE.projectType,
      creationMode: DEFAULT_PROJECT_SETUP_PROFILE.creationMode,
      intro: DEFAULT_PROJECT_SETUP_PROFILE.intro,
      artStylePresetId: DEFAULT_PROJECT_SETUP_PROFILE.artStylePresetId,
      artStyleName: DEFAULT_PROJECT_SETUP_PROFILE.artStyleName,
      styleDirectives: DEFAULT_PROJECT_SETUP_PROFILE.styleDirectives,
      directorManualPresetId: DEFAULT_PROJECT_SETUP_PROFILE.directorManualPresetId,
      directorManual: DEFAULT_PROJECT_SETUP_PROFILE.directorManual,
      videoRatio: DEFAULT_PROJECT_SETUP_PROFILE.videoRatio,
      imageModel: DEFAULT_PROJECT_SETUP_PROFILE.imageModel,
      videoModel: DEFAULT_PROJECT_SETUP_PROFILE.videoModel,
      imageQuality: DEFAULT_PROJECT_SETUP_PROFILE.imageQuality,
    })
    setProjectTextFile(null)
    setCreateOpen(true)
  }

  const openContextMenu = (x: number, y: number, folderId: string, nodeId: string | null) => {
    const targetFolderId =
      fs.nodesById[folderId]?.kind === 'folder' ? folderId : fs.rootId
    setActiveFolderId(targetFolderId)
    setContextMenu({ x, y, folderId: targetFolderId, nodeId })
  }

  const handleCreate = async () => {
    const name = nameDraft.trim()
    if (!name) return
    if (busy) return
    let createdProject: ProjectDto | null = null
    setBusy(true)
    setCreateError('')
    setCreateUploadProgress(null)
    try {
      if (createKind === 'folder') {
        setFs((prev) => createFolder(prev, activeFolderId, name))
        setCreateOpen(false)
        toast('分组已创建。', 'success')
        return
      }

      if (!projectTextFile) {
        toast('请先上传原文，再创建项目。', 'warning')
        return
      }

      setCreateStage('creating-project')
      const p = await upsertProject({ name })
      createdProject = p
      setProjects((prev) => [p, ...prev.filter((item) => item.id !== p.id)])
      setFs((prev) => createProjectNode(prev, activeFolderId, { name: p.name, projectId: p.id }))

      setCreateStage('finalizing')
      await upsertProjectSetupProfile(p.id, {
        ...projectDraft,
        creationMode: 'text-upload',
        createdFrom: 'uploaded-text',
      })

      setCreateStage('uploading-text')
      const uploaded = await uploadProjectText({
        projectId: p.id,
        projectName: p.name,
        file: projectTextFile,
        onChunkProgress: (completed, total) => {
          setCreateUploadProgress({ completed, total })
        },
      })
      setCreateStage('finalizing')
      await upsertProjectSetupProfile(p.id, {
        creationMode: 'text-upload',
        createdFrom: 'uploaded-text',
        lastTextUploadName: projectTextFile.name,
        lastTextUploadMode: uploaded.mode,
        lastTextUploadAt: new Date().toISOString(),
      })
      if (uploaded.mode === 'book') {
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const synced = await syncProjectChaptersFromPrimaryBook(p.id, { limit: 12 }).catch(() => null)
          if (synced && synced.totalSourceChapters > 0) break
          await new Promise((resolve) => window.setTimeout(resolve, 2000))
        }
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const bootstrapped = await ensureProjectHasAutoBoundFirstChapter(p.id).catch(() => null)
          if (bootstrapped?.chapterId) break
          await new Promise((resolve) => window.setTimeout(resolve, 2000))
        }
      }
      const textUploadMessage = uploaded.mode === 'book'
        ? '文本已上传，项目章节目录会自动按原文补齐。'
        : '文本已上传到项目共享记忆。'

      setCreateStage('idle')
      setCreateUploadProgress(null)
      setCreateOpen(false)
      toast(textUploadMessage, 'success')
      spaNavigate(buildProjectDirectoryUrl(p.id))
    } catch (error) {
      const message = resolveErrorMessage(error, '创建项目失败，请稍后重试')
      console.error('创建项目流程失败', error)
      setCreateStage('idle')
      setCreateUploadProgress(null)
      if (createdProject) {
        setCreateOpen(false)
        setCreateError('')
        toast(`项目“${createdProject.name}”已创建，但原文导入失败：${message}。请进入项目后重新上传原文。`, 'warning')
        spaNavigate(buildProjectDirectoryUrl(createdProject.id))
        return
      }
      setCreateError(message)
    } finally {
      setCreateStage('idle')
      setBusy(false)
    }
  }

  const updateProjectDraft = <K extends keyof ProjectCreateDraft>(key: K, value: ProjectCreateDraft[K]) => {
    setProjectDraft((prev) => ({ ...prev, [key]: value }))
  }

  const selectedDirectorManualPreset = getDirectorManualPresetById(projectDraft.directorManualPresetId)
  const filteredProjectCards = React.useMemo(() => {
    const projectIdSet = new Set(
      filtered
        .filter((node): node is ProjectFsNode & { kind: 'project' } => node.kind === 'project')
        .map((node) => node.projectId),
    )
    return projectOverviewCards.filter((item) => projectIdSet.has(item.project.id))
  }, [filtered, projectOverviewCards])
  const featuredProjectCards = filteredProjectCards.slice(0, 3)
  const projectOverviewById = React.useMemo(
    () => new Map(projectOverviewCards.map((item) => [item.project.id, item])),
    [projectOverviewCards],
  )

  const handleOpenNode = (node: ProjectFsNode) => {
    if (node.kind === 'folder') {
      setActiveFolderId(node.id)
      return
    }
    spaNavigate(buildProjectUrl(node.projectId))
  }

  const openProjectAssets = (node: ProjectFsNode) => {
    if (node.kind !== 'project') return
    setAssetsViewerProject({ id: node.projectId, name: node.name })
  }

  const startRename = (nodeId: string) => {
    const node = fs.nodesById[nodeId]
    if (!node) return
    setRenameNodeId(nodeId)
    setRenameDraft(node.name)
  }

  const commitRename = async () => {
    if (!renameNodeId) return
    const nextName = renameDraft.trim()
    if (!nextName) return
    const node = fs.nodesById[renameNodeId]
    if (!node) return
    if (renameBusy) return
    setRenameBusy(true)
    try {
      if (node.kind === 'project') {
        const updated = await upsertProject({ id: node.projectId, name: nextName })
        setProjects((prev) => prev.map((p) => (p.id === node.projectId ? { ...p, name: updated.name } : p)))
        setFs((prev) => {
          let next = prev
          const projectNodeIds = Object.values(next.nodesById)
            .filter((n) => n.kind === 'project' && n.projectId === node.projectId)
            .map((n) => n.id)
          for (const id of projectNodeIds) {
            next = renameNode(next, id, updated.name)
          }
          return next
        })
      } else {
        setFs((prev) => renameNode(prev, renameNodeId, nextName))
      }
      setRenameNodeId(null)
      setRenameDraft('')
    } catch (error) {
      console.error('重命名失败', error)
      toast(resolveErrorMessage(error, '重命名失败，请稍后重试'), 'error')
    } finally {
      setRenameBusy(false)
    }
  }

  const handleDelete = async (nodeId: string) => {
    const node = fs.nodesById[nodeId]
    if (!node) return
    if (node.kind === 'folder') {
      const subtreeNodeIds = new Set<string>()
      const stack: string[] = [nodeId]
      while (stack.length > 0) {
        const cur = stack.pop() as string
        if (subtreeNodeIds.has(cur)) continue
        subtreeNodeIds.add(cur)
        for (const candidate of Object.values(fs.nodesById)) {
          if (candidate.parentId === cur) {
            stack.push(candidate.id)
          }
        }
      }
      const projectIdsInFolder = Array.from(
        new Set(
          Array.from(subtreeNodeIds)
            .map((id) => fs.nodesById[id])
            .filter((n): n is ProjectFsNode => !!n && n.kind === 'project')
            .map((n) => (n.kind === 'project' ? n.projectId : ''))
            .filter(Boolean),
        ),
      )

      const ok = window.confirm(
        projectIdsInFolder.length > 0
          ? `删除分组「${node.name}」及其所有内容？将同时删除其中 ${projectIdsInFolder.length} 个项目（服务器数据也会删除）。`
          : `删除分组「${node.name}」及其所有内容？`,
      )
      if (!ok) return

      const deletedProjectIds = new Set<string>()
      const failedProjectIds = new Set<string>()
      for (const projectId of projectIdsInFolder) {
        try {
          await deleteProject(projectId)
          deletedProjectIds.add(projectId)
        } catch (error) {
          console.error(`删除项目失败: ${projectId}`, error)
          failedProjectIds.add(projectId)
        }
      }

      if (deletedProjectIds.size > 0) {
        setProjects((prev) => prev.filter((p) => !deletedProjectIds.has(p.id)))
      }

      setFs((prev) => {
        let next = prev
        if (failedProjectIds.size === 0) {
          next = deleteNode(next, nodeId)
        }
        const danglingProjectNodeIds = Object.values(next.nodesById)
          .filter((n) => n.kind === 'project' && deletedProjectIds.has(n.projectId))
          .map((n) => n.id)
        for (const id of danglingProjectNodeIds) {
          next = deleteNode(next, id)
        }
        return next
      })

      if (failedProjectIds.size === 0 && nodeId === activeFolderId) {
        setActiveFolderId(fs.rootId)
      }

      const pidFromUrl = parseProjectIdFromUrl()
      if (pidFromUrl && deletedProjectIds.has(pidFromUrl)) {
        spaNavigate('/projects')
      }

      if (failedProjectIds.size > 0) {
        toast(`目录删除未完成：${failedProjectIds.size} 个项目删除失败，目录已保留。请重试。`, 'warning')
      }
      return
    }

    const ok = window.confirm(
      `删除项目「${node.name}」？（会删除项目及其数据）`,
    )
    if (!ok) return

    try {
      await deleteProject(node.projectId)
      setProjects((prev) => prev.filter((p) => p.id !== node.projectId))
      setFs((prev) => {
        let next = prev
        const ids = Object.values(next.nodesById)
          .filter((n) => n.kind === 'project' && n.projectId === node.projectId)
          .map((n) => n.id)
        for (const id of ids) {
          next = deleteNode(next, id)
        }
        return next
      })
      const pidFromUrl = parseProjectIdFromUrl()
      if (pidFromUrl && pidFromUrl === node.projectId) {
        spaNavigate('/projects')
      }
    } catch (error) {
      console.error('删除项目失败', error)
      toast(resolveErrorMessage(error, '删除项目失败，请稍后重试'), 'error')
    }
  }

  const canDropToFolder = React.useCallback((sourceNodeId: string, targetFolderId: string): boolean => {
    const source = fs.nodesById[sourceNodeId]
    const target = fs.nodesById[targetFolderId]
    if (!source || !target || target.kind !== 'folder') return false
    if (source.id === fs.rootId) return false
    if (source.id === targetFolderId) return false
    if (source.parentId === targetFolderId) return false
    if (source.kind !== 'folder') return true

    let cur: string | null = targetFolderId
    const seen = new Set<string>()
    while (cur) {
      if (seen.has(cur)) break
      seen.add(cur)
      if (cur === source.id) return false
      const node: ProjectFsNode | undefined = fs.nodesById[cur]
      if (!node || node.kind !== 'folder') break
      cur = node.parentId
    }
    return true
  }, [fs.nodesById, fs.rootId])

  const commitDropToFolder = React.useCallback((sourceNodeId: string, targetFolderId: string) => {
    if (!canDropToFolder(sourceNodeId, targetFolderId)) return
    setFs((prev) => moveNode(prev, sourceNodeId, targetFolderId))
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      next.add(targetFolderId)
      next.add(fs.rootId)
      return next
    })
  }, [canDropToFolder, fs.rootId])

  const renderTree = (nodeId: string, depth: number): React.ReactNode => {
    const node: ProjectFsNode | undefined = fs.nodesById[nodeId]
    if (!node) return null
    if (!matchesTreeNode(node.id)) return null
    const isFolder = node.kind === 'folder'
    const kids = isFolder ? listChildren(fs, nodeId) : []
    const isExpanded = isFolder && expandedFolderIds.has(node.id)
    const active = isFolder && nodeId === activeFolderId
    const isDropActive = isFolder && dropFolderId === node.id
    return (
      <div className="tc-pm__tree-item" key={nodeId}>
        <button
          className={['tc-pm__tree-button', active ? 'is-active' : '', isDropActive ? 'is-drop-target' : ''].filter(Boolean).join(' ')}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            if (node.kind === 'folder') {
              setExpandedFolderIds((prev) => {
                const next = new Set(prev)
                if (next.has(node.id)) next.delete(node.id)
                else next.add(node.id)
                next.add(fs.rootId)
                return next
              })
              setActiveFolderId(node.id)
              return
            }
            spaNavigate(buildProjectUrl(node.projectId))
          }}
          draggable={node.id !== fs.rootId}
          onDragStart={(event) => {
            if (node.id === fs.rootId) return
            event.dataTransfer.setData('text/plain', node.id)
            event.dataTransfer.effectAllowed = 'move'
            setDragNodeId(node.id)
          }}
          onDragEnd={() => {
            setDragNodeId(null)
            setDropFolderId(null)
          }}
          onDragOver={(event) => {
            if (!isFolder || !dragNodeId || !canDropToFolder(dragNodeId, node.id)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropFolderId(node.id)
          }}
          onDragLeave={() => {
            if (dropFolderId === node.id) setDropFolderId(null)
          }}
          onDrop={(event) => {
            if (!isFolder) return
            event.preventDefault()
            const sourceNodeId = (event.dataTransfer.getData('text/plain') || dragNodeId || '').trim()
            if (sourceNodeId) commitDropToFolder(sourceNodeId, node.id)
            setDragNodeId(null)
            setDropFolderId(null)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const targetFolderId = node.kind === 'folder' ? node.id : (node.parentId || fs.rootId)
            openContextMenu(event.clientX, event.clientY, targetFolderId, node.id)
          }}
          type="button"
        >
          {isFolder ? (
            <IconChevronRight className={['tc-pm__tree-caret', isExpanded ? 'is-open' : ''].join(' ')} size={14} style={{ opacity: 0.6 }} />
          ) : (
            <span className="tc-pm__tree-caret-placeholder" aria-hidden />
          )}
          <NodeIcon node={node} />
          <span className="tc-pm__tree-label">{node.name}</span>
        </button>
        {isFolder && isExpanded && kids.length > 0 && (
          <div className="tc-pm__tree-children">
            {kids.map((k) => renderTree(k.id, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <AppShell className="tc-pm__shell" header={{ height: 56 }} padding={0}>
      <FeatureTour opened={managerTourOpen} steps={managerTourSteps} onClose={closeManagerTour} />
      <AppShell.Header className="tc-pm__header">
        <Group className="tc-pm__header-inner" justify="space-between" h="100%" px={16}>
          <Group className="tc-pm__header-left" gap={10}>
            <ActionIcon className="tc-pm__back" variant="subtle" onClick={() => spaNavigate(buildStudioUrl())}>
              <IconArrowLeft className="tc-pm__back-icon" size={18} />
            </ActionIcon>
            <Box>
              <Title className="tc-pm__title" order={3}>项目入口</Title>
              <Text size="xs" c="dimmed">创建项目、查看共享资产，并打开画布内的漫剧工作台。</Text>
            </Box>
            <Badge className="tc-pm__badge" variant="light" color="gray">
              {loading ? '同步中' : `项目 ${projects.length} 个`}
            </Badge>
          </Group>

          <Group className="tc-pm__header-right" gap={10}>
            <TextInput
              className="tc-pm__search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              leftSection={<IconSearch className="tc-pm__search-icon" size={14} />}
              placeholder="搜索项目"
              size="sm"
              w={320}
            />
            <CanvasEntryButton
              href={focusedProjectId ? buildStudioUrl({ projectId: focusedProjectId, panel: 'nanoComic' }) : buildStudioUrl({ panel: 'nanoComic' })}
              label="漫剧工作台"
              variant="light"
              size="sm"
            />
            <Button className="tc-pm__new-project" variant="filled" size="sm" leftSection={<IconFilePlus className="tc-pm__new-project-icon" size={14} />} onClick={() => openCreate('project')} data-tour="project-manager-create">
              上传原文
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main className="tc-pm__main">
        <GithubGate className="tc-pm__gate">
          <div className="tc-pm__layout">
            {showGroupingUi ? (
              <aside className="tc-pm__sidebar">
                <div className="tc-pm__sidebar-top">
                  <Text className="tc-pm__sidebar-title" size="xs" c="dimmed">
                    {hasCustomGroups ? '项目目录 / 分组' : '项目目录'}
                  </Text>
                </div>
                <ScrollArea className="tc-pm__sidebar-scroll" type="hover">
                  <div
                    className="tc-pm__tree"
                    onContextMenu={(event) => {
                      const target = event.target as HTMLElement | null
                      if (target?.closest('.tc-pm__tree-button')) return
                      event.preventDefault()
                      openContextMenu(event.clientX, event.clientY, activeFolderId || fs.rootId, null)
                    }}
                  >
                    {renderTree(fs.rootId, 0)}
                  </div>
                </ScrollArea>
              </aside>
            ) : null}

            <section className="tc-pm__content">
              {showGroupingUi ? (
                <div className="tc-pm__content-top">
                  <Breadcrumbs className="tc-pm__breadcrumbs" separator=" / ">
                    {crumbs.map((c) => (
                      <Anchor
                        className="tc-pm__crumb"
                        key={c.id}
                        onClick={() => setActiveFolderId(c.id)}
                      >
                        {c.name}
                      </Anchor>
                    ))}
                  </Breadcrumbs>
                </div>
              ) : null}

              <div className="tc-pm__top-grid">
              <PanelCard className="tc-pm__quickstart-card" padding="default" mb="md" data-tour="project-manager-path">
                <Group className="tc-pm__quickstart-layout" justify="space-between" align="flex-start" gap="lg">
                  <Box className="tc-pm__quickstart-copy" style={{ flex: 1, minWidth: 260 }}>
                    <Badge variant="light" color="blue">章节生产入口</Badge>
                    <Title order={4} mt={10}>先选项目，再进画布工作台</Title>
                    <Text size="sm" c="dimmed" mt={6}>
                      这里只做两件事：启动项目，或接力回到画布内的漫剧工作台。逐章生成、确认、沉淀资产都在画布里完成。
                    </Text>
                    <Group gap="xs" mt="md">
                      <Button leftSection={<IconSparkles size={14} />} onClick={() => openCreate('project')}>
                        新建项目
                      </Button>
                      <Button variant="light" onClick={() => spaNavigate('/')}>
                        回到工作台首页
                      </Button>
                    </Group>
                  </Box>
                  <SimpleGrid className="tc-pm__quickstart-steps" cols={1} spacing="sm">
                    <InlinePanel className="tc-pm__quickstart-step">
                      <Text size="sm" fw={700}>1. 上传原文并锁定画风</Text>
                      <Text size="xs" c="dimmed" mt={4}>先把文本与视觉共识一次建好。</Text>
                    </InlinePanel>
                    <InlinePanel className="tc-pm__quickstart-step">
                      <Text size="sm" fw={700}>2. 自动补齐章节目录</Text>
                      <Text size="xs" c="dimmed" mt={4}>系统会优先把你送进最近可编辑章节。</Text>
                    </InlinePanel>
                    <InlinePanel className="tc-pm__quickstart-step">
                      <Text size="sm" fw={700}>3. 只在项目级调整时回这里</Text>
                      <Text size="xs" c="dimmed" mt={4}>共享记忆、分组整理、归档删除都在这里做。</Text>
                    </InlinePanel>
                  </SimpleGrid>
                </Group>
              </PanelCard>

              {featuredProjectCards.length > 0 ? (
                <PanelCard className="tc-pm__overview-card" padding="default" mb="md">
                  <Group justify="space-between" align="flex-start" mb="sm" gap="md">
                    <Box>
                      <Badge variant="light" color="grape">继续生产</Badge>
                      <Title order={4} mt={10}>最近可接力项目</Title>
                      <Text size="sm" c="dimmed" mt={6}>
                        这里只放最近 3 个项目，完整列表在下方网格。
                      </Text>
                    </Box>
                    <InlinePanel className="tc-pm__overview-tip">
                      <Text size="xs" c="dimmed">目标</Text>
                      <Text size="sm" fw={700} mt={4}>首屏先看到能继续的项目</Text>
                    </InlinePanel>
                  </Group>
                  <SimpleGrid className="tc-pm__overview-grid" cols={{ base: 1, xl: 3 }} spacing="sm">
                    {featuredProjectCards.map(({ project, chapterCount, recentChapter }) => (
                      <PanelCard
                        className={['tc-pm__project-overview-item', focusedProjectId === project.id ? 'is-focused' : ''].filter(Boolean).join(' ')}
                        key={project.id}
                      >
                        <Stack gap="xs">
                          <Group justify="space-between" align="flex-start" gap="sm">
                            <Box style={{ flex: 1, minWidth: 0 }}>
                              <Text fw={700} size="sm">{project.name}</Text>
                              <Text size="xs" c="dimmed" mt={4}>
                                {recentChapter
                                  ? `最近章节：${recentChapter.title || `第 ${recentChapter.index} 章`} · ${recentChapter.status}`
                                  : '项目已创建，等待第一章就绪'}
                              </Text>
                            </Box>
                            <Badge variant="light" color="blue">
                              {chapterCount > 0 ? `${chapterCount} 章` : '待补齐'}
                            </Badge>
                          </Group>
                          <Group gap="xs">
                            <InlinePanel className="tc-pm__project-overview-chip">
                              <Group gap={6}>
                                <IconBooks size={14} />
                                <Text size="xs">{chapterCount > 0 ? `章节 ${chapterCount}` : '章节准备中'}</Text>
                              </Group>
                            </InlinePanel>
                            <InlinePanel className="tc-pm__project-overview-chip">
                              <Group gap={6}>
                                <IconLayoutKanban size={14} />
                                <Text size="xs">{recentChapter ? '可继续生产' : '等待入口'}</Text>
                              </Group>
                            </InlinePanel>
                          </Group>
                          <Group gap="xs">
                            <Button
                              size="xs"
                              rightSection={<IconArrowRight size={14} />}
                              onClick={() => {
                                spaNavigate(buildProjectUrl(project.id))
                              }}
                            >
                              {recentChapter ? '继续最近章节' : '进入项目'}
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => spaNavigate(buildProjectDirectoryUrl(project.id))}
                            >
                              项目目录
                            </Button>
                          </Group>
                        </Stack>
                      </PanelCard>
                    ))}
                  </SimpleGrid>
                </PanelCard>
              ) : null}
              </div>

              <Divider className="tc-pm__divider" />

              <div className="tc-pm__grid" data-tour="project-manager-grid">
                {filtered.map((n) => (
                  <PanelCard
                    className={[
                      'tc-pm__card',
                      n.kind === 'folder' && dropFolderId === n.id ? 'is-drop-target' : '',
                      n.kind === 'project' && focusedProjectId === n.projectId ? 'is-focused' : '',
                    ].filter(Boolean).join(' ')}
                    key={n.id}
                    onDoubleClick={() => handleOpenNode(n)}
                    draggable={n.id !== fs.rootId}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', n.id)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragNodeId(n.id)
                    }}
                    onDragEnd={() => {
                      setDragNodeId(null)
                      setDropFolderId(null)
                    }}
                    onDragOver={(event) => {
                      if (n.kind !== 'folder' || !dragNodeId || !canDropToFolder(dragNodeId, n.id)) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDropFolderId(n.id)
                    }}
                    onDragLeave={() => {
                      if (dropFolderId === n.id) setDropFolderId(null)
                    }}
                    onDrop={(event) => {
                      if (n.kind !== 'folder') return
                      event.preventDefault()
                      const sourceNodeId = (event.dataTransfer.getData('text/plain') || dragNodeId || '').trim()
                      if (sourceNodeId) commitDropToFolder(sourceNodeId, n.id)
                      setDragNodeId(null)
                      setDropFolderId(null)
                    }}
                  >
                    <div className="tc-pm__card-row">
                      <div className="tc-pm__card-left">
                        <div className="tc-pm__card-icon-wrap">
                          <NodeIcon node={n} />
                        </div>
                          <div className="tc-pm__card-meta">
                            <div className="tc-pm__card-title">{n.name}</div>
                            <div className="tc-pm__card-sub">
                            {n.kind === 'folder'
                              ? '项目分组'
                              : (projectOverviewById.get(n.projectId)?.recentChapter
                                ? `最近章节 · ${projectOverviewById.get(n.projectId)?.recentChapter?.title || ''}`
                                : '项目已创建，等待章节入口')}
                            </div>
                          </div>
                        </div>
                        <div className="tc-pm__card-right">
                        <button
                          className="tc-pm__card-open"
                          type="button"
                          onClick={() => handleOpenNode(n)}
                        >
                          {n.kind === 'folder' ? '打开' : '继续'}
                        </button>
                        {n.kind === 'project' && (
                          <button
                            className="tc-pm__card-assets"
                            type="button"
                            onClick={() => openProjectAssets(n)}
                          >
                            记忆库
                          </button>
                        )}
                        <Menu
                          classNames={{
                            dropdown: 'tc-pm__card-menu-dropdown',
                            item: 'tc-pm__card-menu-item',
                          }}
                          withinPortal
                          position="bottom-end"
                          withArrow
                          shadow="md"
                        >
                          <Menu.Target>
                            <ActionIcon
                              className="tc-pm__card-menu"
                              variant="subtle"
                            >
                              <IconDots className="tc-pm__card-menu-icon" size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {n.kind === 'project' && (
                              <Menu.Item leftSection={<IconPhoto className="tc-pm__menu-icon" size={14} />} onClick={() => openProjectAssets(n)}>
                                项目记忆库
                              </Menu.Item>
                            )}
                            {n.kind === 'folder' ? (
                              <Menu.Item leftSection={<IconFolderPlus className="tc-pm__menu-icon" size={14} />} onClick={() => openCreate('folder')}>
                                新建分组
                              </Menu.Item>
                            ) : null}
                            <Menu.Item leftSection={<IconEdit className="tc-pm__menu-icon" size={14} />} onClick={() => startRename(n.id)}>
                              重命名
                            </Menu.Item>
                            <Menu.Item className="tc-pm__card-menu-item--danger" color="red" leftSection={<IconTrash className="tc-pm__menu-icon" size={14} />} onClick={() => void handleDelete(n.id)}>
                              删除
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </div>
                    </div>
                  </PanelCard>
                ))}
                {!filtered.length && (
                  <div className="tc-pm__empty">
                    <Text className="tc-pm__empty-title">{projects.length === 0 && !query.trim() ? '先创建第一个项目' : '暂无内容'}</Text>
                    <Text className="tc-pm__empty-sub" c="dimmed" size="sm">
                      {projects.length === 0 && !query.trim()
                        ? '上传原文后即可创建第一个项目。'
                        : '你可以上传原文创建项目，或者清空搜索条件。'}
                    </Text>
                    {projects.length === 0 && !query.trim() ? (
                      <Group justify="center" mt="md">
                        <Button size="sm" onClick={() => openCreate('project')} leftSection={<IconFilePlus size={14} />}>
                          上传原文创建项目
                        </Button>
                      </Group>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          </div>

          <Modal className="tc-pm__modal" opened={createOpen} onClose={() => setCreateOpen(false)} title={createKind === 'folder' ? '新建分组' : '创建项目'} centered>
            <Stack className="tc-pm__modal-stack" gap="sm">
              <TextInput
                className="tc-pm__modal-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.currentTarget.value)}
                placeholder={createKind === 'folder' ? '请输入分组名称' : '请输入项目名称'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate()
                }}
              />
              {createKind === 'project' ? (
                <>
                  <Alert variant="light" color="blue" title="创建项目">
                    <Stack gap={4}>
                      <Text size="sm">默认只填最影响结果质量的内容：项目名、原文、基础画风。</Text>
                      <Text size="sm">创建完成后会自动补齐章节，并优先把你送进第一章。</Text>
                    </Stack>
                  </Alert>
                  <Group grow align="stretch">
                    <InlinePanel>
                      <Text size="xs" c="dimmed">Step 1</Text>
                      <Text size="sm" fw={700} mt={4}>上传原文</Text>
                      <Text size="xs" c="dimmed" mt={4}>这是后续章节、镜头和共享资产的唯一文本底稿。</Text>
                    </InlinePanel>
                    <InlinePanel>
                      <Text size="xs" c="dimmed">Step 2</Text>
                      <Text size="sm" fw={700} mt={4}>锁定画风</Text>
                      <Text size="xs" c="dimmed" mt={4}>先确定视觉方向，后续跨章节连续性更稳。</Text>
                    </InlinePanel>
                    <InlinePanel>
                      <Text size="xs" c="dimmed">Step 3</Text>
                      <Text size="sm" fw={700} mt={4}>自动进入章节</Text>
                      <Text size="xs" c="dimmed" mt={4}>接下来会继续补齐目录，并尝试自动进入第一章。</Text>
                    </InlinePanel>
                  </Group>
                  <FileInput
                    label="原文上传"
                    description="支持 txt 等文本文件。创建后会继续自动补齐章节，并尝试进入第一章。"
                    value={projectTextFile}
                    onChange={(file) => {
                      setProjectTextFile(file)
                      setCreateError('')
                      setCreateUploadProgress(null)
                    }}
                    placeholder="先选择原文文件"
                    clearable
                  />
                  <ProjectArtStylePresetPicker
                    value={projectDraft.artStylePresetId}
                    description="先看风格图卡再决定，不再只靠文字下拉。选中后会自动填充画风名和视觉规则。"
                    onChange={(value) => {
                      const preset = getArtStylePresetById(value)
                      if (!preset) {
                        updateProjectDraft('artStylePresetId', undefined)
                        return
                      }
                      setProjectDraft((prev) => applyArtStylePresetToProfile(prev, preset))
                    }}
                  />
                  <TextInput
                    label="画风 / 风格名"
                    value={projectDraft.artStyleName}
                    onChange={(event) => setProjectDraft((prev) => ({
                      ...prev,
                      artStylePresetId: undefined,
                      artStyleName: event.currentTarget.value,
                    }))}
                    placeholder="如：国风电影感、赛璐璐热血、黑白悬疑漫画"
                  />
                  <Textarea
                    label="视觉规则"
                    minRows={2}
                    maxRows={4}
                    value={projectDraft.styleDirectives}
                    onChange={(event) => setProjectDraft((prev) => ({
                      ...prev,
                      artStylePresetId: undefined,
                      styleDirectives: event.currentTarget.value,
                    }))}
                    placeholder="描述镜头气质、人物一致性、构图偏好、色彩规则。"
                  />
                  <Button
                    variant="subtle"
                    rightSection={<IconChevronRight size={14} style={{ transform: createAdvancedOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms ease' }} />}
                    onClick={() => setCreateAdvancedOpen((prev) => !prev)}
                  >
                    {createAdvancedOpen ? '收起补充设置' : '打开补充设置'}
                  </Button>
                  <Collapse in={createAdvancedOpen}>
                    <Stack gap="sm">
                      <Select
                        data={[
                          { value: 'nano-comic', label: '漫剧工作台' },
                          { value: 'storyboard', label: '分镜项目' },
                          { value: 'novel-adaptation', label: '小说改编' },
                          { value: 'serialized', label: '连载项目' },
                        ]}
                        value={projectDraft.projectType}
                        label="项目类型"
                        onChange={(value) => updateProjectDraft('projectType', (value as ProjectCreateDraft['projectType']) || 'nano-comic')}
                      />
                      <Textarea
                        label="项目简介"
                        minRows={2}
                        maxRows={4}
                        value={projectDraft.intro}
                        onChange={(event) => updateProjectDraft('intro', event.currentTarget.value)}
                        placeholder="一句话说明题材、世界观与目标受众。"
                      />
                      <Select
                        data={PROJECT_DIRECTOR_MANUAL_PRESETS.map((item) => ({
                          value: item.id,
                          label: `${item.name} · ${item.tags.join(' / ')}`,
                        }))}
                        value={projectDraft.directorManualPresetId || null}
                        label="导演手册预设"
                        description="补自 Toonflow 的导演叙事技能包。选择后会填充导演手册，可再按项目改写。"
                        onChange={(value) => {
                          const preset = getDirectorManualPresetById(value)
                          if (!preset) {
                            updateProjectDraft('directorManualPresetId', undefined)
                            return
                          }
                          setProjectDraft((prev) => applyDirectorManualPresetToProfile(prev, preset))
                        }}
                        clearable
                        searchable
                        nothingFoundMessage="没有匹配的导演预设"
                      />
                      {selectedDirectorManualPreset ? (
                        <InlinePanel>
                          <Group justify="space-between" align="flex-start">
                            <Box style={{ minWidth: 0 }}>
                              <Text size="sm" fw={700}>{selectedDirectorManualPreset.name}</Text>
                              <Text size="xs" c="dimmed" mt={4}>{selectedDirectorManualPreset.summary}</Text>
                            </Box>
                            <Badge variant="light" color="grape">Toonflow</Badge>
                          </Group>
                          <Text size="xs" mt={8}>{selectedDirectorManualPreset.tags.join(' · ')}</Text>
                        </InlinePanel>
                      ) : null}
                      <Textarea
                        label="导演手册"
                        minRows={3}
                        maxRows={6}
                        value={projectDraft.directorManual}
                        onChange={(event) => setProjectDraft((prev) => ({
                          ...prev,
                          directorManualPresetId: undefined,
                          directorManual: event.currentTarget.value,
                        }))}
                        placeholder="例如：章节节奏、旁白策略、对白密度、动作镜头比例。"
                      />
                      <Group grow>
                        <Select
                          data={[
                            { value: '9:16', label: '9:16 竖屏' },
                            { value: '16:9', label: '16:9 横屏' },
                            { value: '1:1', label: '1:1 方图' },
                            { value: '4:3', label: '4:3 传统' },
                          ]}
                          value={projectDraft.videoRatio}
                          label="画幅比例"
                          onChange={(value) => updateProjectDraft('videoRatio', (value as ProjectCreateDraft['videoRatio']) || '9:16')}
                        />
                        <Select
                          data={[
                            { value: 'draft', label: '草稿' },
                            { value: 'standard', label: '标准' },
                            { value: 'high', label: '高质量' },
                          ]}
                          value={projectDraft.imageQuality}
                          label="图片质量"
                          onChange={(value) => updateProjectDraft('imageQuality', (value as ProjectCreateDraft['imageQuality']) || 'standard')}
                        />
                      </Group>
                      <Group grow>
                        <TextInput
                          label="图片模型"
                          value={projectDraft.imageModel}
                          onChange={(event) => updateProjectDraft('imageModel', event.currentTarget.value)}
                          placeholder="可选，后续可修改"
                        />
                        <TextInput
                          label="视频模型"
                          value={projectDraft.videoModel}
                          onChange={(event) => updateProjectDraft('videoModel', event.currentTarget.value)}
                          placeholder="可选，后续可修改"
                        />
                      </Group>
                    </Stack>
                  </Collapse>
                  {createKind === 'project' && busy && createStage !== 'idle' ? (
                    <Stack gap={6}>
                      <Text size="sm">{getCreateProjectStageLabel(createStage)}</Text>
                      {createUploadProgress && createUploadProgress.total > 0 ? (
                        <>
                          <Progress
                            value={(createUploadProgress.completed / createUploadProgress.total) * 100}
                            size="sm"
                            radius="md"
                          />
                          <Text size="xs" c="dimmed">
                            {`上传分块 ${createUploadProgress.completed}/${createUploadProgress.total}`}
                          </Text>
                        </>
                      ) : (
                        <Text size="xs" c="dimmed">当前步骤需要等待服务端完成，期间不会自动降级或跳过。</Text>
                      )}
                    </Stack>
                  ) : null}
                  {createError ? (
                    <Text size="sm" c="red">{createError}</Text>
                  ) : null}
                  <InlinePanel>
                    <Text size="sm" fw={700}>创建完成后还会继续往下走</Text>
                    <Text size="xs" c="dimmed" mt={6}>这一步不是只创建空项目，后面还会继续处理：</Text>
                    <Stack gap={4} mt={8}>
                      <Text size="xs">- 原文进入导入链路</Text>
                      <Text size="xs">- 项目级画风与导演规则被保存</Text>
                      <Text size="xs">- 自动补齐章节目录</Text>
                      <Text size="xs">- 尝试自动进入第一章或最近可编辑章节</Text>
                    </Stack>
                  </InlinePanel>
                </>
              ) : null}
              <Group className="tc-pm__modal-actions" justify="flex-end">
                <Button className="tc-pm__modal-cancel" variant="subtle" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button className="tc-pm__modal-create" onClick={() => void handleCreate()} loading={busy} disabled={!nameDraft.trim() || (createKind === 'project' && !projectTextFile)}>
                  {createKind === 'project' ? '创建并进入章节' : '创建'}
                </Button>
              </Group>
            </Stack>
          </Modal>

          <Modal className="tc-pm__modal" opened={Boolean(renameNodeId)} onClose={() => setRenameNodeId(null)} title="重命名" centered>
            <Stack className="tc-pm__modal-stack" gap="sm">
              <TextInput
                className="tc-pm__modal-input"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                }}
              />
              <Group className="tc-pm__modal-actions" justify="flex-end">
                <Button className="tc-pm__modal-cancel" variant="subtle" onClick={() => setRenameNodeId(null)}>取消</Button>
                <Button className="tc-pm__modal-create" onClick={() => void commitRename()} loading={renameBusy} disabled={!renameDraft.trim() || renameBusy}>
                  保存
                </Button>
              </Group>
            </Stack>
          </Modal>

          <ProjectAssetsViewer
            opened={Boolean(assetsViewerProject)}
            projectId={assetsViewerProject?.id || ''}
            projectName={assetsViewerProject?.name || ''}
            onClose={() => setAssetsViewerProject(null)}
          />

          <Menu
            opened={Boolean(contextMenu)}
            onClose={() => setContextMenu(null)}
            withinPortal
            position="bottom-start"
            shadow="md"
            classNames={{
              dropdown: 'tc-pm__card-menu-dropdown',
              item: 'tc-pm__card-menu-item',
            }}
          >
            <Menu.Target>
              <Box
                className="tc-pm__context-anchor"
                style={{
                  position: 'fixed',
                  left: contextMenu?.x ?? -9999,
                  top: contextMenu?.y ?? -9999,
                  width: 1,
                  height: 1,
                  pointerEvents: 'none',
                }}
              />
            </Menu.Target>
            <Menu.Dropdown>
              {(() => {
                const nodeId = contextMenu?.nodeId
                if (!nodeId) return null
                const node = fs.nodesById[nodeId]
                if (!node || node.kind !== 'project') return null
                return (
                  <Menu.Item
                    leftSection={<IconPhoto className="tc-pm__menu-icon" size={14} />}
                    onClick={() => {
                      setContextMenu(null)
                      openProjectAssets(node)
                    }}
                  >
                    项目记忆库
                  </Menu.Item>
                )
              })()}
              {(() => {
                const nodeId = contextMenu?.nodeId
                if (!nodeId) return null
                const node = fs.nodesById[nodeId]
                if (!node || node.kind !== 'project') return null
                return <Menu.Divider />
              })()}
              {contextMenu?.nodeId && contextMenu.nodeId !== fs.rootId && (
                <Menu.Item
                  leftSection={<IconEdit className="tc-pm__menu-icon" size={14} />}
                  onClick={() => {
                    const id = contextMenu.nodeId
                    setContextMenu(null)
                    if (!id) return
                    startRename(id)
                  }}
                >
                  重命名
                </Menu.Item>
              )}
              {contextMenu?.nodeId && contextMenu.nodeId !== fs.rootId && (
                <Menu.Item
                  className="tc-pm__card-menu-item--danger"
                  color="red"
                  leftSection={<IconTrash className="tc-pm__menu-icon" size={14} />}
                  onClick={() => {
                    const id = contextMenu.nodeId
                    setContextMenu(null)
                    if (!id) return
                    void handleDelete(id)
                  }}
                >
                  删除
                </Menu.Item>
              )}
              {contextMenu?.nodeId && contextMenu.nodeId !== fs.rootId && <Menu.Divider />}
              <Menu.Item
                leftSection={<IconFolderPlus className="tc-pm__menu-icon" size={14} />}
                onClick={() => {
                  if (contextMenu?.folderId) setActiveFolderId(contextMenu.folderId)
                  setContextMenu(null)
                  openCreate('folder')
                }}
              >
                新建分组
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFilePlus className="tc-pm__menu-icon" size={14} />}
                onClick={() => {
                  if (contextMenu?.folderId) setActiveFolderId(contextMenu.folderId)
                  setContextMenu(null)
                  openCreate('project')
                }}
              >
                上传原文创建项目
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </GithubGate>
      </AppShell.Main>
    </AppShell>
  )
}
