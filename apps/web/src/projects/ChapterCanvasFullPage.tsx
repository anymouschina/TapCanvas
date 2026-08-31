import React from 'react'
import { AppShell, Box, Group, ActionIcon, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconHome, IconDeviceFloppy, IconCheck, IconShare2, IconLayoutColumns, IconActivityHeartbeat } from '@tabler/icons-react'
import { useUIStore } from '../ui/uiStore'
import { useIsAdmin } from '../auth/isAdmin'
import AgentAdminWorkbenchPanel from '../ui/AgentAdminWorkbenchPanel'
import { useAgentCanvasDeepLink } from '../ui/agent-task-execution/useAgentCanvasDeepLink'
import { useRFStore } from '../canvas/store'
import GithubGate from '../auth/GithubGate'
import BodyPortal from '../ui/BodyPortal'
import { CanvasLoadingScreen } from '../ui/CanvasLoadingScreen'
import FloatingNav from '../ui/FloatingNav'
import AddNodePanel from '../ui/AddNodePanel'
import TemplatePanel from '../ui/TemplatePanel'
import ProjectPanel from '../ui/ProjectPanel'
import AssetManagerDrawer from '../ui/AssetManagerDrawer'
import CanvasStyleLibraryPanel from '../ui/styleLibrary/CanvasStyleLibraryPanel'
import CanvasCharacterLibraryPanel from '../ui/assets/CanvasCharacterLibraryPanel'
import ModelPanel from '../ui/ModelPanel'
import HistoryPanel from '../ui/HistoryPanel'
import GenerationHistoryPanel from '../ui/GenerationHistoryPanel'
import TaskInboxPanel from '../ui/TaskInboxPanel'
import { ExecutionLogModal } from '../ui/ExecutionLogModal'
import { WorkflowExecutionSnapshotHost } from '../ui/WorkflowExecutionSnapshotHost'
import AiChatDialog from '../ui/chat/AiChatDialog'
import { ProjectLookBibleChip } from '../ui/projectLookBible/ProjectLookBibleChip'
import { RoleSkillConfigLauncher } from '../ui/chat/RoleSkillConfigModal'
import { ChapterCreativeSettingsPopover } from '../ui/chapter/ChapterCreativeSettingsPopover'
import DirectorPetLauncher from '../ui/DirectorPetLauncher'
import PreviewModal from '../ui/PreviewModal'
import { PublishModal } from '../ui/PublishModal'
import { ToastHost } from '../ui/toast'
import { IntentProgressToast } from '../ui/IntentProgressToast'
import { useAuth } from '../auth/store'
import ChapterCanvasPage from './ChapterCanvasPage'
import { getChapterWorkbench, getProjectBookChapter } from '../api/server'
import type { ChapterCreativeOverride } from '../api/server'
import { parseChapterCreativeOverride } from './chapterCreative'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import {
  applyChapterProjectRouteMetadata,
  useChapterProjectRouteBinding,
} from './useChapterProjectRouteBinding'
import {
  CHAPTER_META_UPDATED_EVENT,
  readChapterMetaUpdate,
} from './chapterMetaEvents'

type ChapterCanvasFullPageProps = {
  projectId: string
  bookId: string | null
  chapterId: string
}

type ChapterMeta = {
  chapterId: string
  projectName: string
  chapterTitle: string
  chapterText: string
  creativeOverride: ChapterCreativeOverride | null
}

// 章节 meta（标题/正文）按 chapterId 的进程内缓存。切章时 getChapterWorkbench 是异步网络请求，
// 若不缓存，`meta` 状态会在切章后短暂仍是【上一章】的正文，被当作种子文本喂给当前章 →
// 画面先显示上一章的文本节点（用户报的「先展示上个章节的文本」根因之一）。
// 暖切（本会话访问过的章节）从此缓存同步取到正确 meta，冷切退回空文本占位（绝不用错章文本）。
const chapterMetaMemCache = new Map<string, ChapterMeta>()

export default function ChapterCanvasFullPage({
  projectId,
  bookId,
  chapterId,
}: ChapterCanvasFullPageProps): JSX.Element {
  const auth = useAuth()
  const isAdmin = useIsAdmin()
  const setCurrentChapterCreativeOverride = useUIStore((s) => s.setCurrentChapterCreativeOverride)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const [workbenchOpen, setWorkbenchOpen] = React.useState(false)
  const [meta, setMeta] = React.useState<ChapterMeta | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [effectiveBookId, setEffectiveBookId] = React.useState<string | null>(bookId)
  const saveRef = React.useRef<(() => Promise<void>) | null>(null)
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle')
  const [publishModalOpen, setPublishModalOpen] = React.useState(false)
  const [executionLogId, setExecutionLogId] = React.useState<string | null>(null)
  const savedTimerRef = React.useRef<number | null>(null)

  useAgentCanvasDeepLink({
    projectId,
    chapterId,
    routeKey: `${projectId}:${chapterId}`,
    onOpenExecutionWorkbench: () => setWorkbenchOpen(true),
  })

  // 章节路由是项目上下文的唯一生命周期 owner。先按 URL 同步绑定 projectId，
  // 让目录/资产面板无需等待 workbench 请求即可加载；workbench 返回后再补齐真实名称与团队。
  // StrictMode 会重放 setup → cleanup → setup，因此 cleanup 必须与 setup 在同一层成对存在。
  useChapterProjectRouteBinding(projectId)

  const handleManualSave = React.useCallback(async () => {
    if (!saveRef.current || saveState === 'saving') return
    setSaveState('saving')
    try {
      await saveRef.current()
      setSaveState('saved')
      if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('idle')
    }
  }, [saveState])

  React.useEffect(() => {
    setCurrentChapterCreativeOverride(null)
    let alive = true
    ;(async () => {
      try {
        const wb = await getChapterWorkbench(chapterId)
        if (!alive) return
        const projectName = wb.project?.name || ''
        applyChapterProjectRouteMetadata({
          projectId,
          projectName,
          teamId: wb.project.teamId ?? null,
        })
        let chapterText = wb.chapter.summary ?? ''
        const sourceBookId = wb.chapter.sourceBookId
        const sourceBookChapter = wb.chapter.sourceBookChapter
        if ((!chapterText || !chapterText.trim()) && sourceBookId && sourceBookChapter != null) {
          try {
            const bc = await getProjectBookChapter(projectId, sourceBookId, sourceBookChapter)
            if (alive && bc?.content) chapterText = bc.content
          } catch {
            // fall through with empty text; ChapterCanvasPage will show placeholder
          }
        }
        if (!alive) return
        const resolvedBookId = bookId || (sourceBookId ? String(sourceBookId).trim() : null) || null
        setEffectiveBookId(resolvedBookId)
        const resolvedMeta: ChapterMeta = {
          chapterId,
          projectName,
          chapterTitle: wb.chapter.title || '(untitled)',
          chapterText,
          creativeOverride: parseChapterCreativeOverride(wb.chapter.styleProfileOverride),
        }
        chapterMetaMemCache.set(chapterId, resolvedMeta)
        setMeta(resolvedMeta)
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [chapterId, projectId, bookId, setCurrentChapterCreativeOverride])

  const handleGoHome = React.useCallback(() => {
    spaNavigate('/')
  }, [])

  const handleOpenProjectCanvas = React.useCallback(async () => {
    if (saveRef.current) await saveRef.current()
    spaNavigate(buildStudioUrl({ projectId, ownerType: 'project', ownerId: projectId }))
  }, [projectId])

  // 当前章节权威 meta：仅当 `meta` 状态确属当前 chapterId 才用它，否则退回按章缓存（暖切同步命中）。
  // 绝不把上一章的 meta（陈旧 `meta` 状态）当作当前章的种子文本，从根上消除「先显示上一章文本」。
  const activeMeta = (meta && meta.chapterId === chapterId)
    ? meta
    : (chapterMetaMemCache.get(chapterId) ?? null)

  React.useEffect(() => {
    setCurrentChapterCreativeOverride(activeMeta?.creativeOverride ?? null)
    return () => setCurrentChapterCreativeOverride(null)
  }, [activeMeta?.chapterId, activeMeta?.creativeOverride, chapterId, setCurrentChapterCreativeOverride])

  const handleChapterCreativeOverrideChange = React.useCallback((next: ChapterCreativeOverride | null) => {
    setMeta((current) => current && current.chapterId === chapterId
      ? { ...current, creativeOverride: next }
      : current)
    const cached = chapterMetaMemCache.get(chapterId)
    if (cached) chapterMetaMemCache.set(chapterId, { ...cached, creativeOverride: next })
    setCurrentChapterCreativeOverride(next)
  }, [chapterId, setCurrentChapterCreativeOverride])

  React.useEffect(() => {
    const handleChapterMetaUpdate = (event: Event) => {
      const update = readChapterMetaUpdate(event)
      if (!update || update.chapterId !== chapterId) return
      setMeta((current) => {
        if (!current || current.chapterId !== chapterId) return current
        const next: ChapterMeta = {
          ...current,
          chapterTitle: update.title,
          chapterText: update.summary,
        }
        chapterMetaMemCache.set(chapterId, next)
        return next
      })
    }
    window.addEventListener(CHAPTER_META_UPDATED_EVENT, handleChapterMetaUpdate)
    return () => window.removeEventListener(CHAPTER_META_UPDATED_EVENT, handleChapterMetaUpdate)
  }, [chapterId])

  // 一旦渲染过章节画布就保持挂载：冷切（新章 meta 尚未到）也不回退到「加载中」占位，
  // 否则会卸载 ChapterCanvasPage → Canvas 重挂，倒退回之前根治过的切章重挂闪烁。
  const everRenderedPageRef = React.useRef(false)
  const showChapterPage = !!activeMeta || everRenderedPageRef.current
  if (showChapterPage) everRenderedPageRef.current = true

  return (
    <AppShell
      data-compact={'false'}
      header={{ height: 0, offset: false }}
      padding={0}
      styles={{
        main: {
          paddingTop: 0,
          paddingLeft: 0,
          paddingRight: 0,
          background: 'var(--mantine-color-body)',
          overflow: 'hidden',
        },
      }}
    >
      <AppShell.Header className="app-shell-header" />
      <AppShell.Main className="app-shell-main">
        <Box
          className="app-shell-main-box"
          onClick={(e) => {
            const el = e.target as HTMLElement
            if (!el.closest('[data-ux-floating]') && !el.closest('[data-ux-panel]')) {
              setActivePanel(null)
            }
          }}
        >
          <GithubGate className="app-github-gate">
            {err ? (
              <div className="chapter-canvas-error" style={{ padding: 16, color: 'red' }}>{err}</div>
            ) : !showChapterPage ? (
              <CanvasLoadingScreen fixed />
            ) : (
              <ChapterCanvasPage
                projectId={projectId}
                bookId={effectiveBookId}
                chapterId={chapterId}
                chapterTitle={activeMeta?.chapterTitle ?? ''}
                chapterText={activeMeta?.chapterText ?? ''}
                saveRef={saveRef}
              />
            )}
          </GithubGate>
        </Box>
      </AppShell.Main>

      <ToastHost className="app-toast-host" />
      <IntentProgressToast />
      <ExecutionLogModal
        className="chapter-execution-log-modal"
        opened={Boolean(executionLogId)}
        executionId={executionLogId}
        onClose={() => setExecutionLogId(null)}
      />
      <WorkflowExecutionSnapshotHost
        onOpenLog={setExecutionLogId}
      />

      <BodyPortal>
        <div className="app-header-overlay">
          <Group className="app-header" justify="space-between" p="sm" wrap="nowrap">
            <Group className="app-header-left" gap="xs" wrap="nowrap">
              <Tooltip label="返回首页">
                <ActionIcon variant="subtle" aria-label="返回首页" onClick={handleGoHome}>
                  <IconArrowLeft size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="项目画布">
                <ActionIcon variant="subtle" aria-label="打开项目画布" onClick={() => { void handleOpenProjectCanvas() }}>
                  <IconHome size={18} />
                </ActionIcon>
              </Tooltip>
              {/* 返回与项目画布各自有明确入口；章节标题已去除（标题在内容区可见）。 */}
            </Group>
            <Group className="app-header-actions" gap="xs" wrap="nowrap">
              {auth.user && !auth.user.guest ? (
                <Tooltip label="AI 执行台：查看当前任务进度与交付证据">
                  <ActionIcon
                    className="chapter-ai-admin-workbench-entry"
                    variant="subtle"
                    aria-label="AI 执行台"
                    onClick={() => setWorkbenchOpen(true)}
                  >
                    <IconActivityHeartbeat className="chapter-ai-execution-workbench-icon" size={18} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              <ChapterCreativeSettingsPopover
                projectId={projectId}
                chapterId={chapterId}
                override={activeMeta?.creativeOverride ?? null}
                onOverrideChange={handleChapterCreativeOverrideChange}
              />
              <ProjectLookBibleChip projectId={projectId} portalTargetId={null} />
              {auth.user ? <RoleSkillConfigLauncher projectId={projectId} portalTargetId={null} /> : null}
              <Tooltip label="一键整理：内容节点自动分列，工作流组按执行链对齐">
                <ActionIcon
                  className="app-tidy-button"
                  variant="subtle"
                  aria-label="一键整理"
                  onClick={() => useRFStore.getState().tidyByCategory({ arrangeWorkflowGroups: true })}
                >
                  <IconLayoutColumns size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={saveState === 'saved' ? '已保存' : '手动保存'}>
                <ActionIcon
                  variant="subtle"
                  aria-label="手动保存"
                  loading={saveState === 'saving'}
                  color={saveState === 'saved' ? 'teal' : undefined}
                  onClick={handleManualSave}
                >
                  {saveState === 'saved' ? <IconCheck size={18} /> : <IconDeviceFloppy size={18} />}
                </ActionIcon>
              </Tooltip>
              <Tooltip label="发布到 TapCanvas Show">
                <ActionIcon variant="subtle" aria-label="发布" onClick={() => setPublishModalOpen(true)}>
                  <IconShare2 size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </div>
        <FloatingNav className="app-floating-nav" />
        {auth.user ? (
          <>
            <DirectorPetLauncher />
            <AiChatDialog className="app-ai-chat-dialog" />
          </>
        ) : null}
        <AddNodePanel className="app-add-node-panel" />
        <TemplatePanel className="app-template-panel" />
        <CanvasStyleLibraryPanel />
        <CanvasCharacterLibraryPanel />
        <ProjectPanel />
        <AssetManagerDrawer />
        <ModelPanel />
        <HistoryPanel
          onOpenLog={setExecutionLogId}
          onFocusNode={(nodeId) => {
            const target = window as unknown as { __tcFocusNode?: (id: string) => void }
            target.__tcFocusNode?.(nodeId)
          }}
        />
        <GenerationHistoryPanel />
        <TaskInboxPanel />
      </BodyPortal>
      {auth.user && !auth.user.guest ? (
        <AgentAdminWorkbenchPanel
          className="chapter-agent-admin-workbench-panel"
          opened={workbenchOpen}
          projectId={projectId}
          bookId={effectiveBookId}
          chapterId={chapterId}
          canEditGlobal={isAdmin}
          canEditProject={isAdmin}
          adminCapabilities={isAdmin}
          onClose={() => setWorkbenchOpen(false)}
        />
      ) : null}
      <PreviewModal />
      <PublishModal
        opened={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        projectId={projectId}
        projectName={activeMeta?.projectName || ''}
        sourceName={activeMeta?.chapterTitle || ''}
        sourceLabel={`${activeMeta?.projectName || '未命名项目'} · 章节`}
        ownerType="chapter"
        ownerId={chapterId}
        sourceChapterTitle={activeMeta?.chapterTitle || ''}
      />
    </AppShell>
  )
}
