import React from 'react'
import { Paper, Group, Title, Transition, Button, Stack, Text, TextInput, Textarea, Badge, ActionIcon, Modal, CopyButton, Tooltip, Switch, Divider, Table, Select, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconTrash, IconPencil, IconCopy, IconCheck } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { API_BASE, createApiKey, deleteApiKey, listApiKeys, updateApiKey, listTaskLogs, type ApiKeyDto, type VendorCallLogDto, type VendorCallLogStatus } from '../api/server'

function parseOriginsInput(input: string): string[] {
  return String(input || '')
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatLastUsedAt(lastUsedAt?: string | null): string {
  if (!lastUsedAt) return '未使用'
  const t = Date.parse(lastUsedAt)
  if (!Number.isFinite(t)) return '未使用'
  return new Date(t).toLocaleString()
}

const TASK_KIND_LABELS: Record<string, string> = {
  chat: '文本',
  prompt_refine: '指令优化',
  text_to_image: '图片',
  image_to_prompt: '图像理解',
  image_to_video: '图像转视频',
  text_to_video: '视频',
  image_edit: '图像编辑',
}

function formatTaskKind(kind?: string | null): string {
  const key = typeof kind === 'string' ? kind.trim() : ''
  if (!key) return '—'
  return TASK_KIND_LABELS[key] || key
}

function statusColor(status: VendorCallLogStatus): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  return 'blue'
}

function formatDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
}

export default function ThirdPartyApiPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const mounted = active === 'thirdPartyApi'

  const [items, setItems] = React.useState<ApiKeyDto[]>([])
  const [loading, setLoading] = React.useState(false)

  const [logs, setLogs] = React.useState<VendorCallLogDto[]>([])
  const [logsLoading, setLogsLoading] = React.useState(false)
  const [logsLoadingMore, setLogsLoadingMore] = React.useState(false)
  const [logsError, setLogsError] = React.useState<string | null>(null)
  const [logsHasMore, setLogsHasMore] = React.useState(false)
  const [logsCursor, setLogsCursor] = React.useState<string | null>(null)
  const [logsVendor, setLogsVendor] = React.useState<string>('all')
  const [logsStatus, setLogsStatus] = React.useState<string>('all')

  const [createLabel, setCreateLabel] = React.useState('外部调用')
  const [createOrigins, setCreateOrigins] = React.useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.origin
  })
  const [createEnabled, setCreateEnabled] = React.useState(true)
  const [createSubmitting, setCreateSubmitting] = React.useState(false)

  const [createdKey, setCreatedKey] = React.useState<string | null>(null)
  const [createdOpen, setCreatedOpen] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editLabel, setEditLabel] = React.useState('')
  const [editEnabled, setEditEnabled] = React.useState(true)
  const [editOrigins, setEditOrigins] = React.useState('')

  const reload = React.useCallback(async () => {
    if (!mounted) return
    setLoading(true)
    try {
      const data = await listApiKeys()
      setItems(Array.isArray(data) ? data : [])
    } catch (err: any) {
      console.error('list api keys failed', err)
      setItems([])
      notifications.show({ color: 'red', title: '加载失败', message: err?.message || '无法加载 API Key 列表' })
    } finally {
      setLoading(false)
    }
  }, [mounted])

  React.useEffect(() => {
    if (!mounted) return
    reload()
  }, [mounted, reload])

  const fetchLogs = React.useCallback(
    async (before: string | null) => {
      const vendor = logsVendor !== 'all' ? logsVendor : null
      const status = (logsStatus !== 'all' ? (logsStatus as VendorCallLogStatus) : null) as VendorCallLogStatus | null
      return listTaskLogs({ limit: 40, before, vendor, status })
    },
    [logsVendor, logsStatus],
  )

  const reloadLogs = React.useCallback(async () => {
    if (!mounted) return
    setLogsLoading(true)
    setLogsError(null)
    try {
      const resp = await fetchLogs(null)
      setLogs(Array.isArray(resp?.items) ? resp.items : [])
      setLogsHasMore(Boolean(resp?.hasMore))
      setLogsCursor(typeof resp?.nextBefore === 'string' ? resp.nextBefore : null)
    } catch (err: any) {
      console.error('list task logs failed', err)
      setLogs([])
      setLogsHasMore(false)
      setLogsCursor(null)
      setLogsError(err?.message || '无法加载生成任务列表')
    } finally {
      setLogsLoading(false)
    }
  }, [mounted, fetchLogs])

  const loadMoreLogs = React.useCallback(async () => {
    if (!mounted || !logsHasMore || logsLoadingMore) return
    setLogsLoadingMore(true)
    try {
      const resp = await fetchLogs(logsCursor)
      const nextItems = Array.isArray(resp?.items) ? resp.items : []
      setLogs((prev) => [...prev, ...nextItems])
      setLogsHasMore(Boolean(resp?.hasMore))
      setLogsCursor(typeof resp?.nextBefore === 'string' ? resp.nextBefore : null)
    } catch (err: any) {
      console.error('load more task logs failed', err)
      notifications.show({ color: 'red', title: '加载失败', message: err?.message || '加载更多失败' })
    } finally {
      setLogsLoadingMore(false)
    }
  }, [mounted, logsHasMore, logsLoadingMore, logsCursor, fetchLogs])

  React.useEffect(() => {
    if (!mounted) return
    reloadLogs()
  }, [mounted, logsVendor, logsStatus, reloadLogs])

  const maxHeight = calculateSafeMaxHeight(anchorY, 160)
  if (!mounted) return null

  const publicChatUrl = `${API_BASE || ''}/public/chat`
  const fetchSnippet = `fetch('${publicChatUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({
    vendor: 'openai', // openai | gemini | anthropic | sora2api | qwen
    prompt: '你好，帮我用中文总结一下这段话：...'
  }),
}).then(r => r.json())`

  const handleCreate = async () => {
    if (createSubmitting) return
    const label = createLabel.trim() || '外部调用'
    const allowedOrigins = parseOriginsInput(createOrigins)
    if (!allowedOrigins.length) {
      notifications.show({ color: 'yellow', title: '需要白名单', message: '请至少填写一个 Origin（如 https://example.com），或使用 *' })
      return
    }
    setCreateSubmitting(true)
    try {
      const result = await createApiKey({ label, allowedOrigins, enabled: createEnabled })
      setItems((prev) => [result.apiKey, ...prev])
      setCreatedKey(result.key)
      setCreatedOpen(true)
      notifications.show({ color: 'green', title: '创建成功', message: 'Key 已生成（仅展示一次，请及时保存）' })
    } catch (err: any) {
      console.error('create api key failed', err)
      notifications.show({ color: 'red', title: '创建失败', message: err?.message || '创建 API Key 失败' })
    } finally {
      setCreateSubmitting(false)
    }
  }

  const openEdit = (item: ApiKeyDto) => {
    setEditId(item.id)
    setEditLabel(item.label || '')
    setEditEnabled(Boolean(item.enabled))
    setEditOrigins((item.allowedOrigins || []).join('\n'))
    setEditOpen(true)
  }

  const handleEditSave = async () => {
    if (!editId || editSubmitting) return
    const label = editLabel.trim() || '外部调用'
    const allowedOrigins = parseOriginsInput(editOrigins)
    if (!allowedOrigins.length) {
      notifications.show({ color: 'yellow', title: '需要白名单', message: '请至少填写一个 Origin（如 https://example.com），或使用 *' })
      return
    }
    setEditSubmitting(true)
    try {
      const updated = await updateApiKey(editId, { label, allowedOrigins, enabled: editEnabled })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      notifications.show({ color: 'green', title: '已保存', message: '白名单与状态已更新' })
      setEditOpen(false)
    } catch (err: any) {
      console.error('update api key failed', err)
      notifications.show({ color: 'red', title: '保存失败', message: err?.message || '更新 API Key 失败' })
    } finally {
      setEditSubmitting(false)
    }
  }

  const handleDelete = async (item: ApiKeyDto) => {
    if (!window.confirm(`确定删除 API Key「${item.label || item.keyPrefix}」？删除后外站将无法继续调用。`)) return
    try {
      await deleteApiKey(item.id)
      setItems((prev) => prev.filter((x) => x.id !== item.id))
      notifications.show({ color: 'green', title: '已删除', message: 'API Key 已撤销' })
    } catch (err: any) {
      console.error('delete api key failed', err)
      notifications.show({ color: 'red', title: '删除失败', message: err?.message || '删除 API Key 失败' })
    }
  }

  return (
    <div className="third-party-api-panel-anchor" style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 160 : 140, zIndex: 200 }} data-ux-panel>
      <Transition className="third-party-api-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="third-party-api-panel-transition-inner" style={styles}>
            <Paper
              className="third-party-api-panel-card glass"
              withBorder
              shadow="md"
              radius="lg"
              p="md"
              style={{
                width: 460,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="third-party-api-panel-arrow panel-arrow" />
              <Group className="third-party-api-panel-header" justify="space-between" mb={8}>
                <div className="third-party-api-panel-header-left">
                  <Title className="third-party-api-panel-title" order={6}>三方 API</Title>
                  <Text className="third-party-api-panel-subtitle" size="xs" c="dimmed">
                    生成可分享的 Key，并按 Origin 白名单限制调用（默认中文回答）。
                  </Text>
                </div>
                <Group className="third-party-api-panel-header-actions" gap="xs">
                  <Button className="third-party-api-panel-refresh" size="xs" variant="light" loading={loading} onClick={() => reload()}>
                    刷新
                  </Button>
                  <Button className="third-party-api-panel-close" size="xs" variant="light" onClick={() => setActivePanel(null)}>
                    关闭
                  </Button>
                </Group>
              </Group>

              <div className="third-party-api-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Stack className="third-party-api-panel-stack" gap="sm">
                  <div className="third-party-api-panel-endpoint">
                    <Text className="third-party-api-panel-endpoint-label" size="xs" c="dimmed">外站调用地址</Text>
                    <Group className="third-party-api-panel-endpoint-row" gap="xs" justify="space-between" align="center">
                      <Text className="third-party-api-panel-endpoint-url" size="xs" style={{ wordBreak: 'break-all' }}>
                        {publicChatUrl}
                      </Text>
                      <CopyButton value={publicChatUrl} timeout={1200}>
                        {({ copied, copy }) => (
                          <Tooltip className="third-party-api-panel-endpoint-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                            <ActionIcon className="third-party-api-panel-endpoint-copy" variant="subtle" onClick={copy} aria-label="copy-endpoint">
                              {copied ? <IconCheck className="third-party-api-panel-endpoint-copy-icon" size={16} /> : <IconCopy className="third-party-api-panel-endpoint-copy-icon" size={16} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Group>
                    <pre className="third-party-api-panel-endpoint-snippet" style={{ margin: 0, marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.18)', overflowX: 'auto' }}>
                      <code className="third-party-api-panel-endpoint-snippet-code">{fetchSnippet}</code>
                    </pre>
                  </div>

                  <Divider className="third-party-api-panel-divider" label="创建新 Key" labelPosition="left" />
                  <Stack className="third-party-api-panel-create" gap="xs">
                    <TextInput
                      className="third-party-api-panel-create-label"
                      label="名称"
                      value={createLabel}
                      onChange={(e) => setCreateLabel(e.currentTarget.value)}
                      placeholder="例如：我的网站"
                    />
                    <Textarea
                      className="third-party-api-panel-create-origins"
                      label="Origin 白名单（每行一个；可用 * 放开所有）"
                      value={createOrigins}
                      onChange={(e) => setCreateOrigins(e.currentTarget.value)}
                      minRows={2}
                      autosize
                      placeholder={`https://example.com\nhttp://localhost:3000`}
                    />
                    <Group className="third-party-api-panel-create-actions" justify="space-between" align="center">
                      <Switch
                        className="third-party-api-panel-create-enabled"
                        checked={createEnabled}
                        onChange={(e) => setCreateEnabled(e.currentTarget.checked)}
                        label="启用"
                      />
                      <Button
                        className="third-party-api-panel-create-submit"
                        size="xs"
                        leftSection={<IconPlus className="third-party-api-panel-create-submit-icon" size={14} />}
                        loading={createSubmitting}
                        onClick={handleCreate}
                      >
                        生成 Key
                      </Button>
                    </Group>
                    <Text className="third-party-api-panel-create-hint" size="xs" c="dimmed">
                      Key 只会在创建成功后展示一次；请复制到你的站点环境变量中。
                    </Text>
                  </Stack>

                  <Divider className="third-party-api-panel-divider" label="已生成的 Key" labelPosition="left" />
                  <Stack className="third-party-api-panel-list" gap="xs">
                    {(!items || items.length === 0) && (
                      <Text className="third-party-api-panel-empty" size="sm" c="dimmed">
                        暂无 Key
                      </Text>
                    )}
                    {items.map((item) => (
                      <Paper className="third-party-api-panel-item" key={item.id} p="sm" radius="md" withBorder style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <Group className="third-party-api-panel-item-row" justify="space-between" align="flex-start" gap="xs">
                          <div className="third-party-api-panel-item-main" style={{ flex: 1, minWidth: 0 }}>
                            <Group className="third-party-api-panel-item-title-row" gap="xs" align="center">
                              <Text className="third-party-api-panel-item-title" size="sm" fw={600} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {item.label || '未命名'}
                              </Text>
                              <Badge className="third-party-api-panel-item-status" color={item.enabled ? 'green' : 'gray'} size="xs" variant="light">
                                {item.enabled ? '启用' : '禁用'}
                              </Badge>
                            </Group>
                            <Text className="third-party-api-panel-item-meta" size="xs" c="dimmed">
                              前缀：{item.keyPrefix} · 白名单：{(item.allowedOrigins || []).length} · 最近：{formatLastUsedAt(item.lastUsedAt)}
                            </Text>
                            {!!item.allowedOrigins?.length && (
                              <Text className="third-party-api-panel-item-origins" size="xs" c="dimmed" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                                {(item.allowedOrigins || []).join(', ')}
                              </Text>
                            )}
                          </div>
                          <Group className="third-party-api-panel-item-actions" gap={4}>
                            <ActionIcon
                              className="third-party-api-panel-item-edit"
                              variant="subtle"
                              aria-label="edit"
                              onClick={() => openEdit(item)}
                            >
                              <IconPencil className="third-party-api-panel-item-edit-icon" size={16} />
                            </ActionIcon>
                            <ActionIcon
                              className="third-party-api-panel-item-delete"
                              variant="subtle"
                              color="red"
                              aria-label="delete"
                              onClick={() => handleDelete(item)}
                            >
                              <IconTrash className="third-party-api-panel-item-delete-icon" size={16} />
                            </ActionIcon>
                          </Group>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>

                  <Divider className="third-party-api-panel-divider" label="生成任务列表" labelPosition="left" />
                  <Stack className="third-party-api-panel-logs" gap="xs">
                    <Group className="third-party-api-panel-logs-toolbar" justify="space-between" align="center">
                      <Group className="third-party-api-panel-logs-filters" gap="xs" align="center" wrap="nowrap">
                        <Select
                          className="third-party-api-panel-logs-filter-vendor"
                          size="xs"
                          value={logsVendor}
                          onChange={(v) => setLogsVendor(v || 'all')}
                          data={[
                            { value: 'all', label: '全部厂商' },
                            { value: 'openai', label: 'OpenAI' },
                            { value: 'gemini', label: 'Gemini' },
                            { value: 'anthropic', label: 'Anthropic' },
                            { value: 'qwen', label: 'Qwen' },
                            { value: 'sora2api', label: 'Sora2API' },
                            { value: 'veo', label: 'Veo' },
                            { value: 'minimax', label: 'MiniMax' },
                          ]}
                          placeholder="厂商"
                          w={132}
                          withinPortal
                        />
                        <Select
                          className="third-party-api-panel-logs-filter-status"
                          size="xs"
                          value={logsStatus}
                          onChange={(v) => setLogsStatus(v || 'all')}
                          data={[
                            { value: 'all', label: '全部状态' },
                            { value: 'running', label: '运行中' },
                            { value: 'succeeded', label: '成功' },
                            { value: 'failed', label: '失败' },
                          ]}
                          placeholder="状态"
                          w={112}
                          withinPortal
                        />
                      </Group>
                      <Button className="third-party-api-panel-logs-refresh" size="xs" variant="light" onClick={() => reloadLogs()} disabled={logsLoading}>
                        {logsLoading ? <Loader className="third-party-api-panel-logs-refresh-loader" size="xs" /> : '刷新'}
                      </Button>
                    </Group>

                    {!!logsError && (
                      <Text className="third-party-api-panel-logs-error" size="xs" c="red">
                        {logsError}
                      </Text>
                    )}

                    {!logsLoading && (!logs || logs.length === 0) && (
                      <Text className="third-party-api-panel-logs-empty" size="sm" c="dimmed">
                        暂无生成记录
                      </Text>
                    )}

                    {!!logs?.length && (
                      <div className="third-party-api-panel-logs-table-wrap" style={{ overflowX: 'auto' }}>
                        <Table className="third-party-api-panel-logs-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
                          <Table.Thead className="third-party-api-panel-logs-table-head">
                            <Table.Tr className="third-party-api-panel-logs-table-head-row">
                              <Table.Th className="third-party-api-panel-logs-table-head-cell" style={{ width: 170 }}>时间</Table.Th>
                              <Table.Th className="third-party-api-panel-logs-table-head-cell" style={{ width: 90 }}>厂商</Table.Th>
                              <Table.Th className="third-party-api-panel-logs-table-head-cell" style={{ width: 90 }}>类型</Table.Th>
                              <Table.Th className="third-party-api-panel-logs-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                              <Table.Th className="third-party-api-panel-logs-table-head-cell" style={{ width: 80 }}>耗时</Table.Th>
                              <Table.Th className="third-party-api-panel-logs-table-head-cell" style={{ width: 220 }}>任务</Table.Th>
                              <Table.Th className="third-party-api-panel-logs-table-head-cell">错误</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody className="third-party-api-panel-logs-table-body">
                            {logs.map((it) => (
                              <Table.Tr className="third-party-api-panel-logs-table-row" key={`${it.vendor}:${it.taskId}`}>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Text className="third-party-api-panel-logs-created-at" size="xs" c="dimmed">
                                    {new Date(it.createdAt).toLocaleString()}
                                  </Text>
                                </Table.Td>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Text className="third-party-api-panel-logs-vendor" size="xs">
                                    {it.vendor}
                                  </Text>
                                </Table.Td>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Text className="third-party-api-panel-logs-kind" size="xs">
                                    {formatTaskKind(it.taskKind)}
                                  </Text>
                                </Table.Td>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Badge className="third-party-api-panel-logs-status-badge" size="xs" variant="light" color={statusColor(it.status as VendorCallLogStatus) as any}>
                                    {it.status}
                                  </Badge>
                                </Table.Td>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Text className="third-party-api-panel-logs-duration" size="xs" c="dimmed">
                                    {formatDuration(it.durationMs)}
                                  </Text>
                                </Table.Td>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Group className="third-party-api-panel-logs-task" gap={6} justify="space-between" wrap="nowrap">
                                    <Text
                                      className="third-party-api-panel-logs-task-id"
                                      size="xs"
                                      title={it.taskId}
                                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}
                                    >
                                      {it.taskId}
                                    </Text>
                                    <CopyButton value={it.taskId} timeout={1200}>
                                      {({ copied, copy }) => (
                                        <Tooltip className="third-party-api-panel-logs-task-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                                          <ActionIcon className="third-party-api-panel-logs-task-copy" variant="subtle" onClick={copy} aria-label="copy-task-id">
                                            {copied ? <IconCheck className="third-party-api-panel-logs-task-copy-icon" size={14} /> : <IconCopy className="third-party-api-panel-logs-task-copy-icon" size={14} />}
                                          </ActionIcon>
                                        </Tooltip>
                                      )}
                                    </CopyButton>
                                  </Group>
                                </Table.Td>
                                <Table.Td className="third-party-api-panel-logs-table-cell">
                                  <Text className="third-party-api-panel-logs-error-message" size="xs" c={it.status === 'failed' ? 'red' : 'dimmed'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                                    {it.errorMessage || '—'}
                                  </Text>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </div>
                    )}

                    {logsHasMore && (
                      <Button
                        className="third-party-api-panel-logs-more"
                        size="xs"
                        variant="light"
                        onClick={() => void loadMoreLogs()}
                        disabled={logsLoadingMore}
                      >
                        {logsLoadingMore ? <Loader className="third-party-api-panel-logs-more-loader" size="xs" /> : '加载更多'}
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </div>
            </Paper>
          </div>
        )}
      </Transition>

      <Modal
        className="third-party-api-panel-created-modal"
        opened={createdOpen}
        onClose={() => setCreatedOpen(false)}
        title="你的 Key（仅展示一次）"
        centered
      >
        <Stack className="third-party-api-panel-created-modal-body" gap="xs">
          <Text className="third-party-api-panel-created-modal-hint" size="sm">
            请复制保存；之后将无法再次查看明文。
          </Text>
          <Paper className="third-party-api-panel-created-modal-key" withBorder radius="md" p="sm" style={{ background: 'rgba(0,0,0,0.18)' }}>
            <Group className="third-party-api-panel-created-modal-key-row" justify="space-between" gap="xs" align="center">
              <Text className="third-party-api-panel-created-modal-key-text" size="sm" style={{ wordBreak: 'break-all' }}>
                {createdKey || ''}
              </Text>
              <CopyButton value={createdKey || ''} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="third-party-api-panel-created-modal-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                    <ActionIcon className="third-party-api-panel-created-modal-copy" variant="light" onClick={copy} aria-label="copy-key">
                      {copied ? <IconCheck className="third-party-api-panel-created-modal-copy-icon" size={16} /> : <IconCopy className="third-party-api-panel-created-modal-copy-icon" size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Paper>
          <Text className="third-party-api-panel-created-modal-note" size="xs" c="dimmed">
            默认会按 Origin 白名单校验；若你需要后端/脚本调用，可在白名单中填入 *。
          </Text>
        </Stack>
      </Modal>

      <Modal
        className="third-party-api-panel-edit-modal"
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑 Key"
        centered
      >
        <Stack className="third-party-api-panel-edit-modal-body" gap="xs">
          <TextInput
            className="third-party-api-panel-edit-label"
            label="名称"
            value={editLabel}
            onChange={(e) => setEditLabel(e.currentTarget.value)}
            placeholder="例如：我的网站"
          />
          <Textarea
            className="third-party-api-panel-edit-origins"
            label="Origin 白名单（每行一个；可用 * 放开所有）"
            value={editOrigins}
            onChange={(e) => setEditOrigins(e.currentTarget.value)}
            minRows={3}
            autosize
            placeholder={`https://example.com\nhttp://localhost:3000`}
          />
          <Group className="third-party-api-panel-edit-actions" justify="space-between" align="center">
            <Switch
              className="third-party-api-panel-edit-enabled"
              checked={editEnabled}
              onChange={(e) => setEditEnabled(e.currentTarget.checked)}
              label="启用"
            />
            <Button
              className="third-party-api-panel-edit-save"
              size="xs"
              loading={editSubmitting}
              onClick={handleEditSave}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
