import React from 'react'
import { ActionIcon, Button, Loader, Select, TextInput, Tooltip } from '@mantine/core'
import { IconCopy, IconPlayerPause, IconPlayerPlay, IconSearch } from '@tabler/icons-react'

import {
  fetchAdminExecutionDiagnosticBundle,
  fetchAdminExecutionEvents,
  type AgentExecutionEventDto,
  type AgentExecutionEventPageDto,
} from '../../api/server'
import { formatExecutionTimestamp } from './executionTiming'

type ExecutionEventLogInspectorProps = {
  traceId: string
  workflowNodeId?: string | null
}

const LIVE_TAIL_INTERVAL_MS = 1_500

function eventTone(event: AgentExecutionEventDto): string {
  if (event.status === 'failed' || event.eventType === 'error' || event.eventType === 'execution.failed') return 'failed'
  if (event.status === 'running' || event.phase === 'started') return 'running'
  if (event.status === 'succeeded' || event.phase === 'completed' || event.eventType === 'response.completed') return 'succeeded'
  return 'info'
}

function payloadLabel(event: AgentExecutionEventDto): string {
  if (event.eventType === 'request.accepted') return '执行输入'
  if (event.eventType === 'response.completed') return '最终输出'
  if (event.eventClass === 'tool') return event.phase === 'started' ? '工具输入' : '工具结果'
  return '事件载荷'
}

function mergeEvents(current: AgentExecutionEventDto[], incoming: AgentExecutionEventDto[]): AgentExecutionEventDto[] {
  const byId = new Map([...current, ...incoming].map((event) => [event.id, event]))
  return [...byId.values()].sort((left, right) => left.seq - right.seq)
}

function searchableEventText(event: AgentExecutionEventDto): string {
  return [
    event.eventType,
    event.eventClass,
    event.eventKey,
    event.status,
    event.phase,
    event.logicalTaskId,
    event.rootTraceId,
    event.parentTraceId,
    event.physicalRunId,
    event.workflowRunId,
    event.workflowNodeId,
    event.agentId,
    event.toolCallId,
    event.effectId,
    event.providerTaskId,
    JSON.stringify(event.payload),
  ].filter(Boolean).join('\n').toLocaleLowerCase()
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value)
}

export default function ExecutionEventLogInspector(props: ExecutionEventLogInspectorProps): JSX.Element {
  const { traceId, workflowNodeId = null } = props
  const [events, setEvents] = React.useState<AgentExecutionEventDto[]>([])
  const [pageState, setPageState] = React.useState<Omit<AgentExecutionEventPageDto, 'events' | 'nextAfterSeq'> | null>(null)
  const [nextAfterSeq, setNextAfterSeq] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [liveTail, setLiveTail] = React.useState(true)
  const [exporting, setExporting] = React.useState(false)
  const [eventClass, setEventClass] = React.useState<string | null>(null)
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [nodeFocus, setNodeFocus] = React.useState(Boolean(workflowNodeId))
  const generation = React.useRef(0)
  const eventsRef = React.useRef<AgentExecutionEventDto[]>([])

  React.useEffect(() => {
    eventsRef.current = events
  }, [events])

  const load = React.useCallback(async (afterSeq: number | null, append: boolean, background = false) => {
    const currentGeneration = generation.current
    if (!background) setLoading(true)
    setError('')
    try {
      const page = await fetchAdminExecutionEvents({ traceId, afterSeq, limit: 100 })
      if (generation.current !== currentGeneration) return
      setEvents((current) => append ? mergeEvents(current, page.events) : page.events)
      setNextAfterSeq(page.nextAfterSeq)
      const { events: _events, nextAfterSeq: _nextAfterSeq, ...nextPageState } = page
      setPageState(nextPageState)
    } catch (loadError: unknown) {
      if (generation.current !== currentGeneration) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (!background && generation.current === currentGeneration) setLoading(false)
    }
  }, [traceId])

  React.useEffect(() => {
    generation.current += 1
    setEvents([])
    setPageState(null)
    setNextAfterSeq(null)
    setLiveTail(true)
    setNodeFocus(Boolean(workflowNodeId))
    void load(null, false)
    return () => {
      generation.current += 1
    }
  }, [load, workflowNodeId])

  React.useEffect(() => {
    if (!liveTail || pageState?.traceStatus !== 'running') return undefined
    const timer = window.setInterval(() => {
      const currentEvents = eventsRef.current
      const lastSeq = currentEvents[currentEvents.length - 1]?.seq ?? 0
      void load(lastSeq, true, true)
    }, LIVE_TAIL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [liveTail, load, pageState?.traceStatus])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEvents = React.useMemo(() => events.filter((event) => {
    if (eventClass && event.eventClass !== eventClass) return false
    if (statusFilter && event.status !== statusFilter && event.phase !== statusFilter) return false
    if (nodeFocus && workflowNodeId && event.workflowNodeId !== workflowNodeId) return false
    return !normalizedQuery || searchableEventText(event).includes(normalizedQuery)
  }), [eventClass, events, nodeFocus, normalizedQuery, statusFilter, workflowNodeId])

  const classOptions = React.useMemo(() => [...new Set(events.map((event) => event.eventClass))]
    .sort()
    .map((value) => ({ value, label: value })), [events])
  const statusOptions = React.useMemo(() => [...new Set(events.flatMap((event) => [event.status, event.phase]).filter((value): value is string => Boolean(value)))]
    .sort()
    .map((value) => ({ value, label: value })), [events])
  const lastLoadedSeq = events[events.length - 1]?.seq ?? 0
  const live = pageState?.traceStatus === 'running'
  const integrity = pageState?.integrity

  const exportBundle = React.useCallback(async () => {
    setExporting(true)
    setError('')
    try {
      const blob = await fetchAdminExecutionDiagnosticBundle(traceId)
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `execution-${traceId}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : String(exportError))
    } finally {
      setExporting(false)
    }
  }, [traceId])

  return (
    <section className="agent-execution-run-log" aria-label="本轮 AI 执行日志">
      <header className="agent-execution-run-log__header">
        <div className="agent-execution-run-log__heading">
          <strong className="agent-execution-run-log__title">本轮 AI 执行日志</strong>
          <p className="agent-execution-run-log__description">数据库真实事件 · 可按节点、Agent、工具与供应商任务定位。</p>
        </div>
        <div className="agent-execution-run-log__header-actions">
          <Button
            className="agent-execution-run-log__export"
            variant="subtle"
            size="compact-xs"
            loading={exporting}
            onClick={() => void exportBundle()}
          >
            导出诊断包
          </Button>
          <span className={`agent-execution-run-log__integrity agent-execution-run-log__integrity--${integrity?.status ?? 'incomplete'}`}>
            {integrity?.status === 'consistent' ? '记录完整' : integrity?.status === 'inconsistent' ? '记录矛盾' : '记录未收口'}
          </span>
          <span className="agent-execution-run-log__count">{filteredEvents.length}/{events.length}</span>
          {live ? (
            <Tooltip className="agent-execution-run-log__tail-tooltip" label={liveTail ? '暂停实时追尾' : '继续实时追尾'}>
              <ActionIcon
                className="agent-execution-run-log__tail-toggle"
                variant="subtle"
                size="sm"
                aria-label={liveTail ? '暂停实时追尾' : '继续实时追尾'}
                onClick={() => setLiveTail((current) => !current)}
              >
                {liveTail
                  ? <IconPlayerPause className="agent-execution-run-log__tail-icon" size={14} />
                  : <IconPlayerPlay className="agent-execution-run-log__tail-icon" size={14} />}
              </ActionIcon>
            </Tooltip>
          ) : null}
        </div>
      </header>
      <div className="agent-execution-run-log__identity">
        <code className="agent-execution-run-log__trace-id">trace={traceId}</code>
        <Tooltip className="agent-execution-run-log__copy-tooltip" label="复制 trace ID">
          <ActionIcon
            className="agent-execution-run-log__copy"
            variant="subtle"
            size="xs"
            aria-label="复制 trace ID"
            onClick={() => copyText(traceId)}
          >
            <IconCopy className="agent-execution-run-log__copy-icon" size={12} />
          </ActionIcon>
        </Tooltip>
        <span className="agent-execution-run-log__cursor">#{lastLoadedSeq}/{pageState?.latestSeq ?? 0}</span>
      </div>
      <div className="agent-execution-run-log__filters">
        <TextInput
          className="agent-execution-run-log__search"
          size="xs"
          value={query}
          placeholder="搜索事件、ID、错误或载荷"
          leftSection={<IconSearch className="agent-execution-run-log__search-icon" size={13} />}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Select
          className="agent-execution-run-log__class-filter"
          size="xs"
          clearable
          placeholder="全部类型"
          data={classOptions}
          value={eventClass}
          onChange={setEventClass}
        />
        <Select
          className="agent-execution-run-log__status-filter"
          size="xs"
          clearable
          placeholder="全部状态"
          data={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        {workflowNodeId ? (
          <Button
            className={`agent-execution-run-log__node-focus${nodeFocus ? ' agent-execution-run-log__node-focus--active' : ''}`}
            variant="subtle"
            size="compact-xs"
            onClick={() => setNodeFocus((current) => !current)}
          >
            {nodeFocus ? '仅当前节点' : '显示全链路'}
          </Button>
        ) : null}
      </div>
      {integrity && integrity.issues.length > 0 ? (
        <div className="agent-execution-run-log__integrity-issues" role="status">
          {integrity.issues.map((issue) => (
            <p className="agent-execution-run-log__integrity-issue" key={issue.code}>{issue.code} · {issue.detail}</p>
          ))}
        </div>
      ) : null}
      {loading ? <Loader className="agent-execution-run-log__loader" size="xs" /> : null}
      {error ? <p className="agent-execution-run-log__error">日志读取失败：{error}</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="agent-execution-run-log__empty">这条执行记录还没有持久事件；旧记录不会伪造回填。</p>
      ) : null}
      {!loading && events.length > 0 && filteredEvents.length === 0 ? (
        <p className="agent-execution-run-log__empty">当前筛选条件没有命中事件。</p>
      ) : null}
      <div className="agent-execution-run-log__events">
        {filteredEvents.map((event) => (
          <details className={`agent-execution-run-log__event agent-execution-run-log__event--${eventTone(event)}`} key={event.id}>
            <summary className="agent-execution-run-log__event-summary">
              <span className="agent-execution-run-log__seq">#{event.seq}</span>
              <strong className="agent-execution-run-log__event-type">{event.eventType}</strong>
              <span className="agent-execution-run-log__event-class">{event.eventClass}</span>
              <span className="agent-execution-run-log__event-key">{event.eventKey}</span>
              {event.phase ? <span className="agent-execution-run-log__phase">{event.phase}</span> : null}
              {event.status ? <span className="agent-execution-run-log__status">{event.status}</span> : null}
              <time className="agent-execution-run-log__time" dateTime={event.createdAt}>{formatExecutionTimestamp(event.createdAt)}</time>
            </summary>
            <div className="agent-execution-run-log__payload">
              <div className="agent-execution-run-log__correlation">
                {event.workflowNodeId ? <code className="agent-execution-run-log__correlation-value">node={event.workflowNodeId}</code> : null}
                {event.agentId ? <code className="agent-execution-run-log__correlation-value">agent={event.agentId}</code> : null}
                {event.toolCallId ? <code className="agent-execution-run-log__correlation-value">tool={event.toolCallId}</code> : null}
                {event.effectId ? <code className="agent-execution-run-log__correlation-value">effect={event.effectId}</code> : null}
                {event.providerTaskId ? <code className="agent-execution-run-log__correlation-value">provider={event.providerTaskId}</code> : null}
              </div>
              <span className="agent-execution-run-log__payload-label">
                {payloadLabel(event)} · {event.payloadSizeBytes} bytes{event.payloadTruncated ? ' · 已截断' : ''}
              </span>
              <pre className="agent-execution-run-log__payload-value">{JSON.stringify(event.payload, null, 2)}</pre>
            </div>
          </details>
        ))}
      </div>
      {nextAfterSeq !== null ? (
        <Button
          className="agent-execution-run-log__load-more"
          variant="subtle"
          size="compact-xs"
          disabled={loading}
          onClick={() => void load(nextAfterSeq, true)}
        >
          加载后续事件
        </Button>
      ) : null}
    </section>
  )
}
