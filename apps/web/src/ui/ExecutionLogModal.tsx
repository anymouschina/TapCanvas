import React from 'react'
import { Modal, Stack, Group, Text, Badge, ScrollArea, Button, Table, Divider, ActionIcon, Tooltip } from '@mantine/core'
import { IconCopy, IconFilter, IconPlayerStop, IconX } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { API_BASE, cancelWorkflowExecution, getWorkflowExecution, getWorkflowExecutionContext, getWorkflowExecutionSnapshot, listWorkflowNodeRuns, type WorkflowExecutionContextDto, type WorkflowExecutionDto, type WorkflowExecutionEventDto, type WorkflowNodeRunDto } from '../api/server'
import {
  resolveWorkflowExecutionFocusNode,
  workflowExecutionStatusLabel,
  workflowFocusNodePrefix,
  workflowNodeRunStatusLabel,
} from './workflowExecutionHistory'
import './ExecutionLogModal.css'
import { buildWorkflowExecutionSnapshotGraph } from './workflowExecutionSnapshotGraph'

function parseSseChunk(buffer: string) {
  const parts = buffer.split('\n\n')
  const complete = parts.slice(0, -1)
  const rest = parts[parts.length - 1] || ''
  const events = complete
    .map((block) => {
      const lines = block.split('\n').filter(Boolean)
      let event = 'message'
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
        if (line.startsWith('data:')) data += line.slice('data:'.length).trim()
      }
      return { event, data }
    })
    .filter((e) => e.data)
  return { events, rest }
}

export function ExecutionLogModal(props: {
  opened: boolean
  executionId: string | null
  onClose: () => void
  className?: string
}) {
  const { opened, executionId, onClose, className } = props
  const [events, setEvents] = React.useState<WorkflowExecutionEventDto[]>([])
  const [nodeRuns, setNodeRuns] = React.useState<WorkflowNodeRunDto[]>([])
  const [statusLine, setStatusLine] = React.useState<string>('connecting')
  const [lastSeq, setLastSeq] = React.useState<number>(0)
  const [onlyIssues, setOnlyIssues] = React.useState(false)
  const [filterNodeId, setFilterNodeId] = React.useState<string | null>(null)
  const [execution, setExecution] = React.useState<WorkflowExecutionDto | null>(null)
  const [canceling, setCanceling] = React.useState(false)
  const [snapshotNodeLabelById, setSnapshotNodeLabelById] = React.useState<Readonly<Record<string, string>>>({})
  const [snapshotError, setSnapshotError] = React.useState<string | null>(null)
  const [runtimeContext, setRuntimeContext] = React.useState<WorkflowExecutionContextDto | null>(null)

  React.useEffect(() => {
    if (!opened) return
    setEvents([])
    setNodeRuns([])
    setLastSeq(0)
    setStatusLine('connecting')
    setOnlyIssues(false)
    setFilterNodeId(null)
    setExecution(null)
    setCanceling(false)
    setSnapshotNodeLabelById({})
    setSnapshotError(null)
    setRuntimeContext(null)
  }, [opened, executionId])

  React.useEffect(() => {
    if (!opened || !executionId) return
    let active = true
    void Promise.all([getWorkflowExecutionSnapshot(executionId), getWorkflowExecutionContext(executionId)])
      .then(([snapshot, context]) => {
        if (!active) return
        const graph = buildWorkflowExecutionSnapshotGraph(snapshot, [])
        setSnapshotNodeLabelById(Object.fromEntries(graph.nodes.map((node) => [node.id, node.data.label])))
        setRuntimeContext(context)
        setSnapshotError(null)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setSnapshotNodeLabelById({})
        setRuntimeContext(null)
        setSnapshotError(loadError instanceof Error ? loadError.message : '执行时节点名称读取失败')
      })
    return () => { active = false }
  }, [executionId, opened])

  React.useEffect(() => {
    if (!opened) return
    if (!executionId) return
    let stopped = false
    const poll = async () => {
      try {
        const [dto, runs] = await Promise.all([
          getWorkflowExecution(executionId),
          listWorkflowNodeRuns(executionId),
        ])
        if (stopped) return
        setExecution(dto)
        setNodeRuns(runs)
        if (dto.status === 'success' || dto.status === 'failed' || dto.status === 'canceled') return
      } catch (pollError: unknown) {
        if (stopped) return
        setStatusLine(pollError instanceof Error ? pollError.message : '运行状态读取失败')
      }
      setTimeout(() => {
        if (!stopped) void poll()
      }, 1200)
    }
    void poll()
    return () => {
      stopped = true
    }
  }, [opened, executionId])

  React.useEffect(() => {
    if (!opened) return
    if (!executionId) return

    const abort = new AbortController()
    const url = `${API_BASE}/executions/${encodeURIComponent(executionId)}/events?after=${encodeURIComponent(String(lastSeq || 0))}`

    void (async () => {
      try {
        setStatusLine('connecting')
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          signal: abort.signal,
        })
        if (!resp.ok || !resp.body) {
          throw new Error(`SSE failed: ${resp.status}`)
        }

        setStatusLine('live')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parsed = parseSseChunk(buf)
          buf = parsed.rest
          for (const e of parsed.events) {
            if (e.event === 'ping') continue
            try {
              const dto = JSON.parse(e.data) as WorkflowExecutionEventDto
              if (dto && typeof dto.seq === 'number') {
                setLastSeq((prev) => (dto.seq > prev ? dto.seq : prev))
              }
              setEvents((prev) => [...prev, dto])
            } catch (parseError: unknown) {
              setStatusLine(parseError instanceof Error ? `日志事件解析失败：${parseError.message}` : '日志事件解析失败')
            }
          }
        }
      } catch (err: unknown) {
        if (abort.signal.aborted) return
        setStatusLine(err instanceof Error ? err.message : '日志连接中断')
      }
    })()

    return () => abort.abort()
  }, [opened, executionId])

  const formatTime = React.useCallback((s: string) => {
    try {
      const d = new Date(s)
      if (Number.isNaN(d.getTime())) return '--'
      return d.toLocaleTimeString()
    } catch {
      return '--'
    }
  }, [])

  const runsSummary = React.useMemo(() => {
    const total = nodeRuns.length
    const by: Record<string, number> = {}
    for (const r of nodeRuns) by[r.status] = (by[r.status] || 0) + 1
    return { total, by }
  }, [nodeRuns])

  const focusNode = React.useCallback((nodeId: string) => {
    const target = window as unknown as { __tcFocusNode?: (id: string) => void }
    target.__tcFocusNode?.(nodeId)
  }, [])

  const writeClipboard = React.useCallback(async (text: string) => {
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
  }, [])

  const visibleEvents = React.useMemo(() => {
    return events.filter((e) => {
      if (onlyIssues && e.level !== 'warn' && e.level !== 'error') return false
      if (filterNodeId && e.nodeId !== filterNodeId) return false
      return true
    })
  }, [events, onlyIssues, filterNodeId])

  const modalClassName = ['execution-log-modal', className].filter(Boolean).join(' ')
  const canCancel = execution?.status === 'queued' || execution?.status === 'running'
  const focusRun = React.useMemo(() => resolveWorkflowExecutionFocusNode(nodeRuns), [nodeRuns])

  const cancelExecution = React.useCallback(async (): Promise<void> => {
    if (!executionId || !canCancel || canceling) return
    setCanceling(true)
    try {
      const result = await cancelWorkflowExecution(executionId)
      setExecution(result.execution)
      setNodeRuns(await listWorkflowNodeRuns(executionId))
      notifications.show({
        title: result.execution.status === 'canceled' ? '运行已中断' : '运行无需中断',
        message: result.execution.status === 'canceled'
          ? `已停止后续调度，并向 ${result.localAbortedJobs} 个本地在飞执行器发送中断信号。`
          : `当前运行状态为 ${result.execution.status}。`,
        color: result.execution.status === 'canceled' ? 'yellow' : 'gray',
      })
    } catch (error: unknown) {
      notifications.show({
        title: '中断失败',
        message: error instanceof Error ? error.message : '无法中断工作流执行',
        color: 'red',
      })
    } finally {
      setCanceling(false)
    }
  }, [canceling, canCancel, executionId])

  return (
    <Modal className={modalClassName} opened={opened} onClose={onClose} title="运行日志" centered size="lg" zIndex={10200}>
      <Stack className="execution-log-body" gap="sm">
        <Group className="execution-log-header" justify="space-between">
          <Group className="execution-log-meta" gap="xs">
            <Text className="execution-log-meta-label" size="xs" c="dimmed">
              execution
            </Text>
            <Text className="execution-log-meta-id" size="xs" fw={600} style={{ wordBreak: 'break-all' }}>
              {executionId || '--'}
            </Text>
            {execution?.status && (
              <Badge
                className="execution-log-status"
                size="xs"
                variant="light"
                color={execution.status === 'failed' ? 'red' : execution.status === 'success' ? 'teal' : execution.status === 'running' ? 'blue' : 'gray'}
              >
                {workflowExecutionStatusLabel(execution.status)}
              </Badge>
            )}
          </Group>
          <Group className="execution-log-controls" gap="xs" wrap="nowrap">
            <Tooltip className="execution-log-cancel-tooltip" label="中断本次运行；已完成产物会保留">
              <ActionIcon
                className="execution-log-cancel-action"
                size="sm"
                variant="subtle"
                color="red"
                aria-label="中断本次工作流运行"
                disabled={!canCancel}
                loading={canceling}
                onClick={() => void cancelExecution()}
              >
                <IconPlayerStop className="execution-log-cancel-icon" size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="execution-log-filter-tooltip" label={onlyIssues ? '只看告警/错误（已开启）' : '只看告警/错误'}>
              <ActionIcon
                className="execution-log-filter-action"
                size="sm"
                variant={onlyIssues ? 'light' : 'subtle'}
                aria-label="只看告警/错误"
                onClick={() => setOnlyIssues((v) => !v)}
              >
                <IconFilter className="execution-log-filter-icon" size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="execution-log-node-filter-tooltip" label={filterNodeId ? '清除节点筛选' : '未筛选节点'}>
              <ActionIcon
                className="execution-log-node-filter-action"
                size="sm"
                variant={filterNodeId ? 'light' : 'subtle'}
                aria-label="清除节点筛选"
                disabled={!filterNodeId}
                onClick={() => setFilterNodeId(null)}
              >
                <IconX className="execution-log-node-filter-icon" size={14} />
              </ActionIcon>
            </Tooltip>
            <Badge className="execution-log-status-line" variant="light">{statusLine}</Badge>
          </Group>
        </Group>

        {snapshotError ? (
          <Text className="execution-log-snapshot-error" size="xs" c="red">
            执行快照读取失败：{snapshotError}。日志仍按持久节点 ID 展示。
          </Text>
        ) : null}

        {runtimeContext ? (
          <details className="execution-log-project-context">
            <summary>
              运行时项目资产 · {runtimeContext.assetSnapshot.length} 项
              {runtimeContext.usesProjectAssets ? ' · 已使用项目资产' : ' · 未检测到资产消费'}
            </summary>
            <Text size="xs" c="dimmed">
              项目 {runtimeContext.projectId || '—'} · 画布 {runtimeContext.canvasId || '—'}。这里显示本次运行开始时可见的资产快照，可用于区分“未注入”与“Agent 未使用”。
            </Text>
            <pre>{JSON.stringify({ projectContext: runtimeContext.projectContext, assetSnapshot: runtimeContext.assetSnapshot }, null, 2)}</pre>
          </details>
        ) : null}

        {!!nodeRuns.length && (
          <>
            <Group className="execution-log-summary" justify="space-between">
              <Group className="execution-log-summary-left" gap="xs">
                <Text className="execution-log-summary-label" size="xs" c="dimmed">
                  节点执行
                </Text>
                <Badge className="execution-log-summary-total" size="xs" variant="light">
                  {runsSummary.total}
                </Badge>
                {Object.entries(runsSummary.by).map(([k, v]) => (
                  <Badge
                    className="execution-log-summary-badge"
                    key={k}
                    size="xs"
                    variant="light"
                    color={k === 'failed' ? 'red' : k === 'success' ? 'teal' : k === 'running' ? 'blue' : 'gray'}
                  >
                    {workflowNodeRunStatusLabel(k as WorkflowNodeRunDto['status'])}:{v}
                  </Badge>
                ))}
              </Group>
              <Button
                className="execution-log-summary-focus"
                size="xs"
                variant="subtle"
                onClick={() => { if (focusRun) focusNode(focusRun.nodeId) }}
                disabled={!focusRun}
              >
                {focusRun ? `${workflowFocusNodePrefix(focusRun.status)} ${snapshotNodeLabelById[focusRun.nodeId] || focusRun.nodeId}` : '没有停留节点'}
              </Button>
            </Group>

            <ScrollArea className="execution-log-runs-scroll" h={180} offsetScrollbars>
              <Table className="execution-log-runs-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
                <Table.Thead className="execution-log-runs-head">
                  <Table.Tr className="execution-log-runs-head-row">
                    <Table.Th className="execution-log-runs-head-cell" style={{ width: 180 }}>节点</Table.Th>
                    <Table.Th className="execution-log-runs-head-cell" style={{ width: 110 }}>状态</Table.Th>
                    <Table.Th className="execution-log-runs-head-cell">信息</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="execution-log-runs-body">
                  {nodeRuns.map((r) => {
                    const label = snapshotNodeLabelById[r.nodeId]
                    const nodeDisplay = label || `${r.nodeId.slice(0, 8)}…`
                    const color = r.status === 'failed' ? 'red' : r.status === 'success' ? 'teal' : r.status === 'running' ? 'blue' : 'gray'
                    return (
                      <Table.Tr
                        className="execution-log-runs-row"
                        key={r.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setFilterNodeId(r.nodeId)
                          focusNode(r.nodeId)
                        }}
                      >
                        <Table.Td className="execution-log-runs-cell">
                          <Text className="execution-log-runs-node" size="xs" fw={label ? 600 : 400} title={r.nodeId} style={{ maxWidth: 180 }}>
                            {nodeDisplay}
                          </Text>
                        </Table.Td>
                        <Table.Td className="execution-log-runs-cell">
                          <Badge className="execution-log-runs-status" size="xs" variant="light" color={color}>
                            {workflowNodeRunStatusLabel(r.status, r.outputRefs)}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="execution-log-runs-cell">
                          <Text className="execution-log-runs-message" size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>
                            {[r.errorCode, r.failureStage, r.retryCount ? `重试 ${r.retryCount}` : '', r.toolName, r.modelKey, r.errorMessage].filter(Boolean).join(' · ') || '—'}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Divider className="execution-log-divider" />
          </>
        )}

        <ScrollArea className="execution-log-events-scroll" h={360} offsetScrollbars>
          <Table className="execution-log-events-table" striped highlightOnHover withColumnBorders={false} horizontalSpacing="sm" verticalSpacing="xs" stickyHeader>
            <Table.Thead className="execution-log-events-head">
              <Table.Tr className="execution-log-events-head-row">
                <Table.Th className="execution-log-events-head-cell" style={{ width: 54 }}>#</Table.Th>
                <Table.Th className="execution-log-events-head-cell" style={{ width: 90 }}>时间</Table.Th>
                <Table.Th className="execution-log-events-head-cell" style={{ width: 70 }}>级别</Table.Th>
                <Table.Th className="execution-log-events-head-cell" style={{ width: 160 }}>节点</Table.Th>
                <Table.Th className="execution-log-events-head-cell" style={{ width: 120 }}>事件</Table.Th>
                <Table.Th className="execution-log-events-head-cell">信息</Table.Th>
                <Table.Th className="execution-log-events-head-cell" style={{ width: 44 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="execution-log-events-body">
              {visibleEvents.map((e) => {
                const nodeLabel = e.nodeId ? snapshotNodeLabelById[e.nodeId] : null
                const nodeDisplay = nodeLabel || (e.nodeId ? `${e.nodeId.slice(0, 8)}…` : '--')
                const levelColor = e.level === 'error' ? 'red' : e.level === 'warn' ? 'yellow' : e.level === 'info' ? 'teal' : 'gray'
                const clip = [
                  `#${e.seq}`,
                  e.level,
                  e.eventType,
                  e.nodeId ? (nodeLabel || e.nodeId) : '',
                  e.message || '',
                  e.data === undefined ? '' : JSON.stringify(e.data),
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <Table.Tr
                    className="execution-log-events-row"
                    key={`${e.seq}-${e.id}`}
                    style={{ cursor: e.nodeId ? 'pointer' : undefined }}
                    onClick={() => {
                      if (!e.nodeId) return
                      setFilterNodeId(e.nodeId)
                      focusNode(e.nodeId)
                    }}
                  >
                    <Table.Td className="execution-log-events-cell">
                      <Text className="execution-log-events-seq" size="xs" c="dimmed">
                        {e.seq}
                      </Text>
                    </Table.Td>
                    <Table.Td className="execution-log-events-cell">
                      <Text className="execution-log-events-time" size="xs" c="dimmed">
                        {formatTime(e.createdAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td className="execution-log-events-cell">
                      <Badge className="execution-log-events-level" size="xs" variant="light" color={levelColor}>
                        {e.level}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="execution-log-events-cell">
                      <Text className="execution-log-events-node" size="xs" fw={nodeLabel ? 600 : 400} title={e.nodeId || undefined} style={{ maxWidth: 160 }}>
                        {nodeDisplay}
                      </Text>
                    </Table.Td>
                    <Table.Td className="execution-log-events-cell">
                      <Text className="execution-log-events-type" size="xs">{e.eventType}</Text>
                    </Table.Td>
                    <Table.Td className="execution-log-events-cell">
                      <div className="execution-log-events-message-wrap">
                        <Text className="execution-log-events-message" size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                          {e.message || ''}
                        </Text>
                        {e.data !== undefined ? (
                          <details className="execution-log-events-data">
                            <summary className="execution-log-events-data-summary">事件数据</summary>
                            <pre className="execution-log-events-data-value">{JSON.stringify(e.data, null, 2)}</pre>
                          </details>
                        ) : null}
                      </div>
                    </Table.Td>
                    <Table.Td className="execution-log-events-cell">
                      <Tooltip className="execution-log-events-copy-tooltip" label="复制">
                        <ActionIcon
                          className="execution-log-events-copy-action"
                          size="sm"
                          variant="subtle"
                          aria-label="复制日志"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            void writeClipboard(clip)
                          }}
                        >
                          <IconCopy className="execution-log-events-copy-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
              {!visibleEvents.length && (
                <Table.Tr className="execution-log-events-empty-row">
                  <Table.Td className="execution-log-events-empty-cell" colSpan={7}>
                    <Text className="execution-log-events-empty-text" size="xs" c="dimmed" p="xs">
                      暂无事件
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Group className="execution-log-footer" justify="flex-end">
          <Button className="execution-log-close" variant="subtle" onClick={onClose}>
            关闭
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
