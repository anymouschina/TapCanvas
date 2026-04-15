import React from 'react'
import type { Edge, Node } from '@xyflow/react'
import { Badge, Button, Group, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { useRFStore } from '../canvas/store'
import {
  selectResourceRuntimeDiagnosticsSnapshot,
  useResourceRuntimeStore,
} from '../domain/resource-runtime/store/resourceRuntimeStore'
import {
  selectUploadRuntimeDiagnosticsSnapshot,
  useUploadRuntimeStore,
} from '../domain/upload-runtime/store/uploadRuntimeStore'
import { useLiveChatRunStore, type LiveChatRunRecord } from './chat/liveChatRunStore'
import { InlinePanel } from './InlinePanel'
import { PanelCard } from './PanelCard'
import { toast } from './toast'

type AgentStateStoragePanelProps = {
  className?: string
  opened: boolean
}

type MemorySample = {
  usedJsHeapSize: number
  totalJsHeapSize: number
  jsHeapSizeLimit: number
} | null

type SizeRow = {
  label: string
  bytes: number
  hint?: string
}

type StoreSummaryRow = SizeRow & {
  key: string
}

type NodePayloadRow = {
  nodeId: string
  label: string
  kind: string
  totalBytes: number
  topFields: SizeRow[]
}

type ResourceEntryRow = {
  id: string
  url: string
  state: string
  priority: string
  transport: string
  refCount: number
  estimatedBytes: number
  ownerNodeIds: string[]
}

type DomImageStats = {
  imageCount: number
  visibleImageCount: number
  blobImageCount: number
  dataImageCount: number
  uniqueSourceCount: number
  canvasCount: number
  videoCount: number
}

type BrowserPerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
    jsHeapSizeLimit?: number
  }
}

const TOP_FIELD_LIMIT = 4
const TOP_NODE_LIMIT = 8
const TOP_SECTION_SIZE_LIMIT = 8

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value) : '0'
}

function formatAgeMs(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  if (value < 1_000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`
  return `${(value / 60_000).toFixed(1)} min`
}

function estimateJsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value, createJsonReplacer())
    if (!json) return 0
    return new TextEncoder().encode(json).length
  } catch {
    return 0
  }
}

function createJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>()
  return (_key, value) => {
    if (!value || typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    return value
  }
}

function toNodeDataRecord(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
}

function readNodeLabel(node: Node): string {
  const data = toNodeDataRecord(node)
  const label = data.label
  return typeof label === 'string' && label.trim() ? label.trim() : node.id
}

function readNodeKind(node: Node): string {
  const data = toNodeDataRecord(node)
  const kind = data.kind
  return typeof kind === 'string' && kind.trim() ? kind.trim() : node.type || 'unknown'
}

function buildNodePayloadRows(nodes: Node[]): NodePayloadRow[] {
  return nodes
    .map((node) => {
      const data = toNodeDataRecord(node)
      const topFields = Object.entries(data)
        .map(([key, value]) => ({
          label: key,
          bytes: estimateJsonBytes(value),
        }))
        .filter((item) => item.bytes > 0)
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, TOP_FIELD_LIMIT)

      return {
        nodeId: node.id,
        label: readNodeLabel(node),
        kind: readNodeKind(node),
        totalBytes: estimateJsonBytes(node),
        topFields,
      }
    })
    .filter((item) => item.totalBytes > 0)
    .sort((left, right) => right.totalBytes - left.totalBytes)
    .slice(0, TOP_NODE_LIMIT)
}

function buildCanvasSectionSizes(input: {
  nodes: Node[]
  edges: Edge[]
  historyPast: Array<{ nodes: Node[]; edges: Edge[] }>
  historyFuture: Array<{ nodes: Node[]; edges: Edge[] }>
  clipboard: { nodes: Node[]; edges: Edge[] } | null
}): SizeRow[] {
  return [
    { label: 'nodes', bytes: estimateJsonBytes(input.nodes), hint: `${formatCount(input.nodes.length)} nodes` },
    { label: 'edges', bytes: estimateJsonBytes(input.edges), hint: `${formatCount(input.edges.length)} edges` },
    { label: 'historyPast', bytes: estimateJsonBytes(input.historyPast), hint: `${formatCount(input.historyPast.length)} snapshots` },
    { label: 'historyFuture', bytes: estimateJsonBytes(input.historyFuture), hint: `${formatCount(input.historyFuture.length)} snapshots` },
    { label: 'clipboard', bytes: estimateJsonBytes(input.clipboard), hint: input.clipboard ? `${formatCount(input.clipboard.nodes.length)} nodes` : 'empty' },
  ]
    .filter((item) => item.bytes > 0 || item.label === 'clipboard')
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, TOP_SECTION_SIZE_LIMIT)
}

function buildResourceEntryRows(
  entries: Record<string, {
    id: string
    descriptor: { url: string; priority: string }
    state: string
    refCount: number
    estimatedBytes: number | null
    owners: Array<{ ownerNodeId: string | null }>
    decoded: { transport: string } | null
  }>,
): ResourceEntryRow[] {
  return Object.values(entries)
    .map((entry) => ({
      id: entry.id,
      url: entry.descriptor.url,
      state: entry.state,
      priority: entry.descriptor.priority,
      transport: entry.decoded?.transport ?? 'none',
      refCount: entry.refCount,
      estimatedBytes:
        typeof entry.estimatedBytes === 'number' && Number.isFinite(entry.estimatedBytes) && entry.estimatedBytes > 0
          ? entry.estimatedBytes
          : 0,
      ownerNodeIds: Array.from(
        new Set(
          entry.owners
            .map((owner) => (typeof owner.ownerNodeId === 'string' ? owner.ownerNodeId.trim() : ''))
            .filter(Boolean),
        ),
      ),
    }))
    .sort((left, right) => {
      if (right.estimatedBytes !== left.estimatedBytes) return right.estimatedBytes - left.estimatedBytes
      if (right.refCount !== left.refCount) return right.refCount - left.refCount
      return left.id.localeCompare(right.id)
    })
    .slice(0, 12)
}

function readLogsLineCount(nodes: Node[]): number {
  return nodes.reduce((count, node) => {
    const logs = toNodeDataRecord(node).logs
    return count + (Array.isArray(logs) ? logs.length : 0)
  }, 0)
}

function readSelectedCount(nodes: Node[]): number {
  return nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0)
}

function readGroupCount(nodes: Node[]): number {
  return nodes.reduce((count, node) => count + (node.type === 'groupNode' ? 1 : 0), 0)
}

function readTaskNodeCount(nodes: Node[]): number {
  return nodes.reduce((count, node) => count + (node.type === 'taskNode' ? 1 : 0), 0)
}

function readPersistedLocalStorageBytes(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem('tapcanvas-flow')
    return raw ? new TextEncoder().encode(raw).length : 0
  } catch {
    return 0
  }
}

function readDomImageStats(): DomImageStats {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      imageCount: 0,
      visibleImageCount: 0,
      blobImageCount: 0,
      dataImageCount: 0,
      uniqueSourceCount: 0,
      canvasCount: 0,
      videoCount: 0,
    }
  }

  const images = Array.from(document.querySelectorAll('img'))
  const uniqueSources = new Set<string>()
  let visibleImageCount = 0
  let blobImageCount = 0
  let dataImageCount = 0

  for (const image of images) {
    const src = typeof image.currentSrc === 'string' && image.currentSrc.trim()
      ? image.currentSrc.trim()
      : typeof image.src === 'string'
        ? image.src.trim()
        : ''

    if (src) uniqueSources.add(src)
    if (src.startsWith('blob:')) blobImageCount += 1
    if (src.startsWith('data:image/')) dataImageCount += 1

    const rect = image.getBoundingClientRect()
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    ) {
      visibleImageCount += 1
    }
  }

  return {
    imageCount: images.length,
    visibleImageCount,
    blobImageCount,
    dataImageCount,
    uniqueSourceCount: uniqueSources.size,
    canvasCount: document.querySelectorAll('canvas').length,
    videoCount: document.querySelectorAll('video').length,
  }
}

function readMemorySample(): MemorySample {
  if (typeof window === 'undefined') return null
  const perf = window.performance as BrowserPerformanceWithMemory
  if (!perf.memory) return null
  const used = Number(perf.memory.usedJSHeapSize || 0)
  const total = Number(perf.memory.totalJSHeapSize || 0)
  const limit = Number(perf.memory.jsHeapSizeLimit || 0)
  if (!Number.isFinite(used) && !Number.isFinite(total) && !Number.isFinite(limit)) return null
  return {
    usedJsHeapSize: Number.isFinite(used) ? used : 0,
    totalJsHeapSize: Number.isFinite(total) ? total : 0,
    jsHeapSizeLimit: Number.isFinite(limit) ? limit : 0,
  }
}

function summarizeLiveRun(activeRun: LiveChatRunRecord | null): SizeRow[] {
  if (!activeRun) return []
  return [
    { label: 'record', bytes: estimateJsonBytes(activeRun), hint: activeRun.status },
    { label: 'logs', bytes: estimateJsonBytes(activeRun.logs), hint: `${formatCount(activeRun.logs.length)} entries` },
    { label: 'todoItems', bytes: estimateJsonBytes(activeRun.todoItems), hint: `${formatCount(activeRun.todoItems.length)} items` },
    { label: 'assistantPreview', bytes: estimateJsonBytes(activeRun.assistantPreview), hint: `${formatCount(activeRun.assistantPreview.length)} chars` },
  ]
    .filter((item) => item.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes)
}

function buildStoreSummaryRows(input: {
  memorySample: MemorySample
  canvasStoreBytes: number
  resourceStoreBytes: number
  uploadStoreBytes: number
  persistedLocalStorageBytes: number
  liveRunBytes: number
  nodesCount: number
  edgesCount: number
  resourceHandleCount: number
  resourceEstimatedBytes: number
  pendingUploadCount: number
  uploadHandleCount: number
  activeLiveRun: LiveChatRunRecord | null
}): StoreSummaryRow[] {
  const rows: StoreSummaryRow[] = [
    {
      key: 'canvas',
      label: 'Canvas Store',
      bytes: input.canvasStoreBytes,
      hint: `${formatCount(input.nodesCount)} nodes · ${formatCount(input.edgesCount)} edges`,
    },
    {
      key: 'resource',
      label: 'Resource Runtime',
      bytes: input.resourceStoreBytes,
      hint: `${formatCount(input.resourceHandleCount)} handles · est ${formatBytes(input.resourceEstimatedBytes)}`,
    },
    {
      key: 'upload',
      label: 'Upload Runtime',
      bytes: input.uploadStoreBytes,
      hint: `${formatCount(input.pendingUploadCount)} pending · ${formatCount(input.uploadHandleCount)} handles`,
    },
    {
      key: 'persisted',
      label: 'Persisted Flow',
      bytes: input.persistedLocalStorageBytes,
      hint: 'localStorage.tapcanvas-flow',
    },
    {
      key: 'live',
      label: 'Live Chat Store',
      bytes: input.liveRunBytes,
      hint: input.activeLiveRun ? `${input.activeLiveRun.status} · ${formatCount(input.activeLiveRun.logs.length)} logs` : 'idle',
    },
  ]

  if (input.memorySample) {
    rows.push({
      key: 'heap',
      label: 'JS Heap',
      bytes: input.memorySample.usedJsHeapSize,
      hint: `total ${formatBytes(input.memorySample.totalJsHeapSize)} / limit ${formatBytes(input.memorySample.jsHeapSizeLimit)}`,
    })
  }

  return rows.sort((left, right) => right.bytes - left.bytes)
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function MetricCard(props: {
  className: string
  label: string
  value: string
  hint?: string
  color?: string
}): JSX.Element {
  return (
    <InlinePanel className={props.className} padding="compact">
      <Stack className={`${props.className}__stack`} gap={2}>
        <Group className={`${props.className}__header`} justify="space-between" align="center" wrap="nowrap">
          <Text className={`${props.className}__label`} size="xs" c="dimmed">
            {props.label}
          </Text>
          {props.color ? (
            <Badge className={`${props.className}__badge`} size="xs" variant="light" color={props.color}>
              {props.value}
            </Badge>
          ) : null}
        </Group>
        {!props.color ? (
          <Text className={`${props.className}__value`} size="sm" fw={700}>
            {props.value}
          </Text>
        ) : null}
        {props.hint ? (
          <Text className={`${props.className}__hint`} size="xs" c="dimmed">
            {props.hint}
          </Text>
        ) : null}
      </Stack>
    </InlinePanel>
  )
}

export default function AgentStateStoragePanel(props: AgentStateStoragePanelProps): JSX.Element {
  const { className, opened } = props
  const nodes = useRFStore((state) => state.nodes)
  const edges = useRFStore((state) => state.edges)
  const historyPast = useRFStore((state) => state.historyPast)
  const historyFuture = useRFStore((state) => state.historyFuture)
  const clipboard = useRFStore((state) => state.clipboard)
  const resourceSnapshot = useResourceRuntimeStore(selectResourceRuntimeDiagnosticsSnapshot)
  const resourceEntries = useResourceRuntimeStore((state) => state.imageEntries)
  const uploadSnapshot = useUploadRuntimeStore(selectUploadRuntimeDiagnosticsSnapshot)
  const uploadHandlesById = useUploadRuntimeStore((state) => state.handlesById)
  const activeLiveRun = useLiveChatRunStore((state) => state.activeRun)
  const [memorySample, setMemorySample] = React.useState<MemorySample>(() => readMemorySample())
  const [domImageStats, setDomImageStats] = React.useState<DomImageStats>(() => readDomImageStats())

  React.useEffect(() => {
    if (!opened) return
    setMemorySample(readMemorySample())
    setDomImageStats(readDomImageStats())
    const timer = window.setInterval(() => {
      setMemorySample(readMemorySample())
      setDomImageStats(readDomImageStats())
    }, 1500)
    return () => window.clearInterval(timer)
  }, [opened])

  const canvasSectionSizes = React.useMemo(
    () => buildCanvasSectionSizes({ nodes, edges, historyPast, historyFuture, clipboard }),
    [nodes, edges, historyPast, historyFuture, clipboard],
  )
  const nodePayloadRows = React.useMemo(() => buildNodePayloadRows(nodes), [nodes])
  const liveRunSectionSizes = React.useMemo(() => summarizeLiveRun(activeLiveRun), [activeLiveRun])
  const resourceEntryRows = React.useMemo(() => buildResourceEntryRows(resourceEntries), [resourceEntries])
  const canvasStoreBytes = React.useMemo(
    () => estimateJsonBytes({ nodes, edges, historyPast, historyFuture, clipboard }),
    [nodes, edges, historyPast, historyFuture, clipboard],
  )
  const resourceStoreBytes = React.useMemo(
    () => estimateJsonBytes({
      imageEntries: resourceEntries,
      diagnostics: resourceSnapshot,
    }),
    [resourceEntries, resourceSnapshot],
  )
  const uploadStoreBytes = React.useMemo(
    () => estimateJsonBytes({
      handlesById: uploadHandlesById,
      diagnostics: uploadSnapshot,
    }),
    [uploadHandlesById, uploadSnapshot],
  )
  const liveRunBytes = React.useMemo(() => estimateJsonBytes(activeLiveRun), [activeLiveRun])
  const persistedLocalStorageBytes = React.useMemo(
    () => (opened ? readPersistedLocalStorageBytes() : 0),
    [opened, nodes, edges, historyPast.length, historyFuture.length],
  )
  const storeSummaryRows = React.useMemo(
    () =>
      buildStoreSummaryRows({
        memorySample,
        canvasStoreBytes,
        resourceStoreBytes,
        uploadStoreBytes,
        persistedLocalStorageBytes,
        liveRunBytes,
        nodesCount: nodes.length,
        edgesCount: edges.length,
        resourceHandleCount: resourceSnapshot.handleCount,
        resourceEstimatedBytes: resourceSnapshot.totalEstimatedBytes,
        pendingUploadCount: uploadSnapshot.pendingUploadCount,
        uploadHandleCount: Object.keys(uploadHandlesById).length,
        activeLiveRun,
      }),
    [
      memorySample,
      canvasStoreBytes,
      resourceStoreBytes,
      uploadStoreBytes,
      persistedLocalStorageBytes,
      liveRunBytes,
      nodes.length,
      edges.length,
      resourceSnapshot.handleCount,
      resourceSnapshot.totalEstimatedBytes,
      uploadSnapshot.pendingUploadCount,
      uploadHandlesById,
      activeLiveRun,
    ],
  )
  const snapshotPayload = React.useMemo(
    () => ({
      capturedAt: new Date().toISOString(),
      browserMemory: memorySample
        ? {
            usedJsHeapSize: memorySample.usedJsHeapSize,
            totalJsHeapSize: memorySample.totalJsHeapSize,
            jsHeapSizeLimit: memorySample.jsHeapSizeLimit,
          }
        : null,
      domRuntime: {
        imageCount: domImageStats.imageCount,
        visibleImageCount: domImageStats.visibleImageCount,
        blobImageCount: domImageStats.blobImageCount,
        dataImageCount: domImageStats.dataImageCount,
        uniqueSourceCount: domImageStats.uniqueSourceCount,
        canvasCount: domImageStats.canvasCount,
        videoCount: domImageStats.videoCount,
      },
      storeSummary: storeSummaryRows.map((row) => ({
        key: row.key,
        label: row.label,
        bytes: row.bytes,
        humanBytes: formatBytes(row.bytes),
        hint: row.hint ?? '',
      })),
      canvas: {
        nodes: nodes.length,
        edges: edges.length,
        selectedNodes: readSelectedCount(nodes),
        taskNodes: readTaskNodeCount(nodes),
        groupNodes: readGroupCount(nodes),
        logLines: readLogsLineCount(nodes),
        sectionSizes: canvasSectionSizes.map((item) => ({
          label: item.label,
          bytes: item.bytes,
          humanBytes: formatBytes(item.bytes),
          hint: item.hint ?? '',
        })),
        largestNodes: nodePayloadRows.map((row) => ({
          nodeId: row.nodeId,
          label: row.label,
          kind: row.kind,
          bytes: row.totalBytes,
          humanBytes: formatBytes(row.totalBytes),
          topFields: row.topFields.map((field) => ({
            label: field.label,
            bytes: field.bytes,
            humanBytes: formatBytes(field.bytes),
          })),
        })),
      },
      resourceRuntime: {
        snapshot: {
          handleCount: resourceSnapshot.handleCount,
          activeHandleCount: resourceSnapshot.activeHandleCount,
          readyHandleCount: resourceSnapshot.readyHandleCount,
          queuedHandleCount: resourceSnapshot.queuedHandleCount,
          loadingHandleCount: resourceSnapshot.loadingHandleCount,
          failedHandleCount: resourceSnapshot.failedHandleCount,
          releasedHandleCount: resourceSnapshot.releasedHandleCount,
          totalEstimatedBytes: resourceSnapshot.totalEstimatedBytes,
          totalEstimatedHumanBytes: formatBytes(resourceSnapshot.totalEstimatedBytes),
          readyBitmapCount: resourceSnapshot.readyBitmapCount,
          queuedDownloadCount: resourceSnapshot.queuedDownloadCount,
          activeDownloadCount: resourceSnapshot.activeDownloadCount,
          queuedDecodeCount: resourceSnapshot.queuedDecodeCount,
          activeDecodeCount: resourceSnapshot.activeDecodeCount,
          queuedBatchJobCount: resourceSnapshot.queuedBatchJobCount,
          activeBatchJobCount: resourceSnapshot.activeBatchJobCount,
          viewportMoving: resourceSnapshot.viewportMoving,
          nodeDragging: resourceSnapshot.nodeDragging,
          backgroundPaused: resourceSnapshot.backgroundPaused,
        },
        largestHandles: resourceEntryRows.map((row) => ({
          id: row.id,
          url: row.url,
          state: row.state,
          priority: row.priority,
          transport: row.transport,
          refCount: row.refCount,
          estimatedBytes: row.estimatedBytes,
          estimatedHumanBytes: formatBytes(row.estimatedBytes),
          ownerNodeIds: row.ownerNodeIds,
        })),
        storeBytes: resourceStoreBytes,
        storeHumanBytes: formatBytes(resourceStoreBytes),
      },
      uploadRuntime: {
        snapshot: {
          activeNodeImageUploadCount: uploadSnapshot.activeNodeImageUploadCount,
          pendingUploadCount: uploadSnapshot.pendingUploadCount,
          ownerBoundPendingCount: uploadSnapshot.ownerBoundPendingCount,
          ownerlessPendingCount: uploadSnapshot.ownerlessPendingCount,
          ownerBindingErrorCount: uploadSnapshot.ownerBindingErrorCount,
          multiOwnerPendingCount: uploadSnapshot.multiOwnerPendingCount,
          oldestPendingAgeMs: uploadSnapshot.oldestPendingAgeMs,
          duplicateBlockedCount: uploadSnapshot.duplicateBlockedCount,
        },
        handleCount: Object.keys(uploadHandlesById).length,
        storeBytes: uploadStoreBytes,
        storeHumanBytes: formatBytes(uploadStoreBytes),
      },
      liveChatRun: activeLiveRun
        ? {
            status: activeLiveRun.status,
            runId: activeLiveRun.runId,
            startedAt: activeLiveRun.startedAt,
            updatedAt: activeLiveRun.updatedAt,
            logsCount: activeLiveRun.logs.length,
            todoCount: activeLiveRun.todoItems.length,
            assetCount: activeLiveRun.assetCount,
            assistantPreviewChars: activeLiveRun.assistantPreview.length,
            topSections: liveRunSectionSizes.map((item) => ({
              label: item.label,
              bytes: item.bytes,
              humanBytes: formatBytes(item.bytes),
              hint: item.hint ?? '',
            })),
            storeBytes: liveRunBytes,
            storeHumanBytes: formatBytes(liveRunBytes),
          }
        : null,
      localPersistence: {
        key: 'tapcanvas-flow',
        bytes: persistedLocalStorageBytes,
        humanBytes: formatBytes(persistedLocalStorageBytes),
      },
    }),
    [
      memorySample,
      storeSummaryRows,
      nodes,
      edges,
      canvasSectionSizes,
      nodePayloadRows,
      resourceSnapshot,
      domImageStats,
      resourceStoreBytes,
      resourceEntryRows,
      uploadSnapshot,
      uploadHandlesById,
      uploadStoreBytes,
      activeLiveRun,
      liveRunSectionSizes,
      liveRunBytes,
      persistedLocalStorageBytes,
    ],
  )
  const handleCopySnapshot = React.useCallback(async () => {
    const payload = JSON.stringify(snapshotPayload, null, 2)
    const ok = await copyText(payload)
    toast(ok ? '已复制状态快照' : '复制状态快照失败', ok ? 'success' : 'error')
  }, [snapshotPayload])

  return (
    <Stack className={className} gap="md">
      <PanelCard className="agent-state-storage-panel__hero">
        <Stack className="agent-state-storage-panel__hero-stack" gap={6}>
          <Group className="agent-state-storage-panel__hero-header" justify="space-between" align="center" wrap="wrap">
            <Group className="agent-state-storage-panel__hero-header-main" gap="xs" wrap="wrap">
              <Text className="agent-state-storage-panel__hero-title" size="sm" fw={700}>
                前端状态存储概览
              </Text>
              <Group className="agent-state-storage-panel__hero-badges" gap="xs" wrap="wrap">
                <Badge className="agent-state-storage-panel__hero-badge" variant="light" color="blue">
                  canvas
                </Badge>
                <Badge className="agent-state-storage-panel__hero-badge" variant="light" color="teal">
                  resource runtime
                </Badge>
                <Badge className="agent-state-storage-panel__hero-badge" variant="light" color="grape">
                  upload runtime
                </Badge>
                <Badge className="agent-state-storage-panel__hero-badge" variant="light" color="orange">
                  live chat
                </Badge>
              </Group>
            </Group>
            <Button
              className="agent-state-storage-panel__copy-button"
              size="compact-sm"
              variant="light"
              onClick={() => void handleCopySnapshot()}
            >
              复制快照
            </Button>
          </Group>
          <Text className="agent-state-storage-panel__hero-text" size="xs" c="dimmed">
            这里只读展示当前浏览器内的 Zustand 状态规模、历史快照和热点字段，便于定位哪一块在吃内存。
          </Text>
        </Stack>
      </PanelCard>

      <Group className="agent-state-storage-panel__summary-grid" grow align="stretch">
        {storeSummaryRows.map((row) => (
          <MetricCard
            key={row.key}
            className={`agent-state-storage-panel__metric-card agent-state-storage-panel__metric-card--${row.key}`}
            label={row.label}
            value={formatBytes(row.bytes)}
            hint={row.hint}
          />
        ))}
      </Group>

      <ScrollArea className="agent-state-storage-panel__scroll" h={560} offsetScrollbars>
        <Stack className="agent-state-storage-panel__content" gap="md">
          <PanelCard className="agent-state-storage-panel__section">
            <Stack className="agent-state-storage-panel__section-stack" gap="sm">
              <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                  Canvas Store
                </Text>
                <Group className="agent-state-storage-panel__section-badges" gap="xs" wrap="wrap">
                  <Badge className="agent-state-storage-panel__section-badge" variant="light">{`selected ${formatCount(readSelectedCount(nodes))}`}</Badge>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light">{`task ${formatCount(readTaskNodeCount(nodes))}`}</Badge>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light">{`group ${formatCount(readGroupCount(nodes))}`}</Badge>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light" color="orange">{`logs ${formatCount(readLogsLineCount(nodes))}`}</Badge>
                </Group>
              </Group>
              <Group className="agent-state-storage-panel__canvas-metrics" grow align="stretch">
                {canvasSectionSizes.map((item) => (
                  <MetricCard
                    key={item.label}
                    className={`agent-state-storage-panel__metric-card agent-state-storage-panel__metric-card--${item.label}`}
                    label={item.label}
                    value={formatBytes(item.bytes)}
                    hint={item.hint}
                  />
                ))}
              </Group>
            </Stack>
          </PanelCard>

          <PanelCard className="agent-state-storage-panel__section">
            <Stack className="agent-state-storage-panel__section-stack" gap="sm">
              <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                  Current Node Payload Hotspots
                </Text>
                <Text className="agent-state-storage-panel__section-subtitle" size="xs" c="dimmed">
                  当前仅统计在内存中的 `node.data` 顶层字段
                </Text>
              </Group>
              <div className="agent-state-storage-panel__table-wrap" style={{ overflowX: 'auto' }}>
                <Table className="agent-state-storage-panel__table" striped highlightOnHover verticalSpacing="xs">
                  <Table.Thead className="agent-state-storage-panel__table-head">
                    <Table.Tr className="agent-state-storage-panel__table-head-row">
                      <Table.Th className="agent-state-storage-panel__table-head-cell">node</Table.Th>
                      <Table.Th className="agent-state-storage-panel__table-head-cell">kind</Table.Th>
                      <Table.Th className="agent-state-storage-panel__table-head-cell">payload</Table.Th>
                      <Table.Th className="agent-state-storage-panel__table-head-cell">top fields</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody className="agent-state-storage-panel__table-body">
                    {nodePayloadRows.length === 0 ? (
                      <Table.Tr className="agent-state-storage-panel__table-empty-row">
                        <Table.Td className="agent-state-storage-panel__table-empty-cell" colSpan={4}>
                          <Text className="agent-state-storage-panel__table-empty-text" size="sm" c="dimmed">
                            当前没有可统计的节点 payload
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : nodePayloadRows.map((row) => (
                      <Table.Tr className="agent-state-storage-panel__table-row" key={row.nodeId}>
                        <Table.Td className="agent-state-storage-panel__table-cell">
                          <Stack className="agent-state-storage-panel__node-cell" gap={2}>
                            <Text className="agent-state-storage-panel__node-label" size="sm" fw={600}>
                              {row.label}
                            </Text>
                            <Text className="agent-state-storage-panel__node-id" size="xs" c="dimmed">
                              {row.nodeId}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td className="agent-state-storage-panel__table-cell">
                          <Badge className="agent-state-storage-panel__node-kind" size="xs" variant="light">
                            {row.kind}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="agent-state-storage-panel__table-cell">
                          <Text className="agent-state-storage-panel__node-size" size="sm" c="dimmed">
                            {formatBytes(row.totalBytes)}
                          </Text>
                        </Table.Td>
                        <Table.Td className="agent-state-storage-panel__table-cell">
                          <Group className="agent-state-storage-panel__field-badges" gap={6} wrap="wrap">
                            {row.topFields.map((field) => (
                              <Badge className="agent-state-storage-panel__field-badge" key={`${row.nodeId}_${field.label}`} size="xs" variant="outline">
                                {`${field.label} ${formatBytes(field.bytes)}`}
                              </Badge>
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </Stack>
          </PanelCard>

          <Group className="agent-state-storage-panel__runtime-grid" grow align="stretch">
            <PanelCard className="agent-state-storage-panel__section">
              <Stack className="agent-state-storage-panel__section-stack" gap="sm">
                <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                  <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                    Resource Runtime
                  </Text>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light" color="teal">
                    {formatBytes(resourceSnapshot.totalEstimatedBytes)}
                  </Badge>
                </Group>
                <Group className="agent-state-storage-panel__resource-badges" gap="xs" wrap="wrap">
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`handles ${formatCount(resourceSnapshot.handleCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`ready ${formatCount(resourceSnapshot.readyHandleCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`loading ${formatCount(resourceSnapshot.loadingHandleCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`queued ${formatCount(resourceSnapshot.queuedHandleCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`failed ${formatCount(resourceSnapshot.failedHandleCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`bitmaps ${formatCount(resourceSnapshot.readyBitmapCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light" color={resourceSnapshot.viewportMoving ? 'yellow' : 'gray'}>{`viewport ${resourceSnapshot.viewportMoving ? 'moving' : 'idle'}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light" color={resourceSnapshot.nodeDragging ? 'yellow' : 'gray'}>{`drag ${resourceSnapshot.nodeDragging ? 'on' : 'off'}`}</Badge>
                </Group>
              </Stack>
            </PanelCard>

            <PanelCard className="agent-state-storage-panel__section">
              <Stack className="agent-state-storage-panel__section-stack" gap="sm">
                <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                  <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                    Upload Runtime
                  </Text>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light" color="grape">
                    {formatCount(uploadSnapshot.pendingUploadCount)}
                  </Badge>
                </Group>
                <Group className="agent-state-storage-panel__upload-badges" gap="xs" wrap="wrap">
                  <Badge className="agent-state-storage-panel__upload-badge" variant="light">{`active node uploads ${formatCount(uploadSnapshot.activeNodeImageUploadCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__upload-badge" variant="light">{`ownerless ${formatCount(uploadSnapshot.ownerlessPendingCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__upload-badge" variant="light">{`multi-owner ${formatCount(uploadSnapshot.multiOwnerPendingCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__upload-badge" variant="light">{`duplicate blocked ${formatCount(uploadSnapshot.duplicateBlockedCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__upload-badge" variant="outline">{`oldest ${formatAgeMs(uploadSnapshot.oldestPendingAgeMs)}`}</Badge>
                </Group>
              </Stack>
            </PanelCard>
          </Group>

          <Group className="agent-state-storage-panel__runtime-grid" grow align="stretch">
            <PanelCard className="agent-state-storage-panel__section">
              <Stack className="agent-state-storage-panel__section-stack" gap="sm">
                <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                  <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                    DOM 图片/渲染挂载
                  </Text>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light" color="blue">
                    {`img ${formatCount(domImageStats.imageCount)}`}
                  </Badge>
                </Group>
                <Group className="agent-state-storage-panel__resource-badges" gap="xs" wrap="wrap">
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`visible ${formatCount(domImageStats.visibleImageCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`blob ${formatCount(domImageStats.blobImageCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`data ${formatCount(domImageStats.dataImageCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`unique src ${formatCount(domImageStats.uniqueSourceCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`canvas ${formatCount(domImageStats.canvasCount)}`}</Badge>
                  <Badge className="agent-state-storage-panel__resource-badge" variant="light">{`video ${formatCount(domImageStats.videoCount)}`}</Badge>
                </Group>
                <Text className="agent-state-storage-panel__section-subtitle" size="xs" c="dimmed">
                  这是页面真实挂载的 DOM 观测，用来辅助判断标签页总内存是否主要来自图片预览、blob URL 或渲染层，而不是 Zustand store。
                </Text>
              </Stack>
            </PanelCard>

            <PanelCard className="agent-state-storage-panel__section">
              <Stack className="agent-state-storage-panel__section-stack" gap="sm">
                <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                  <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                    资源句柄大户
                  </Text>
                  <Badge className="agent-state-storage-panel__section-badge" variant="light" color="teal">
                    {`top ${formatCount(resourceEntryRows.length)}`}
                  </Badge>
                </Group>
                <div className="agent-state-storage-panel__table-wrap" style={{ overflowX: 'auto' }}>
                  <Table className="agent-state-storage-panel__table" striped highlightOnHover verticalSpacing="xs">
                    <Table.Thead className="agent-state-storage-panel__table-head">
                      <Table.Tr className="agent-state-storage-panel__table-head-row">
                        <Table.Th className="agent-state-storage-panel__table-head-cell">resource</Table.Th>
                        <Table.Th className="agent-state-storage-panel__table-head-cell">bytes</Table.Th>
                        <Table.Th className="agent-state-storage-panel__table-head-cell">ref</Table.Th>
                        <Table.Th className="agent-state-storage-panel__table-head-cell">transport</Table.Th>
                        <Table.Th className="agent-state-storage-panel__table-head-cell">owners</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody className="agent-state-storage-panel__table-body">
                      {resourceEntryRows.length === 0 ? (
                        <Table.Tr className="agent-state-storage-panel__table-empty-row">
                          <Table.Td className="agent-state-storage-panel__table-empty-cell" colSpan={5}>
                            <Text className="agent-state-storage-panel__table-empty-text" size="sm" c="dimmed">
                              当前没有资源句柄
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : resourceEntryRows.map((row) => (
                        <Table.Tr className="agent-state-storage-panel__table-row" key={row.id}>
                          <Table.Td className="agent-state-storage-panel__table-cell">
                            <Stack className="agent-state-storage-panel__node-cell" gap={2}>
                              <Text className="agent-state-storage-panel__node-label" size="sm" fw={600}>
                                {row.id}
                              </Text>
                              <Text className="agent-state-storage-panel__node-id" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                                {row.url}
                              </Text>
                              <Group className="agent-state-storage-panel__field-badges" gap={6} wrap="wrap">
                                <Badge className="agent-state-storage-panel__field-badge" size="xs" variant="light">
                                  {row.state}
                                </Badge>
                                <Badge className="agent-state-storage-panel__field-badge" size="xs" variant="outline">
                                  {row.priority}
                                </Badge>
                              </Group>
                            </Stack>
                          </Table.Td>
                          <Table.Td className="agent-state-storage-panel__table-cell">
                            <Text className="agent-state-storage-panel__node-size" size="sm" c="dimmed">
                              {formatBytes(row.estimatedBytes)}
                            </Text>
                          </Table.Td>
                          <Table.Td className="agent-state-storage-panel__table-cell">
                            <Text className="agent-state-storage-panel__node-size" size="sm" c="dimmed">
                              {formatCount(row.refCount)}
                            </Text>
                          </Table.Td>
                          <Table.Td className="agent-state-storage-panel__table-cell">
                            <Text className="agent-state-storage-panel__node-size" size="sm" c="dimmed">
                              {row.transport}
                            </Text>
                          </Table.Td>
                          <Table.Td className="agent-state-storage-panel__table-cell">
                            <Group className="agent-state-storage-panel__field-badges" gap={6} wrap="wrap">
                              {row.ownerNodeIds.length === 0 ? (
                                <Badge className="agent-state-storage-panel__field-badge" size="xs" variant="outline">
                                  no owner
                                </Badge>
                              ) : row.ownerNodeIds.map((ownerNodeId) => (
                                <Badge className="agent-state-storage-panel__field-badge" key={`${row.id}_${ownerNodeId}`} size="xs" variant="outline">
                                  {ownerNodeId}
                                </Badge>
                              ))}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
              </Stack>
            </PanelCard>
          </Group>

          <PanelCard className="agent-state-storage-panel__section">
            <Stack className="agent-state-storage-panel__section-stack" gap="sm">
              <Group className="agent-state-storage-panel__section-header" justify="space-between" align="center" wrap="wrap">
                <Text className="agent-state-storage-panel__section-title" size="sm" fw={700}>
                  Live Chat Run Store
                </Text>
                <Badge className="agent-state-storage-panel__section-badge" variant="light" color={activeLiveRun ? (activeLiveRun.status === 'running' ? 'orange' : activeLiveRun.status === 'succeeded' ? 'green' : 'red') : 'gray'}>
                  {activeLiveRun ? activeLiveRun.status : 'idle'}
                </Badge>
              </Group>
              {activeLiveRun ? (
                <>
                  <Group className="agent-state-storage-panel__live-badges" gap="xs" wrap="wrap">
                    <Badge className="agent-state-storage-panel__live-badge" variant="light">{`logs ${formatCount(activeLiveRun.logs.length)}`}</Badge>
                    <Badge className="agent-state-storage-panel__live-badge" variant="light">{`todo ${formatCount(activeLiveRun.todoItems.length)}`}</Badge>
                    <Badge className="agent-state-storage-panel__live-badge" variant="light">{`assets ${formatCount(activeLiveRun.assetCount)}`}</Badge>
                    <Badge className="agent-state-storage-panel__live-badge" variant="outline">{`preview ${formatCount(activeLiveRun.assistantPreview.length)} chars`}</Badge>
                  </Group>
                  <Group className="agent-state-storage-panel__live-size-grid" grow align="stretch">
                    {liveRunSectionSizes.map((item) => (
                      <MetricCard
                        key={item.label}
                        className={`agent-state-storage-panel__metric-card agent-state-storage-panel__metric-card--live-${item.label}`}
                        label={item.label}
                        value={formatBytes(item.bytes)}
                        hint={item.hint}
                      />
                    ))}
                  </Group>
                </>
              ) : (
                <Text className="agent-state-storage-panel__live-empty" size="sm" c="dimmed">
                  当前没有活动中的实时聊天运行态。
                </Text>
              )}
            </Stack>
          </PanelCard>
        </Stack>
      </ScrollArea>
    </Stack>
  )
}
