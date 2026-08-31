import React from 'react'
import {
  ActionIcon,
  Badge,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tooltip,
  Transition,
} from '@mantine/core'
import {
  IconCamera,
  IconDeviceFloppy,
  IconFileText,
  IconPlayerPlay,
  IconRefresh,
  IconRestore,
  IconTarget,
  IconX,
} from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import {
  createFlowVersionSnapshot,
  getWorkflowExecutionMetrics,
  listFlowVersionsPage,
  listWorkflowExecutionHistoryPage,
  resumeWorkflowExecution,
  rerunWorkflowExecutionSnapshot,
  rollbackFlow,
  type FlowVersionListItemDto,
  type WorkflowExecutionDto,
  type WorkflowExecutionMetricsDto,
} from '../api/server'
import {
  BOTTOM_BAR_PANEL_WIDTH,
  bottomBarPanelMetrics,
  bottomBarPanelStyle,
} from './utils/panelPosition'
import { PanelCard } from './PanelCard'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { toast } from './toast'
import {
  formatWorkflowExecutionDuration,
  workflowExecutionStatusLabel,
  workflowFocusNodePrefix,
  workflowNodeRunStatusLabel,
} from './workflowExecutionHistory'
import { WorkflowExecutionSnapshotModal } from './WorkflowExecutionSnapshotModal'
import './HistoryPanel.css'

type HistoryMode = 'executions' | 'versions'
type ExecutionScope = 'all' | 'current'

function executionStatusColor(status: WorkflowExecutionDto['status']): string {
  if (status === 'success') return 'teal'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'blue'
  if (status === 'queued') return 'yellow'
  return 'gray'
}

function triggerLabel(trigger: string | null | undefined): string {
  if (trigger === 'manual') return '手动触发'
  if (trigger === 'schedule') return '定时触发'
  if (trigger === 'api') return 'API 触发'
  if (trigger === 'agent') return 'Agent 触发'
  return trigger?.trim() || '触发来源未记录'
}

function historyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `${fallback}：请求超过 15 秒，请稍后刷新`
  }
  return error instanceof Error ? error.message : fallback
}

function mergeById<T extends Readonly<{ id: string }>>(current: T[], incoming: T[]): T[] {
  const existingIds = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !existingIds.has(item.id))]
}

export default function HistoryPanel(props: Readonly<{
  onOpenLog: (executionId: string) => void
  onFocusNode?: (nodeId: string) => void
  onVersionRestored?: () => Promise<void> | void
}>): React.JSX.Element | null {
  const active = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const anchorX = useUIStore((state) => state.panelAnchorX)
  const currentFlowId = useUIStore((state) => state.currentFlow.id?.trim() ?? '')
  const mounted = active === 'history'
  const [mode, setMode] = React.useState<HistoryMode>('executions')
  const [executionScope, setExecutionScope] = React.useState<ExecutionScope>('all')
  const [executions, setExecutions] = React.useState<WorkflowExecutionDto[]>([])
  const [executionCursor, setExecutionCursor] = React.useState<string | null>(null)
  const [executionLoading, setExecutionLoading] = React.useState(false)
  const [executionLoadingMore, setExecutionLoadingMore] = React.useState(false)
  const [executionError, setExecutionError] = React.useState<string | null>(null)
  const [versions, setVersions] = React.useState<FlowVersionListItemDto[]>([])
  const [versionCursor, setVersionCursor] = React.useState<string | null>(null)
  const [versionLoading, setVersionLoading] = React.useState(false)
  const [versionLoadingMore, setVersionLoadingMore] = React.useState(false)
  const [versionError, setVersionError] = React.useState<string | null>(null)
  const [rerunningId, setRerunningId] = React.useState<string | null>(null)
  const [resumingId, setResumingId] = React.useState<string | null>(null)
  const [metrics, setMetrics] = React.useState<WorkflowExecutionMetricsDto | null>(null)
  const [restoringVersionId, setRestoringVersionId] = React.useState<string | null>(null)
  const [savingVersion, setSavingVersion] = React.useState(false)
  const [snapshotExecutionId, setSnapshotExecutionId] = React.useState<string | null>(null)
  const executionRequestSequence = React.useRef(0)
  const versionRequestSequence = React.useRef(0)
  const metricsRequestSequence = React.useRef(0)
  const polling = React.useRef(false)

  const loadExecutions = React.useCallback(async (options: Readonly<{
    append?: boolean
    silent?: boolean
    cursor?: string
  }> = {}): Promise<void> => {
    if (!mounted) return
    const scopedFlowId = executionScope === 'current' ? currentFlowId : undefined
    if (executionScope === 'current' && !scopedFlowId) {
      setExecutions([])
      setExecutionCursor(null)
      setExecutionError(null)
      return
    }
    const append = options.append === true
    const requestId = executionRequestSequence.current + 1
    executionRequestSequence.current = requestId
    if (!options.silent) {
      if (append) setExecutionLoadingMore(true)
      else setExecutionLoading(true)
    }
    setExecutionError(null)
    try {
      const page = await listWorkflowExecutionHistoryPage({
        ...(scopedFlowId ? { flowId: scopedFlowId } : {}),
        ...(append && options.cursor ? { cursor: options.cursor } : {}),
        limit: 40,
      })
      if (executionRequestSequence.current !== requestId) return
      setExecutions((current) => append ? mergeById(current, page.items) : page.items)
      setExecutionCursor(page.nextCursor)
    } catch (error: unknown) {
      if (executionRequestSequence.current !== requestId) return
      const message = historyErrorMessage(error, '无法读取执行记录')
      if (append) toast(message, 'error')
      else setExecutionError(message)
    } finally {
      if (executionRequestSequence.current === requestId && !options.silent) {
        setExecutionLoading(false)
        setExecutionLoadingMore(false)
      }
    }
  }, [currentFlowId, executionScope, mounted])

  const loadMetrics = React.useCallback(async (): Promise<void> => {
    if (!mounted) return
    const scopedFlowId = executionScope === 'current' ? currentFlowId : undefined
    if (executionScope === 'current' && !scopedFlowId) {
      setMetrics(null)
      return
    }
    const requestId = metricsRequestSequence.current + 1
    metricsRequestSequence.current = requestId
    try {
      const nextMetrics = await getWorkflowExecutionMetrics(scopedFlowId)
      if (metricsRequestSequence.current === requestId) setMetrics(nextMetrics)
    } catch {
      if (metricsRequestSequence.current === requestId) setMetrics(null)
    }
  }, [currentFlowId, executionScope, mounted])

  const loadVersions = React.useCallback(async (options: Readonly<{
    append?: boolean
    cursor?: string
  }> = {}): Promise<void> => {
    if (!mounted || !currentFlowId) {
      setVersions([])
      setVersionCursor(null)
      setVersionError(null)
      return
    }
    const requestId = versionRequestSequence.current + 1
    versionRequestSequence.current = requestId
    const append = options.append === true
    if (append) setVersionLoadingMore(true)
    else setVersionLoading(true)
    setVersionError(null)
    try {
      const page = await listFlowVersionsPage({
        flowId: currentFlowId,
        ...(append && options.cursor ? { cursor: options.cursor } : {}),
        limit: 40,
      })
      if (versionRequestSequence.current !== requestId) return
      setVersions((current) => append ? mergeById(current, page.items) : page.items)
      setVersionCursor(page.nextCursor)
    } catch (error: unknown) {
      if (versionRequestSequence.current !== requestId) return
      const message = historyErrorMessage(error, '无法读取保存版本')
      if (append) toast(message, 'error')
      else setVersionError(message)
    } finally {
      if (versionRequestSequence.current === requestId) {
        setVersionLoading(false)
        setVersionLoadingMore(false)
      }
    }
  }, [currentFlowId, mounted])

  React.useEffect(() => {
    void loadExecutions()
    void loadMetrics()
    return () => {
      executionRequestSequence.current += 1
      metricsRequestSequence.current += 1
    }
  }, [loadExecutions, loadMetrics])

  React.useEffect(() => {
    if (mode !== 'versions') return
    void loadVersions()
    return () => { versionRequestSequence.current += 1 }
  }, [loadVersions, mode])

  React.useEffect(() => {
    if (
      executionLoading
      || !mounted
      || !executions.some((execution) => execution.status === 'queued' || execution.status === 'running')
    ) return
    const timer = window.setInterval(() => {
      if (polling.current) return
      polling.current = true
      void loadExecutions({ silent: true }).finally(() => { polling.current = false })
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [executionLoading, executions, loadExecutions, mounted])

  const refreshCurrentMode = React.useCallback(async (): Promise<void> => {
    if (mode === 'versions') {
      await loadVersions()
      return
    }
    await Promise.all([loadExecutions(), loadMetrics()])
  }, [loadExecutions, loadMetrics, loadVersions, mode])

  const rerun = React.useCallback(async (execution: WorkflowExecutionDto): Promise<void> => {
    if (rerunningId) return
    const confirmed = window.confirm(
      `使用 ${new Date(execution.createdAt).toLocaleString('zh-CN', { hour12: false })} 的不可变快照重新运行？\n\n这会创建一条新的执行记录，可能再次产生模型或媒体费用；不会修改当前画布和原历史记录。`,
    )
    if (!confirmed) return
    setRerunningId(execution.id)
    try {
      const created = await rerunWorkflowExecutionSnapshot(execution.id)
      toast('已按历史快照创建新的工作流执行', 'success')
      props.onOpenLog(created.id)
      await loadExecutions()
    } catch (error: unknown) {
      toast(historyErrorMessage(error, '历史快照重新运行失败'), 'error')
    } finally {
      setRerunningId(null)
    }
  }, [loadExecutions, props, rerunningId])

  const resume = React.useCallback(async (execution: WorkflowExecutionDto): Promise<void> => {
    if (resumingId) return
    const confirmed = window.confirm('从失败节点继续？\n\n已成功节点和高成本生成节点的 checkpoint 会复用，不会整条重跑。')
    if (!confirmed) return
    setResumingId(execution.id)
    try {
      const created = await resumeWorkflowExecution(execution.id)
      toast('已从失败节点创建恢复运行', 'success')
      props.onOpenLog(created.id)
      await loadExecutions()
    } catch (error: unknown) {
      toast(historyErrorMessage(error, '恢复运行失败'), 'error')
    } finally {
      setResumingId(null)
    }
  }, [loadExecutions, props, resumingId])

  const saveVersion = React.useCallback(async (): Promise<void> => {
    if (!currentFlowId || savingVersion) return
    setSavingVersion(true)
    try {
      await createFlowVersionSnapshot(currentFlowId)
      toast('已保存当前工作流版本', 'success')
      await loadVersions()
    } catch (error: unknown) {
      toast(historyErrorMessage(error, '保存工作流版本失败'), 'error')
    } finally {
      setSavingVersion(false)
    }
  }, [currentFlowId, loadVersions, savingVersion])

  const restoreVersion = React.useCallback(async (version: FlowVersionListItemDto): Promise<void> => {
    if (!currentFlowId || restoringVersionId) return
    const versionTime = new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })
    const confirmed = window.confirm(
      `恢复到 ${versionTime} 的保存版本？\n\n版本：${version.id}\n当前画布会被该不可变快照替换；现有版本历史不会删除。`,
    )
    if (!confirmed) return
    setRestoringVersionId(version.id)
    try {
      await rollbackFlow(currentFlowId, version.id)
      await props.onVersionRestored?.()
      toast(`已恢复 ${versionTime} 的保存版本`, 'success')
      await loadVersions()
    } catch (error: unknown) {
      toast(historyErrorMessage(error, '保存版本恢复失败'), 'error')
    } finally {
      setRestoringVersionId(null)
    }
  }, [currentFlowId, loadVersions, props, restoringVersionId])

  if (!mounted) return null

  const panelMetrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.wide)
  const refreshing = mode === 'versions' ? versionLoading : executionLoading

  return (
    <>
      <div
        className="history-panel-anchor"
        style={bottomBarPanelStyle(anchorX, { zIndex: 200, halfWidth: panelMetrics.width / 2 })}
        data-ux-panel
      >
        <Transition className="history-panel-transition" mounted={mounted} transition="pop" duration={160} timingFunction="ease">
          {(styles) => (
            <div className="history-panel-transition-inner" style={styles}>
              <PanelCard
                className="history-panel-shell glass workflow-history-panel-shell"
                padding="compact"
                style={{ width: panelMetrics.width, height: panelMetrics.height, maxHeight: panelMetrics.height }}
                onWheelCapture={stopPanelWheelPropagation}
                data-ux-panel
              >
                <nav className="history-panel-group-tabs" aria-label="工作流与历史记录">
                  <button className="history-panel-group-tab" type="button" onClick={() => setActivePanel('template')}>工作流</button>
                  <button className="history-panel-group-tab history-panel-group-tab--active" type="button" aria-current="page">历史记录</button>
                </nav>
                <header className="history-panel-header">
                  <div className="history-panel-heading">
                    <strong className="history-panel-title">工作流历史</strong>
                    <span className="history-panel-subtitle">执行记录属于当前用户，保存版本属于当前工作流</span>
                  </div>
                  <Group className="history-panel-header-actions" gap={4}>
                    <Tooltip className="history-panel-refresh-tooltip" label="刷新历史">
                      <ActionIcon className="history-panel-icon-button" variant="subtle" aria-label="刷新工作流历史" loading={refreshing} onClick={() => void refreshCurrentMode()}>
                        <IconRefresh className="history-panel-action-icon" size={15} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="history-panel-close-tooltip" label="关闭">
                      <ActionIcon className="history-panel-icon-button" variant="subtle" aria-label="关闭历史记录" onClick={() => setActivePanel(null)}>
                        <IconX className="history-panel-action-icon" size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </header>
                <SegmentedControl
                  className="history-panel-mode"
                  fullWidth
                  size="xs"
                  value={mode}
                  onChange={(value) => setMode(value === 'versions' ? 'versions' : 'executions')}
                  data={[
                    { value: 'executions', label: `执行记录 ${executions.length}${executionCursor ? '+' : ''}` },
                    { value: 'versions', label: `保存版本 ${versions.length}${versionCursor ? '+' : ''}` },
                  ]}
                />
                {mode === 'executions' ? (
                  <div className="history-panel-execution-toolbar">
                    <SegmentedControl
                      className="history-panel-scope"
                      size="xs"
                      value={executionScope}
                      onChange={(value) => setExecutionScope(value === 'current' ? 'current' : 'all')}
                      data={[
                        { value: 'all', label: '全部工作流' },
                        { value: 'current', label: '当前工作流', disabled: !currentFlowId },
                      ]}
                    />
                    {metrics && metrics.sampleSize > 0 ? (
                      <div className="history-panel-metrics" title="按当前筛选范围的最近执行样本统计">
                        <span className="history-panel-metric">成功率 {(metrics.workflowSuccessRate * 100).toFixed(1)}%</span>
                        <span className="history-panel-metric">节点失败率 {(metrics.nodeFailureRate * 100).toFixed(1)}%</span>
                        <span className="history-panel-metric">恢复成功率 {(metrics.recoverySuccessRate * 100).toFixed(1)}%</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="history-panel-version-toolbar">
                    <span className="history-panel-version-scope">当前工作流的手动快照</span>
                    <Tooltip className="history-panel-action-tooltip" label="保存当前版本">
                      <ActionIcon
                        className="history-panel-save-version"
                        variant="subtle"
                        aria-label="保存当前工作流版本"
                        loading={savingVersion}
                        disabled={!currentFlowId}
                        onClick={() => void saveVersion()}
                      >
                        <IconDeviceFloppy className="history-panel-action-icon" size={15} />
                      </ActionIcon>
                    </Tooltip>
                  </div>
                )}
                <div className="history-panel-body">
                  {mode === 'executions' && executionLoading && executions.length === 0 ? (
                    <div className="history-panel-state" role="status">
                      <Loader className="history-panel-loader" size="sm" />
                      <span className="history-panel-state-text">读取执行记录</span>
                    </div>
                  ) : null}
                  {mode === 'versions' && versionLoading && versions.length === 0 ? (
                    <div className="history-panel-state" role="status">
                      <Loader className="history-panel-loader" size="sm" />
                      <span className="history-panel-state-text">读取保存版本</span>
                    </div>
                  ) : null}
                  {mode === 'executions' && executionError ? (
                    <div className="history-panel-state history-panel-state--error">{executionError}</div>
                  ) : null}
                  {mode === 'versions' && versionError ? (
                    <div className="history-panel-state history-panel-state--error">{versionError}</div>
                  ) : null}
                  {mode === 'executions' && !executionLoading && !executionError && executions.length === 0 ? (
                    <div className="history-panel-state">当前范围还没有执行记录。</div>
                  ) : null}
                  {mode === 'versions' && !currentFlowId ? (
                    <div className="history-panel-state">先保存当前画布，才能创建和读取工作流版本。</div>
                  ) : null}
                  {mode === 'versions' && currentFlowId && !versionLoading && !versionError && versions.length === 0 ? (
                    <div className="history-panel-state">还没有手动保存版本。自动保存不会堆积版本快照。</div>
                  ) : null}
                  {mode === 'executions' && executions.length > 0 ? (
                    <ScrollArea className="history-panel-scroll" offsetScrollbars>
                      <Stack className="history-panel-execution-list" gap={0}>
                        {executions.map((execution) => {
                          const focus = execution.focusNode
                          const focusLabel = focus ? workflowFocusNodePrefix(focus.status) : null
                          const displayNode = focus?.nodeLabel ?? null
                          const executionBelongsToCurrentFlow = Boolean(
                            currentFlowId
                            && (execution.flowId === currentFlowId || execution.canvasId === currentFlowId),
                          )
                          const canFocus = Boolean(props.onFocusNode && executionBelongsToCurrentFlow)
                          return (
                            <article className={`history-panel-execution history-panel-execution--${execution.status}`} key={execution.id}>
                              <div className="history-panel-execution-main">
                                <div className="history-panel-execution-title-row">
                                  <time className="history-panel-execution-time" dateTime={execution.createdAt}>
                                    {new Date(execution.createdAt).toLocaleString('zh-CN', { hour12: false })}
                                  </time>
                                  <Badge className="history-panel-execution-status" size="xs" variant="light" color={executionStatusColor(execution.status)}>
                                    {workflowExecutionStatusLabel(execution.status)}
                                  </Badge>
                                </div>
                                <div className="history-panel-execution-meta">
                                  <span className="history-panel-execution-flow" title={execution.flowName ?? execution.flowId}>
                                    {execution.flowName ?? execution.flowId}
                                  </span>
                                  <span className="history-panel-execution-trigger">{triggerLabel(execution.trigger)}</span>
                                  <span className="history-panel-execution-duration">{formatWorkflowExecutionDuration(execution)}</span>
                                  {execution.nodeSummary ? (
                                    <span className="history-panel-execution-progress">
                                      {execution.nodeSummary.success}/{execution.nodeSummary.total} 节点完成
                                    </span>
                                  ) : null}
                                </div>
                                {focus ? (
                                  <button
                                    className={`history-panel-focus history-panel-focus--${focus.status}`}
                                    type="button"
                                    disabled={!canFocus}
                                    title={canFocus ? '在当前画布定位节点' : '该执行不属于当前画布'}
                                    onClick={() => props.onFocusNode?.(focus.nodeId)}
                                  >
                                    <IconTarget className="history-panel-focus-icon" size={13} />
                                    <span className="history-panel-focus-label">{focusLabel}</span>
                                    <strong className="history-panel-focus-node">{displayNode}</strong>
                                    <span className="history-panel-focus-status">{workflowNodeRunStatusLabel(focus.status)}</span>
                                  </button>
                                ) : null}
                                {execution.errorMessage ? <p className="history-panel-execution-error">{execution.errorMessage}</p> : null}
                              </div>
                              <div className="history-panel-execution-actions">
                                {execution.status === 'failed' ? (
                                  <Tooltip className="history-panel-action-tooltip" label="从失败节点继续并复用 checkpoint">
                                    <ActionIcon
                                      className="history-panel-execution-action"
                                      variant="light"
                                      color="orange"
                                      aria-label="从失败节点继续"
                                      loading={resumingId === execution.id}
                                      disabled={Boolean(resumingId)}
                                      onClick={() => void resume(execution)}
                                    >
                                      <IconRestore className="history-panel-action-icon" size={15} />
                                    </ActionIcon>
                                  </Tooltip>
                                ) : null}
                                <Tooltip className="history-panel-action-tooltip" label="使用当时快照重新运行">
                                  <ActionIcon
                                    className="history-panel-execution-action"
                                    variant="subtle"
                                    aria-label="使用当时快照重新运行"
                                    loading={rerunningId === execution.id}
                                    disabled={Boolean(rerunningId)}
                                    onClick={() => void rerun(execution)}
                                  >
                                    <IconPlayerPlay className="history-panel-action-icon" size={15} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip className="history-panel-action-tooltip" label="查看当时画布快照">
                                  <ActionIcon className="history-panel-execution-action" variant="subtle" aria-label="查看执行快照" onClick={() => setSnapshotExecutionId(execution.id)}>
                                    <IconCamera className="history-panel-action-icon" size={15} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip className="history-panel-action-tooltip" label="查看完整日志">
                                  <ActionIcon className="history-panel-execution-action" variant="subtle" aria-label="查看执行日志" onClick={() => props.onOpenLog(execution.id)}>
                                    <IconFileText className="history-panel-action-icon" size={15} />
                                  </ActionIcon>
                                </Tooltip>
                              </div>
                            </article>
                          )
                        })}
                        {executionCursor ? (
                          <button
                            className="history-panel-load-more"
                            type="button"
                            disabled={executionLoadingMore}
                            onClick={() => void loadExecutions({ append: true, cursor: executionCursor })}
                          >
                            {executionLoadingMore ? '读取中…' : '加载更多执行记录'}
                          </button>
                        ) : null}
                      </Stack>
                    </ScrollArea>
                  ) : null}
                  {mode === 'versions' && versions.length > 0 ? (
                    <ScrollArea className="history-panel-scroll" offsetScrollbars>
                      <ol className="history-panel-version-list">
                        {versions.map((version) => (
                          <li className="history-panel-version" data-version-id={version.id} key={version.id}>
                            <div className="history-panel-version-main">
                              <strong className="history-panel-version-name">{version.name}</strong>
                              <time className="history-panel-version-time" dateTime={version.createdAt}>
                                {new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}
                              </time>
                            </div>
                            <div className="history-panel-version-actions">
                              <code className="history-panel-version-id" title={version.id}>{version.id.slice(0, 12)}</code>
                              <Tooltip className="history-panel-action-tooltip" label="恢复到此版本">
                                <ActionIcon
                                  className="history-panel-version-restore"
                                  variant="subtle"
                                  aria-label={`恢复版本 ${new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}`}
                                  loading={restoringVersionId === version.id}
                                  disabled={Boolean(restoringVersionId)}
                                  onClick={() => void restoreVersion(version)}
                                >
                                  <IconRestore className="history-panel-action-icon" size={15} />
                                </ActionIcon>
                              </Tooltip>
                            </div>
                          </li>
                        ))}
                      </ol>
                      {versionCursor ? (
                        <button
                          className="history-panel-load-more"
                          type="button"
                          disabled={versionLoadingMore}
                          onClick={() => void loadVersions({ append: true, cursor: versionCursor })}
                        >
                          {versionLoadingMore ? '读取中…' : '加载更多保存版本'}
                        </button>
                      ) : null}
                    </ScrollArea>
                  ) : null}
                </div>
              </PanelCard>
            </div>
          )}
        </Transition>
      </div>
      <WorkflowExecutionSnapshotModal
        opened={Boolean(snapshotExecutionId)}
        executionId={snapshotExecutionId}
        onClose={() => setSnapshotExecutionId(null)}
        onOpenLog={props.onOpenLog}
      />
    </>
  )
}
