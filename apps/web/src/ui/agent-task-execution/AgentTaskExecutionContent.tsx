import React from 'react'
import { ActionIcon, Badge, Button, Group, Loader, ScrollArea, Stack, Text, Tooltip } from '@mantine/core'
import { IconExternalLink, IconFocus2, IconRefresh } from '@tabler/icons-react'
import type { AgentTraceSpanV1 } from '@tapcanvas/agent-observability'
import {
  fetchAgentDiagnostics,
  type AgentDiagnosticsPublicChatRunDto,
  type AgentDiagnosticsResponseDto,
} from '../../api/server'
import { useLiveChatRunStore, type LiveChatRunRecord } from '../chat/liveChatRunStore'
import {
  buildAgentObservabilityUrl,
  readAgentCanvasDeepLink,
  resolveAgentObservabilityDashboardUrl,
} from './agentTaskExecutionLinks'
import './AgentTaskExecutionContent.css'

type AgentTaskExecutionContentProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  bookId?: string | null
  chapterId?: string | null
  flowId?: string | null
  onReturnToChat: () => void
}

type CurrentTraceProjection = {
  traceId: string
  root: AgentTraceSpanV1
  spans: AgentTraceSpanV1[]
  publicChatRun: AgentDiagnosticsPublicChatRunDto | null
}

const STATUS_LABELS: Record<string, string> = {
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  needs_input: '等待你的输入',
  suspended: '已挂起',
  accepted_async: '后台处理中',
  blocked: '动作未执行',
  denied: '权限拒绝',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function statusColor(status: string): string {
  if (status === 'succeeded') return 'teal'
  if (status === 'failed' || status === 'blocked' || status === 'denied' || status === 'cancelled') return 'red'
  if (status === 'running' || status === 'accepted_async' || status === 'needs_input' || status === 'suspended') return 'yellow'
  return 'gray'
}

function formatTime(timestamp: number | string | null): string {
  if (timestamp === null) return '—'
  const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  if (!Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '进行中'
  if (durationMs < 1_000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`
}

function isRunInScope(run: LiveChatRunRecord | null, projectId?: string | null, flowId?: string | null): run is LiveChatRunRecord {
  if (!run) return false
  if (projectId && run.projectId && run.projectId !== projectId) return false
  if (flowId && run.flowId && run.flowId !== flowId) return false
  return true
}

function findCurrentTrace(
  diagnostics: AgentDiagnosticsResponseDto | null,
  activeRun: LiveChatRunRecord | null,
  preferredTraceId: string | null,
): CurrentTraceProjection | null {
  if (!diagnostics || diagnostics.spans.length === 0) return null
  const newestFirst = [...diagnostics.spans].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  const traceId = preferredTraceId
    ?? newestFirst.find((span) => activeRun?.requestId && span.requestId === activeRun.requestId)?.traceId
    ?? newestFirst.find((span) => activeRun?.sessionId && span.threadId === activeRun.sessionId)?.traceId
    ?? newestFirst[0]?.traceId
    ?? null
  if (!traceId) return null
  const spans = diagnostics.spans
    .filter((span) => span.traceId === traceId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  const root = spans.find((span) => span.parentSpanId === null && span.kind === 'request')
    ?? spans.find((span) => span.parentSpanId === null)
    ?? spans[0]
  if (!root) return null
  const publicChatRun = diagnostics.publicChatRuns.find((run) => (
    Boolean(activeRun?.requestId) && run.requestId === activeRun?.requestId
  )) ?? diagnostics.publicChatRuns[0] ?? null
  return { traceId, root, spans, publicChatRun }
}

function Fact(props: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="agent-task-execution-fact">
      <Text className="agent-task-execution-fact-label" size="xs" c="dimmed">{props.label}</Text>
      <div className="agent-task-execution-fact-value">{props.value}</div>
    </div>
  )
}

export default function AgentTaskExecutionContent(props: AgentTaskExecutionContentProps): JSX.Element {
  const { className, opened, projectId, bookId, chapterId, flowId, onReturnToChat } = props
  const liveRun = useLiveChatRunStore((state) => state.activeRun)
  const activeRun = isRunInScope(liveRun, projectId, flowId) ? liveRun : null
  const [diagnostics, setDiagnostics] = React.useState<AgentDiagnosticsResponseDto | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const preferredTraceId = typeof window === 'undefined'
    ? null
    : readAgentCanvasDeepLink(window.location.search).traceId ?? null

  const load = React.useCallback(async () => {
    if (!opened) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetchAgentDiagnostics({
        ...(preferredTraceId ? { traceId: preferredTraceId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(bookId ? { bookId } : {}),
        ...(chapterId ? { chapterId } : {}),
        ...(flowId ? { flowId } : {}),
        limit: 60,
      })
      setDiagnostics(response)
    } catch (loadError) {
      setDiagnostics(null)
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [bookId, chapterId, flowId, opened, preferredTraceId, projectId])

  React.useEffect(() => {
    if (!opened) return
    void load()
    if (activeRun?.status !== 'active') return
    const timer = window.setInterval(() => void load(), 8_000)
    return () => window.clearInterval(timer)
  }, [activeRun?.status, load, opened])

  const trace = React.useMemo(
    () => findCurrentTrace(diagnostics, activeRun, preferredTraceId),
    [activeRun, diagnostics, preferredTraceId],
  )
  const displayedStatus = activeRun?.status ?? trace?.root.status ?? 'unknown'
  const failedSpanCount = trace?.spans.filter((span) => (
    ['failed', 'blocked', 'denied'].includes(span.status)
  )).length ?? 0
  const totalTokens = trace?.spans
    .filter((span) => span.kind === 'llm')
    .reduce((sum, span) => sum + span.totalTokens, 0) ?? 0
  const asyncArtifacts = activeRun?.asyncArtifacts ?? []
  const evidenceCount = asyncArtifacts.filter((artifact) => artifact.status === 'succeeded').length
    + (trace?.publicChatRun?.canvasWrite ? 1 : 0)
  const observabilityUrl = buildAgentObservabilityUrl({
    traceId: trace?.traceId ?? preferredTraceId,
    projectId: projectId ?? activeRun?.projectId ?? null,
    bookId,
    chapterId,
    flowId: flowId ?? activeRun?.flowId ?? null,
    nodeId: asyncArtifacts[0]?.nodeId ?? trace?.root.scope.nodeId ?? null,
  }, {
    dashboardUrl: resolveAgentObservabilityDashboardUrl(),
    canvasBaseUrl: typeof window === 'undefined' ? null : window.location.origin,
  })

  const focusNode = React.useCallback((nodeId: string) => {
    const target = window as unknown as { __tcFocusNode?: (id: string) => void }
    target.__tcFocusNode?.(nodeId)
  }, [])

  return (
    <Stack className={className || 'agent-task-execution'} gap={0}>
      <div className="agent-task-execution-toolbar">
        <div className="agent-task-execution-toolbar-copy">
          <Group className="agent-task-execution-heading" gap="xs" wrap="nowrap">
            <Text className="agent-task-execution-title" fw={650}>当前任务</Text>
            <Badge
              className="agent-task-execution-status"
              size="sm"
              variant="light"
              color={statusColor(displayedStatus)}
            >
              {statusLabel(displayedStatus)}
            </Badge>
          </Group>
          <Text className="agent-task-execution-subtitle" size="xs" c="dimmed">
            这里只展示当前画布的执行事实；跨项目质量分析与人工复核统一在 8798。
          </Text>
        </div>
        <Group className="agent-task-execution-toolbar-actions" gap="xs" wrap="nowrap">
          <Tooltip className="agent-task-execution-refresh-tooltip" label="刷新当前任务事实">
            <ActionIcon
              className="agent-task-execution-refresh"
              variant="subtle"
              aria-label="刷新当前任务事实"
              loading={loading}
              onClick={() => void load()}
            >
              <IconRefresh className="agent-task-execution-refresh-icon" size={16} />
            </ActionIcon>
          </Tooltip>
          <Button
            className="agent-task-execution-observability-link"
            size="xs"
            variant="default"
            rightSection={<IconExternalLink className="agent-task-execution-external-icon" size={14} />}
            onClick={() => window.open(observabilityUrl, '_blank', 'noopener,noreferrer')}
          >
            完整诊断
          </Button>
          <Button className="agent-task-execution-return" size="xs" onClick={onReturnToChat}>
            返回小T
          </Button>
        </Group>
      </div>

      {loading && !diagnostics ? (
        <div className="agent-task-execution-loading">
          <Loader className="agent-task-execution-loader" size="sm" color="gray" />
          <Text className="agent-task-execution-loading-copy" size="sm" c="dimmed">读取当前任务事实…</Text>
        </div>
      ) : error ? (
        <div className="agent-task-execution-error" role="alert">
          <Text className="agent-task-execution-error-title" size="sm" fw={600}>当前任务诊断读取失败</Text>
          <Text className="agent-task-execution-error-detail" size="xs">{error}</Text>
        </div>
      ) : !activeRun && !trace ? (
        <div className="agent-task-execution-empty">
          <Text className="agent-task-execution-empty-title" size="sm" fw={600}>当前画布还没有 AI 执行记录</Text>
          <Text className="agent-task-execution-empty-copy" size="xs" c="dimmed">从小T发起任务后，这里会显示进度、等待原因与交付证据。</Text>
        </div>
      ) : (
        <div className="agent-task-execution-body">
          <section className="agent-task-execution-section agent-task-execution-overview">
            <div className="agent-task-execution-section-heading">
              <Text className="agent-task-execution-section-title" size="sm" fw={650}>执行概况</Text>
              <Text className="agent-task-execution-section-meta" size="xs" c="dimmed">
                {activeRun ? `更新于 ${formatTime(activeRun.updatedAt)}` : `开始于 ${formatTime(trace?.root.startedAt ?? null)}`}
              </Text>
            </div>
            <div className="agent-task-execution-facts">
              <Fact label="任务" value={activeRun?.displayText || activeRun?.requestText || trace?.root.name || '—'} />
              <Fact label="耗时" value={formatDuration(trace?.root.durationMs ?? (activeRun ? Math.max(0, (activeRun.finishedAt ?? Date.now()) - activeRun.startedAt) : null))} />
              <Fact label="执行步骤" value={`${trace?.spans.length ?? activeRun?.logs.length ?? 0} 条`} />
              <Fact label="异常动作" value={failedSpanCount > 0 ? `${failedSpanCount} 条` : '无'} />
              <Fact label="Token" value={totalTokens > 0 ? totalTokens.toLocaleString('zh-CN') : '未采集'} />
              <Fact label="交付证据" value={evidenceCount > 0 ? `${evidenceCount} 项` : '尚未形成'} />
            </div>
          </section>

          {activeRun?.attentionProjection ? (
            <section className="agent-task-execution-section agent-task-execution-attention">
              <div className="agent-task-execution-section-heading">
                <Text className="agent-task-execution-section-title" size="sm" fw={650}>下一步与等待原因</Text>
                <Badge className="agent-task-execution-attention-status" size="xs" color={statusColor(displayedStatus)} variant="light">
                  {statusLabel(activeRun.status)}
                </Badge>
              </div>
              <Text className="agent-task-execution-obligation" size="sm">{activeRun.attentionProjection.obligation}</Text>
              {activeRun.attentionProjection.waitingOn ? (
                <Text className="agent-task-execution-waiting-on" size="xs" c="dimmed">等待：{activeRun.attentionProjection.waitingOn}</Text>
              ) : null}
            </section>
          ) : null}

          {activeRun?.todoItems.length ? (
            <section className="agent-task-execution-section agent-task-execution-progress">
              <div className="agent-task-execution-section-heading">
                <Text className="agent-task-execution-section-title" size="sm" fw={650}>任务进度</Text>
                <Text className="agent-task-execution-section-meta" size="xs" c="dimmed">
                  {activeRun.todoItems.filter((item) => item.completed).length}/{activeRun.todoItems.length}
                </Text>
              </div>
              <div className="agent-task-execution-todos">
                {activeRun.todoItems.map((item, index) => (
                  <div className={`agent-task-execution-todo is-${item.status}`} key={`${item.text}-${index}`}>
                    <span className="agent-task-execution-todo-marker" aria-hidden="true" />
                    <Text className="agent-task-execution-todo-copy" size="xs">{item.text}</Text>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="agent-task-execution-section agent-task-execution-evidence">
            <div className="agent-task-execution-section-heading">
              <Text className="agent-task-execution-section-title" size="sm" fw={650}>交付证据</Text>
              <Text className="agent-task-execution-section-meta" size="xs" c="dimmed">只列真实节点、资产与持久化结果</Text>
            </div>
            {asyncArtifacts.length ? (
              <div className="agent-task-execution-artifacts">
                {asyncArtifacts.map((artifact) => (
                  <div className="agent-task-execution-artifact" key={`${artifact.assetType}:${artifact.nodeId}`}>
                    <div className="agent-task-execution-artifact-copy">
                      <Text className="agent-task-execution-artifact-title" size="xs" fw={600}>{artifact.assetType.toUpperCase()} · {artifact.nodeId}</Text>
                      <Text className="agent-task-execution-artifact-meta" size="xs" c={artifact.failureReason ? 'red' : 'dimmed'}>
                        {artifact.failureReason || statusLabel(artifact.status)}
                      </Text>
                    </div>
                    <Tooltip className="agent-task-execution-focus-tooltip" label="定位画布节点">
                      <ActionIcon
                        className="agent-task-execution-focus"
                        size="sm"
                        variant="subtle"
                        aria-label={`定位节点 ${artifact.nodeId}`}
                        onClick={() => focusNode(artifact.nodeId)}
                      >
                        <IconFocus2 className="agent-task-execution-focus-icon" size={15} />
                      </ActionIcon>
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : trace?.publicChatRun ? (
              <div className="agent-task-execution-delivery-summary">
                <Text className="agent-task-execution-delivery-primary" size="sm">
                  {trace.publicChatRun.canvasWrite ? '已写入当前画布' : '本轮未写入画布'}
                  {trace.publicChatRun.assetCount > 0 ? ` · ${trace.publicChatRun.assetCount} 个资产` : ''}
                </Text>
                <Text className="agent-task-execution-delivery-meta" size="xs" c="dimmed">
                  交付校验：{trace.publicChatRun.turnVerdict} · 结果：{trace.publicChatRun.runOutcome}
                </Text>
              </div>
            ) : (
              <Text className="agent-task-execution-no-evidence" size="xs" c="dimmed">当前尚未形成可验证交付；执行记录不会被文本回复替代。</Text>
            )}
          </section>

          {activeRun?.errorMessage ? (
            <section className="agent-task-execution-section agent-task-execution-failure" role="alert">
              <Text className="agent-task-execution-section-title" size="sm" fw={650}>失败原因</Text>
              <Text className="agent-task-execution-failure-copy" size="xs">{activeRun.errorMessage}</Text>
            </section>
          ) : null}

          {activeRun?.logs.length ? (
            <section className="agent-task-execution-section agent-task-execution-log-section">
              <div className="agent-task-execution-section-heading">
                <Text className="agent-task-execution-section-title" size="sm" fw={650}>最近过程</Text>
                <Text className="agent-task-execution-section-meta" size="xs" c="dimmed">完整跨服务链路请在 8798 查看</Text>
              </div>
              <ScrollArea className="agent-task-execution-log-scroll" h={220} type="auto">
                <div className="agent-task-execution-logs">
                  {activeRun.logs.slice(-30).reverse().map((entry) => (
                    <div className={`agent-task-execution-log ${entry.tone ? `is-${entry.tone}` : ''}`} key={entry.id}>
                      <div className="agent-task-execution-log-heading">
                        <Text className="agent-task-execution-log-title" size="xs" fw={600}>{entry.title}</Text>
                        <Text className="agent-task-execution-log-time" size="xs" c="dimmed">{formatTime(entry.at)}</Text>
                      </div>
                      {entry.reason || entry.detail ? (
                        <Text className="agent-task-execution-log-detail" size="xs" c={entry.tone === 'error' ? 'red' : 'dimmed'}>
                          {entry.reason || entry.detail}
                        </Text>
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </section>
          ) : null}

          {trace ? (
            <section className="agent-task-execution-section agent-task-execution-trace-summary">
              <div className="agent-task-execution-section-heading">
                <Text className="agent-task-execution-section-title" size="sm" fw={650}>当前 Trace 摘要</Text>
                <Badge className="agent-task-execution-trace-persistence" size="xs" variant="light" color={trace.root.persistenceStatus === 'persisted' ? 'gray' : 'red'}>
                  {trace.root.persistenceStatus}
                </Badge>
              </div>
              <Text className="agent-task-execution-trace-id" size="xs" ff="monospace">{trace.traceId}</Text>
              <Text className="agent-task-execution-trace-meta" size="xs" c="dimmed">
                {trace.spans.length} spans · {new Set(trace.spans.map((span) => span.service)).size} services · {formatDuration(trace.root.durationMs)}
              </Text>
            </section>
          ) : null}
        </div>
      )}
    </Stack>
  )
}
