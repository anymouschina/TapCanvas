import React from 'react'
import {
  Badge,
  Button,
  Group,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { IconRefresh, IconSearch, IconX } from '@tabler/icons-react'
import {
  listTaskLogs,
  type VendorCallLogDto,
  type VendorCallLogStatus,
} from '../../../api/server'
import { toast } from '../../toast'
import { StatePanel } from '../../StatePanel'

type TaskLogFilters = {
  status: VendorCallLogStatus | ''
  taskKind: string
  vendor: string
  userId: string
  taskId: string
  createdFrom: string
  createdTo: string
}

const EMPTY_FILTERS: TaskLogFilters = {
  status: '',
  taskKind: '',
  vendor: '',
  userId: '',
  taskId: '',
  createdFrom: '',
  createdTo: '',
}

const STATUS_OPTIONS = [
  { value: 'running', label: '运行中' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
] as const

const TASK_KIND_OPTIONS = [
  { value: 'chat', label: '文本' },
  { value: 'prompt_refine', label: '指令优化' },
  { value: 'text_to_image', label: '文生图' },
  { value: 'image_edit', label: '图像编辑' },
  { value: 'image_to_prompt', label: '图像理解' },
  { value: 'text_to_video', label: '文生视频' },
  { value: 'image_to_video', label: '图生视频' },
] as const

function toIsoDateTime(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function formatDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
}

function formatCaller(item: VendorCallLogDto): string {
  const login = item.userLogin?.trim() || ''
  const name = item.userName?.trim() || ''
  if (name && login) return `${name} (@${login})`
  return name || (login ? `@${login}` : item.userId)
}

function statusColor(status: VendorCallLogStatus): string {
  if (status === 'succeeded') return 'teal'
  if (status === 'failed') return 'red'
  return 'orange'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '生成任务日志加载失败'
}

export default function StatsTaskLogs({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-task-logs', className].filter(Boolean).join(' ')
  const [draftFilters, setDraftFilters] = React.useState<TaskLogFilters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = React.useState<TaskLogFilters>(EMPTY_FILTERS)
  const [items, setItems] = React.useState<VendorCallLogDto[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [selectedItem, setSelectedItem] = React.useState<VendorCallLogDto | null>(null)

  const load = React.useCallback(async () => {
    const createdFrom = toIsoDateTime(appliedFilters.createdFrom)
    const createdTo = toIsoDateTime(appliedFilters.createdTo)
    if (appliedFilters.createdFrom && !createdFrom) {
      setErrorMessage('开始时间格式无效')
      return
    }
    if (appliedFilters.createdTo && !createdTo) {
      setErrorMessage('结束时间格式无效')
      return
    }
    if (createdFrom && createdTo && Date.parse(createdFrom) > Date.parse(createdTo)) {
      setErrorMessage('开始时间不能晚于结束时间')
      return
    }

    setLoading(true)
    setErrorMessage(null)
    try {
      const result = await listTaskLogs({
        page,
        pageSize,
        ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
        ...(appliedFilters.taskKind.trim() ? { taskKind: appliedFilters.taskKind.trim() } : {}),
        ...(appliedFilters.vendor.trim() ? { vendor: appliedFilters.vendor.trim() } : {}),
        ...(appliedFilters.userId.trim() ? { userId: appliedFilters.userId.trim() } : {}),
        ...(appliedFilters.taskId.trim() ? { taskId: appliedFilters.taskId.trim() } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
      })
      setItems(result.items)
      setTotal(result.total)
      setTotalPages(result.totalPages)
      if (result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      setItems([])
      setTotal(0)
      setTotalPages(0)
      setErrorMessage(message)
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [appliedFilters, page, pageSize])

  React.useEffect(() => {
    void load()
  }, [load])

  const applyFilters = React.useCallback(() => {
    setPage(1)
    setAppliedFilters({ ...draftFilters })
  }, [draftFilters])

  const resetFilters = React.useCallback(() => {
    setDraftFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setPage(1)
  }, [])

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-task-logs__filters" align="flex-end" gap="sm" wrap="wrap">
        <Select
          className="stats-task-logs__status"
          label="状态"
          data={[...STATUS_OPTIONS]}
          placeholder="全部状态"
          clearable
          value={draftFilters.status || null}
          onChange={(value) => setDraftFilters((current) => ({ ...current, status: (value || '') as TaskLogFilters['status'] }))}
          w={130}
        />
        <Select
          className="stats-task-logs__task-kind"
          label="任务类型"
          data={[...TASK_KIND_OPTIONS]}
          placeholder="全部类型"
          clearable
          value={draftFilters.taskKind || null}
          onChange={(value) => setDraftFilters((current) => ({ ...current, taskKind: value || '' }))}
          searchable
          w={150}
        />
        <TextInput
          className="stats-task-logs__vendor"
          label="Vendor"
          placeholder="精确匹配"
          value={draftFilters.vendor}
          onChange={(event) => setDraftFilters((current) => ({ ...current, vendor: event.currentTarget.value }))}
          w={150}
        />
        <TextInput
          className="stats-task-logs__user-id"
          label="用户 ID"
          value={draftFilters.userId}
          onChange={(event) => setDraftFilters((current) => ({ ...current, userId: event.currentTarget.value }))}
          w={180}
        />
        <TextInput
          className="stats-task-logs__task-id"
          label="任务 ID"
          value={draftFilters.taskId}
          onChange={(event) => setDraftFilters((current) => ({ ...current, taskId: event.currentTarget.value }))}
          w={200}
        />
        <TextInput
          className="stats-task-logs__created-from"
          label="开始时间"
          type="datetime-local"
          value={draftFilters.createdFrom}
          onChange={(event) => setDraftFilters((current) => ({ ...current, createdFrom: event.currentTarget.value }))}
          w={190}
        />
        <TextInput
          className="stats-task-logs__created-to"
          label="结束时间"
          type="datetime-local"
          value={draftFilters.createdTo}
          onChange={(event) => setDraftFilters((current) => ({ ...current, createdTo: event.currentTarget.value }))}
          w={190}
        />
        <Button className="stats-task-logs__query" leftSection={<IconSearch className="stats-task-logs__query-icon" size={15} />} onClick={applyFilters}>
          查询
        </Button>
        <Button className="stats-task-logs__reset" variant="subtle" leftSection={<IconX className="stats-task-logs__reset-icon" size={15} />} onClick={resetFilters}>
          重置
        </Button>
        <Button className="stats-task-logs__refresh" variant="light" leftSection={<IconRefresh className="stats-task-logs__refresh-icon" size={15} />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </Group>

      <Group className="stats-task-logs__summary" justify="space-between" align="center" wrap="wrap">
        <Text className="stats-task-logs__total" size="sm" c="dimmed">共 {total} 条记录</Text>
        <Select
          className="stats-task-logs__page-size"
          aria-label="每页记录数"
          value={String(pageSize)}
          data={[
            { value: '10', label: '10 条/页' },
            { value: '20', label: '20 条/页' },
            { value: '50', label: '50 条/页' },
            { value: '100', label: '100 条/页' },
          ]}
          onChange={(value) => {
            const nextPageSize = Number(value || 20)
            setPageSize(nextPageSize)
            setPage(1)
          }}
          w={120}
        />
      </Group>

      {errorMessage ? (
        <StatePanel className="stats-task-logs__error" title="日志读取失败" description={errorMessage} tone="error" />
      ) : (
        <div className="stats-task-logs__table-wrap" style={{ overflowX: 'auto', minHeight: 440 }}>
          <Table className="stats-task-logs__table" striped highlightOnHover verticalSpacing="xs">
            <Table.Thead className="stats-task-logs__table-head">
              <Table.Tr className="stats-task-logs__table-head-row">
                <Table.Th className="stats-task-logs__table-head-cell">时间</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">Vendor</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">调用者</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">类型</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">状态</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">耗时</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">任务 ID</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">错误</Table.Th>
                <Table.Th className="stats-task-logs__table-head-cell">详情</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-task-logs__table-body">
              {!loading && items.length === 0 ? (
                <Table.Tr className="stats-task-logs__empty-row">
                  <Table.Td className="stats-task-logs__empty-cell" colSpan={9}>
                    <Text className="stats-task-logs__empty-text" size="sm" c="dimmed">没有符合条件的生成任务日志</Text>
                  </Table.Td>
                </Table.Tr>
              ) : items.map((item) => (
                <Table.Tr className="stats-task-logs__table-row" key={`${item.userId}:${item.vendor}:${item.taskId}`}>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__created-at" size="xs" c="dimmed">{new Date(item.createdAt).toLocaleString()}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__vendor-value" size="sm">{item.vendor}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__caller" size="sm" title={item.userId}>{formatCaller(item)}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__kind" size="sm">{item.taskKind || '—'}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Badge className="stats-task-logs__status-value" size="sm" variant="light" color={statusColor(item.status)}>{item.status}</Badge></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__duration" size="sm" c="dimmed">{formatDuration(item.durationMs)}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__task-id-value" size="xs" title={item.taskId}>{item.taskId}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Text className="stats-task-logs__error-value" size="xs" c={item.errorMessage ? 'red' : 'dimmed'}>{item.errorMessage || '—'}</Text></Table.Td>
                  <Table.Td className="stats-task-logs__table-cell"><Button className="stats-task-logs__detail" size="compact-xs" variant="subtle" onClick={() => setSelectedItem(item)}>查看</Button></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}

      <Group className="stats-task-logs__pagination-row" justify="space-between" align="center" wrap="wrap">
        <Text className="stats-task-logs__page-label" size="xs" c="dimmed">第 {totalPages === 0 ? 0 : page} / {totalPages} 页</Text>
        <Pagination className="stats-task-logs__pagination" value={page} total={Math.max(1, totalPages)} onChange={setPage} disabled={loading || totalPages <= 1} />
      </Group>

      <Modal className="stats-task-logs__detail-modal" opened={Boolean(selectedItem)} onClose={() => setSelectedItem(null)} title="任务日志详情" size="xl" centered>
        <Stack className="stats-task-logs__detail-content" gap="sm">
          <Text className="stats-task-logs__detail-meta" size="sm">{selectedItem ? `${selectedItem.vendor} · ${selectedItem.taskId}` : ''}</Text>
          <Textarea className="stats-task-logs__request-payload" label="请求体" value={selectedItem?.requestPayload || ''} readOnly autosize minRows={8} maxRows={18} />
          <Textarea className="stats-task-logs__upstream-response" label="上游响应" value={selectedItem?.upstreamResponse || ''} readOnly autosize minRows={8} maxRows={18} />
        </Stack>
      </Modal>
    </Stack>
  )
}
