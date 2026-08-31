import React from 'react'
import { Badge, Button, Collapse, Group, Loader, Modal, ScrollArea, Select, Stack, Text, TextInput } from '@mantine/core'
import type { AgentSpanKind, AgentSpanStatus } from '@tapcanvas/agent-observability'
import { toast } from './toast'
import {
  fetchAdminAgentDiagnostics,
  listAgentPipelineRuns,
  type AgentDiagnosticsPublicChatRunDto,
  type AgentDiagnosticsResponseDto,
  type AgentDiagnosticsTraceDto,
  type AgentPipelineRunDto,
} from '../api/server'
import { useLiveChatRunStore, type LiveChatRunRecord } from './chat/liveChatRunStore'
import AgentExecutionGraph from './agent-diagnostics/AgentExecutionGraph'
import AgentApiExecutionChain, { isAgentApiVideoRun } from './agent-diagnostics/AgentApiExecutionChain'
import AgentObservabilitySummary from './agent-diagnostics/AgentObservabilitySummary'

const LABEL_OPTIONS = [
  { value: '', label: '全部标签' },
  { value: 'storyboard_semantic_bootstrap', label: '语义锚定抽取' },
  { value: 'storyboard_continuity_qc', label: '连续性 QC' },
] as const

const PUBLIC_CHAT_VERDICT_OPTIONS = [
  { value: '', label: '全部 verdict' },
  { value: 'satisfied', label: 'satisfied' },
  { value: 'partial', label: 'partial' },
  { value: 'failed', label: 'failed' },
] as const

const PUBLIC_CHAT_OUTCOME_OPTIONS = [
  { value: '', label: '全部 outcome' },
  { value: 'promote', label: 'promote' },
  { value: 'hold', label: 'hold' },
  { value: 'discard', label: 'discard' },
] as const

const TRACE_TIME_RANGE_OPTIONS = [
  { value: '1h', label: '最近 1 小时', milliseconds: 60 * 60 * 1_000 },
  { value: '24h', label: '最近 24 小时', milliseconds: 24 * 60 * 60 * 1_000 },
  { value: '7d', label: '最近 7 天', milliseconds: 7 * 24 * 60 * 60 * 1_000 },
  { value: 'all', label: '全部时间', milliseconds: null },
] as const

const TRACE_STATUS_OPTIONS: Array<{ value: '' | AgentSpanStatus; label: string }> = [
  { value: '', label: '全部 span 状态' },
  { value: 'succeeded', label: 'succeeded' },
  { value: 'failed', label: 'failed' },
  { value: 'accepted_async', label: 'accepted_async' },
  { value: 'needs_input', label: 'needs_input' },
  { value: 'blocked', label: 'blocked' },
  { value: 'denied', label: 'denied' },
  { value: 'running', label: 'running' },
]

const TRACE_KIND_OPTIONS: Array<{ value: '' | AgentSpanKind; label: string }> = [
  { value: '', label: '全部 span 类型' },
  { value: 'agent', label: 'agent' },
  { value: 'llm', label: 'llm' },
  { value: 'tool', label: 'tool' },
  { value: 'skill', label: 'skill' },
  { value: 'subagent', label: 'subagent' },
  { value: 'delivery_verification', label: 'delivery verification' },
  { value: 'async_task', label: 'async task' },
  { value: 'asset_materialization', label: 'asset materialization' },
  { value: 'evaluation', label: 'evaluation' },
]

type TraceTimeRange = (typeof TRACE_TIME_RANGE_OPTIONS)[number]['value']

function isTraceTimeRange(value: string | null): value is TraceTimeRange {
  return TRACE_TIME_RANGE_OPTIONS.some((item) => item.value === value)
}

function isAgentSpanStatus(value: string | null): value is AgentSpanStatus {
  return TRACE_STATUS_OPTIONS.some((item) => item.value !== '' && item.value === value)
}

function isAgentSpanKind(value: string | null): value is AgentSpanKind {
  return TRACE_KIND_OPTIONS.some((item) => item.value !== '' && item.value === value)
}

const INLINE_IMAGE_DATA_URL_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi

export type AgentTraceContextSelection = {
  traceId: string
  bookId: string | null
  chapter: number | null
  label: string | null
}

type AgentDiagnosticsContentProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  // 章节工作台：锁定到当前章节。设置后章节 ID 预填且只读。
  scopedChapterId?: string | null
  onInspectTrace?: (selection: AgentTraceContextSelection) => void
}

type PublicChatWorkflowSummary = {
  workflowKey: string
  count: number
  promoteCount: number
  failedCount: number
}

type PublicChatRunSummary = {
  total: number
  promoteCount: number
  holdCount: number
  discardCount: number
  satisfiedCount: number
  partialCount: number
  failedCount: number
  canvasWriteCount: number
  assetRunCount: number
  topWorkflows: PublicChatWorkflowSummary[]
}

function normalizeInlineImageDataUrl(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i)
  if (!match) return null
  const mimeType = String(match[1] || '').trim()
  const base64 = String(match[2] || '').replace(/\s+/g, '')
  if (!mimeType || !base64) return null
  return `data:${mimeType};base64,${base64}`
}

function collectInlineImageUrls(value: unknown, out: Set<string>, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    const direct = normalizeInlineImageDataUrl(value)
    if (direct) out.add(direct)
    const matches = value.match(INLINE_IMAGE_DATA_URL_PATTERN)
    if (!matches) return
    for (const match of matches) {
      const normalized = normalizeInlineImageDataUrl(match)
      if (normalized) out.add(normalized)
    }
    return
  }
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectInlineImageUrls(item, out, seen)
    return
  }
  const record = value as Record<string, unknown>
  for (const nested of Object.values(record)) collectInlineImageUrls(nested, out, seen)
}

function extractInlineImageUrls(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  const out = new Set<string>()
  const seen = new WeakSet<object>()
  collectInlineImageUrls(trimmed, out, seen)
  try {
    const parsed: unknown = JSON.parse(trimmed)
    collectInlineImageUrls(parsed, out, seen)
  } catch {
    // Non-JSON text is still handled by direct string scanning above.
  }
  return Array.from(out).slice(0, 6)
}

function TraceImagePreview(props: { raw: string }): JSX.Element | null {
  const imageUrls = React.useMemo(() => extractInlineImageUrls(props.raw), [props.raw])
  if (!imageUrls.length) return null
  return (
    <div className="agent-diagnostics-inline-image-preview-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
      {imageUrls.map((url, index) => (
        <div
          key={`${index}_${url.length}`}
          className="agent-diagnostics-inline-image-preview-card"
          style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 8, overflow: 'hidden', background: 'var(--mantine-color-body)' }}
        >
          <img
            className="agent-diagnostics-inline-image-preview-image"
            src={url}
            alt={`inline-preview-${index + 1}`}
            style={{ display: 'block', width: '100%', height: 140, objectFit: 'cover', background: 'var(--mantine-color-dark-6)' }}
          />
        </div>
      ))}
    </div>
  )
}

function liveRunStatusColor(status: LiveChatRunRecord['status']): string {
	if (status === 'active') return 'orange'
	if (status === 'succeeded') return 'green'
	if (status === 'waiting_input') return 'blue'
	if (status === 'waiting_external') return 'blue'
	if (status === 'cancelled') return 'gray'
	return 'red'
}

function formatLiveRunTime(input: number | null): string {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return ''
  try {
    return new Date(input).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

export default function AgentDiagnosticsContent(props: AgentDiagnosticsContentProps): JSX.Element {
  const { className, opened, projectId, scopedChapterId, onInspectTrace } = props
  const [traceId, setTraceId] = React.useState('')
  const [bookId, setBookId] = React.useState('')
  const [chapterId, setChapterId] = React.useState(scopedChapterId || '')
  const [flowId, setFlowId] = React.useState('')
  const [nodeId, setNodeId] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [workflowKey, setWorkflowKey] = React.useState('')
  const [modelKey, setModelKey] = React.useState('')
  const [traceTimeRange, setTraceTimeRange] = React.useState<TraceTimeRange>('24h')
  const [spanStatus, setSpanStatus] = React.useState<AgentSpanStatus | ''>('')
  const [spanKind, setSpanKind] = React.useState<AgentSpanKind | ''>('')
  const [publicChatVerdict, setPublicChatVerdict] = React.useState('')
  const [publicChatOutcome, setPublicChatOutcome] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [agentApiJobs, setAgentApiJobs] = React.useState<AgentPipelineRunDto[]>([])
  const [agentApiJobsLoading, setAgentApiJobsLoading] = React.useState(false)
  const [agentApiJobsError, setAgentApiJobsError] = React.useState('')
  const [expandedTraceId, setExpandedTraceId] = React.useState<string | null>(null)
  const [expandedPublicChatRunId, setExpandedPublicChatRunId] = React.useState<string | null>(null)
  const [executionLogTraceId, setExecutionLogTraceId] = React.useState<string | null>(null)
  const [rawRecordsOpened, setRawRecordsOpened] = React.useState(false)
  const [data, setData] = React.useState<AgentDiagnosticsResponseDto | null>(null)
  const loadSequenceRef = React.useRef(0)
  const activeLiveRun = useLiveChatRunStore((state) => state.activeRun)
  const clearLiveRun = useLiveChatRunStore((state) => state.clearRun)

  const loadAgentApiJobs = React.useCallback(async () => {
    if (!opened) return
    setAgentApiJobsLoading(true)
    setAgentApiJobsError('')
    try {
      const runs = await listAgentPipelineRuns({
        ...(projectId ? { projectId } : {}),
        limit: 100,
      })
      const jobs = runs
        .filter(isAgentApiVideoRun)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      setAgentApiJobs(jobs)
      setTraceId((current) => current.trim() || jobs[0]?.id || '')
    } catch (error: unknown) {
      setAgentApiJobsError(error instanceof Error ? error.message : String(error))
    } finally {
      setAgentApiJobsLoading(false)
    }
  }, [opened, projectId])

  const load = React.useCallback(async (cursor?: string) => {
    if (!opened) return
    const loadSequence = loadSequenceRef.current + 1
    loadSequenceRef.current = loadSequence
    setLoading(true)
    try {
      const range = TRACE_TIME_RANGE_OPTIONS.find((item) => item.value === traceTimeRange)
      const from = typeof range?.milliseconds === 'number'
        ? new Date(Date.now() - range.milliseconds).toISOString()
        : undefined
      const result = await fetchAdminAgentDiagnostics({
        ...(traceId.trim() ? { traceId: traceId.trim() } : {}),
        ...(projectId ? { projectId } : {}),
        ...(bookId.trim() ? { bookId: bookId.trim() } : {}),
        ...(chapterId.trim() ? { chapterId: chapterId.trim() } : {}),
        ...(flowId.trim() ? { flowId: flowId.trim() } : {}),
        ...(nodeId.trim() ? { nodeId: nodeId.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(workflowKey.trim() ? { workflowKey: workflowKey.trim() } : {}),
        ...(modelKey.trim() ? { modelKey: modelKey.trim() } : {}),
        ...(spanStatus ? { status: spanStatus } : {}),
        ...(spanKind ? { kind: spanKind } : {}),
        ...(from ? { from } : {}),
        ...(cursor ? { cursor } : {}),
        ...(publicChatVerdict
          ? { turnVerdict: publicChatVerdict as 'satisfied' | 'partial' | 'failed' }
          : {}),
        ...(publicChatOutcome
          ? { runOutcome: publicChatOutcome as 'promote' | 'hold' | 'discard' }
          : {}),
        limit: 50,
      })
      if (loadSequence !== loadSequenceRef.current) return
      setData((current) => {
        if (!cursor || !current) return result
        const spanIds = new Set(current.spans.map((span) => span.id))
        const evaluationIds = new Set(current.evaluations.map((evaluation) => evaluation.id))
        const feedbackIds = new Set(current.humanFeedback.map((feedback) => feedback.id))
        const annotationIds = new Set(current.annotationQueue.map((item) => item.id))
        return {
          ...result,
          spans: [...current.spans, ...result.spans.filter((span) => !spanIds.has(span.id))],
          evaluations: [
            ...current.evaluations,
            ...result.evaluations.filter((evaluation) => !evaluationIds.has(evaluation.id)),
          ],
          humanFeedback: [
            ...current.humanFeedback,
            ...result.humanFeedback.filter((feedback) => !feedbackIds.has(feedback.id)),
          ],
          annotationQueue: [
            ...current.annotationQueue,
            ...result.annotationQueue.filter((item) => !annotationIds.has(item.id)),
          ],
        }
      })
    } catch (error) {
      if (loadSequence === loadSequenceRef.current) {
        toast(error instanceof Error ? error.message : '加载 AI 诊断失败', 'error')
      }
    } finally {
      if (loadSequence === loadSequenceRef.current) setLoading(false)
    }
  }, [opened, traceId, projectId, bookId, chapterId, flowId, nodeId, label, workflowKey, modelKey, traceTimeRange, spanStatus, spanKind, publicChatVerdict, publicChatOutcome])

  React.useEffect(() => {
    if (!opened) {
      loadSequenceRef.current += 1
      setLoading(false)
      return undefined
    }
    const timeout = window.setTimeout(() => void load(), 200)
    return () => window.clearTimeout(timeout)
  }, [load])

  React.useEffect(() => {
    if (!opened) return
    void loadAgentApiJobs()
  }, [loadAgentApiJobs, opened])

  // 章节工作台：当前章节变化时同步锁定的章节 ID
  React.useEffect(() => {
    if (scopedChapterId) setChapterId(scopedChapterId)
  }, [scopedChapterId])

  const publicChatSummary = React.useMemo(
    () => summarizePublicChatRuns(Array.isArray(data?.publicChatRuns) ? data.publicChatRuns : []),
    [data?.publicChatRuns],
  )
  const selectedAgentApiJob = React.useMemo(
    () => agentApiJobs.find((job) => job.id === traceId.trim()) ?? null,
    [agentApiJobs, traceId],
  )
  const handleCopyTraceId = React.useCallback(async (traceId: string) => {
    const ok = await copyText(traceId)
    toast(ok ? '已复制 TraceId' : '复制 TraceId 失败', ok ? 'success' : 'error')
  }, [])

  return (
    <Stack className={className} gap="md">
      {activeLiveRun ? (
        <Stack className="agent-diagnostics-panel-live-run" gap={6} p="sm" style={{ border: '1px solid var(--mantine-color-blue-4)', borderRadius: 10, background: 'rgba(34, 139, 230, 0.06)' }}>
          <Group className="agent-diagnostics-panel-live-run-header" justify="space-between" align="flex-start" wrap="wrap">
            <Group className="agent-diagnostics-panel-live-run-header-main" gap="xs" wrap="wrap">
              <Badge className="agent-diagnostics-panel-live-run-badge" variant="light" color={liveRunStatusColor(activeLiveRun.status)}>
                {activeLiveRun.status === 'active'
                  ? 'live running'
                  : activeLiveRun.status === 'succeeded'
                    ? 'live completed'
                    : activeLiveRun.status === 'waiting_input'
                      ? 'live needs input'
                      : activeLiveRun.status === 'waiting_external'
                        ? 'live suspended'
                      : 'live failed'}
              </Badge>
              {activeLiveRun.skillName ? (
                <Badge className="agent-diagnostics-panel-live-run-skill" variant="outline" color="gray">
                  {activeLiveRun.skillName}
                </Badge>
              ) : null}
              {activeLiveRun.projectName ? (
                <Badge className="agent-diagnostics-panel-live-run-project-name" variant="outline">
                  {activeLiveRun.projectName}
                </Badge>
              ) : null}
              <Text className="agent-diagnostics-panel-live-run-time" size="xs" c="dimmed">
                {`start ${formatLiveRunTime(activeLiveRun.startedAt)} · update ${formatLiveRunTime(activeLiveRun.updatedAt)}`}
              </Text>
            </Group>
            <Button className="agent-diagnostics-panel-live-run-clear" size="compact-xs" variant="subtle" onClick={() => clearLiveRun()}>
              清空实时日志
            </Button>
          </Group>

          <Group className="agent-diagnostics-panel-live-run-scope" gap="xs" wrap="wrap">
            {activeLiveRun.requestId ? <Badge className="agent-diagnostics-panel-live-run-request-id" variant="outline">{`request ${activeLiveRun.requestId}`}</Badge> : null}
            {activeLiveRun.sessionId ? <Badge className="agent-diagnostics-panel-live-run-session-id" variant="outline">{`session ${activeLiveRun.sessionId}`}</Badge> : null}
            {activeLiveRun.userMessageId ? <Badge className="agent-diagnostics-panel-live-run-message-id" variant="outline">{`message ${activeLiveRun.userMessageId}`}</Badge> : null}
            {activeLiveRun.projectId ? <Badge className="agent-diagnostics-panel-live-run-project-id" variant="outline">{`project ${activeLiveRun.projectId}`}</Badge> : null}
            {activeLiveRun.flowId ? <Badge className="agent-diagnostics-panel-live-run-flow-id" variant="outline">{`flow ${activeLiveRun.flowId}`}</Badge> : null}
            {activeLiveRun.sessionKey ? <Badge className="agent-diagnostics-panel-live-run-session-key" variant="outline">{`sessionKey ${activeLiveRun.sessionKey}`}</Badge> : null}
            {activeLiveRun.assetCount > 0 ? <Badge className="agent-diagnostics-panel-live-run-assets" variant="light" color="teal">{`assets ${activeLiveRun.assetCount}`}</Badge> : null}
          </Group>

          {activeLiveRun.requestText || activeLiveRun.displayText ? (
            <Stack className="agent-diagnostics-panel-live-run-request" gap={2}>
              <Text className="agent-diagnostics-panel-live-run-request-title" size="xs" fw={600}>当前请求</Text>
              <Text className="agent-diagnostics-panel-live-run-request-text" size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {activeLiveRun.displayText || activeLiveRun.requestText}
              </Text>
            </Stack>
          ) : null}

          {activeLiveRun.assistantPreview ? (
            <Stack className="agent-diagnostics-panel-live-run-preview" gap={2}>
              <Text className="agent-diagnostics-panel-live-run-preview-title" size="xs" fw={600}>助手输出预览</Text>
              <Text className="agent-diagnostics-panel-live-run-preview-text" size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {activeLiveRun.assistantPreview}
              </Text>
            </Stack>
          ) : null}

          {activeLiveRun.todoItems.length > 0 ? (
            <Stack className="agent-diagnostics-panel-live-run-todo" gap={4}>
              <Text className="agent-diagnostics-panel-live-run-todo-title" size="xs" fw={600}>实时 Todo</Text>
              {activeLiveRun.todoItems.map((item, index) => (
                <Group className="agent-diagnostics-panel-live-run-todo-item" key={`live_todo_${index}_${item.text}`} gap="xs" wrap="nowrap" align="flex-start">
                  <Badge className="agent-diagnostics-panel-live-run-todo-status" size="xs" variant="light" color={timelineStatusColor(item.status)}>
                    {item.status}
                  </Badge>
                  <Text className="agent-diagnostics-panel-live-run-todo-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {item.text}
                  </Text>
                </Group>
              ))}
            </Stack>
          ) : null}

          {activeLiveRun.errorMessage ? (
            <Text className="agent-diagnostics-panel-live-run-error" size="sm" c="red">
              {activeLiveRun.errorMessage}
            </Text>
          ) : null}

          <Stack className="agent-diagnostics-panel-live-run-logs" gap={4}>
            <Text className="agent-diagnostics-panel-live-run-logs-title" size="xs" fw={600}>实时日志</Text>
            <ScrollArea className="agent-diagnostics-panel-live-run-logs-scroll" h={240} offsetScrollbars>
              <Stack className="agent-diagnostics-panel-live-run-logs-list" gap={4}>
                {activeLiveRun.logs.length === 0 ? (
                  <Text className="agent-diagnostics-panel-live-run-logs-empty" size="xs" c="dimmed">暂无实时日志</Text>
                ) : activeLiveRun.logs.map((entry) => (
                  <Stack className="agent-diagnostics-panel-live-run-log-card" key={entry.id} gap={2} p="xs" style={{ border: '1px solid var(--mantine-color-dark-5)', borderRadius: 8 }}>
                    <Group className="agent-diagnostics-panel-live-run-log-header" gap="xs" wrap="wrap">
                      <Badge className="agent-diagnostics-panel-live-run-log-event" size="xs" variant="outline">{entry.event}</Badge>
                      <Text className="agent-diagnostics-panel-live-run-log-title" size="xs" fw={600}>{entry.title}</Text>
                      {entry.reason ? (
                        <Badge className="agent-diagnostics-panel-live-run-log-reason" size="xs" variant="light" color={entry.tone === 'error' ? 'red' : 'yellow'} style={{ maxWidth: 420, textTransform: 'none' }}>
                          {entry.reason}
                        </Badge>
                      ) : null}
                      <Text className="agent-diagnostics-panel-live-run-log-time" size="xs" c="dimmed">{formatLiveRunTime(entry.at)}</Text>
                    </Group>
                    {entry.detail ? (
                      <Text className="agent-diagnostics-panel-live-run-log-detail" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {entry.detail}
                      </Text>
                    ) : null}
                  </Stack>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Stack>
      ) : null}

      <AgentApiExecutionChain
        jobs={agentApiJobs}
        jobsLoading={agentApiJobsLoading}
        jobsError={agentApiJobsError}
        selectedJobId={selectedAgentApiJob?.id ?? ''}
        traces={Array.isArray(data?.traces) ? data.traces : []}
        diagnosticsLoading={loading}
        onSelectJob={(jobId) => setTraceId(jobId)}
        onRefreshJobs={() => void loadAgentApiJobs()}
      />

      <Group className="agent-diagnostics-panel-filters" gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          className="agent-diagnostics-panel-trace-input"
          label="Agent API Job / Trace ID"
          placeholder="精确查询，可选"
          value={traceId}
          onChange={(event) => setTraceId(event.currentTarget.value)}
          w={280}
        />
        <TextInput
          className="agent-diagnostics-panel-project-input"
          label="项目 ID"
          value={projectId || ''}
          readOnly
          w={220}
        />
        <TextInput
          className="agent-diagnostics-panel-book-input"
          label="书籍 ID"
          placeholder="可选"
          value={bookId}
          onChange={(event) => setBookId(event.currentTarget.value)}
          w={180}
        />
        <TextInput
          className="agent-diagnostics-panel-chapter-input"
          label={scopedChapterId ? '章节 ID（当前章节）' : '章节 ID'}
          placeholder="可选"
          value={chapterId}
          onChange={(event) => setChapterId(event.currentTarget.value)}
          readOnly={Boolean(scopedChapterId)}
          w={scopedChapterId ? 220 : 140}
        />
        <TextInput
          className="agent-diagnostics-panel-flow-input"
          label="Flow ID"
          placeholder="可选"
          value={flowId}
          onChange={(event) => setFlowId(event.currentTarget.value)}
          w={180}
        />
        <TextInput
          className="agent-diagnostics-panel-node-input"
          label="Node ID"
          placeholder="可选"
          value={nodeId}
          onChange={(event) => setNodeId(event.currentTarget.value)}
          w={180}
        />
        <Select
          className="agent-diagnostics-panel-label-select"
          label="标签"
          data={LABEL_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={label}
          onChange={(value) => setLabel(value || '')}
          w={220}
        />
        <TextInput
          className="agent-diagnostics-panel-workflow-input"
          label="Workflow"
          placeholder="public_chat.general"
          value={workflowKey}
          onChange={(event) => setWorkflowKey(event.currentTarget.value)}
          w={220}
        />
        <TextInput
          className="agent-diagnostics-panel-model-input"
          label="模型"
          placeholder="model key"
          value={modelKey}
          onChange={(event) => setModelKey(event.currentTarget.value)}
          w={180}
        />
        <Select
          className="agent-diagnostics-panel-time-range-select"
          label="时间范围"
          data={TRACE_TIME_RANGE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={traceTimeRange}
          onChange={(value) => {
            if (isTraceTimeRange(value)) setTraceTimeRange(value)
          }}
          w={150}
        />
        <Select
          className="agent-diagnostics-panel-span-status-select"
          label="Trace 状态"
          data={TRACE_STATUS_OPTIONS}
          value={spanStatus}
          onChange={(value) => setSpanStatus(isAgentSpanStatus(value) ? value : '')}
          w={160}
        />
        <Select
          className="agent-diagnostics-panel-span-kind-select"
          label="Span 类型"
          data={TRACE_KIND_OPTIONS}
          value={spanKind}
          onChange={(value) => setSpanKind(isAgentSpanKind(value) ? value : '')}
          w={180}
        />
        <Select
          className="agent-diagnostics-panel-public-chat-verdict-select"
          label="Chat Verdict"
          data={PUBLIC_CHAT_VERDICT_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={publicChatVerdict}
          onChange={(value) => setPublicChatVerdict(value || '')}
          w={160}
        />
        <Select
          className="agent-diagnostics-panel-public-chat-outcome-select"
          label="Chat Outcome"
          data={PUBLIC_CHAT_OUTCOME_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={publicChatOutcome}
          onChange={(value) => setPublicChatOutcome(value || '')}
          w={160}
        />
        <Button className="agent-diagnostics-panel-refresh-button" variant="light" onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </Group>

      <Group className="agent-diagnostics-panel-summary" gap="xs" wrap="wrap">
        <Badge
          className="agent-diagnostics-panel-execution-health"
          variant="light"
          color={data?.executionHealth.status === 'degraded' ? 'red' : 'green'}
        >
          {data ? `execution ${data.executionHealth.status}` : 'execution 未加载'}
        </Badge>
        <Badge className="agent-diagnostics-panel-running-count" variant="outline" color="orange">
          {`运行中 ${data?.executionHealth.runningTraceCount ?? 0}`}
        </Badge>
        <Badge
          className="agent-diagnostics-panel-stale-count"
          variant="outline"
          color={(data?.executionHealth.staleRunningTraceCount ?? 0) > 0 ? 'red' : 'gray'}
        >
          {`疑似卡住 ${data?.executionHealth.staleRunningTraceCount ?? 0}`}
        </Badge>
        <Badge
          className="agent-diagnostics-panel-integrity-count"
          variant="outline"
          color={(data?.executionHealth.terminalIntegrityIssueCount ?? 0) > 0 ? 'red' : 'gray'}
        >
          {`终态矛盾 ${data?.executionHealth.terminalIntegrityIssueCount ?? 0}`}
        </Badge>
        <Badge
          className="agent-diagnostics-panel-sequence-count"
          variant="outline"
          color={(data?.executionHealth.sequenceMismatchCount ?? 0) > 0 ? 'red' : 'gray'}
        >
          {`日志缺口 ${data?.executionHealth.sequenceMismatchCount ?? 0}`}
        </Badge>
        <Badge className="agent-diagnostics-panel-trace-count" variant="light" color="gray">
          traces {Array.isArray(data?.traces) ? data?.traces.length : 0}
        </Badge>
        <Badge className="agent-diagnostics-panel-public-chat-count" variant="light" color="teal">
          public chat runs {Array.isArray(data?.publicChatRuns) ? data?.publicChatRuns.length : 0}
        </Badge>
        <Badge className="agent-diagnostics-panel-storyboard-count" variant="light" color="gray">
          storyboard logs {Array.isArray(data?.storyboardDiagnostics) ? data?.storyboardDiagnostics.length : 0}
        </Badge>
      </Group>

      <AgentObservabilitySummary
        spans={data?.spans ?? []}
        metrics={data?.metrics ?? null}
        evaluations={data?.evaluations ?? []}
        humanFeedback={data?.humanFeedback ?? []}
        annotationQueue={data?.annotationQueue ?? []}
        nextCursor={data?.nextCursor ?? null}
        loading={loading}
        onLoadMore={() => {
          if (data?.nextCursor) void load(data.nextCursor)
        }}
        onChanged={() => void load()}
      />

      {publicChatSummary.total > 0 ? (
        <Stack className="agent-diagnostics-panel-public-chat-summary-block" gap="xs">
          <Group className="agent-diagnostics-panel-public-chat-summary-grid" gap="sm" grow align="stretch">
            <div className="agent-diagnostics-panel-public-chat-summary-card" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10, padding: 12 }}>
              <Text className="agent-diagnostics-panel-public-chat-summary-card-label" size="xs" c="dimmed">run outcome</Text>
              <Group className="agent-diagnostics-panel-public-chat-summary-card-badges" gap="xs" mt={6} wrap="wrap">
                <Badge className="agent-diagnostics-panel-public-chat-summary-promote" variant="light" color="green">{`promote ${publicChatSummary.promoteCount}`}</Badge>
                <Badge className="agent-diagnostics-panel-public-chat-summary-hold" variant="light" color="yellow">{`hold ${publicChatSummary.holdCount}`}</Badge>
                <Badge className="agent-diagnostics-panel-public-chat-summary-discard" variant="light" color="red">{`discard ${publicChatSummary.discardCount}`}</Badge>
              </Group>
            </div>
            <div className="agent-diagnostics-panel-public-chat-summary-card" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10, padding: 12 }}>
              <Text className="agent-diagnostics-panel-public-chat-summary-card-label" size="xs" c="dimmed">turn verdict</Text>
              <Group className="agent-diagnostics-panel-public-chat-summary-card-badges" gap="xs" mt={6} wrap="wrap">
                <Badge className="agent-diagnostics-panel-public-chat-summary-satisfied" variant="light" color="green">{`satisfied ${publicChatSummary.satisfiedCount}`}</Badge>
                <Badge className="agent-diagnostics-panel-public-chat-summary-partial" variant="light" color="yellow">{`partial ${publicChatSummary.partialCount}`}</Badge>
                <Badge className="agent-diagnostics-panel-public-chat-summary-failed" variant="light" color="red">{`failed ${publicChatSummary.failedCount}`}</Badge>
              </Group>
            </div>
            <div className="agent-diagnostics-panel-public-chat-summary-card" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10, padding: 12 }}>
              <Text className="agent-diagnostics-panel-public-chat-summary-card-label" size="xs" c="dimmed">execution footprint</Text>
              <Group className="agent-diagnostics-panel-public-chat-summary-card-badges" gap="xs" mt={6} wrap="wrap">
                <Badge className="agent-diagnostics-panel-public-chat-summary-total" variant="outline">{`runs ${publicChatSummary.total}`}</Badge>
                <Badge className="agent-diagnostics-panel-public-chat-summary-canvas" variant="light" color="green">{`canvas ${publicChatSummary.canvasWriteCount}`}</Badge>
                <Badge className="agent-diagnostics-panel-public-chat-summary-assets" variant="light" color="gray">{`assets ${publicChatSummary.assetRunCount}`}</Badge>
              </Group>
            </div>
          </Group>
          {publicChatSummary.topWorkflows.length > 0 ? (
            <div className="agent-diagnostics-panel-public-chat-workflow-summary" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10, padding: 12 }}>
              <Text className="agent-diagnostics-panel-public-chat-workflow-summary-title" size="xs" c="dimmed">top workflows</Text>
              <Group className="agent-diagnostics-panel-public-chat-workflow-summary-list" gap="xs" mt={6} wrap="wrap">
                {publicChatSummary.topWorkflows.map((workflow) => (
                  <Badge
                    className="agent-diagnostics-panel-public-chat-workflow-summary-item"
                    key={workflow.workflowKey}
                    variant="outline"
                    color={workflow.failedCount > 0 ? 'red' : workflow.promoteCount > 0 ? 'green' : 'gray'}
                  >
                    {`${workflow.workflowKey} · ${workflow.count}`}
                  </Badge>
                ))}
              </Group>
            </div>
          ) : null}
        </Stack>
      ) : null}

      {selectedAgentApiJob ? null : (
        <AgentExecutionGraph
          className="agent-diagnostics-panel-execution-graph"
          traces={Array.isArray(data?.traces) ? data.traces : []}
          liveRun={activeLiveRun}
        />
      )}

      <Group className="agent-diagnostics-panel-raw-records-header" justify="space-between" align="center">
        <Text className="agent-diagnostics-panel-raw-records-title" size="sm" fw={600}>原始诊断记录</Text>
        <Button
          className="agent-diagnostics-panel-raw-records-toggle"
          size="compact-xs"
          variant="subtle"
          aria-expanded={rawRecordsOpened}
          onClick={() => setRawRecordsOpened((openedValue) => !openedValue)}
        >
          {rawRecordsOpened ? '收起' : '展开'}
        </Button>
      </Group>

      <Collapse className="agent-diagnostics-panel-raw-records-collapse" in={rawRecordsOpened}>
      <ScrollArea className="agent-diagnostics-panel-scroll" h={520} offsetScrollbars>
        <Stack className="agent-diagnostics-panel-content" gap="sm">
          {loading ? <Loader className="agent-diagnostics-panel-loader" size="sm" /> : null}
          {!loading && (!data || (data.traces.length === 0 && data.publicChatRuns.length === 0 && data.storyboardDiagnostics.length === 0 && data.spans.length === 0)) ? (
            <Text className="agent-diagnostics-panel-empty" c="dimmed" size="sm">暂无诊断数据</Text>
          ) : null}
          {Array.isArray(data?.traces) ? data.traces.map((item) => {
            const isExpanded = expandedTraceId === item.id
            const traceSelection = toTraceContextSelection(item)
            const meta = item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : null
            const metaLabel = readTraceString(meta, 'label')
            const metaPagePath = readTraceString(meta, 'pagePath')
            const metaReferrerPath = readTraceString(meta, 'referrerPath')
            const assistantText = readTraceString(meta, 'assistantText')
            const assistantTextPreview = readTraceString(meta, 'assistantTextPreview')
            const outputMode = readTraceString(meta, 'outputMode')
            const turnVerdict = readTraceRecord(meta, 'turnVerdict')
            const toolStatusSummary = readTraceRecord(meta, 'toolStatusSummary')
            const toolEvidence = readTraceRecord(meta, 'toolEvidence')
            const requestContext = readTraceRecord(meta, 'requestContext')
            const canvasPlan = readTraceRecord(meta, 'canvasPlan')
            const responseTrace = readTraceRecord(meta, 'responseTrace')
            const diagnosticFlags = readTraceRecordArray(meta, 'diagnosticFlags')
            const responseTurns = readTraceRecordArray(responseTrace, 'turns')
            const todoEvents = readTraceTodoEvents(meta, responseTrace)
            const canvasPlanParsed = readTraceBoolean(canvasPlan, 'parseSuccess')
            const canvasPlanNodeCount = readTraceNumber(canvasPlan, 'nodeCount')
            const toolFailedCount = readTraceNumber(toolStatusSummary, 'failedToolCalls')
            const turnVerdictStatus = readTraceString(turnVerdict, 'status')
            const turnVerdictReasons = readTraceStringArray(turnVerdict, 'reasons')
            const loadedSkills = getTraceLoadedSkillNames(item)
            return (
              <Stack className="agent-diagnostics-panel-trace-card" key={item.id} gap={4} p="sm" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10 }}>
                <Group className="agent-diagnostics-panel-trace-header" gap="xs" wrap="wrap">
                  <Badge className="agent-diagnostics-panel-trace-id" variant="outline" color="gray" title={item.id}>
                    {`trace ${item.id.slice(0, 8)}`}
                  </Badge>
                  <Badge className="agent-diagnostics-panel-trace-kind" variant="light">{item.requestKind}</Badge>
                  <Badge className="agent-diagnostics-panel-trace-scope" variant="outline">{item.scopeType}:{item.scopeId}</Badge>
                  {metaLabel ? <Badge className="agent-diagnostics-panel-trace-label" variant="light" color="gray">{metaLabel}</Badge> : null}
                  {metaPagePath ? <Badge className="agent-diagnostics-panel-trace-page" variant="outline" color="gray">{metaPagePath}</Badge> : null}
                  {Array.isArray(item.toolCalls) ? <Badge className="agent-diagnostics-panel-trace-tools-count" variant="outline" color="gray">tools {item.toolCalls.length}</Badge> : null}
                  {outputMode ? <Badge className="agent-diagnostics-panel-trace-output-mode" variant="light" color="gray">{outputMode}</Badge> : null}
                  {turnVerdictStatus ? <Badge className="agent-diagnostics-panel-trace-turn-verdict" variant="light" color={turnVerdictColor(turnVerdictStatus)}>{`verdict ${turnVerdictStatus}`}</Badge> : null}
                  {canvasPlanParsed ? <Badge className="agent-diagnostics-panel-trace-canvas-plan" variant="light" color="green">plan {canvasPlanNodeCount ?? 0}</Badge> : null}
                  {toolFailedCount && toolFailedCount > 0 ? <Badge className="agent-diagnostics-panel-trace-tool-failed" variant="light" color="red">failed {toolFailedCount}</Badge> : null}
                  {todoEvents.length > 0 ? <Badge className="agent-diagnostics-panel-trace-todo-events" variant="light" color="orange">{`todo ${todoEvents.length}`}</Badge> : null}
                  {diagnosticFlags.length > 0 ? <Badge className="agent-diagnostics-panel-trace-flags" variant="light" color="red">flags {diagnosticFlags.length}</Badge> : null}
                  {loadedSkills.length > 0 ? <Badge className="agent-diagnostics-panel-trace-loaded-skills-count" variant="light" color="orange">{`skills ${loadedSkills.length}`}</Badge> : null}
                  {loadedSkills.map((skillName) => (
                    <Badge className="agent-diagnostics-panel-trace-loaded-skill" key={`${item.id}_skill_${skillName}`} variant="outline" color="orange">
                      {skillName}
                    </Badge>
                  ))}
                  <Text className="agent-diagnostics-panel-trace-time" size="xs" c="dimmed">{item.createdAt}</Text>
                  {traceSelection.bookId || traceSelection.chapter !== null ? (
                    <Button
                      className="agent-diagnostics-panel-trace-context"
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => onInspectTrace?.(traceSelection)}
                    >
                      查看上下文
                    </Button>
                  ) : null}
                  <Button
                    className="agent-diagnostics-panel-trace-copy-id"
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => void handleCopyTraceId(item.id)}
                  >
                    复制 TraceId
                  </Button>
                  <Button
                    className="agent-diagnostics-panel-trace-execution-log"
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => setExecutionLogTraceId(item.id)}
                  >
                    执行日志
                  </Button>
                  <Button
                    className="agent-diagnostics-panel-trace-toggle"
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => setExpandedTraceId(isExpanded ? null : item.id)}
                  >
                    {isExpanded ? '收起' : '详情'}
                  </Button>
                </Group>
                <Text className="agent-diagnostics-panel-trace-input" size="sm">{item.inputSummary}</Text>
                {item.resultSummary ? <Text className="agent-diagnostics-panel-trace-result" size="sm" c="dimmed">{item.resultSummary}</Text> : null}
                {item.errorCode || item.errorDetail ? (
                  <Text className="agent-diagnostics-panel-trace-error" size="sm" c="red">
                    {[item.errorCode, item.errorDetail].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                <Collapse in={isExpanded}>
                  <Stack className="agent-diagnostics-panel-trace-details" gap={6} mt="xs">
                    {metaReferrerPath ? <Text className="agent-diagnostics-panel-trace-referrer" size="xs" c="dimmed">referrer: {metaReferrerPath}</Text> : null}
                    {assistantText || assistantTextPreview ? (
                      <Stack className="agent-diagnostics-panel-trace-output" gap={2}>
                        <Text className="agent-diagnostics-panel-trace-output-title" size="xs" fw={600}>assistant (full)</Text>
                        <Text className="agent-diagnostics-panel-trace-output-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {assistantText || assistantTextPreview}
                        </Text>
                      </Stack>
                    ) : null}
                    {Array.isArray(item.decisionLog) && item.decisionLog.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-trace-decisions" gap={2}>
                        {item.decisionLog.map((line, index) => (
                          <Text className="agent-diagnostics-panel-trace-decision" key={`${item.id}_decision_${index}`} size="xs" c="dimmed">{line}</Text>
                        ))}
                      </Stack>
                    ) : null}
                    {turnVerdictStatus ? (
                      <Stack className="agent-diagnostics-panel-trace-turn-verdict-block" gap={4}>
                        <Text className="agent-diagnostics-panel-trace-turn-verdict-title" size="xs" fw={600}>turn verdict</Text>
                        <Group className="agent-diagnostics-panel-trace-turn-verdict-header" gap="xs" wrap="wrap">
                          <Badge className="agent-diagnostics-panel-trace-turn-verdict-status" size="xs" variant="light" color={turnVerdictColor(turnVerdictStatus)}>{turnVerdictStatus}</Badge>
                          {turnVerdictReasons.map((reason, index) => (
                            <Badge className="agent-diagnostics-panel-trace-turn-verdict-reason" key={`${item.id}_verdict_${index}`} size="xs" variant="outline">{reason}</Badge>
                          ))}
                        </Group>
                      </Stack>
                    ) : null}
                    {diagnosticFlags.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-trace-flags-block" gap={4}>
                        <Text className="agent-diagnostics-panel-trace-flags-title" size="xs" fw={600}>diagnostic flags</Text>
                        {diagnosticFlags.map((flag, index) => {
                          const severity = readTraceString(flag, 'severity') || 'unknown'
                          const title = readTraceString(flag, 'title') || `flag ${index + 1}`
                          const detail = readTraceString(flag, 'detail')
                          const code = readTraceString(flag, 'code')
                          return (
                            <Stack className="agent-diagnostics-panel-trace-flag-card" key={`${item.id}_flag_${index}`} gap={2} p="xs" style={{ border: '1px solid var(--mantine-color-dark-5)', borderRadius: 8 }}>
                              <Group className="agent-diagnostics-panel-trace-flag-header" gap="xs" wrap="wrap">
                                <Badge className="agent-diagnostics-panel-trace-flag-severity" size="xs" variant="light" color={flagSeverityColor(severity)}>{severity}</Badge>
                                {code ? <Badge className="agent-diagnostics-panel-trace-flag-code" size="xs" variant="outline">{code}</Badge> : null}
                              </Group>
                              <Text className="agent-diagnostics-panel-trace-flag-title" size="xs" fw={600}>{title}</Text>
                              {detail ? <Text className="agent-diagnostics-panel-trace-flag-detail" size="xs" c="dimmed">{detail}</Text> : null}
                            </Stack>
                          )
                        })}
                      </Stack>
                    ) : null}
                    {requestContext ? (
                      <Stack className="agent-diagnostics-panel-trace-request-context" gap={2}>
                        <Text className="agent-diagnostics-panel-trace-request-context-title" size="xs" fw={600}>request context</Text>
                        <Text className="agent-diagnostics-panel-trace-request-context-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(requestContext)}
                        </Text>
                      </Stack>
                    ) : null}
                    {toolEvidence ? (
                      <Stack className="agent-diagnostics-panel-trace-tool-evidence" gap={2}>
                        <Text className="agent-diagnostics-panel-trace-tool-evidence-title" size="xs" fw={600}>evidence</Text>
                        <Text className="agent-diagnostics-panel-trace-tool-evidence-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(toolEvidence)}
                        </Text>
                      </Stack>
                    ) : null}
                    {canvasPlan ? (
                      <Stack className="agent-diagnostics-panel-trace-canvas-plan-block" gap={2}>
                        <Text className="agent-diagnostics-panel-trace-canvas-plan-title" size="xs" fw={600}>canvas plan</Text>
                        <Text className="agent-diagnostics-panel-trace-canvas-plan-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(canvasPlan)}
                        </Text>
                      </Stack>
                    ) : null}
                    {responseTrace ? (
                      <Stack className="agent-diagnostics-panel-trace-response-trace" gap={2}>
                        <Text className="agent-diagnostics-panel-trace-response-trace-title" size="xs" fw={600}>response trace</Text>
                        <Text className="agent-diagnostics-panel-trace-response-trace-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(responseTrace)}
                        </Text>
                      </Stack>
                    ) : null}
                    {responseTurns.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-trace-turns" gap={4}>
                        <Text className="agent-diagnostics-panel-trace-turns-title" size="xs" fw={600}>llm turns</Text>
                        {responseTurns.map((turn, index) => {
                          const turnNo = readTraceNumber(turn, 'turn')
                          const turnText = readTraceString(turn, 'text')
                          const turnPreview = readTraceString(turn, 'textPreview')
                          const turnToolCount = readTraceNumber(turn, 'toolCallCount')
                          const turnFinished = readTraceBoolean(turn, 'finished')
                          const toolNamesRaw = Array.isArray(turn.toolNames) ? turn.toolNames.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
                          return (
                            <Stack className="agent-diagnostics-panel-trace-turn-card" key={`${item.id}_turn_${index}`} gap={2} p="xs" style={{ border: '1px solid var(--mantine-color-dark-5)', borderRadius: 8 }}>
                              <Group className="agent-diagnostics-panel-trace-turn-header" gap="xs" wrap="wrap">
                                <Badge className="agent-diagnostics-panel-trace-turn-index" size="xs" variant="light">turn {turnNo ?? index + 1}</Badge>
                                <Badge className="agent-diagnostics-panel-trace-turn-tool-count" size="xs" variant="outline">tools {turnToolCount ?? 0}</Badge>
                                <Badge className="agent-diagnostics-panel-trace-turn-finished" size="xs" variant="light" color={turnFinished ? 'green' : 'yellow'}>
                                  {turnFinished ? 'finished' : 'continue'}
                                </Badge>
                                {toolNamesRaw.length ? <Badge className="agent-diagnostics-panel-trace-turn-tool-names" size="xs" variant="outline">{toolNamesRaw.join(', ')}</Badge> : null}
                              </Group>
                              <Text className="agent-diagnostics-panel-trace-turn-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {turnText || turnPreview}
                              </Text>
                            </Stack>
                          )
                        })}
                      </Stack>
                    ) : null}
                    {todoEvents.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-trace-todo-events-block" gap={4}>
                        <Text className="agent-diagnostics-panel-trace-todo-events-title" size="xs" fw={600}>todo timeline</Text>
                        {todoEvents.map((event, index) => {
                          const eventStatus = buildTodoEventStatus(event)
                          return (
                            <Stack className="agent-diagnostics-panel-trace-todo-event-card" key={`${item.id}_todo_${index}`} gap={2} p="xs" style={{ border: '1px solid var(--mantine-color-dark-5)', borderRadius: 8 }}>
                              <Group className="agent-diagnostics-panel-trace-todo-event-header" gap="xs" wrap="wrap">
                                <Text className="agent-diagnostics-panel-trace-todo-event-name" size="xs" fw={600}>{buildTodoEventTitle(event)}</Text>
                                <Badge className="agent-diagnostics-panel-trace-todo-event-status" size="xs" variant="light" color={timelineStatusColor(eventStatus)}>{eventStatus}</Badge>
                                {event.atMs !== null ? <Badge className="agent-diagnostics-panel-trace-todo-event-at" size="xs" variant="outline">+{event.atMs}ms</Badge> : null}
                                {event.durationMs !== null ? <Badge className="agent-diagnostics-panel-trace-todo-event-duration" size="xs" variant="outline">{event.durationMs}ms</Badge> : null}
                                <Badge className="agent-diagnostics-panel-trace-todo-event-source" size="xs" variant="outline">{event.sourceToolCallId}</Badge>
                              </Group>
                              <Text className="agent-diagnostics-panel-trace-todo-event-detail" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {formatTodoEventDetail(event)}
                              </Text>
                            </Stack>
                          )
                        })}
                      </Stack>
                    ) : null}
                    {Array.isArray(item.toolCalls) && item.toolCalls.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-trace-tools" gap={4}>
                        {item.toolCalls.map((call, index) => {
                          const toolName = readToolCallName(call)
                          const atMs = readToolCallAtMs(call)
                          const output = readToolCallOutputPreview(call) || JSON.stringify(call)
                          const pathHint = readToolCallPathHint(call)
                          const durationMs = readToolCallDurationMs(call)
                          const status = readToolCallStatus(call)
                          const outputChars = readToolCallOutputChars(call)
                          const errorMessage = readToolCallErrorMessage(call)
                          const inputPreview = readToolCallInputPreview(call)
                          return (
                            <Stack className="agent-diagnostics-panel-trace-tool-card" key={`${item.id}_tool_${index}`} gap={2} p="xs" style={{ border: '1px solid var(--mantine-color-dark-5)', borderRadius: 8 }}>
                              <Group className="agent-diagnostics-panel-trace-tool-header" gap="xs" wrap="wrap">
                                <Text className="agent-diagnostics-panel-trace-tool-name" size="xs" fw={600}>{toolName}</Text>
                                {status ? <Badge className="agent-diagnostics-panel-trace-tool-status" size="xs" variant="light" color={toolStatusColor(status)}>{status}</Badge> : null}
                                {(status === 'blocked' || status === 'failed' || status === 'denied') && (errorMessage || output) ? (
                                  <Badge className="agent-diagnostics-panel-trace-tool-reason" size="xs" variant="light" color={status === 'blocked' ? 'yellow' : 'red'} style={{ maxWidth: 420, textTransform: 'none' }}>
                                    {(errorMessage || output).split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 160) || ''}
                                  </Badge>
                                ) : null}
                                {atMs !== null ? <Badge className="agent-diagnostics-panel-trace-tool-at" size="xs" variant="outline">+{atMs}ms</Badge> : null}
                                {durationMs !== null ? <Badge className="agent-diagnostics-panel-trace-tool-duration" size="xs" variant="outline">{durationMs}ms</Badge> : null}
                                {outputChars !== null ? <Badge className="agent-diagnostics-panel-trace-tool-chars" size="xs" variant="outline">{outputChars} chars</Badge> : null}
                                {pathHint ? <Badge className="agent-diagnostics-panel-trace-tool-path" size="xs" variant="light">{pathHint}</Badge> : null}
                              </Group>
                              {inputPreview ? <Text className="agent-diagnostics-panel-trace-tool-input" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{inputPreview}</Text> : null}
                              <TraceImagePreview raw={output} />
                              <Text className="agent-diagnostics-panel-trace-tool-output" size="xs" c="dimmed">{output}</Text>
                              {errorMessage ? <Text className="agent-diagnostics-panel-trace-tool-error" size="xs" c="red">{errorMessage}</Text> : null}
                            </Stack>
                          )
                        })}
                      </Stack>
                    ) : null}
                  </Stack>
                </Collapse>
              </Stack>
            )
          }) : null}
          {Array.isArray(data?.publicChatRuns) ? data.publicChatRuns.map((item) => {
            const isExpanded = expandedPublicChatRunId === item.id
            return (
              <Stack className="agent-diagnostics-panel-public-chat-card" key={`public_chat_run_${item.id}`} gap={4} p="sm" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10 }}>
                <Group className="agent-diagnostics-panel-public-chat-header" gap="xs" wrap="wrap">
                  <Badge className="agent-diagnostics-panel-public-chat-workflow" variant="light" color="teal">{item.workflowKey}</Badge>
                  {item.label ? <Badge className="agent-diagnostics-panel-public-chat-label" variant="light" color="gray">{item.label}</Badge> : null}
                  <Badge className="agent-diagnostics-panel-public-chat-output-mode" variant="outline" color="gray">{item.outputMode}</Badge>
                  <Badge className="agent-diagnostics-panel-public-chat-verdict" variant="light" color={turnVerdictColor(item.turnVerdict)}>{`verdict ${item.turnVerdict}`}</Badge>
                  <Badge className="agent-diagnostics-panel-public-chat-outcome" variant="light" color={runOutcomeColor(item.runOutcome)}>{`outcome ${item.runOutcome}`}</Badge>
                  {item.assetCount > 0 ? <Badge className="agent-diagnostics-panel-public-chat-assets" variant="outline">{`assets ${item.assetCount}`}</Badge> : null}
                  {item.canvasWrite ? <Badge className="agent-diagnostics-panel-public-chat-canvas-write" variant="light" color="green">canvas write</Badge> : null}
                  {item.runMs !== null ? <Badge className="agent-diagnostics-panel-public-chat-run-ms" variant="outline">{`${item.runMs}ms`}</Badge> : null}
                  {item.diagnosticFlags.length > 0 ? <Badge className="agent-diagnostics-panel-public-chat-flags" variant="light" color="red">{`flags ${item.diagnosticFlags.length}`}</Badge> : null}
                  <Text className="agent-diagnostics-panel-public-chat-time" size="xs" c="dimmed">{item.createdAt}</Text>
                  <Button
                    className="agent-diagnostics-panel-public-chat-toggle"
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => setExpandedPublicChatRunId(isExpanded ? null : item.id)}
                  >
                    {isExpanded ? '收起' : '详情'}
                  </Button>
                </Group>
                <Text className="agent-diagnostics-panel-public-chat-session" size="sm" c="dimmed">{item.sessionKey}</Text>
                <Collapse in={isExpanded}>
                  <Stack className="agent-diagnostics-panel-public-chat-details" gap={6} mt="xs">
                    {item.projectId || item.bookId || item.chapterId ? (
                      <Group className="agent-diagnostics-panel-public-chat-scope" gap="xs" wrap="wrap">
                        {item.projectId ? <Badge className="agent-diagnostics-panel-public-chat-project-id" size="xs" variant="outline">{`project ${item.projectId}`}</Badge> : null}
                        {item.bookId ? <Badge className="agent-diagnostics-panel-public-chat-book-id" size="xs" variant="outline">{`book ${item.bookId}`}</Badge> : null}
                        {item.chapterId ? <Badge className="agent-diagnostics-panel-public-chat-chapter-id" size="xs" variant="outline">{`chapter ${item.chapterId}`}</Badge> : null}
                      </Group>
                    ) : null}
                    <Group className="agent-diagnostics-panel-public-chat-ids" gap="xs" wrap="wrap">
                      {item.requestId ? <Badge className="agent-diagnostics-panel-public-chat-request-id" size="xs" variant="outline">{`request ${item.requestId}`}</Badge> : null}
                      {item.userMessageId ? <Badge className="agent-diagnostics-panel-public-chat-user-message-id" size="xs" variant="outline">{`user ${item.userMessageId}`}</Badge> : null}
                      {item.assistantMessageId ? <Badge className="agent-diagnostics-panel-public-chat-assistant-message-id" size="xs" variant="outline">{`assistant ${item.assistantMessageId}`}</Badge> : null}
                    </Group>
                    {item.turnVerdictReasons.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-public-chat-reasons" gap={4}>
                        <Text className="agent-diagnostics-panel-public-chat-reasons-title" size="xs" fw={600}>turn verdict reasons</Text>
                        <Group className="agent-diagnostics-panel-public-chat-reasons-list" gap="xs" wrap="wrap">
                          {item.turnVerdictReasons.map((reason, index) => (
                            <Badge className="agent-diagnostics-panel-public-chat-reason" key={`${item.id}_reason_${index}`} size="xs" variant="outline">{reason}</Badge>
                          ))}
                        </Group>
                      </Stack>
                    ) : null}
                    {item.agentDecision ? (
                      <Stack className="agent-diagnostics-panel-public-chat-agent-decision" gap={2}>
                        <Text className="agent-diagnostics-panel-public-chat-agent-decision-title" size="xs" fw={600}>agent decision</Text>
                        <Text className="agent-diagnostics-panel-public-chat-agent-decision-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(item.agentDecision)}
                        </Text>
                      </Stack>
                    ) : null}
                    {item.toolStatusSummary ? (
                      <Stack className="agent-diagnostics-panel-public-chat-tool-summary" gap={2}>
                        <Text className="agent-diagnostics-panel-public-chat-tool-summary-title" size="xs" fw={600}>tool summary</Text>
                        <Text className="agent-diagnostics-panel-public-chat-tool-summary-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(item.toolStatusSummary)}
                        </Text>
                      </Stack>
                    ) : null}
                    {item.canvasPlan ? (
                      <Stack className="agent-diagnostics-panel-public-chat-canvas-plan" gap={2}>
                        <Text className="agent-diagnostics-panel-public-chat-canvas-plan-title" size="xs" fw={600}>canvas plan</Text>
                        <Text className="agent-diagnostics-panel-public-chat-canvas-plan-text" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {formatUnknown(item.canvasPlan)}
                        </Text>
                      </Stack>
                    ) : null}
                    {item.diagnosticFlags.length > 0 ? (
                      <Stack className="agent-diagnostics-panel-public-chat-flags-block" gap={4}>
                        <Text className="agent-diagnostics-panel-public-chat-flags-title" size="xs" fw={600}>diagnostic flags</Text>
                        {item.diagnosticFlags.map((flag, index) => {
                          const severity = readTraceString(flag, 'severity') || 'unknown'
                          const title = readTraceString(flag, 'title') || readTraceString(flag, 'code') || `flag ${index + 1}`
                          const detail = readTraceString(flag, 'detail')
                          return (
                            <Stack className="agent-diagnostics-panel-public-chat-flag-card" key={`${item.id}_flag_${index}`} gap={2} p="xs" style={{ border: '1px solid var(--mantine-color-dark-5)', borderRadius: 8 }}>
                              <Group className="agent-diagnostics-panel-public-chat-flag-header" gap="xs" wrap="wrap">
                                <Badge className="agent-diagnostics-panel-public-chat-flag-severity" size="xs" variant="light" color={flagSeverityColor(severity)}>{severity}</Badge>
                              </Group>
                              <Text className="agent-diagnostics-panel-public-chat-flag-title" size="xs" fw={600}>{title}</Text>
                              {detail ? <Text className="agent-diagnostics-panel-public-chat-flag-detail" size="xs" c="dimmed">{detail}</Text> : null}
                            </Stack>
                          )
                        })}
                      </Stack>
                    ) : null}
                  </Stack>
                </Collapse>
              </Stack>
            )
          }) : null}
          {Array.isArray(data?.storyboardDiagnostics) ? data.storyboardDiagnostics.map((row, index) => {
            const stage = typeof row.stage === 'string' ? row.stage : 'storyboard'
            const message = typeof row.message === 'string' ? row.message : 'unknown'
            const createdAt = typeof row.createdAt === 'string' ? row.createdAt : ''
            return (
              <Stack className="agent-diagnostics-panel-storyboard-card" key={`storyboard_${index}_${createdAt}`} gap={4} p="sm" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10 }}>
                <Group className="agent-diagnostics-panel-storyboard-header" gap="xs" wrap="wrap">
                  <Badge className="agent-diagnostics-panel-storyboard-stage" variant="light" color="gray">{stage}</Badge>
                  <Text className="agent-diagnostics-panel-storyboard-time" size="xs" c="dimmed">{createdAt}</Text>
                </Group>
                <Text className="agent-diagnostics-panel-storyboard-message" size="sm">{message}</Text>
              </Stack>
            )
          }) : null}
        </Stack>
      </ScrollArea>
      </Collapse>
      <AgentTraceExecutionLogModal
        opened={Boolean(executionLogTraceId)}
        trace={Array.isArray(data?.traces) ? data.traces.find((item) => item.id === executionLogTraceId) ?? null : null}
        onClose={() => setExecutionLogTraceId(null)}
        onCopyTraceId={(traceId) => void handleCopyTraceId(traceId)}
      />
    </Stack>
  )
}

function AgentTraceExecutionLogModal(props: {
  opened: boolean
  trace: AgentDiagnosticsTraceDto | null
  onClose: () => void
  onCopyTraceId: (traceId: string) => void
}): JSX.Element {
  const { opened, trace, onClose, onCopyTraceId } = props
  const meta = trace?.meta && typeof trace.meta === 'object' && !Array.isArray(trace.meta) ? trace.meta : null
  const requestContext = readTraceRecord(meta, 'requestContext')
  const toolEvidence = readTraceRecord(meta, 'toolEvidence')
  const canvasPlan = readTraceRecord(meta, 'canvasPlan')
  const responseTrace = readTraceRecord(meta, 'responseTrace')
  const diagnosticFlags = readTraceRecordArray(meta, 'diagnosticFlags')
  const responseTurns = readTraceRecordArray(responseTrace, 'turns')
  const todoEvents = readTraceTodoEvents(meta, responseTrace)
  const toolCalls = Array.isArray(trace?.toolCalls) ? trace.toolCalls : []
  const loadedSkills = React.useMemo(() => getTraceLoadedSkillNames(trace), [trace])
  const timeline = buildTraceTimelineItems({
    trace,
    requestContext,
    toolEvidence,
    canvasPlan,
    responseTurns,
    todoEvents,
    diagnosticFlags,
    toolCalls,
  })
  const copyAllLogs = React.useCallback(async () => {
    const payload = serializeTraceTimeline(trace, timeline)
    const ok = await copyText(payload)
    toast(ok ? '已复制全部执行日志' : '复制执行日志失败', ok ? 'success' : 'error')
  }, [trace, timeline])

  return (
    <Modal
      className="agent-diagnostics-execution-log-modal"
      opened={opened}
      onClose={onClose}
      title="执行日志"
      centered
      size="xl"
    >
      <Group className="agent-diagnostics-execution-log-actions" justify="space-between" align="center" mb="sm" wrap="wrap">
        <Group className="agent-diagnostics-execution-log-trace-meta" gap="xs" wrap="wrap">
          {trace?.id ? (
            <Badge className="agent-diagnostics-execution-log-trace-id" variant="outline" color="gray" title={trace.id}>
              {trace.id}
            </Badge>
          ) : null}
        </Group>
        <Group className="agent-diagnostics-execution-log-action-group" gap="xs" wrap="wrap">
          {trace?.id ? (
            <Button
              className="agent-diagnostics-execution-log-copy-trace-id"
              size="xs"
              variant="subtle"
              onClick={() => onCopyTraceId(trace.id)}
            >
              复制 TraceId
            </Button>
          ) : null}
          <Button className="agent-diagnostics-execution-log-copy-all" size="xs" variant="light" onClick={() => void copyAllLogs()}>
            复制全部日志
          </Button>
        </Group>
      </Group>
      {loadedSkills.length > 0 ? (
        <Group className="agent-diagnostics-execution-log-loaded-skills" gap="xs" mb="sm" wrap="wrap">
          <Badge className="agent-diagnostics-execution-log-loaded-skills-count" variant="light" color="orange">
            {`loaded skills ${loadedSkills.length}`}
          </Badge>
          {loadedSkills.map((skillName) => (
            <Badge className="agent-diagnostics-execution-log-loaded-skill" key={`execution_log_skill_${skillName}`} variant="outline" color="orange">
              {skillName}
            </Badge>
          ))}
        </Group>
      ) : null}
      <ScrollArea className="agent-diagnostics-execution-log-scroll" h={620} offsetScrollbars>
        <Stack className="agent-diagnostics-execution-log-stack" gap="sm">
          {timeline.length === 0 ? <Text className="agent-diagnostics-execution-log-empty" size="sm" c="dimmed">暂无执行日志</Text> : null}
          {timeline.map((entry, index) => (
            <Stack className="agent-diagnostics-execution-log-item" key={`${entry.kind}_${index}`} gap={4} p="sm" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 10 }}>
              <Group className="agent-diagnostics-execution-log-item-header" gap="xs" wrap="wrap">
                <Badge className="agent-diagnostics-execution-log-item-kind" size="xs" variant="light" color={timelineKindColor(entry.kind)}>{entry.kind}</Badge>
                {entry.status ? <Badge className="agent-diagnostics-execution-log-item-status" size="xs" variant="light" color={timelineStatusColor(entry.status)}>{entry.status}</Badge> : null}
                {entry.time ? <Badge className="agent-diagnostics-execution-log-item-time" size="xs" variant="outline">{entry.time}</Badge> : null}
              </Group>
              <Text className="agent-diagnostics-execution-log-item-title" size="sm" fw={600}>{entry.title}</Text>
              {entry.detail ? (
                <>
                  <TraceImagePreview raw={entry.detail} />
                  <Text className="agent-diagnostics-execution-log-item-detail" size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entry.detail}</Text>
                </>
              ) : null}
            </Stack>
          ))}
        </Stack>
      </ScrollArea>
    </Modal>
  )
}

type TraceTimelineItem = {
  kind: string
  title: string
  detail: string
  status?: string
  time?: string
}

type TodoTraceItem = {
  sourceToolCallId: string
  items: Array<{
    text: string
    completed: boolean
    status: 'pending' | 'in_progress' | 'completed'
  }>
  totalCount: number
  completedCount: number
  inProgressCount: number
  pendingCount: number
  atMs: number | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
}

export function getCanvasPlanTimelineStatus(canvasPlan: Record<string, unknown>): string {
  if (readTraceBoolean(canvasPlan, 'parseSuccess')) return 'parsed'
  const reason = readTraceString(canvasPlan, 'reason')
  const summary = readTraceString(canvasPlan, 'summary')
  if (reason === 'not_applicable_text_only' || summary === 'plain_text_answer_without_canvas_plan') {
    return 'info'
  }
  return 'invalid'
}

function buildTraceTimelineItems(input: {
  trace: AgentDiagnosticsTraceDto | null
  requestContext: Record<string, unknown> | null
  toolEvidence: Record<string, unknown> | null
  canvasPlan: Record<string, unknown> | null
  responseTurns: Record<string, unknown>[]
  todoEvents: TodoTraceItem[]
  diagnosticFlags: Record<string, unknown>[]
  toolCalls: Array<Record<string, unknown>>
}): TraceTimelineItem[] {
  const items: TraceTimelineItem[] = []
  if (input.trace) {
    items.push({
      kind: 'request',
      title: input.trace.requestKind,
      detail: [input.trace.inputSummary, input.trace.resultSummary || ''].filter(Boolean).join('\n'),
      status: input.trace.errorCode || input.trace.errorDetail ? 'error' : 'ok',
      time: input.trace.createdAt,
    })
  }
  if (input.requestContext) {
    items.push({ kind: 'context', title: 'request context', detail: formatUnknown(input.requestContext), status: 'info' })
  }
  if (input.toolEvidence) {
    items.push({ kind: 'evidence', title: 'tool evidence', detail: formatUnknown(input.toolEvidence), status: 'info' })
  }
  for (const turn of input.responseTurns) {
    const toolNamesRaw = Array.isArray(turn.toolNames) ? turn.toolNames.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
    items.push({
      kind: 'turn',
      title: `turn ${readTraceNumber(turn, 'turn') ?? '?'}`,
      detail: [
        `tools=${readTraceNumber(turn, 'toolCallCount') ?? 0}`,
        toolNamesRaw.length ? `toolNames=${toolNamesRaw.join(', ')}` : '',
        readTraceString(turn, 'text') || readTraceString(turn, 'textPreview'),
      ].filter(Boolean).join('\n'),
      status: readTraceBoolean(turn, 'finished') ? 'finished' : 'continue',
    })
  }
  for (const call of input.toolCalls) {
    const toolName = readToolCallName(call)
    const isCreativeLearning = toolName === 'creative_learning_record' || toolName === 'creative_learning_query' || toolName === 'creative_learning_review'
    items.push({
      kind: isCreativeLearning ? 'learning' : 'tool',
      title: toolName,
      detail: [
        readToolCallPathHint(call) ? `path=${readToolCallPathHint(call)}` : '',
        readToolCallInputPreview(call),
        readToolCallOutputPreview(call),
        readToolCallErrorMessage(call),
      ].filter(Boolean).join('\n'),
      status: readToolCallStatus(call) || 'unknown',
      time: readToolCallAtMs(call) !== null ? `+${readToolCallAtMs(call)}ms` : undefined,
    })
  }
  for (const event of input.todoEvents) {
    items.push({
      kind: 'todo',
      title: buildTodoEventTitle(event),
      detail: formatTodoEventDetail(event),
      status: buildTodoEventStatus(event),
      time: event.atMs !== null ? `+${event.atMs}ms` : event.finishedAt || event.startedAt || undefined,
    })
  }
  if (input.canvasPlan) {
    items.push({
      kind: 'plan',
      title: 'canvas plan',
      detail: formatUnknown(input.canvasPlan),
      status: getCanvasPlanTimelineStatus(input.canvasPlan),
    })
  }
  for (const flag of input.diagnosticFlags) {
    items.push({
      kind: 'flag',
      title: readTraceString(flag, 'title') || readTraceString(flag, 'code') || 'flag',
      detail: readTraceString(flag, 'detail'),
      status: readTraceString(flag, 'severity') || 'unknown',
    })
  }
  return items
}

function getTraceLoadedSkillNames(trace: AgentDiagnosticsTraceDto | null): string[] {
  const meta = trace?.meta && typeof trace.meta === 'object' && !Array.isArray(trace.meta) ? trace.meta : null
  const responseTrace = readTraceRecord(meta, 'responseTrace')
  const runtimeTrace = readTraceRecord(responseTrace, 'runtime')
  const requestContext = readTraceRecord(meta, 'requestContext')
  const candidates = [
    ...readTraceStringArray(runtimeTrace, 'loadedSkills'),
    ...readTraceStringArray(requestContext, 'loadedSkills'),
  ]
  const deduped = new Set<string>()
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    deduped.add(trimmed)
  }
  return Array.from(deduped)
}

function serializeTraceTimeline(trace: AgentDiagnosticsTraceDto | null, timeline: TraceTimelineItem[]): string {
  const loadedSkills = getTraceLoadedSkillNames(trace)
  const header = trace
    ? [
        `traceId=${trace.id}`,
        `requestKind=${trace.requestKind}`,
        `scope=${trace.scopeType}:${trace.scopeId}`,
        `createdAt=${trace.createdAt}`,
        `loadedSkills=${loadedSkills.join(",") || "none"}`,
      ].join('\n')
    : ''
  const body = timeline.map((entry, index) => {
    const meta = [
      `#${index + 1}`,
      entry.kind,
      entry.status ? `status=${entry.status}` : '',
      entry.time ? `time=${entry.time}` : '',
    ].filter(Boolean).join(' · ')
    return [meta, entry.title, entry.detail].filter(Boolean).join('\n')
  }).join('\n\n')
  return [header, body].filter(Boolean).join('\n\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // ignore
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.focus()
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  } catch {
    return false
  }
}

function toTraceContextSelection(trace: AgentDiagnosticsTraceDto): AgentTraceContextSelection {
  const meta = trace?.meta && typeof trace.meta === 'object' && !Array.isArray(trace.meta) ? trace.meta : null
  const fromMetaBookId = readTraceString(meta, 'bookId')
  const fromMetaChapter = normalizeChapter(readTraceString(meta, 'chapterId'))
  const fromMetaLabel = readTraceString(meta, 'label')
  return {
    traceId: trace.id,
    bookId: fromMetaBookId || null,
    chapter: fromMetaChapter ?? null,
    label: fromMetaLabel || null,
  }
}

function readTraceString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  const text = typeof record[key] === 'string' ? record[key].trim() : ''
  return text
}

function readTraceRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const nested = record[key]
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null
  return nested as Record<string, unknown>
}

function readTraceRecordArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  const nested = record[key]
  if (!Array.isArray(nested)) return []
  return nested.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function readTraceStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  const nested = record[key]
  if (!Array.isArray(nested)) return []
  return nested
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function readTodoTraceItems(value: unknown): TodoTraceItem[] {
  if (!Array.isArray(value)) return []
  const out: TodoTraceItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const sourceToolCallId = typeof record.sourceToolCallId === 'string' ? record.sourceToolCallId.trim() : ''
    if (!sourceToolCallId) continue
    const rawItems = Array.isArray(record.items) ? record.items : []
    const items = rawItems
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        const itemRecord = item as Record<string, unknown>
        const text = typeof itemRecord.text === 'string' ? itemRecord.text.trim() : ''
        if (!text) return null
        const rawStatus = typeof itemRecord.status === 'string' ? itemRecord.status.trim() : ''
        const status: TodoTraceItem['items'][number]['status'] =
          rawStatus === 'completed' || rawStatus === 'in_progress' || rawStatus === 'pending'
            ? rawStatus
            : itemRecord.completed === true
              ? 'completed'
              : 'pending'
        return {
          text,
          completed: status === 'completed',
          status,
        }
      })
      .filter((item): item is TodoTraceItem['items'][number] => item !== null)
      .slice(0, 20)
    if (items.length === 0) continue
    const totalCount = readTodoCount(record.totalCount, items.length)
    const completedCount = readTodoCount(record.completedCount, items.filter((item) => item.status === 'completed').length)
    const inProgressCount = readTodoCount(record.inProgressCount, items.filter((item) => item.status === 'in_progress').length)
    const pendingCount = readTodoCount(record.pendingCount, Math.max(totalCount - completedCount - inProgressCount, 0))
    out.push({
      sourceToolCallId,
      items,
      totalCount,
      completedCount,
      inProgressCount,
      pendingCount,
      atMs: readTraceNumber(record, 'atMs'),
      startedAt: readTraceString(record, 'startedAt') || null,
      finishedAt: readTraceString(record, 'finishedAt') || null,
      durationMs: readTraceNumber(record, 'durationMs'),
    })
    if (out.length >= 32) break
  }
  return out
}

function readTraceTodoEvents(meta: Record<string, unknown> | null, responseTrace: Record<string, unknown> | null): TodoTraceItem[] {
  const fromMeta = readTodoTraceItems(meta ? meta.todoEvents : null)
  if (fromMeta.length > 0) return fromMeta
  return readTodoTraceItems(responseTrace ? responseTrace.todoEvents : null)
}

function readTodoCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback
}

function readTraceBoolean(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record[key] === true
}

function readTraceNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const raw = record[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : null
}

function normalizeChapter(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.trunc(parsed)
  if (normalized <= 0) return null
  return normalized
}

function readToolCallName(call: Record<string, unknown>): string {
  const name = typeof call.name === 'string' ? call.name.trim() : ''
  return name || 'tool'
}

function readToolCallAtMs(call: Record<string, unknown>): number | null {
  const atMs = typeof call.atMs === 'number' && Number.isFinite(call.atMs) ? Math.trunc(call.atMs) : null
  return atMs != null && atMs >= 0 ? atMs : null
}

function readToolCallOutputPreview(call: Record<string, unknown>): string {
  const outputPreview = typeof call.outputPreview === 'string' ? call.outputPreview.trim() : ''
  if (outputPreview) return outputPreview
  const output = typeof call.output === 'string' ? call.output : ''
  return output.trim()
}

function readToolCallPathHint(call: Record<string, unknown>): string {
  const direct = typeof call.pathHint === 'string' ? call.pathHint.trim() : ''
  if (direct) return direct
  const input = call.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const record = input as Record<string, unknown>
  const path = typeof record.path === 'string' ? record.path.trim() : ''
  return path
}

function readToolCallDurationMs(call: Record<string, unknown>): number | null {
  const durationMs = typeof call.durationMs === 'number' && Number.isFinite(call.durationMs) ? Math.trunc(call.durationMs) : null
  return durationMs != null && durationMs >= 0 ? durationMs : null
}

function readToolCallStatus(call: Record<string, unknown>): string {
  return typeof call.status === 'string' ? call.status.trim() : ''
}

function readToolCallOutputChars(call: Record<string, unknown>): number | null {
  const outputChars = typeof call.outputChars === 'number' && Number.isFinite(call.outputChars) ? Math.trunc(call.outputChars) : null
  return outputChars != null && outputChars >= 0 ? outputChars : null
}

function readToolCallErrorMessage(call: Record<string, unknown>): string {
  return typeof call.errorMessage === 'string' ? call.errorMessage.trim() : ''
}

function readToolCallInputPreview(call: Record<string, unknown>): string {
  const input = call.input
  if (input == null) return ''
  return formatUnknown(input)
}

function buildTodoEventTitle(event: TodoTraceItem): string {
  const activeItem = event.items.find((item) => item.status === 'in_progress') ?? null
  if (activeItem) return `todo update · ${activeItem.text}`
  return `todo update · ${event.completedCount}/${event.totalCount} completed`
}

function buildTodoEventStatus(event: TodoTraceItem): string {
  if (event.inProgressCount > 0) return 'in_progress'
  if (event.pendingCount > 0) return 'pending'
  return 'completed'
}

function formatTodoEventDetail(event: TodoTraceItem): string {
  const summary = [
    `completed=${event.completedCount}/${event.totalCount}`,
    `pending=${event.pendingCount}`,
    `in_progress=${event.inProgressCount}`,
    event.finishedAt ? `finishedAt=${event.finishedAt}` : event.startedAt ? `startedAt=${event.startedAt}` : '',
  ].filter(Boolean)
  const items = event.items.map((item) => {
    const mark = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]'
    return `${mark} ${item.text}`
  })
  return [...summary, ...items].join('\n')
}

function summarizePublicChatRuns(runs: AgentDiagnosticsPublicChatRunDto[]): PublicChatRunSummary {
  const workflowMap = new Map<string, PublicChatWorkflowSummary>()
  let promoteCount = 0
  let holdCount = 0
  let discardCount = 0
  let satisfiedCount = 0
  let partialCount = 0
  let failedCount = 0
  let canvasWriteCount = 0
  let assetRunCount = 0

  for (const item of runs) {
    if (item.runOutcome === 'promote') promoteCount += 1
    else if (item.runOutcome === 'discard') discardCount += 1
    else holdCount += 1

    if (item.turnVerdict === 'satisfied') satisfiedCount += 1
    else if (item.turnVerdict === 'failed') failedCount += 1
    else partialCount += 1

    if (item.canvasWrite) canvasWriteCount += 1
    if (item.assetCount > 0) assetRunCount += 1

    const current = workflowMap.get(item.workflowKey) ?? {
      workflowKey: item.workflowKey,
      count: 0,
      promoteCount: 0,
      failedCount: 0,
    }
    current.count += 1
    if (item.runOutcome === 'promote') current.promoteCount += 1
    if (item.turnVerdict === 'failed') current.failedCount += 1
    workflowMap.set(item.workflowKey, current)
  }

  return {
    total: runs.length,
    promoteCount,
    holdCount,
    discardCount,
    satisfiedCount,
    partialCount,
    failedCount,
    canvasWriteCount,
    assetRunCount,
    topWorkflows: Array.from(workflowMap.values())
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count
        if (right.promoteCount !== left.promoteCount) return right.promoteCount - left.promoteCount
        return left.workflowKey.localeCompare(right.workflowKey)
      })
      .slice(0, 8),
  }
}

function runOutcomeColor(status: AgentDiagnosticsPublicChatRunDto['runOutcome']): string {
  switch (status) {
    case 'promote':
      return 'green'
    case 'discard':
      return 'red'
    default:
      return 'yellow'
  }
}

function toolStatusColor(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'green'
    case 'failed':
      return 'red'
    case 'denied':
      return 'orange'
    case 'blocked':
      return 'yellow'
    default:
      return 'gray'
  }
}

function flagSeverityColor(severity: string): string {
  switch (severity) {
    case 'high':
      return 'red'
    case 'medium':
      return 'orange'
    case 'low':
      return 'yellow'
    default:
      return 'gray'
  }
}

function turnVerdictColor(status: string): string {
  switch (status) {
    case 'failed':
      return 'red'
    case 'partial':
      return 'yellow'
    case 'satisfied':
      return 'green'
    default:
      return 'gray'
  }
}

function timelineKindColor(kind: string): string {
  switch (kind) {
    case 'request':
      return 'blue'
    case 'context':
      return 'grape'
    case 'evidence':
      return 'cyan'
    case 'turn':
      return 'indigo'
    case 'tool':
      return 'gray'
    case 'todo':
      return 'orange'
    case 'plan':
      return 'green'
    case 'flag':
      return 'red'
    default:
      return 'gray'
  }
}

function timelineStatusColor(status: string): string {
  switch (status) {
    case 'ok':
    case 'finished':
    case 'parsed':
    case 'succeeded':
      return 'green'
    case 'continue':
    case 'info':
      return 'blue'
    case 'pending':
    case 'in_progress':
      return 'orange'
    case 'completed':
      return 'green'
    case 'medium':
    case 'denied':
    case 'blocked':
      return 'orange'
    case 'high':
    case 'failed':
    case 'error':
    case 'invalid':
      return 'red'
    default:
      return 'gray'
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
