import React from 'react'
import { Modal, Stack, Group, Text, Badge, ScrollArea, Button, Table, Divider, ActionIcon, Tooltip } from '@mantine/core'
import { IconCopy, IconFilter, IconX } from '@tabler/icons-react'
import { API_BASE, getWorkflowExecution, listWorkflowNodeRuns, type WorkflowExecutionDto, type WorkflowExecutionEventDto, type WorkflowNodeRunDto } from '../api/server'
import { getAuthToken, getAuthTokenFromCookie } from '../auth/store'

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
  nodeLabelById?: Record<string, string>
  className?: string
}) {
  const { opened, executionId, onClose, nodeLabelById, className } = props
  const [events, setEvents] = React.useState<WorkflowExecutionEventDto[]>([])
  const [nodeRuns, setNodeRuns] = React.useState<WorkflowNodeRunDto[]>([])
  const [statusLine, setStatusLine] = React.useState<string>('connecting')
  const [lastSeq, setLastSeq] = React.useState<number>(0)
  const [onlyIssues, setOnlyIssues] = React.useState(false)
  const [filterNodeId, setFilterNodeId] = React.useState<string | null>(null)
  const [execution, setExecution] = React.useState<WorkflowExecutionDto | null>(null)

  React.useEffect(() => {
    if (!opened) return
    setEvents([])
    setNodeRuns([])
    setLastSeq(0)
    setStatusLine('connecting')
    setOnlyIssues(false)
    setFilterNodeId(null)
    setExecution(null)
  }, [opened, executionId])

  React.useEffect(() => {
    if (!opened) return
    if (!executionId) return
    let stopped = false
    const poll = async () => {
      try {
        const dto = await getWorkflowExecution(executionId)
        if (stopped) return
        setExecution(dto)
        if (dto.status === 'success' || dto.status === 'failed' || dto.status === 'canceled') return
      } catch {
        if (stopped) return
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
    void (async () => {
      try {
        const rows = await listWorkflowNodeRuns(executionId)
        setNodeRuns(Array.isArray(rows) ? rows : [])
      } catch {
        setNodeRuns([])
      }
    })()
  }, [opened, executionId])

  React.useEffect(() => {
    if (!opened) return
    if (!executionId) return

    const abort = new AbortController()
    const t = getAuthToken() || getAuthTokenFromCookie()
    const url = `${API_BASE}/executions/${encodeURIComponent(executionId)}/events?after=${encodeURIComponent(String(lastSeq || 0))}`

    void (async () => {
      try {
        setStatusLine('connecting')
        const resp = await fetch(url, {
          method: 'GET',
          headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
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
            } catch {
              // ignore
            }
          }
        }
      } catch (err: any) {
        if (abort.signal.aborted) return
        setStatusLine(err?.message || 'disconnected')
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
    try {
      const fn = (window as any).__tcFocusNode as undefined | ((id: string) => void)
      fn?.(nodeId)
    } catch {
      // ignore
    }
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

  return (
    <Modal className={modalClassName} opened={opened} onClose={onClose} title="运行日志" centered size="lg">
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
                {execution.status}
              </Badge>
            )}
          </Group>
          <Group className="execution-log-controls" gap="xs" wrap="nowrap">
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
                    {k}:{v}
                  </Badge>
                ))}
              </Group>
              <Button
                className="execution-log-summary-focus"
                size="xs"
                variant="subtle"
                onClick={() => {
                  const failed = nodeRuns.find((r) => r.status === 'failed')
                  if (failed) focusNode(failed.nodeId)
                }}
                disabled={!nodeRuns.some((r) => r.status === 'failed')}
              >
                定位失败节点
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
                    const label = nodeLabelById?.[r.nodeId]
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
                          <Badge className="execution-log-runs-status" size="xs" variant="light" color={color as any}>
                            {r.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="execution-log-runs-cell">
                          <Text className="execution-log-runs-message" size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>
                            {r.errorMessage || '—'}
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
                const nodeLabel = e.nodeId ? nodeLabelById?.[e.nodeId] : null
                const nodeDisplay = nodeLabel || (e.nodeId ? `${e.nodeId.slice(0, 8)}…` : '--')
                const levelColor = e.level === 'error' ? 'red' : e.level === 'warn' ? 'yellow' : e.level === 'info' ? 'teal' : 'gray'
                const clip = [
                  `#${e.seq}`,
                  e.level,
                  e.eventType,
                  e.nodeId ? (nodeLabel || e.nodeId) : '',
                  e.message || '',
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
                      <Text className="execution-log-events-message" size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                        {e.message || ''}
                      </Text>
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
