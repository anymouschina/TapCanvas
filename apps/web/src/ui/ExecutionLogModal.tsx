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
}) {
  const { opened, executionId, onClose, nodeLabelById } = props
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

  return (
    <Modal opened={opened} onClose={onClose} title="运行日志" centered size="lg">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              execution
            </Text>
            <Text size="xs" fw={600} style={{ wordBreak: 'break-all' }}>
              {executionId || '--'}
            </Text>
            {execution?.status && (
              <Badge
                size="xs"
                variant="light"
                color={execution.status === 'failed' ? 'red' : execution.status === 'success' ? 'teal' : execution.status === 'running' ? 'blue' : 'gray'}
              >
                {execution.status}
              </Badge>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={onlyIssues ? '只看告警/错误（已开启）' : '只看告警/错误'}>
              <ActionIcon
                size="sm"
                variant={onlyIssues ? 'light' : 'subtle'}
                aria-label="只看告警/错误"
                onClick={() => setOnlyIssues((v) => !v)}
              >
                <IconFilter size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={filterNodeId ? '清除节点筛选' : '未筛选节点'}>
              <ActionIcon
                size="sm"
                variant={filterNodeId ? 'light' : 'subtle'}
                aria-label="清除节点筛选"
                disabled={!filterNodeId}
                onClick={() => setFilterNodeId(null)}
              >
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
            <Badge variant="light">{statusLine}</Badge>
          </Group>
        </Group>

        {!!nodeRuns.length && (
          <>
            <Group justify="space-between">
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  节点执行
                </Text>
                <Badge size="xs" variant="light">
                  {runsSummary.total}
                </Badge>
                {Object.entries(runsSummary.by).map(([k, v]) => (
                  <Badge
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

            <ScrollArea h={180} offsetScrollbars>
              <Table striped highlightOnHover stickyHeader verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 180 }}>节点</Table.Th>
                    <Table.Th style={{ width: 110 }}>状态</Table.Th>
                    <Table.Th>信息</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {nodeRuns.map((r) => {
                    const label = nodeLabelById?.[r.nodeId]
                    const nodeDisplay = label || `${r.nodeId.slice(0, 8)}…`
                    const color = r.status === 'failed' ? 'red' : r.status === 'success' ? 'teal' : r.status === 'running' ? 'blue' : 'gray'
                    return (
                      <Table.Tr
                        key={r.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setFilterNodeId(r.nodeId)
                          focusNode(r.nodeId)
                        }}
                      >
                        <Table.Td>
                          <Text size="xs" fw={label ? 600 : 400} title={r.nodeId} style={{ maxWidth: 180 }}>
                            {nodeDisplay}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color={color as any}>
                            {r.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>
                            {r.errorMessage || '—'}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Divider />
          </>
        )}

        <ScrollArea h={360} offsetScrollbars>
          <Table striped highlightOnHover withColumnBorders={false} horizontalSpacing="sm" verticalSpacing="xs" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 54 }}>#</Table.Th>
                <Table.Th style={{ width: 90 }}>时间</Table.Th>
                <Table.Th style={{ width: 70 }}>级别</Table.Th>
                <Table.Th style={{ width: 160 }}>节点</Table.Th>
                <Table.Th style={{ width: 120 }}>事件</Table.Th>
                <Table.Th>信息</Table.Th>
                <Table.Th style={{ width: 44 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
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
                    key={`${e.seq}-${e.id}`}
                    style={{ cursor: e.nodeId ? 'pointer' : undefined }}
                    onClick={() => {
                      if (!e.nodeId) return
                      setFilterNodeId(e.nodeId)
                      focusNode(e.nodeId)
                    }}
                  >
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {e.seq}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {formatTime(e.createdAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={levelColor}>
                        {e.level}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={nodeLabel ? 600 : 400} title={e.nodeId || undefined} style={{ maxWidth: 160 }}>
                        {nodeDisplay}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{e.eventType}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                        {e.message || ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="复制">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          aria-label="复制日志"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            void writeClipboard(clip)
                          }}
                        >
                          <IconCopy size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
              {!visibleEvents.length && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text size="xs" c="dimmed" p="xs">
                      暂无事件
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            关闭
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
