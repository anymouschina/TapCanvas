import React from 'react'
import { Paper, Group, Title, Transition, Button, Stack, Text, Badge, Table, ActionIcon, Tooltip, Loader } from '@mantine/core'
import { IconRefresh, IconPlayerPlay, IconFileText, IconTarget } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { listWorkflowExecutions, listWorkflowNodeRuns, type WorkflowExecutionDto, type WorkflowNodeRunDto } from '../api/server'
import { calculateSafeMaxHeight } from './utils/panelPosition'

function statusColor(status: WorkflowExecutionDto['status']): string {
  if (status === 'success') return 'teal'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'blue'
  if (status === 'queued') return 'gray'
  return 'gray'
}

export default function ExecutionPanel(props: {
  onOpenLog: (executionId: string) => void
  onRun?: () => void | Promise<void>
  onFocusNode?: (nodeId: string) => void
  nodeLabelById?: Record<string, string>
}): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const currentFlowId = useUIStore((s) => s.currentFlow.id)
  const mounted = active === 'runs'
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<WorkflowExecutionDto[]>([])
  const [failedNodeByExecId, setFailedNodeByExecId] = React.useState<Record<string, { nodeId: string }>>({})
  const [runStatsByExecId, setRunStatsByExecId] = React.useState<Record<string, { total: number; done: number; failed: number }>>({})
  const nodeLabelById = props.nodeLabelById
  const onFocusNode = props.onFocusNode
  const [runStarting, setRunStarting] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!currentFlowId) return
    setLoading(true)
    setError(null)
    try {
      const list = await listWorkflowExecutions({ flowId: currentFlowId, limit: 40 })
      setItems(Array.isArray(list) ? list : [])
      setFailedNodeByExecId((prev) => prev) // keep cache
    } catch (e: any) {
      setError(e?.message || '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [currentFlowId])

  const ensureFailedNodeCached = React.useCallback(
    async (executionId: string) => {
      if (!executionId) return null
      if (failedNodeByExecId[executionId]?.nodeId) return failedNodeByExecId[executionId]!
      try {
        const runs = await listWorkflowNodeRuns(executionId)
        const failed = Array.isArray(runs) ? runs.find((r) => r.status === 'failed') : null
        if (!failed?.nodeId) return null
        const payload = { nodeId: failed.nodeId }
        setFailedNodeByExecId((prev) => ({ ...prev, [executionId]: payload }))
        return payload
      } catch {
        return null
      }
    },
    [failedNodeByExecId],
  )

  const ensureRunStatsCached = React.useCallback(
    async (executionId: string) => {
      if (!executionId) return null
      if (runStatsByExecId[executionId]) return runStatsByExecId[executionId]!
      try {
        const runs = (await listWorkflowNodeRuns(executionId)) as WorkflowNodeRunDto[]
        const total = Array.isArray(runs) ? runs.length : 0
        let done = 0
        let failed = 0
        if (Array.isArray(runs)) {
          for (const r of runs) {
            if (r.status === 'success') done += 1
            if (r.status === 'failed') failed += 1
          }
        }
        const payload = { total, done, failed }
        setRunStatsByExecId((prev) => ({ ...prev, [executionId]: payload }))
        return payload
      } catch {
        return null
      }
    },
    [runStatsByExecId],
  )

  const handleRun = React.useCallback(async () => {
    if (runStarting || loading) return
    setRunStarting(true)
    try {
      await props.onRun?.()
      // allow backend to insert first rows, then refresh list
      setTimeout(() => void load(), 700)
    } finally {
      setRunStarting(false)
    }
  }, [props, runStarting, loading, load])

  const handleRerun = React.useCallback(async () => {
    await handleRun()
  }, [handleRun])

  React.useEffect(() => {
    if (!mounted) return
    void load()
  }, [mounted, load])

  React.useEffect(() => {
    if (!mounted) return
    const failedOnes = items.filter((it) => it.status === 'failed').slice(0, 6)
    if (!failedOnes.length) return
    void Promise.allSettled(failedOnes.map((it) => ensureFailedNodeCached(it.id)))
  }, [mounted, items, ensureFailedNodeCached])

  React.useEffect(() => {
    if (!mounted) return
    const hasActive = items.some((it) => it.status === 'running' || it.status === 'queued')
    if (!hasActive) return
    const t = window.setInterval(() => void load(), 1500)
    return () => window.clearInterval(t)
  }, [mounted, items, load])

  React.useEffect(() => {
    if (!mounted) return
    const active = items.filter((it) => it.status === 'running' || it.status === 'queued').slice(0, 2)
    if (!active.length) return
    void Promise.allSettled(active.map((it) => ensureRunStatsCached(it.id)))
  }, [mounted, items, ensureRunStatsCached])

  if (!mounted) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 190)

  return (
    <div className="execution-panel-anchor" style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 190 : 140, zIndex: 200 }} data-ux-panel>
      <Transition className="execution-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="execution-panel-transition-inner" style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 520,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="execution-panel-arrow panel-arrow" />
              <Group className="execution-panel-header" justify="space-between" mb={8}>
                <Group className="execution-panel-title-group" gap="xs">
                  <Title className="execution-panel-title" order={6}>运行记录</Title>
                  <Tooltip className="execution-panel-refresh-tooltip" label="刷新">
                    <ActionIcon className="execution-panel-refresh-action" size="sm" variant="subtle" aria-label="刷新运行记录" onClick={() => void load()} disabled={loading}>
                      <IconRefresh className="execution-panel-refresh-icon" size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip className="execution-panel-run-tooltip" label="运行">
                    <ActionIcon
                      className="execution-panel-run-action"
                      size="sm"
                      variant="subtle"
                      aria-label="运行工作流"
                      onClick={() => void handleRun()}
                      disabled={!currentFlowId || runStarting}
                    >
                      {runStarting ? <Loader className="execution-panel-run-loader" size="xs" /> : <IconPlayerPlay className="execution-panel-run-icon" size={14} />}
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <Button className="execution-panel-close" size="xs" variant="light" onClick={() => setActivePanel(null)}>
                  关闭
                </Button>
              </Group>

              {!currentFlowId && (
                <Text className="execution-panel-empty-hint" size="sm" c="dimmed">
                  还没有保存过这个项目：先点顶部“保存”，再运行一次就会出现在这里。
                </Text>
              )}

              {!!error && (
                <Text className="execution-panel-error" size="sm" c="red">
                  {error}
                </Text>
              )}

              <div className="execution-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Stack className="execution-panel-body-stack" gap="xs">
                  {currentFlowId && !items.length && !loading && (
                    <Text className="execution-panel-no-items" size="sm" c="dimmed">
                      暂无运行记录
                    </Text>
                  )}

                  {!!items.length && (
                    <Table className="execution-panel-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
                      <Table.Thead className="execution-panel-table-head">
                        <Table.Tr className="execution-panel-table-head-row">
                          <Table.Th className="execution-panel-table-head-cell" style={{ width: 170 }}>时间</Table.Th>
                          <Table.Th className="execution-panel-table-head-cell" style={{ width: 100 }}>状态</Table.Th>
                          <Table.Th className="execution-panel-table-head-cell" style={{ width: 110 }}>进度</Table.Th>
                          <Table.Th className="execution-panel-table-head-cell" style={{ width: 170 }}>失败节点</Table.Th>
                          <Table.Th className="execution-panel-table-head-cell">信息</Table.Th>
                          <Table.Th className="execution-panel-table-head-cell" style={{ width: 150 }} />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody className="execution-panel-table-body">
                        {items.map((it) => (
                          <Table.Tr className="execution-panel-table-row" key={it.id}>
                            <Table.Td className="execution-panel-table-cell">
                              <Text className="execution-panel-created-at" size="xs" c="dimmed">
                                {new Date(it.createdAt).toLocaleString()}
                              </Text>
                            </Table.Td>
                            <Table.Td className="execution-panel-table-cell">
                              <Badge className="execution-panel-status-badge" size="xs" variant="light" color={statusColor(it.status) as any}>
                                {it.status}
                              </Badge>
                            </Table.Td>
                            <Table.Td className="execution-panel-table-cell">
                              {(() => {
                                const stats = runStatsByExecId[it.id]
                                if (!stats || !stats.total) return <Text className="execution-panel-progress-empty" size="xs" c="dimmed">—</Text>
                                const label = `${stats.done}/${stats.total}${stats.failed ? ` · 失败${stats.failed}` : ''}`
                                return (
                                  <Text className="execution-panel-progress" size="xs" c={stats.failed ? 'red' : 'dimmed'}>
                                    {label}
                                  </Text>
                                )
                              })()}
                            </Table.Td>
                            <Table.Td className="execution-panel-table-cell">
                              {it.status === 'failed' ? (
                                <Text className="execution-panel-failed-node" size="xs" title={failedNodeByExecId[it.id]?.nodeId} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                                  {(() => {
                                    const nodeId = failedNodeByExecId[it.id]?.nodeId
                                    if (!nodeId) return '（加载中…）'
                                    return nodeLabelById?.[nodeId] || `${nodeId.slice(0, 8)}…`
                                  })()}
                                </Text>
                              ) : (
                                <Text className="execution-panel-failed-node-empty" size="xs" c="dimmed">—</Text>
                              )}
                            </Table.Td>
                            <Table.Td className="execution-panel-table-cell">
                              <Text className="execution-panel-message" size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                                {it.errorMessage || (it.trigger ? `触发：${it.trigger}` : '') || '—'}
                              </Text>
                            </Table.Td>
                            <Table.Td className="execution-panel-table-cell">
                              <Group className="execution-panel-actions" gap={6} justify="flex-end" wrap="nowrap">
                                {(it.status === 'failed' || it.status === 'success') && (
                                  <Tooltip className="execution-panel-rerun-tooltip" label="重跑">
                                    <ActionIcon
                                      className="execution-panel-rerun-action"
                                      size="sm"
                                      variant="light"
                                      aria-label="重跑"
                                      onClick={() => void handleRerun()}
                                      disabled={runStarting}
                                    >
                                      <IconPlayerPlay className="execution-panel-rerun-icon" size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                                {it.status === 'failed' && (
                                  <Tooltip className="execution-panel-focus-tooltip" label="定位失败节点">
                                    <ActionIcon
                                      className="execution-panel-focus-action"
                                      size="sm"
                                      variant="light"
                                      aria-label="定位失败节点"
                                      onClick={async () => {
                                        const payload = await ensureFailedNodeCached(it.id)
                                        if (!payload?.nodeId) return
                                        onFocusNode?.(payload.nodeId)
                                      }}
                                    >
                                      <IconTarget className="execution-panel-focus-icon" size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                                <Tooltip className="execution-panel-log-tooltip" label="打开日志">
                                  <ActionIcon className="execution-panel-log-action" size="sm" variant="light" aria-label="打开日志" onClick={() => props.onOpenLog(it.id)}>
                                    <IconFileText className="execution-panel-log-icon" size={14} />
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
