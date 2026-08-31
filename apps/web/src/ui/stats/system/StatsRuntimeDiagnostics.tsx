import React from 'react'
import { Badge, Group, Pagination, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import {
  selectResourceRuntimeDiagnosticsSnapshot,
  useResourceRuntimeStore,
} from '../../../domain/resource-runtime/store/resourceRuntimeStore'
import {
  getPendingUploads,
  selectUploadRuntimeDiagnosticsSnapshot,
  useUploadRuntimeStore,
} from '../../../domain/upload-runtime/store/uploadRuntimeStore'
import { PanelCard } from '../../PanelCard'
import { InlinePanel } from '../../InlinePanel'

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function formatDuration(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`
  return `${(value / 60_000).toFixed(1)}m`
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return new Date(value).toLocaleString()
}

function formatTrimReason(value: string | null): string {
  const normalized = String(value || '').trim()
  return normalized || '—'
}

function ellipsisMiddle(value: string, head: number = 18, tail: number = 10): string {
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

type SummaryMetricProps = {
  label: string
  value: string
  hint?: string
  color?: string
}

function SummaryMetric({ label, value, hint, color = 'gray' }: SummaryMetricProps): JSX.Element {
  return (
    <InlinePanel className="stats-runtime-diagnostics__metric">
      <Stack className="stats-runtime-diagnostics__metric-stack" gap={4}>
        <Group className="stats-runtime-diagnostics__metric-header" justify="space-between" align="center" wrap="nowrap">
          <Text className="stats-runtime-diagnostics__metric-label" size="xs" c="dimmed">{label}</Text>
          <Badge className="stats-runtime-diagnostics__metric-badge" size="xs" variant="light" color={color}>
            {value}
          </Badge>
        </Group>
        {hint ? (
          <Text className="stats-runtime-diagnostics__metric-hint" size="xs" c="dimmed">
            {hint}
          </Text>
        ) : null}
      </Stack>
    </InlinePanel>
  )
}

export default function StatsRuntimeDiagnostics({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-runtime-diagnostics', className].filter(Boolean).join(' ')
  const resourceSnapshot = useResourceRuntimeStore(selectResourceRuntimeDiagnosticsSnapshot)
  const uploadSnapshot = useUploadRuntimeStore((state) => selectUploadRuntimeDiagnosticsSnapshot(state))
  const imageEntries = useResourceRuntimeStore((state) => state.imageEntries)
  useUploadRuntimeStore((state) => state.handlesById)
  const pendingUploads = getPendingUploads()
  const [resourceQuery, setResourceQuery] = React.useState('')
  const [resourceState, setResourceState] = React.useState('')
  const [resourcePriority, setResourcePriority] = React.useState('')
  const [resourcePage, setResourcePage] = React.useState(1)
  const [uploadQuery, setUploadQuery] = React.useState('')
  const [uploadBinding, setUploadBinding] = React.useState('')
  const [uploadPage, setUploadPage] = React.useState(1)
  const pageSize = 10

  const resourceRows = React.useMemo(
    () => Object.values(imageEntries)
      .filter((entry) => {
        const normalizedQuery = resourceQuery.trim().toLowerCase()
        if (resourceState && entry.state !== resourceState) return false
        if (resourcePriority && entry.descriptor.priority !== resourcePriority) return false
        if (!normalizedQuery) return true
        return entry.id.toLowerCase().includes(normalizedQuery) || entry.descriptor.url.toLowerCase().includes(normalizedQuery)
      })
      .sort((left, right) => {
        if (left.refCount !== right.refCount) return right.refCount - left.refCount
        const rightBytes = typeof right.estimatedBytes === 'number' ? right.estimatedBytes : -1
        const leftBytes = typeof left.estimatedBytes === 'number' ? left.estimatedBytes : -1
        if (rightBytes !== leftBytes) return rightBytes - leftBytes
        return right.lastAccessAt - left.lastAccessAt
      }),
    [imageEntries, resourcePriority, resourceQuery, resourceState],
  )

  const pendingRows = React.useMemo(
    () => [...pendingUploads]
      .filter((item) => {
        const normalizedQuery = uploadQuery.trim().toLowerCase()
        const hasBinding = item.ownerNodeIds.length > 0
        const bindingState = hasBinding ? 'bound' : 'missing'
        if (uploadBinding && bindingState !== uploadBinding) return false
        if (!normalizedQuery) return true
        return [item.fileName, item.requestKey, item.projectId || '', ...item.ownerNodeIds]
          .some((value) => value.toLowerCase().includes(normalizedQuery))
      })
      .sort((left, right) => left.startedAt - right.startedAt),
    [pendingUploads, uploadBinding, uploadQuery],
  )

  const resourceStateOptions = React.useMemo(
    () => Array.from(new Set(Object.values(imageEntries).map((entry) => entry.state))).sort().map((value) => ({ value, label: value })),
    [imageEntries],
  )
  const resourcePriorityOptions = React.useMemo(
    () => Array.from(new Set(Object.values(imageEntries).map((entry) => entry.descriptor.priority))).sort().map((value) => ({ value, label: value })),
    [imageEntries],
  )
  const resourceTotalPages = Math.ceil(resourceRows.length / pageSize)
  const uploadTotalPages = Math.ceil(pendingRows.length / pageSize)
  const pagedResourceRows = resourceRows.slice((resourcePage - 1) * pageSize, resourcePage * pageSize)
  const pagedPendingRows = pendingRows.slice((uploadPage - 1) * pageSize, uploadPage * pageSize)

  React.useEffect(() => {
    setResourcePage(1)
  }, [resourcePriority, resourceQuery, resourceState])

  React.useEffect(() => {
    setUploadPage(1)
  }, [uploadBinding, uploadQuery])

  React.useEffect(() => {
    if (resourceTotalPages > 0 && resourcePage > resourceTotalPages) setResourcePage(resourceTotalPages)
  }, [resourcePage, resourceTotalPages])

  React.useEffect(() => {
    if (uploadTotalPages > 0 && uploadPage > uploadTotalPages) setUploadPage(uploadTotalPages)
  }, [uploadPage, uploadTotalPages])

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-runtime-diagnostics__summary" grow align="stretch">
        <PanelCard className="stats-runtime-diagnostics__section-card" padding="compact">
          <Stack className="stats-runtime-diagnostics__section-stack" gap="sm">
            <div className="stats-runtime-diagnostics__section-header">
              <Text className="stats-runtime-diagnostics__section-title" size="sm" fw={700}>资源运行时</Text>
              <Text className="stats-runtime-diagnostics__section-subtitle" size="xs" c="dimmed">
                句柄、对象 URL、trim 与下载槽位快照。
              </Text>
            </div>
            <Group className="stats-runtime-diagnostics__metrics-grid" grow align="stretch">
              <SummaryMetric label="句柄" value={String(resourceSnapshot.handleCount)} hint={`active ${resourceSnapshot.activeHandleCount} / ready ${resourceSnapshot.readyHandleCount}`} color="gray" />
              <SummaryMetric label="对象 URL" value={String(resourceSnapshot.readyObjectUrlCount)} hint={`revoked ${resourceSnapshot.revokedObjectUrlCount} / bitmap ${resourceSnapshot.readyBitmapCount}`} color="gray" />
              <SummaryMetric label="解码队列" value={`${resourceSnapshot.activeDecodeCount}/${resourceSnapshot.queuedDecodeCount}`} hint="ready 前的受控 decode 并发" color="orange" />
              <SummaryMetric label="估算内存" value={formatBytes(resourceSnapshot.totalEstimatedBytes)} hint={`trim ${resourceSnapshot.trimmedResourceCount} / reason ${formatTrimReason(resourceSnapshot.lastTrimReason)}`} color="teal" />
              <SummaryMetric label="下载队列" value={`${resourceSnapshot.activeDownloadCount}/${resourceSnapshot.queuedDownloadCount}`} hint={`critical ${resourceSnapshot.criticalHandleCount} / visible ${resourceSnapshot.visibleHandleCount}`} color="gray" />
              <SummaryMetric label="批处理队列" value={`${resourceSnapshot.activeBatchJobCount}/${resourceSnapshot.queuedBatchJobCount}`} hint="referenceSheet 单独排队" color="gray" />
            </Group>
            <Group className="stats-runtime-diagnostics__resource-badges" gap={6} wrap="wrap">
              <Badge className="stats-runtime-diagnostics__resource-badge" variant="light">loading {resourceSnapshot.loadingHandleCount}</Badge>
              <Badge className="stats-runtime-diagnostics__resource-badge" variant="light">queued {resourceSnapshot.queuedHandleCount}</Badge>
              <Badge className="stats-runtime-diagnostics__resource-badge" variant="light">failed {resourceSnapshot.failedHandleCount}</Badge>
              <Badge className="stats-runtime-diagnostics__resource-badge" variant="light">prefetch {resourceSnapshot.prefetchHandleCount}</Badge>
              <Badge className="stats-runtime-diagnostics__resource-badge" variant="light">background {resourceSnapshot.backgroundHandleCount}</Badge>
              <Badge className="stats-runtime-diagnostics__resource-badge" color={resourceSnapshot.viewportMoving ? 'yellow' : 'gray'} variant="light">
                viewportMoving {resourceSnapshot.viewportMoving ? 'yes' : 'no'}
              </Badge>
              <Badge className="stats-runtime-diagnostics__resource-badge" color={resourceSnapshot.nodeDragging ? 'yellow' : 'gray'} variant="light">
                nodeDragging {resourceSnapshot.nodeDragging ? 'yes' : 'no'}
              </Badge>
            </Group>
          </Stack>
        </PanelCard>

        <PanelCard className="stats-runtime-diagnostics__section-card" padding="compact">
          <Stack className="stats-runtime-diagnostics__section-stack" gap="sm">
            <div className="stats-runtime-diagnostics__section-header">
              <Text className="stats-runtime-diagnostics__section-title" size="sm" fw={700}>上传运行时</Text>
              <Text className="stats-runtime-diagnostics__section-subtitle" size="xs" c="dimmed">
                pending requestKey、owner 归属与重复阻断计数。
              </Text>
            </div>
            <Group className="stats-runtime-diagnostics__metrics-grid" grow align="stretch">
              <SummaryMetric label="节点上传中" value={String(uploadSnapshot.activeNodeImageUploadCount)} hint={`pending ${uploadSnapshot.pendingUploadCount}`} color="gray" />
              <SummaryMetric label="重复阻断" value={String(uploadSnapshot.duplicateBlockedCount)} hint={`multi-owner ${uploadSnapshot.multiOwnerPendingCount}`} color="orange" />
              <SummaryMetric label="owner 绑定" value={String(uploadSnapshot.ownerBoundPendingCount)} hint={`ownerless ${uploadSnapshot.ownerlessPendingCount} / errors ${uploadSnapshot.ownerBindingErrorCount}`} color={uploadSnapshot.ownerBindingErrorCount > 0 ? 'red' : 'teal'} />
              <SummaryMetric label="最老 pending" value={formatDuration(uploadSnapshot.oldestPendingAgeMs)} hint="按 startedAt 计算" color="gray" />
            </Group>
          </Stack>
        </PanelCard>
      </Group>

      <PanelCard className="stats-runtime-diagnostics__table-card" padding="compact">
        <Stack className="stats-runtime-diagnostics__table-stack" gap="sm">
          <Group className="stats-runtime-diagnostics__table-header" justify="space-between" align="center" wrap="wrap">
            <Stack className="stats-runtime-diagnostics__table-heading" gap={2}>
              <Text className="stats-runtime-diagnostics__table-title" size="sm" fw={700}>当前资源句柄</Text>
              <Text className="stats-runtime-diagnostics__table-subtitle" size="xs" c="dimmed">当前浏览器快照，共 {resourceRows.length} 项。</Text>
            </Stack>
            <Group className="stats-runtime-diagnostics__resource-filters" gap="xs" wrap="wrap">
              <TextInput className="stats-runtime-diagnostics__resource-query" placeholder="resourceId / URL" value={resourceQuery} onChange={(event) => setResourceQuery(event.currentTarget.value)} w={210} />
              <Select className="stats-runtime-diagnostics__resource-state-filter" placeholder="全部状态" clearable data={resourceStateOptions} value={resourceState || null} onChange={(value) => setResourceState(value || '')} w={130} />
              <Select className="stats-runtime-diagnostics__resource-priority-filter" placeholder="全部优先级" clearable data={resourcePriorityOptions} value={resourcePriority || null} onChange={(value) => setResourcePriority(value || '')} w={140} />
            </Group>
          </Group>
          <div className="stats-runtime-diagnostics__table-wrap" style={{ overflowX: 'auto' }}>
            <Table className="stats-runtime-diagnostics__table" striped highlightOnHover verticalSpacing="xs">
              <Table.Thead className="stats-runtime-diagnostics__table-head">
                <Table.Tr className="stats-runtime-diagnostics__table-head-row">
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 220 }}>resourceId</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 80 }}>state</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 90 }}>priority</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 70 }}>ref</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 90 }}>transport</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 100 }}>bytes</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 170 }}>lastAccess</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell">url</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-runtime-diagnostics__table-body">
                {resourceRows.length === 0 ? (
                  <Table.Tr className="stats-runtime-diagnostics__table-empty-row">
                    <Table.Td className="stats-runtime-diagnostics__table-empty-cell" colSpan={8}>
                      <Text className="stats-runtime-diagnostics__table-empty" size="sm" c="dimmed">当前没有资源句柄</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : pagedResourceRows.map((entry) => (
                  <Table.Tr className="stats-runtime-diagnostics__table-row" key={entry.id}>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Text className="stats-runtime-diagnostics__resource-id" size="sm" title={entry.id}>{ellipsisMiddle(entry.id, 18, 14)}</Text>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Badge className="stats-runtime-diagnostics__resource-state" size="xs" variant="light">{entry.state}</Badge>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Badge className="stats-runtime-diagnostics__resource-priority" size="xs" variant="light">{entry.descriptor.priority}</Badge>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Text className="stats-runtime-diagnostics__resource-refcount" size="sm" c="dimmed">{entry.refCount}</Text>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Text className="stats-runtime-diagnostics__resource-transport" size="sm" c="dimmed">{entry.decoded?.transport ?? 'none'}</Text>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Text className="stats-runtime-diagnostics__resource-bytes" size="sm" c="dimmed">{formatBytes(entry.estimatedBytes || 0)}</Text>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Text className="stats-runtime-diagnostics__resource-last-access" size="sm" c="dimmed">{formatTimestamp(entry.lastAccessAt)}</Text>
                    </Table.Td>
                    <Table.Td className="stats-runtime-diagnostics__table-cell">
                      <Text className="stats-runtime-diagnostics__resource-url" size="sm" c="dimmed" title={entry.descriptor.url} style={{ wordBreak: 'break-all' }}>
                        {entry.descriptor.url}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
          <Group className="stats-runtime-diagnostics__resource-pagination-row" justify="space-between" align="center">
            <Text className="stats-runtime-diagnostics__resource-page-label" size="xs" c="dimmed">第 {resourceTotalPages === 0 ? 0 : resourcePage} / {resourceTotalPages} 页</Text>
            <Pagination className="stats-runtime-diagnostics__resource-pagination" value={resourcePage} total={Math.max(1, resourceTotalPages)} onChange={setResourcePage} disabled={resourceTotalPages <= 1} />
          </Group>
        </Stack>
      </PanelCard>

      <PanelCard className="stats-runtime-diagnostics__table-card" padding="compact">
        <Stack className="stats-runtime-diagnostics__table-stack" gap="sm">
          <Group className="stats-runtime-diagnostics__table-header" justify="space-between" align="center" wrap="wrap">
            <Stack className="stats-runtime-diagnostics__table-heading" gap={2}>
              <Text className="stats-runtime-diagnostics__table-title" size="sm" fw={700}>当前上传聚合</Text>
              <Text className="stats-runtime-diagnostics__table-subtitle" size="xs" c="dimmed">当前 pending upload 快照，共 {pendingRows.length} 项。</Text>
            </Stack>
            <Group className="stats-runtime-diagnostics__upload-filters" gap="xs" wrap="wrap">
              <TextInput className="stats-runtime-diagnostics__upload-query" placeholder="文件 / requestKey / owner / 项目" value={uploadQuery} onChange={(event) => setUploadQuery(event.currentTarget.value)} w={250} />
              <Select
                className="stats-runtime-diagnostics__upload-binding-filter"
                placeholder="全部绑定状态"
                clearable
                data={[
                  { value: 'bound', label: '已绑定' },
                  { value: 'missing', label: '缺失绑定' },
                ]}
                value={uploadBinding || null}
                onChange={(value) => setUploadBinding(value || '')}
                w={150}
              />
            </Group>
          </Group>
          <div className="stats-runtime-diagnostics__table-wrap" style={{ overflowX: 'auto' }}>
            <Table className="stats-runtime-diagnostics__table" striped highlightOnHover verticalSpacing="xs">
              <Table.Thead className="stats-runtime-diagnostics__table-head">
                <Table.Tr className="stats-runtime-diagnostics__table-head-row">
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 180 }}>file</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 210 }}>requestKey</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 170 }}>ownerNodeIds</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 100 }}>project</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 170 }}>startedAt</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 90 }}>age</Table.Th>
                  <Table.Th className="stats-runtime-diagnostics__table-head-cell" style={{ width: 100 }}>binding</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-runtime-diagnostics__table-body">
                {pendingRows.length === 0 ? (
                  <Table.Tr className="stats-runtime-diagnostics__table-empty-row">
                    <Table.Td className="stats-runtime-diagnostics__table-empty-cell" colSpan={7}>
                      <Text className="stats-runtime-diagnostics__table-empty" size="sm" c="dimmed">当前没有 pending upload</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : pagedPendingRows.map((item) => {
                  const hasBinding = item.ownerNodeIds.length > 0
                  return (
                    <Table.Tr className="stats-runtime-diagnostics__table-row" key={item.id}>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Text className="stats-runtime-diagnostics__upload-file" size="sm">{item.fileName}</Text>
                      </Table.Td>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Text className="stats-runtime-diagnostics__upload-request-key" size="sm" c="dimmed" title={item.requestKey}>
                          {ellipsisMiddle(item.requestKey, 18, 14)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Text className="stats-runtime-diagnostics__upload-owners" size="sm" c="dimmed" style={{ wordBreak: 'break-word' }}>
                          {item.ownerNodeIds.length > 0 ? item.ownerNodeIds.join(', ') : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Text className="stats-runtime-diagnostics__upload-project" size="sm" c="dimmed">{item.projectId || '—'}</Text>
                      </Table.Td>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Text className="stats-runtime-diagnostics__upload-started-at" size="sm" c="dimmed">{formatTimestamp(item.startedAt)}</Text>
                      </Table.Td>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Text className="stats-runtime-diagnostics__upload-age" size="sm" c="dimmed">
                          {formatDuration(Math.max(0, Date.now() - item.startedAt))}
                        </Text>
                      </Table.Td>
                      <Table.Td className="stats-runtime-diagnostics__table-cell">
                        <Badge
                          className="stats-runtime-diagnostics__upload-binding"
                          size="xs"
                          variant="light"
                          color={hasBinding ? 'teal' : 'red'}
                        >
                          {hasBinding ? 'bound' : 'missing'}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </div>
          <Group className="stats-runtime-diagnostics__upload-pagination-row" justify="space-between" align="center">
            <Text className="stats-runtime-diagnostics__upload-page-label" size="xs" c="dimmed">第 {uploadTotalPages === 0 ? 0 : uploadPage} / {uploadTotalPages} 页</Text>
            <Pagination className="stats-runtime-diagnostics__upload-pagination" value={uploadPage} total={Math.max(1, uploadTotalPages)} onChange={setUploadPage} disabled={uploadTotalPages <= 1} />
          </Group>
        </Stack>
      </PanelCard>
    </Stack>
  )
}
