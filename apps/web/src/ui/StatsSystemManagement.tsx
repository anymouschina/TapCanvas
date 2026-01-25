import React from 'react'
import { ActionIcon, Badge, Button, CopyButton, Divider, Group, Loader, Modal, Paper, Select, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip, Title } from '@mantine/core'
import { IconCheck, IconCopy, IconPencil, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { API_BASE, createApiKey, deleteApiKey, listApiKeys, listTaskLogs, updateApiKey, type ApiKeyDto, type VendorCallLogDto, type VendorCallLogStatus } from '../api/server'
import { toast } from './toast'

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

export default function StatsSystemManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-system', className].filter(Boolean).join(' ')

  const [keys, setKeys] = React.useState<ApiKeyDto[]>([])
  const [keysLoading, setKeysLoading] = React.useState(false)

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

  const reloadKeys = React.useCallback(async () => {
    setKeysLoading(true)
    try {
      const data = await listApiKeys()
      setKeys(Array.isArray(data) ? data : [])
    } catch (err: any) {
      console.error('list api keys failed', err)
      setKeys([])
      toast(err?.message || '加载 API Key 列表失败', 'error')
    } finally {
      setKeysLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadKeys()
  }, [reloadKeys])

  const publicChatUrl = `${API_BASE || ''}/public/chat`
  const fetchSnippet = `fetch('${publicChatUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({
    vendor: 'openai',
    prompt: '你好，帮我用中文回答…'
  }),
}).then(r => r.json())`

  const handleCreate = async () => {
    if (createSubmitting) return
    const label = createLabel.trim() || '外部调用'
    const allowedOrigins = parseOriginsInput(createOrigins)
    if (!allowedOrigins.length) {
      toast('请至少填写一个 Origin（如 https://example.com），或使用 *', 'error')
      return
    }
    setCreateSubmitting(true)
    try {
      const result = await createApiKey({ label, allowedOrigins, enabled: createEnabled })
      setKeys((prev) => [result.apiKey, ...prev])
      setCreatedKey(result.key)
      setCreatedOpen(true)
      toast('Key 已生成（仅展示一次，请及时保存）', 'success')
    } catch (err: any) {
      console.error('create api key failed', err)
      toast(err?.message || '创建 API Key 失败', 'error')
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
      toast('请至少填写一个 Origin（如 https://example.com），或使用 *', 'error')
      return
    }
    setEditSubmitting(true)
    try {
      const updated = await updateApiKey(editId, { label, allowedOrigins, enabled: editEnabled })
      setKeys((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setEditOpen(false)
      toast('已保存', 'success')
    } catch (err: any) {
      console.error('update api key failed', err)
      toast(err?.message || '更新 API Key 失败', 'error')
    } finally {
      setEditSubmitting(false)
    }
  }

  const handleDelete = async (item: ApiKeyDto) => {
    if (!window.confirm(`确定删除 API Key「${item.label || item.keyPrefix}」？删除后外站将无法继续调用。`)) return
    try {
      await deleteApiKey(item.id)
      setKeys((prev) => prev.filter((x) => x.id !== item.id))
      toast('已删除', 'success')
    } catch (err: any) {
      console.error('delete api key failed', err)
      toast(err?.message || '删除 API Key 失败', 'error')
    }
  }

  const [logs, setLogs] = React.useState<VendorCallLogDto[]>([])
  const [logsLoading, setLogsLoading] = React.useState(false)
  const [logsLoadingMore, setLogsLoadingMore] = React.useState(false)
  const [logsHasMore, setLogsHasMore] = React.useState(false)
  const [logsCursor, setLogsCursor] = React.useState<string | null>(null)
  const [logsVendor, setLogsVendor] = React.useState<string>('all')
  const [logsStatus, setLogsStatus] = React.useState<string>('all')

  const fetchLogs = React.useCallback(
    async (before: string | null) => {
      const vendor = logsVendor !== 'all' ? logsVendor : null
      const status = (logsStatus !== 'all' ? (logsStatus as VendorCallLogStatus) : null) as VendorCallLogStatus | null
      return listTaskLogs({ limit: 60, before, vendor, status })
    },
    [logsVendor, logsStatus],
  )

  const reloadLogs = React.useCallback(async () => {
    setLogsLoading(true)
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
      toast(err?.message || '加载生成任务列表失败', 'error')
    } finally {
      setLogsLoading(false)
    }
  }, [fetchLogs])

  const loadMoreLogs = React.useCallback(async () => {
    if (!logsHasMore || logsLoadingMore) return
    setLogsLoadingMore(true)
    try {
      const resp = await fetchLogs(logsCursor)
      const nextItems = Array.isArray(resp?.items) ? resp.items : []
      setLogs((prev) => [...prev, ...nextItems])
      setLogsHasMore(Boolean(resp?.hasMore))
      setLogsCursor(typeof resp?.nextBefore === 'string' ? resp.nextBefore : null)
    } catch (err: any) {
      console.error('load more task logs failed', err)
      toast(err?.message || '加载更多失败', 'error')
    } finally {
      setLogsLoadingMore(false)
    }
  }, [logsHasMore, logsLoadingMore, logsCursor, fetchLogs])

  React.useEffect(() => {
    void reloadLogs()
  }, [reloadLogs, logsVendor, logsStatus])

  return (
    <Stack className={rootClassName} gap="md">
      <Paper className="stats-system-card glass" withBorder radius="lg" p="md">
        <Group className="stats-system-card-header" justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <div className="stats-system-card-header-left">
            <Title className="stats-system-title" order={3}>系统管理</Title>
            <Text className="stats-system-subtitle" size="sm" c="dimmed">
              三方 API Key 管理、Origin 白名单、生成任务列表（后台管理风格）。
            </Text>
          </div>
          <Group className="stats-system-card-header-actions" gap={6}>
            <Tooltip className="stats-system-reload-keys-tooltip" label="刷新 Key" withArrow>
              <ActionIcon
                className="stats-system-reload-keys"
                size="sm"
                variant="subtle"
                aria-label="刷新 Key"
                onClick={() => void reloadKeys()}
                loading={keysLoading}
              >
                <IconRefresh className="stats-system-reload-keys-icon" size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="stats-system-reload-logs-tooltip" label="刷新任务" withArrow>
              <ActionIcon
                className="stats-system-reload-logs"
                size="sm"
                variant="subtle"
                aria-label="刷新任务"
                onClick={() => void reloadLogs()}
                loading={logsLoading}
              >
                <IconRefresh className="stats-system-reload-logs-icon" size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Divider className="stats-system-divider" my="md" label="外站调用地址" labelPosition="left" />
        <Group className="stats-system-endpoint" justify="space-between" align="center" gap="xs" wrap="nowrap">
          <Text className="stats-system-endpoint-url" size="sm" style={{ wordBreak: 'break-all' }}>
            {publicChatUrl}
          </Text>
          <CopyButton value={publicChatUrl} timeout={1200}>
            {({ copied, copy }) => (
              <Tooltip className="stats-system-endpoint-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                <ActionIcon className="stats-system-endpoint-copy" variant="light" onClick={copy} aria-label="copy-endpoint">
                  {copied ? <IconCheck className="stats-system-endpoint-copy-icon" size={16} /> : <IconCopy className="stats-system-endpoint-copy-icon" size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
        <pre className="stats-system-endpoint-snippet" style={{ margin: 0, marginTop: 10, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.18)', overflowX: 'auto' }}>
          <code className="stats-system-endpoint-snippet-code">{fetchSnippet}</code>
        </pre>

        <Divider className="stats-system-divider" my="md" label="创建新 Key" labelPosition="left" />
        <Stack className="stats-system-create" gap="xs">
          <Group className="stats-system-create-row" gap="sm" align="flex-start" wrap="wrap">
            <TextInput
              className="stats-system-create-label"
              label="名称"
              value={createLabel}
              onChange={(e) => setCreateLabel(e.currentTarget.value)}
              placeholder="例如：我的网站"
              w={260}
            />
            <Switch
              className="stats-system-create-enabled"
              checked={createEnabled}
              onChange={(e) => setCreateEnabled(e.currentTarget.checked)}
              label="启用"
              mt={26}
            />
            <Button
              className="stats-system-create-submit"
              size="sm"
              leftSection={<IconPlus className="stats-system-create-submit-icon" size={14} />}
              loading={createSubmitting}
              onClick={() => void handleCreate()}
              mt={22}
            >
              生成 Key
            </Button>
          </Group>
          <Textarea
            className="stats-system-create-origins"
            label="Origin 白名单（每行一个；可用 * 放开所有）"
            value={createOrigins}
            onChange={(e) => setCreateOrigins(e.currentTarget.value)}
            minRows={2}
            autosize
            placeholder={`https://example.com\nhttp://localhost:3000`}
          />
          <Text className="stats-system-create-hint" size="xs" c="dimmed">
            Key 只会在创建成功后展示一次；请复制保存到你的站点环境变量中。
          </Text>
        </Stack>

        <Divider className="stats-system-divider" my="md" label="API Key 列表" labelPosition="left" />
        <div className="stats-system-keys-table-wrap" style={{ overflowX: 'auto' }}>
          <Table className="stats-system-keys-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
            <Table.Thead className="stats-system-keys-table-head">
              <Table.Tr className="stats-system-keys-table-head-row">
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 160 }}>名称</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 130 }}>前缀</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell">Origin 白名单</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 170 }}>最近使用</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 100 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-system-keys-table-body">
              {!keysLoading && keys.length === 0 && (
                <Table.Tr className="stats-system-keys-table-row-empty">
                  <Table.Td className="stats-system-keys-table-cell-empty" colSpan={6}>
                    <Text className="stats-system-keys-empty" size="sm" c="dimmed">
                      暂无 Key
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {keys.map((k) => (
                <Table.Tr className="stats-system-keys-table-row" key={k.id}>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-label" size="sm" fw={600}>
                      {k.label || '未命名'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-prefix" size="sm" c="dimmed">
                      {k.keyPrefix}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-origins" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                      {(k.allowedOrigins || []).join(', ') || '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Badge className="stats-system-keys-status" size="xs" variant="light" color={k.enabled ? 'green' : 'gray'}>
                      {k.enabled ? '启用' : '禁用'}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-last-used" size="sm" c="dimmed">
                      {formatLastUsedAt(k.lastUsedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Group className="stats-system-keys-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Tooltip className="stats-system-keys-edit-tooltip" label="编辑" withArrow>
                        <ActionIcon className="stats-system-keys-edit" size="sm" variant="light" aria-label="edit" onClick={() => openEdit(k)}>
                          <IconPencil className="stats-system-keys-edit-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip className="stats-system-keys-delete-tooltip" label="删除" withArrow>
                        <ActionIcon className="stats-system-keys-delete" size="sm" variant="light" color="red" aria-label="delete" onClick={() => void handleDelete(k)}>
                          <IconTrash className="stats-system-keys-delete-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>

        <Divider className="stats-system-divider" my="md" label="生成任务列表" labelPosition="left" />
        <Group className="stats-system-logs-toolbar" justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group className="stats-system-logs-filters" gap="xs" align="center" wrap="wrap">
            <Select
              className="stats-system-logs-filter-vendor"
              size="sm"
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
              w={160}
              withinPortal
            />
            <Select
              className="stats-system-logs-filter-status"
              size="sm"
              value={logsStatus}
              onChange={(v) => setLogsStatus(v || 'all')}
              data={[
                { value: 'all', label: '全部状态' },
                { value: 'running', label: '运行中' },
                { value: 'succeeded', label: '成功' },
                { value: 'failed', label: '失败' },
              ]}
              placeholder="状态"
              w={140}
              withinPortal
            />
          </Group>
          <Button
            className="stats-system-logs-refresh"
            size="sm"
            variant="light"
            onClick={() => void reloadLogs()}
            disabled={logsLoading}
            leftSection={logsLoading ? <Loader className="stats-system-logs-refresh-loader" size="xs" /> : undefined}
          >
            刷新
          </Button>
        </Group>

        <div className="stats-system-logs-table-wrap" style={{ overflowX: 'auto' }}>
          <Table className="stats-system-logs-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
            <Table.Thead className="stats-system-logs-table-head">
              <Table.Tr className="stats-system-logs-table-head-row">
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 170 }}>时间</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 90 }}>厂商</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 90 }}>类型</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 80 }}>耗时</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 240 }}>任务</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell">错误</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-system-logs-table-body">
              {!logsLoading && logs.length === 0 && (
                <Table.Tr className="stats-system-logs-table-row-empty">
                  <Table.Td className="stats-system-logs-table-cell-empty" colSpan={7}>
                    <Text className="stats-system-logs-empty" size="sm" c="dimmed">
                      暂无生成记录
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {logs.map((it) => (
                <Table.Tr className="stats-system-logs-table-row" key={`${it.vendor}:${it.taskId}`}>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-created-at" size="sm" c="dimmed">
                      {new Date(it.createdAt).toLocaleString()}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-vendor" size="sm">
                      {it.vendor}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-kind" size="sm">
                      {formatTaskKind(it.taskKind)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Badge className="stats-system-logs-status" size="xs" variant="light" color={statusColor(it.status as VendorCallLogStatus) as any}>
                      {it.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-duration" size="sm" c="dimmed">
                      {formatDuration(it.durationMs)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Group className="stats-system-logs-task" gap={6} justify="space-between" wrap="nowrap">
                      <Text
                        className="stats-system-logs-task-id"
                        size="sm"
                        title={it.taskId}
                        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}
                      >
                        {it.taskId}
                      </Text>
                      <CopyButton value={it.taskId} timeout={1200}>
                        {({ copied, copy }) => (
                          <Tooltip className="stats-system-logs-task-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                            <ActionIcon className="stats-system-logs-task-copy" variant="subtle" onClick={copy} aria-label="copy-task-id">
                              {copied ? <IconCheck className="stats-system-logs-task-copy-icon" size={14} /> : <IconCopy className="stats-system-logs-task-copy-icon" size={14} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Group>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-error" size="sm" c={it.status === 'failed' ? 'red' : 'dimmed'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
                      {it.errorMessage || '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>

        {logsHasMore && (
          <Button
            className="stats-system-logs-more"
            size="sm"
            variant="light"
            onClick={() => void loadMoreLogs()}
            disabled={logsLoadingMore}
            leftSection={logsLoadingMore ? <Loader className="stats-system-logs-more-loader" size="xs" /> : undefined}
            mt="sm"
          >
            加载更多
          </Button>
        )}
      </Paper>

      <Modal
        className="stats-system-created-modal"
        opened={createdOpen}
        onClose={() => setCreatedOpen(false)}
        title="你的 Key（仅展示一次）"
        centered
      >
        <Stack className="stats-system-created-modal-body" gap="xs">
          <Text className="stats-system-created-modal-hint" size="sm">
            请复制保存；之后将无法再次查看明文。
          </Text>
          <Paper className="stats-system-created-modal-key" withBorder radius="md" p="sm" style={{ background: 'rgba(0,0,0,0.18)' }}>
            <Group className="stats-system-created-modal-key-row" justify="space-between" gap="xs" align="center">
              <Text className="stats-system-created-modal-key-text" size="sm" style={{ wordBreak: 'break-all' }}>
                {createdKey || ''}
              </Text>
              <CopyButton value={createdKey || ''} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="stats-system-created-modal-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                    <ActionIcon className="stats-system-created-modal-copy" variant="light" onClick={copy} aria-label="copy-key">
                      {copied ? <IconCheck className="stats-system-created-modal-copy-icon" size={16} /> : <IconCopy className="stats-system-created-modal-copy-icon" size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Paper>
          <Text className="stats-system-created-modal-note" size="xs" c="dimmed">
            默认会按 Origin 白名单校验；若你需要后端/脚本调用，可在白名单中填入 *。
          </Text>
        </Stack>
      </Modal>

      <Modal
        className="stats-system-edit-modal"
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑 Key"
        centered
      >
        <Stack className="stats-system-edit-modal-body" gap="xs">
          <TextInput
            className="stats-system-edit-label"
            label="名称"
            value={editLabel}
            onChange={(e) => setEditLabel(e.currentTarget.value)}
            placeholder="例如：我的网站"
          />
          <Textarea
            className="stats-system-edit-origins"
            label="Origin 白名单（每行一个；可用 * 放开所有）"
            value={editOrigins}
            onChange={(e) => setEditOrigins(e.currentTarget.value)}
            minRows={3}
            autosize
            placeholder={`https://example.com\nhttp://localhost:3000`}
          />
          <Group className="stats-system-edit-actions" justify="space-between" align="center">
            <Switch
              className="stats-system-edit-enabled"
              checked={editEnabled}
              onChange={(e) => setEditEnabled(e.currentTarget.checked)}
              label="启用"
            />
            <Button
              className="stats-system-edit-save"
              size="sm"
              loading={editSubmitting}
              onClick={() => void handleEditSave()}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

