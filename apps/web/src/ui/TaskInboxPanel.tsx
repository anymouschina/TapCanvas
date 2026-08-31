import React from 'react'
import {
  ActionIcon,
  Button,
  Loader,
  SegmentedControl,
  Tabs,
  Text,
  Title,
  Tooltip,
  Transition,
} from '@mantine/core'
import {
  IconActivity,
  IconBrain,
  IconCircleCheck,
  IconMusic,
  IconPlayerPlay,
  IconRefresh,
  IconX,
  IconExclamationCircle,
  IconLoader2,
  IconPlayerPause,
} from '@tabler/icons-react'

import { useAuth } from '../auth/store'
import type { TaskInboxItemDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { PanelCard } from './PanelCard'
import { useUIStore } from './uiStore'
import { useTaskInbox } from './useTaskInbox'
import { TaskInboxDetail } from './TaskInboxDetail'
import { CreativeAgentActivityRow } from './CreativeAgentActivityRow'
import { CreativeMemoryLens } from './CreativeMemoryLens'
import { useLiveChatRunStore } from './chat/liveChatRunStore'
import { useMemoryLens } from './useMemoryLens'
import {
  BOTTOM_BAR_PANEL_WIDTH,
  bottomBarPanelMetrics,
  bottomBarPanelStyle,
} from './utils/panelPosition'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import './TaskInboxPanel.css'

type TaskInboxFilter = 'all' | 'active' | 'succeeded' | 'failed'
type CreativeCenterView = 'activity' | 'memory'

const FILTER_VALUES = new Set<TaskInboxFilter>(['all', 'active', 'succeeded', 'failed'])

const TASK_KIND_LABELS: Readonly<Record<string, string>> = {
  chat: '对话',
  prompt_refine: '提示词优化',
  text_to_image: '文生图',
  image_to_prompt: '图生提示词',
  image_to_video: '图生视频',
  text_to_video: '文生视频',
  image_edit: '图片编辑',
  image_to_3d: '图片转 3D',
  video_enhance: '视频增强',
  video_edit: '视频编辑',
  image_remove_bg: '图片去背景',
}

function isTaskInboxFilter(value: string): value is TaskInboxFilter {
  return FILTER_VALUES.has(value as TaskInboxFilter)
}

function formatTaskTime(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

function filterTask(item: TaskInboxItemDto, filter: TaskInboxFilter): boolean {
  if (filter === 'active') return item.status === 'queued' || item.status === 'running'
  if (filter === 'succeeded') return item.status === 'succeeded'
  if (filter === 'failed') return item.status === 'failed'
  return true
}

function taskStatusPresentation(item: TaskInboxItemDto): {
  label: string
  className: string
  icon: React.ReactNode
} {
  if (item.status === 'failed') {
    return { label: '执行失败', className: 'task-inbox-panel__status--failed', icon: <IconExclamationCircle className="task-inbox-panel__status-icon" size={15} /> }
  }
  if (item.status === 'queued') {
    return { label: '等待执行', className: 'task-inbox-panel__status--waiting', icon: <IconPlayerPause className="task-inbox-panel__status-icon" size={15} /> }
  }
  if (item.status === 'running') {
    return { label: '正在执行', className: 'task-inbox-panel__status--active', icon: <IconLoader2 className="task-inbox-panel__status-icon task-inbox-panel__status-spinner" size={15} /> }
  }
  return { label: '执行成功', className: 'task-inbox-panel__status--succeeded', icon: <IconCircleCheck className="task-inbox-panel__status-icon" size={15} /> }
}

function taskAssetLabel(asset: TaskInboxItemDto['assets'][number]): string {
  if (asset.assetName?.trim()) return asset.assetName.trim()
  if (asset.type === 'video') return '生成视频'
  if (asset.type === 'audio') return '生成音频'
  return '生成图片'
}

function TaskInboxListThumbnail({
  asset,
  onPreview,
}: Readonly<{
  asset: TaskInboxItemDto['assets'][number]
  onPreview: () => void
}>): JSX.Element {
  const label = taskAssetLabel(asset)
  const thumbnailUrl = asset.thumbnailUrl?.trim() || asset.posterInline?.trim() || ''
  const imageUrl = asset.type === 'image' ? thumbnailUrl || asset.url : thumbnailUrl
  const previewAriaLabel = asset.type === 'video' ? `放大播放${label}` : `放大查看${label}`

  return (
    <button
      className="task-inbox-panel__thumbnail-button"
      type="button"
      aria-label={previewAriaLabel}
      onClick={onPreview}
    >
      <span className="task-inbox-panel__thumbnail-visual">
        {imageUrl ? (
          <ManagedImage
            className="task-inbox-panel__thumbnail-image"
            src={imageUrl}
            alt={label}
            priority="visible"
          />
        ) : asset.type === 'video' ? (
          <IconPlayerPlay className="task-inbox-panel__thumbnail-placeholder" size={18} stroke={1.6} />
        ) : (
          <IconMusic className="task-inbox-panel__thumbnail-placeholder" size={18} stroke={1.6} />
        )}
        {asset.type === 'video' ? (
          <span className="task-inbox-panel__thumbnail-play" aria-hidden="true">
            <IconPlayerPlay className="task-inbox-panel__thumbnail-play-icon" size={11} fill="currentColor" />
          </span>
        ) : null}
      </span>
    </button>
  )
}

export default function TaskInboxPanel(): JSX.Element | null {
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const anchorX = useUIStore((state) => state.panelAnchorX)
  const userId = useAuth((state) => state.user?.sub == null ? null : String(state.user.sub))
  const currentProjectId = useUIStore((state) => state.currentProject?.id?.trim() || '')
  const currentChapter = useUIStore((state) => state.currentChapter)
  const activeLiveRun = useLiveChatRunStore((state) => state.activeRun)
  const mounted = activePanel === 'task-inbox'
  const inbox = useTaskInbox(userId, mounted)
  const [filter, setFilter] = React.useState<TaskInboxFilter>('all')
  const [view, setView] = React.useState<CreativeCenterView>('activity')
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)
  const memoryLens = useMemoryLens({
    ...(currentProjectId ? { projectId: currentProjectId } : {}),
    ...(currentChapter?.bookId ? { bookId: currentChapter.bookId } : {}),
    ...(currentChapter?.chapterId ? { chapterId: currentChapter.chapterId } : {}),
  }, mounted && view === 'memory')

  const scopedAgentRun = React.useMemo(() => {
    if (!activeLiveRun) return null
    if (currentProjectId && activeLiveRun.projectId !== currentProjectId) return null
    const mirroredByDurableTask = inbox.items.some((item) => (
      item.taskId === activeLiveRun.requestId || item.taskId === activeLiveRun.runId
    ))
    if (mirroredByDurableTask) return null
    return activeLiveRun
  }, [activeLiveRun, currentProjectId, inbox.items])

  React.useEffect(() => {
    if (mounted) {
      setFilter('all')
      setView('activity')
      setSelectedTaskId(null)
    }
  }, [mounted, userId])

  const visibleItems = React.useMemo(
    () => inbox.items.filter((item) => filterTask(item, filter)),
    [filter, inbox.items],
  )
  const failedCount = React.useMemo(
    () => inbox.items.filter((item) => item.status === 'failed').length,
    [inbox.items],
  )
  const succeededCount = React.useMemo(
    () => inbox.items.filter((item) => item.status === 'succeeded').length,
    [inbox.items],
  )
  const activeCount = React.useMemo(
    () => inbox.items.filter((item) => item.status === 'queued' || item.status === 'running').length,
    [inbox.items],
  )
  const agentRunVisible = Boolean(scopedAgentRun && (
    filter === 'all'
    || (filter === 'active' && (scopedAgentRun.status === 'active' || scopedAgentRun.status === 'waiting_external' || scopedAgentRun.status === 'waiting_input'))
    || (filter === 'succeeded' && scopedAgentRun.status === 'succeeded')
    || (filter === 'failed' && (scopedAgentRun.status === 'failed' || scopedAgentRun.status === 'cancelled'))
  ))
  const selectedItem = React.useMemo(
    () => selectedTaskId ? inbox.items.find((item) => item.taskId === selectedTaskId) ?? null : null,
    [inbox.items, selectedTaskId],
  )

  const openTask = React.useCallback((item: TaskInboxItemDto): void => {
    void inbox.markRead(item)
    setSelectedTaskId(item.taskId)
  }, [inbox])

  const focusTaskNode = React.useCallback((item: TaskInboxItemDto): void => {
    if (!item.nodeId) return
    const canvasWindow = window as Window & { __tcFocusNode?: (nodeId: string) => void }
    canvasWindow.__tcFocusNode?.(item.nodeId)
  }, [])

  const previewAsset = React.useCallback((asset: TaskInboxItemDto['assets'][number]): void => {
    useUIStore.getState().openPreview({
      url: asset.url,
      kind: asset.type,
      name: asset.assetName ?? undefined,
    })
  }, [])

  const previewTaskAsset = React.useCallback((
    item: TaskInboxItemDto,
    asset: TaskInboxItemDto['assets'][number],
  ): void => {
    void inbox.markRead(item)
    previewAsset(asset)
  }, [inbox, previewAsset])

  const openAgentChat = React.useCallback((): void => {
    const chatWindow = window as Window & { __tcExpandChat?: () => void }
    chatWindow.__tcExpandChat?.()
    setActivePanel(null)
  }, [setActivePanel])

  if (!mounted) return null

  const panelMetrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.regular)
  const filters: Array<{ label: string; value: TaskInboxFilter }> = [
    { label: `全部 ${inbox.items.length + (scopedAgentRun ? 1 : 0)}`, value: 'all' },
    { label: `进行中 ${activeCount + (scopedAgentRun && (scopedAgentRun.status === 'active' || scopedAgentRun.status === 'waiting_external' || scopedAgentRun.status === 'waiting_input') ? 1 : 0)}`, value: 'active' },
    { label: `成功 ${succeededCount + (scopedAgentRun?.status === 'succeeded' ? 1 : 0)}`, value: 'succeeded' },
    { label: `失败 ${failedCount + (scopedAgentRun && (scopedAgentRun.status === 'failed' || scopedAgentRun.status === 'cancelled') ? 1 : 0)}`, value: 'failed' },
  ]

  return (
    <div
      className="task-inbox-panel__anchor"
      style={{
        ...bottomBarPanelStyle(anchorX, { zIndex: 340, halfWidth: panelMetrics.width / 2 }),
        width: panelMetrics.width,
      }}
      data-ux-panel
    >
      <Transition
        className="task-inbox-panel__transition"
        mounted={mounted}
        transition="pop"
        duration={140}
        timingFunction="ease"
      >
        {(transitionStyles) => (
          <div className="task-inbox-panel__transition-inner" style={transitionStyles}>
            <PanelCard
              className="task-inbox-panel__shell"
              padding="compact"
              style={{ height: panelMetrics.height, maxHeight: panelMetrics.height }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="task-inbox-panel__header">
                <div className="task-inbox-panel__heading">
                  <IconActivity className="task-inbox-panel__heading-icon" size={18} stroke={1.8} />
                  <Title className="task-inbox-panel__title" order={5}>创作动态</Title>
                </div>
                <div className="task-inbox-panel__header-actions">
                  <Tooltip className="task-inbox-panel__tooltip" label="刷新" withArrow>
                    <ActionIcon
                      className="task-inbox-panel__icon-button"
                      variant="subtle"
                      size="sm"
                      aria-label={view === 'memory' ? '刷新记忆' : '刷新创作动态'}
                      disabled={view === 'memory' ? memoryLens.loading : inbox.loading}
                      onClick={view === 'memory' ? memoryLens.reload : inbox.reload}
                    >
                      <IconRefresh className="task-inbox-panel__action-icon" size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip className="task-inbox-panel__tooltip" label="关闭" withArrow>
                    <ActionIcon
                      className="task-inbox-panel__icon-button"
                      variant="subtle"
                      size="sm"
                      aria-label="关闭创作动态"
                      onClick={() => setActivePanel(null)}
                    >
                      <IconX className="task-inbox-panel__action-icon" size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              </div>

              {!selectedItem ? (
                <Tabs className="task-inbox-panel__tabs" value={view} onChange={(value) => setView(value === 'memory' ? 'memory' : 'activity')}>
                  <Tabs.List className="task-inbox-panel__tabs-list">
                    <Tabs.Tab className="task-inbox-panel__tab" value="activity" leftSection={<IconActivity className="task-inbox-panel__tab-icon" size={13} />}>动态</Tabs.Tab>
                    <Tabs.Tab className="task-inbox-panel__tab" value="memory" leftSection={<IconBrain className="task-inbox-panel__tab-icon" size={13} />}>记忆 {memoryLens.itemCount || ''}</Tabs.Tab>
                  </Tabs.List>
                </Tabs>
              ) : null}

              {!selectedItem && view === 'activity' ? (
                <SegmentedControl
                  className="task-inbox-panel__filters"
                  value={filter}
                  onChange={(value) => {
                    if (isTaskInboxFilter(value)) setFilter(value)
                  }}
                  data={filters}
                  fullWidth
                  size="xs"
                />
              ) : null}

              <div className="task-inbox-panel__content">
                {selectedItem ? (
                  <TaskInboxDetail
                    item={selectedItem}
                    title={TASK_KIND_LABELS[selectedItem.kind] ?? selectedItem.kind}
                    onBack={() => setSelectedTaskId(null)}
                    onPreview={previewAsset}
                    onFocusNode={() => focusTaskNode(selectedItem)}
                  />
                ) : view === 'memory' ? (
                  <CreativeMemoryLens state={memoryLens} />
                ) : inbox.loading && inbox.items.length === 0 && !scopedAgentRun ? (
                  <div className="task-inbox-panel__state" role="status" aria-label="正在加载创作动态">
                    <Loader className="task-inbox-panel__loader" size="sm" />
                  </div>
                ) : inbox.error ? (
                  <div className="task-inbox-panel__state task-inbox-panel__state--error" role="alert">
                    <Text className="task-inbox-panel__state-text" size="sm">{inbox.error}</Text>
                    <Button className="task-inbox-panel__retry" variant="subtle" size="compact-xs" onClick={inbox.reload}>重试</Button>
                  </div>
                ) : visibleItems.length === 0 && !agentRunVisible ? (
                  <div className="task-inbox-panel__state">
                    <IconActivity className="task-inbox-panel__empty-icon" size={24} stroke={1.5} />
                    <Text className="task-inbox-panel__state-text" size="sm" c="dimmed">当前筛选下没有创作动态</Text>
                  </div>
                ) : (
                  <div className="task-inbox-panel__list">
                    {agentRunVisible && scopedAgentRun ? (
                      <CreativeAgentActivityRow run={scopedAgentRun} onOpenChat={openAgentChat} />
                    ) : null}
                    {visibleItems.map((item) => {
                      const status = taskStatusPresentation(item)
                      const unread = Boolean(item.notificationId && !item.readAt)
                      const primaryAsset = item.assets[0] ?? null
                      return (
                        <div
                          className={`task-inbox-panel__item${unread ? ' task-inbox-panel__item--unread' : ''}`}
                          key={item.taskId}
                        >
                          <button
                            className="task-inbox-panel__item-main"
                            type="button"
                            onClick={() => openTask(item)}
                            aria-label={`${TASK_KIND_LABELS[item.kind] ?? item.kind}，${status.label}，查看任务事实和全部产物`}
                          >
                            <span className={`task-inbox-panel__status ${status.className}`}>
                              {status.icon}
                            </span>
                            <span className="task-inbox-panel__item-body">
                              <span className="task-inbox-panel__item-title-row">
                                <span className="task-inbox-panel__item-title">{TASK_KIND_LABELS[item.kind] ?? item.kind}</span>
                                {unread ? <span className="task-inbox-panel__unread-dot" aria-label="未读" /> : null}
                              </span>
                              <span className="task-inbox-panel__item-meta">
                                <span className="task-inbox-panel__item-status-label">{status.label}</span>
                                <span className="task-inbox-panel__item-separator">·</span>
                                <span className="task-inbox-panel__item-vendor">{item.vendor}</span>
                                {item.assetCount > 0 ? <span className="task-inbox-panel__item-assets">· {item.assetCount} 个资产</span> : null}
                              </span>
                            </span>
                            <time className="task-inbox-panel__item-time" dateTime={item.updatedAt}>{formatTaskTime(item.updatedAt)}</time>
                            <span className="task-inbox-panel__preview-hint">详情</span>
                          </button>
                          {primaryAsset ? (
                            <TaskInboxListThumbnail
                              asset={primaryAsset}
                              onPreview={() => previewTaskAsset(item, primaryAsset)}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {!selectedItem && view === 'activity' && !inbox.loading && !inbox.error && inbox.hasMore ? (
                <div className="task-inbox-panel__footer">
                  <Button
                    className="task-inbox-panel__load-more"
                    variant="subtle"
                    size="compact-xs"
                    loading={inbox.loadingMore}
                    onClick={inbox.loadMore}
                  >
                    加载更多
                  </Button>
                </div>
              ) : null}
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
