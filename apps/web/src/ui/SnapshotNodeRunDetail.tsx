import React from 'react'
import { Badge, Button } from '@mantine/core'
import { IconArrowUp, IconArrowsMaximize, IconArrowsMinimize, IconBook, IconBraces, IconFileText, IconInputSearch, IconPlayerPlay, IconTool, IconX } from '@tabler/icons-react'
import type { WorkflowExecutionEventMessage, WorkflowNodeRunDto, WorkflowNodeRunHistoryDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime'
import {
  toWorkflowNodeRunHistoryView,
  type WorkflowNodeRunHistoryView,
} from '../canvas/workflowNodeRunHistory'
import {
  readWorkflowAgentExecutionProvenanceHistory,
  readWorkflowKnowledgeSearchObservations,
  readWorkflowPromptExampleSearchObservations,
} from '../canvas/workflowAgentContext'
import { workflowNodeRunStatusLabel } from './workflowExecutionHistory'
import { JsonBrowser } from './execution-insights/JsonBrowser'
import type { WorkflowExecutionSnapshotNode } from './workflowExecutionSnapshotGraph'

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false })
}

function formatRunDuration(run: WorkflowNodeRunDto): string {
  if (typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs >= 0) {
    if (run.durationMs < 1_000) return `${Math.round(run.durationMs)} ms`
    if (run.durationMs < 60_000) return `${(run.durationMs / 1_000).toFixed(run.durationMs < 10_000 ? 1 : 0)} 秒`
    return `${Math.floor(run.durationMs / 60_000)} 分 ${Math.floor((run.durationMs % 60_000) / 1_000)} 秒`
  }
  const start = Date.parse(run.startedAt ?? run.createdAt)
  if (!Number.isFinite(start)) return '—'
  const finish = Date.parse(run.finishedAt ?? '')
  if (!Number.isFinite(finish)) {
    return run.status === 'running' || run.status === 'waiting_external' || run.status === 'queued' ? '进行中' : '—'
  }
  const durationMs = Math.max(0, finish - start)
  if (durationMs < 1_000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes} 分 ${seconds} 秒`
}

function statusColor(status: WorkflowNodeRunDto['status'] | null): string {
  if (status === 'success') return 'teal'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'blue'
  if (status === 'queued' || status === 'waiting_external') return 'yellow'
  return 'gray'
}

function toHistoryView(run: WorkflowNodeRunDto): WorkflowNodeRunHistoryView {
  const historyDto: WorkflowNodeRunHistoryDto = {
    ...run,
    executionStatus: 'running',
    executionCreatedAt: run.createdAt,
    executionFinishedAt: run.finishedAt ?? null,
  }
  return toWorkflowNodeRunHistoryView(historyDto)
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
}

function isEmptyOutput(view: WorkflowNodeRunHistoryView): boolean {
  return view.mediaAssets.length === 0
    && view.itemRuns.length === 0
    && isBlank(view.output)
    && isBlank(view.evidence)
}

function kindLabel(node: WorkflowExecutionSnapshotNode): string {
  const data = node.data as Record<string, unknown>
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : node.type
  if (kind === 'workflowStage') return '工作流阶段'
  if (kind === 'workflowTrigger') return '工作流入口'
  if (kind === 'io-in') return '入口'
  if (kind === 'io-out') return '出口'
  return kind || node.type || 'taskNode'
}

type InspectorTab = 'provider' | 'context' | 'items' | 'references' | 'upstream' | 'tools' | 'structure' | 'lineage' | 'raw'
type InputGroup = Readonly<{ id: string; label: string; items: readonly unknown[] }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function scalarLabel(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '未提供'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return prettyJson(value)
}

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} 项`
  if (isRecord(value)) return `${Object.keys(value).length} 个字段`
  if (value === null) return 'null'
  return typeof value
}

function StructuredValue(props: Readonly<{ value: unknown; depth?: number }>): React.JSX.Element {
  const depth = props.depth ?? 0
  const value = props.value
  if (value === null || value === undefined || typeof value !== 'object') {
    return <span className="workflow-snapshot-detail__value workflow-snapshot-detail__value--scalar">{scalarLabel(value)}</span>
  }
  if (depth >= 3) {
    return <details className="workflow-snapshot-detail__nested"><summary className="snapshot-node-run-detail__summary">{valueKind(value)}</summary><pre className="workflow-snapshot-detail__code-block">{prettyJson(value)}</pre></details>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="workflow-snapshot-detail__empty-value">空数组</span>
    return (
      <div className="workflow-snapshot-detail__value-list">
        {value.map((entry, index) => (
          <div className="workflow-snapshot-detail__value-row" key={`array-${index}`}>
            <span className="workflow-snapshot-detail__value-key">{index + 1}</span>
            <div className="workflow-snapshot-detail__value-content"><StructuredValue value={entry} depth={depth + 1} /></div>
          </div>
        ))}
      </div>
    )
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="workflow-snapshot-detail__empty-value">空对象</span>
  return (
    <div className="workflow-snapshot-detail__value-list">
      {entries.map(([key, entry]) => (
        <div className="workflow-snapshot-detail__value-row" key={key}>
          <span className="workflow-snapshot-detail__value-key">{key}</span>
          <div className="workflow-snapshot-detail__value-content"><StructuredValue value={entry} depth={depth + 1} /></div>
        </div>
      ))}
    </div>
  )
}

function DataCard(props: Readonly<{ title: string; value: unknown; hint?: string }>): React.JSX.Element {
  return (
    <details className="workflow-snapshot-detail__data-card">
      <summary className="workflow-snapshot-detail__data-card-summary">
        <span className="workflow-snapshot-detail__data-card-title">{props.title}</span>
        <span className="workflow-snapshot-detail__data-card-kind">{valueKind(props.value)}</span>
        <span className="workflow-snapshot-detail__data-card-chevron" aria-hidden="true" />
      </summary>
      <div className="workflow-snapshot-detail__data-card-content">
        {props.hint ? <p className="workflow-snapshot-detail__data-card-hint">{props.hint}</p> : null}
        <StructuredValue value={props.value} />
      </div>
    </details>
  )
}

function nestedRecords(value: unknown): readonly Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  const queue: unknown[] = [value]
  const seen = new Set<object>()
  while (queue.length > 0 && records.length < 10_000) {
    const current = queue.shift()
    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }
    if (!isRecord(current) || seen.has(current)) continue
    seen.add(current)
    records.push(current)
    queue.push(...Object.values(current))
  }
  return records
}

function referenceFacts(value: unknown): Readonly<{ skills: readonly unknown[]; knowledge: readonly unknown[]; candidates: readonly unknown[]; searches: readonly unknown[]; decisions: readonly unknown[] }> {
  const records = nestedRecords(value)
  const provenance = records.flatMap((record) => readWorkflowAgentExecutionProvenanceHistory(record))
  const skills = provenance.flatMap((entry) => [
    ...entry.requiredSkills.map((skill) => ({ name: skill, state: 'required' })),
    ...entry.loadedSkills,
    ...(entry.loadedSkillSources ?? []).map((source) => ({ name: source.name ?? source.skill, source: source.source, kind: source.sourceKind })),
    ...(entry.loadedSkillResources ?? []).map((resource) => ({ name: resource.skill, source: resource.resource, kind: 'resource' })),
  ])
  const knowledge = provenance.flatMap((entry) => entry.loadedKnowledgeSources ?? [])
  const candidates = records.flatMap((record) => Array.isArray(record.retrievalCandidateSets) ? record.retrievalCandidateSets : [])
  const searches = records.flatMap((record) => [
    ...readWorkflowKnowledgeSearchObservations(record),
    ...readWorkflowPromptExampleSearchObservations(record),
  ])
  return { skills, knowledge, candidates, searches, decisions: provenance.flatMap((entry) => entry.retrievalDecisions ?? []) }
}
type ReferenceFacts = ReturnType<typeof referenceFacts>

function uniqueReferenceValues(values: readonly unknown[]): readonly unknown[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    let key: string
    try {
      const serialized = JSON.stringify(value)
      key = serialized === undefined ? String(value) : serialized
    } catch {
      key = String(value)
    }
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function referenceTitle(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback
  for (const key of ['title', 'name', 'cardTitle', 'cardId', 'id']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return fallback
}

function referenceContent(value: unknown): string | null {
  if (!isRecord(value)) return null
  for (const key of ['content', 'text', 'body', '正文']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function mergeReferenceFacts(...facts: readonly ReferenceFacts[]): ReferenceFacts {
  return {
    decisions: uniqueReferenceValues(facts.flatMap((entry) => entry.decisions)),
    skills: uniqueReferenceValues(facts.flatMap((entry) => entry.skills)),
    knowledge: uniqueReferenceValues(facts.flatMap((entry) => entry.knowledge)),
    candidates: uniqueReferenceValues(facts.flatMap((entry) => entry.candidates)),
    searches: uniqueReferenceValues(facts.flatMap((entry) => entry.searches)),
  }
}

function sourceDocuments(value: unknown): readonly Record<string, unknown>[] {
  return nestedRecords(value).flatMap((record) => {
    if (!Array.isArray(record.authoritativeSources)) return []
    return record.authoritativeSources.filter((source): source is Record<string, unknown> => (
      isRecord(source) && typeof source.content === 'string' && source.content.trim().length > 0
    ))
  })
}

function upstreamRequestContexts(value: unknown): readonly Record<string, unknown>[] {
  return uniqueReferenceValues(
    nestedRecords(value).flatMap((record) => (
      Array.isArray(record.upstreamRequestContexts)
        ? record.upstreamRequestContexts.filter(isRecord)
        : []
    )),
  ).filter(isRecord)
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function knowledgeConsumptionEvidence(value: unknown): readonly Record<string, unknown>[] {
  const requests = Array.isArray(value) && value.every(isRecord)
    ? value.filter(isRecord)
    : upstreamRequestContexts(value)
  return requests.flatMap((request, requestIndex) => {
    const messages = Array.isArray(request.messages)
      ? request.messages.filter(isRecord)
      : []
    return messages.flatMap((message, messageIndex) => {
      if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) return []
      return message.toolCalls.flatMap((rawToolCall) => {
        if (!isRecord(rawToolCall) || (rawToolCall.name !== 'knowledge_read' && rawToolCall.name !== 'prompt_example_read')) return []
        const args = parseJsonRecord(rawToolCall.arguments)
        const toolCallId = typeof rawToolCall.id === 'string' ? rawToolCall.id : null
        const resultMessage = toolCallId
          ? messages.find((candidate) => candidate.role === 'tool' && candidate.toolCallId === toolCallId)
          : undefined
        const resultRecord = parseJsonRecord(resultMessage?.content)
        return [{
          requestSequence: request.sequence ?? requestIndex + 1,
          messageIndex,
          toolCallId,
          tool: rawToolCall.name,
          cardId: args?.cardId ?? null,
          candidateSetId: args?.candidateSetId ?? null,
          consumed: Boolean(resultRecord && resultRecord.id === args?.cardId && typeof resultRecord.body === 'string' && resultRecord.body.length > 0),
          result: resultRecord ?? resultMessage?.content ?? null,
        }]
      })
    })
  })
}

type RuntimeReferenceStatus = Readonly<{
  label: string
  color: string
  description: string
  searchAttemptCount: number
  searchFailureCount: number
  candidateCount: number
  actualReadCount: number
}>

function nonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function runtimeReferenceStatus(node: WorkflowExecutionSnapshotNode): RuntimeReferenceStatus | null {
  const data = node.data as Record<string, unknown>
  if (data.workflowRuntimeReferenceAggregate !== true) return null
  const evidenceState = typeof data.workflowRuntimeReferenceEvidenceState === 'string'
    ? data.workflowRuntimeReferenceEvidenceState
    : 'available'
  const description = typeof data.workflowRuntimeReferenceDescription === 'string'
    && data.workflowRuntimeReferenceDescription.trim()
    ? data.workflowRuntimeReferenceDescription.trim()
    : '本轮没有参考证据'
  const label = evidenceState === 'actual_read'
    ? '已读取'
    : evidenceState === 'searched'
      ? '已检索'
      : evidenceState === 'search_failed'
        ? '检索异常'
        : evidenceState === 'unrecorded'
          ? '证据未采集'
        : '未使用'
  return {
    label,
    color: evidenceState === 'actual_read' || evidenceState === 'searched'
      ? 'teal'
      : evidenceState === 'search_failed'
        ? 'yellow'
        : evidenceState === 'unrecorded'
          ? 'yellow'
        : 'gray',
    description,
    searchAttemptCount: nonNegativeCount(data.workflowRuntimeReferenceSearchAttemptCount),
    searchFailureCount: nonNegativeCount(data.workflowRuntimeReferenceSearchFailureCount),
    candidateCount: nonNegativeCount(data.workflowRuntimeReferenceCandidateCount),
    actualReadCount: nonNegativeCount(data.workflowRuntimeReferenceActualReadCount),
  }
}

export function SnapshotNodeRunDetail(props: Readonly<{
  node: WorkflowExecutionSnapshotNode
  run: WorkflowNodeRunDto | null
  executionId: string
  nodeLabelById?: Readonly<Record<string, string>>
  onClose: () => void
  onOpenLog?: (executionId: string) => void
  onRecover?: (nodeId: string) => Promise<void>
  events?: readonly WorkflowExecutionEventMessage[]
}>): React.JSX.Element {
  const { node, run } = props
  const nodeEvents = (props.events ?? []).filter((event) => {
    if (!isRecord(event.data)) return false
    const nodeId = typeof event.data.nodeId === 'string' ? event.data.nodeId : typeof event.data.workflowNodeId === 'string' ? event.data.workflowNodeId : ''
    return Boolean(nodeId) && (nodeId === node.id || nodeId === String((node.data as Record<string, unknown>).workflowNodeId ?? ''))
  })
  const view = run ? toHistoryView(run) : null
  const errorMessage = run?.errorMessage?.trim() || view?.errorMessage || null
  const hasMedia = view !== null && view.mediaAssets.length > 0
  const referenceStatus = runtimeReferenceStatus(node)
  const displayedStatus = run
    ? workflowNodeRunStatusLabel(run.status, run.outputRefs)
    : referenceStatus?.label ?? '未运行'
  const displayedStatusColor = run ? statusColor(run.status) : referenceStatus?.color ?? 'gray'
  const [activeTab, setActiveTab] = React.useState<InspectorTab>('context')
  const [eventFilter, setEventFilter] = React.useState('all')
  const expanded = true
  const [fullscreen, setFullscreen] = React.useState(false)
  const [selectedInputId, setSelectedInputId] = React.useState('all')
  const [selectedDocumentIndex, setSelectedDocumentIndex] = React.useState(0)
  const [inputExpanded, setInputExpanded] = React.useState(false)
  const [outputExpanded, setOutputExpanded] = React.useState(false)
  React.useEffect(() => {
    setActiveTab('context')
    setFullscreen(false)
    setSelectedInputId('all')
    setSelectedDocumentIndex(0)
  }, [node.id, run?.id])
  const visibleNodeEvents = eventFilter === 'all' ? nodeEvents : nodeEvents.filter((event) => event.event === eventFilter)

  const outputPorts = view?.output
  const inputRefs = run?.inputRefs
  const toolCalls = run?.toolCalls
  const itemCount = view?.itemRuns.length ?? 0
  const hasOutputData = Boolean(view && (!isEmptyOutput(view) || hasMedia))
  React.useEffect(() => {
    setInputExpanded(inputRefs !== undefined)
    setOutputExpanded(hasOutputData)
  }, [hasOutputData, inputRefs, node.id, run?.id])
  const inputSources = view?.provenance?.inputBindings.map((binding) => ({
    ...binding,
    sourceNode: props.nodeLabelById?.[binding.sourceNodeId] ?? binding.sourceNodeId,
  }))
  const inputGroups = React.useMemo<readonly InputGroup[]>(() => {
    if (inputRefs === undefined) return []
    if (isRecord(inputRefs)) {
      return Object.entries(inputRefs).map(([label, value]) => ({
        id: `port:${label}`,
        label,
        items: Array.isArray(value) ? value : [value],
      }))
    }
    return [{ id: 'input', label: '输入', items: Array.isArray(inputRefs) ? inputRefs : [inputRefs] }]
  }, [inputRefs])
  const itemSelectionMarker = ':item:'
  const itemSelectionMarkerIndex = selectedInputId.lastIndexOf(itemSelectionMarker)
  const selectedItemGroupId = itemSelectionMarkerIndex >= 0 ? selectedInputId.slice(0, itemSelectionMarkerIndex) : null
  const selectedItemIndex = itemSelectionMarkerIndex >= 0 ? Number(selectedInputId.slice(itemSelectionMarkerIndex + itemSelectionMarker.length)) : null
  const selectedInputLabel = selectedInputId === 'all'
    ? '全部输入'
    : inputGroups.flatMap((group) => group.items.map((_, index) => ({ id: `${group.id}:item:${index}`, label: `${group.label} · item ${index + 1}` })).concat([{ id: group.id, label: group.label }])).find((entry) => entry.id === selectedInputId)?.label ?? '全部输入'
  const selectedItemGroupIndex = selectedItemGroupId === null ? -1 : inputGroups.findIndex((group) => group.id === selectedItemGroupId)
  const selectedItemRunIndex = selectedItemGroupIndex >= 0 && selectedItemIndex !== null && Number.isInteger(selectedItemIndex)
    ? inputGroups.slice(0, selectedItemGroupIndex).reduce((sum, group) => sum + group.items.length, 0) + selectedItemIndex
    : null
  const selectedItemRun = selectedItemRunIndex !== null
    ? view?.itemRuns[selectedItemRunIndex] ?? null
    : null
  const selectedItemPayload = selectedItemRunIndex !== null
    ? view?.itemRunPayload[selectedItemRunIndex]
    : undefined
  const selectedReferenceFacts = referenceFacts(selectedItemPayload)
  const allReferenceFacts = mergeReferenceFacts(
    referenceFacts(run?.outputRefs),
    ...(view?.itemRunPayload ?? []).map((item) => referenceFacts(item)),
  )
  const displayedInputSources = inputSources ?? []
  const inputDocuments = sourceDocuments(inputRefs)
  const inputReferenceDocuments = sourceDocuments(run?.outputRefs)
  const sourceDocumentsForDisplay = uniqueReferenceValues([
    ...inputDocuments,
    ...inputReferenceDocuments,
  ]).filter(isRecord)
  const displayedKnowledgeDocuments = uniqueReferenceValues([
    ...allReferenceFacts.knowledge,
  ])
  const selectedUpstreamRequestContexts = upstreamRequestContexts(selectedItemPayload)
  const displayedUpstreamRequestContexts = selectedItemRunIndex !== null
    ? selectedUpstreamRequestContexts
    : upstreamRequestContexts(run?.outputRefs)
  const displayedKnowledgeConsumption = knowledgeConsumptionEvidence(displayedUpstreamRequestContexts)
  const referenceCount = selectedItemRunIndex !== null
    ? selectedReferenceFacts.skills.length + selectedReferenceFacts.knowledge.length + selectedReferenceFacts.candidates.length + selectedReferenceFacts.searches.length + selectedReferenceFacts.decisions.length
    : allReferenceFacts.skills.length + allReferenceFacts.knowledge.length + allReferenceFacts.candidates.length + allReferenceFacts.searches.length + allReferenceFacts.decisions.length
  const tabs: ReadonlyArray<Readonly<{ id: InspectorTab; label: string; count?: number; icon: React.ReactNode }>> = [
    { id: 'provider', label: '供应商诊断', icon: <IconTool className="snapshot-node-run-detail__icontool" size={14} /> },
    { id: 'context', label: '上下文', icon: <IconPlayerPlay className="snapshot-node-run-detail__iconplayerplay" size={14} /> },
    { id: 'items', label: '单条数据', count: itemCount, icon: <IconBraces className="snapshot-node-run-detail__iconbraces" size={14} /> },
    { id: 'references', label: 'Skills/知识库', count: referenceCount, icon: <IconBook className="snapshot-node-run-detail__iconbook" size={14} /> },
    { id: 'upstream', label: '上游请求', count: displayedUpstreamRequestContexts.length, icon: <IconBraces className="snapshot-node-run-detail__iconbraces" size={14} /> },
    { id: 'tools', label: '工具调用', count: Array.isArray(toolCalls) ? toolCalls.length : undefined, icon: <IconTool className="snapshot-node-run-detail__icontool" size={14} /> },
    { id: 'structure', label: '输入输出', icon: <IconBraces className="snapshot-node-run-detail__iconbraces" size={14} /> },
    { id: 'lineage', label: '资产血缘', count: view?.mediaAssets.length ?? 0, icon: <IconArrowUp className="snapshot-node-run-detail__iconarrowup" size={14} /> },
    { id: 'raw', label: '原始', icon: <IconBraces className="snapshot-node-run-detail__iconbraces" size={14} /> },
  ]

  return (
    <aside className={`workflow-snapshot-detail nodrag nopan ${expanded ? 'is-expanded' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} aria-label="节点运行结果与过程" data-ux-panel>
      <header className="workflow-snapshot-detail__header">
        <div className="workflow-snapshot-detail__identity">
          <strong className="workflow-snapshot-detail__title">{String((node.data as Record<string, unknown>).label ?? '') || node.id}</strong>
          <span className="workflow-snapshot-detail__kind">{kindLabel(node)}</span>
        </div>
        <div className="workflow-snapshot-detail__header-actions">
          <Badge className="workflow-snapshot-detail__status" size="sm" variant="light" color={displayedStatusColor}>
            {displayedStatus}
          </Badge>
          {run ? (
            <Badge className="workflow-snapshot-detail__duration" size="sm" variant="outline" color="gray" title="该节点从开始到结束的实际耗时">
              耗时 {formatRunDuration(run)}
            </Badge>
          ) : null}
          {run && run.retryCount && run.retryCount > 0 ? (
            <Badge className="workflow-snapshot-detail__retry-count" size="sm" variant="outline" color="yellow" title="该节点发生过的重试次数">
              重试 {run.retryCount} 次
            </Badge>
          ) : null}
          <button className="workflow-snapshot-detail__expand" type="button" aria-label={fullscreen ? '退出全屏节点详情' : '全屏查看节点详情'} onClick={() => setFullscreen((value) => !value)}>
            {fullscreen ? <IconArrowsMinimize className="snapshot-node-run-detail__iconarrowsminimize" size={15} /> : <IconArrowsMaximize className="snapshot-node-run-detail__iconarrowsmaximize" size={15} />}
          </button>
          <button className="workflow-snapshot-detail__close" type="button" aria-label="关闭节点详情" onClick={props.onClose}>
            <IconX className="workflow-snapshot-detail__close-icon" size={15} />
          </button>
        </div>
      </header>

      <div className="workflow-snapshot-detail__body">
        <section className="workflow-snapshot-detail__section" aria-label="运行过程">
          <h3 className="workflow-snapshot-detail__section-title">执行概览</h3>
          <dl className="workflow-snapshot-detail__facts">
            <div className="workflow-snapshot-detail__fact">
              <dt className="snapshot-node-run-detail__dt">状态</dt>
              <dd className="snapshot-node-run-detail__dd">{run
                ? workflowNodeRunStatusLabel(run.status, run.outputRefs)
                : referenceStatus?.description ?? '该节点在这次执行中没有运行记录'}</dd>
            </div>
            {!run && referenceStatus ? (
              <>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">节点性质</dt>
                  <dd className="snapshot-node-run-detail__dd">Agent 运行证据聚合视图，不是独立 DAG 执行节点</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">检索尝试</dt>
                  <dd className="snapshot-node-run-detail__dd">{referenceStatus.searchAttemptCount} 次（{referenceStatus.searchFailureCount} 次异常）</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">案例候选</dt>
                  <dd className="snapshot-node-run-detail__dd">{referenceStatus.candidateCount} 项</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">正文读取</dt>
                  <dd className="snapshot-node-run-detail__dd">{referenceStatus.actualReadCount} 项</dd>
                </div>
              </>
            ) : null}
            {run ? (
              <>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">执行身份</dt>
                  <dd className="snapshot-node-run-detail__dd"><code className="workflow-snapshot-detail__code">{run.id}</code></dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">尝试</dt>
                  <dd className="snapshot-node-run-detail__dd">第 {run.attempt} 次</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">创建</dt>
                  <dd className="snapshot-node-run-detail__dd">{formatTime(run.createdAt)}</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">开始</dt>
                  <dd className="snapshot-node-run-detail__dd">{formatTime(run.startedAt)}</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">结束</dt>
                  <dd className="snapshot-node-run-detail__dd">{formatTime(run.finishedAt)}</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt className="snapshot-node-run-detail__dt">耗时</dt>
                  <dd className="snapshot-node-run-detail__dd">{formatRunDuration(run)}</dd>
                </div>
				{view && view.configuredItemConcurrency > 0 ? (
					<>
						<div className="workflow-snapshot-detail__fact">
							<dt className="snapshot-node-run-detail__dt">逐项进度</dt>
							<dd className="snapshot-node-run-detail__dd">{view.startedItems}/{view.totalItems} 已启动，{view.completedItems} 完成，{view.waitingItems} 等待供应商</dd>
						</div>
						<div className="workflow-snapshot-detail__fact">
							<dt className="snapshot-node-run-detail__dt">真实并发</dt>
							<dd className="snapshot-node-run-detail__dd">{view.activeItems} 活动 / {view.configuredItemConcurrency} 配置，峰值 {view.peakActiveItems}</dd>
						</div>
					</>
				) : null}
              </>
            ) : null}
          </dl>
          {errorMessage ? (
            <p className="workflow-snapshot-detail__error">{errorMessage}</p>
          ) : null}
        </section>
        {nodeEvents.length > 0 ? (
          <section className="workflow-snapshot-detail__section" aria-label="实时事件">
            <div className="workflow-snapshot-detail__section-heading">
              <h3 className="workflow-snapshot-detail__section-title">实时事件 ({visibleNodeEvents.length}/{nodeEvents.length})</h3>
              <select className="workflow-snapshot-detail__event-filter" aria-label="事件类型筛选" value={eventFilter} onChange={(event) => setEventFilter(event.currentTarget.value)}>
                <option className="snapshot-node-run-detail__option" value="all">全部</option>
                <option className="snapshot-node-run-detail__option" value="status">状态</option>
                <option className="snapshot-node-run-detail__option" value="tool_call">工具调用</option>
                <option className="snapshot-node-run-detail__option" value="artifact">产物</option>
                <option className="snapshot-node-run-detail__option" value="diagnostic">诊断</option>
              </select>
            </div>
            <ol className="workflow-snapshot-detail__event-list">
              {visibleNodeEvents.slice(-20).map((event) => (
                <li className="workflow-snapshot-detail__event" key={`${event.id}-${event.event}`}>
                  <time className="snapshot-node-run-detail__time" dateTime={event.id}>{event.event}</time>
                  <details className="snapshot-node-run-detail__details">
                    <summary className="snapshot-node-run-detail__summary">查看事件数据</summary>
                    <pre className="snapshot-node-run-detail__pre">{typeof event.data === 'string' ? event.data : prettyJson(event.data)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section className="workflow-snapshot-detail__inspector" aria-label="节点数据检查器">
          <div className="workflow-snapshot-detail__inspector-heading">
            <div className="snapshot-node-run-detail__div">
              <h3 className="workflow-snapshot-detail__section-title">主要结果</h3>
              <p className="workflow-snapshot-detail__section-hint">输入与输出是本节点本次运行的核心数据</p>
            </div>
            {hasOutputData ? <span className="workflow-snapshot-detail__result-state">已产生输出</span> : null}
          </div>
          <div className="workflow-snapshot-detail__io-grid">
            <details className="workflow-snapshot-detail__io-card workflow-snapshot-detail__io-card--input" aria-label="节点输入" open={inputExpanded} onToggle={(event) => setInputExpanded(event.currentTarget.open)}>
              <summary className="workflow-snapshot-detail__io-card-head"><span className="snapshot-node-run-detail__span"><IconInputSearch className="snapshot-node-run-detail__iconinputsearch" size={14} />输入</span><em className="snapshot-node-run-detail__em">{inputRefs === undefined ? (displayedInputSources.length > 0 ? `${displayedInputSources.length} 条来源绑定` : '未记录') : valueKind(inputRefs)}</em></summary>
              <div className="workflow-snapshot-detail__io-card-body">
                {inputRefs === undefined && displayedInputSources.length === 0 && displayedUpstreamRequestContexts.length === 0 && sourceDocumentsForDisplay.length === 0 ? <p className="workflow-snapshot-detail__empty">该节点没有记录输入数据。</p> : (
                  <div className="workflow-snapshot-detail__input-browser">
                    {inputRefs !== undefined ? <div className="workflow-snapshot-detail__input-tree" role="tree" aria-label="输入数据分组">
                      <button className={`workflow-snapshot-detail__input-tree-row ${selectedInputId === 'all' ? 'is-selected' : ''}`} type="button" role="treeitem" aria-selected={selectedInputId === 'all'} onClick={() => setSelectedInputId('all')}>
                        <span className="workflow-snapshot-detail__input-tree-label">全部输入</span><em className="snapshot-node-run-detail__em">{inputGroups.reduce((sum, group) => sum + group.items.length, 0)}</em>
                      </button>
                      {inputGroups.map((group) => (
                        <div className="workflow-snapshot-detail__input-tree-group" key={group.id}>
                          <button className={`workflow-snapshot-detail__input-tree-row ${selectedInputId === group.id ? 'is-selected' : ''}`} type="button" role="treeitem" aria-selected={selectedInputId === group.id} onClick={() => setSelectedInputId(group.id)}>
                            <span className="workflow-snapshot-detail__input-tree-label">{group.label}</span><em className="snapshot-node-run-detail__em">{group.items.length}</em>
                          </button>
                          {group.items.map((_, index) => {
                            const itemId = `${group.id}:item:${index}`
                            return <button className={`workflow-snapshot-detail__input-tree-row workflow-snapshot-detail__input-tree-row--item ${selectedInputId === itemId ? 'is-selected' : ''}`} type="button" role="treeitem" aria-selected={selectedInputId === itemId} key={itemId} onClick={() => setSelectedInputId(itemId)}><span className="workflow-snapshot-detail__input-tree-label">item {index + 1}</span><em className="snapshot-node-run-detail__em">{valueKind(group.items[index])}</em></button>
                          })}
                        </div>
                      ))}
                    </div> : <p className="workflow-snapshot-detail__data-card-hint">节点没有单独保存 inputRefs，下面展示执行时冻结的来源绑定。</p>}
                    {displayedInputSources.length > 0 ? <details className="workflow-snapshot-detail__io-sources"><summary className="snapshot-node-run-detail__summary">输入来源 · {displayedInputSources.length} 条</summary><StructuredValue value={displayedInputSources} /></details> : null}
                    <div className="workflow-snapshot-detail__context-block">
                      <div className="workflow-snapshot-detail__context-block-head">
                        <strong className="snapshot-node-run-detail__strong">发送给模型 API 的完整上下文</strong>
                        <span className="snapshot-node-run-detail__span">{displayedUpstreamRequestContexts.length} 轮</span>
                      </div>
                      {displayedUpstreamRequestContexts.length > 0
                        ? displayedUpstreamRequestContexts.map((request, index) => <DataCard key={`input-context-${index}`} title={`请求上下文 · 第 ${String(request.sequence ?? index + 1)} 轮`} value={request} />)
                        : <p className="workflow-snapshot-detail__empty">本次运行没有持久化完整上游请求上下文。</p>}
                    </div>
                    {sourceDocumentsForDisplay.length > 0 ? <div className="workflow-snapshot-detail__document-block">
                      <div className="workflow-snapshot-detail__context-block-head"><strong className="snapshot-node-run-detail__strong">引用文档</strong><span className="snapshot-node-run-detail__span">{sourceDocumentsForDisplay.length} 篇</span></div>
                      <div className="workflow-snapshot-detail__document-layout">
                        <div className="workflow-snapshot-detail__document-tags" role="list" aria-label="引用文档">
                          {sourceDocumentsForDisplay.map((document, index) => <button className={`workflow-snapshot-detail__document-tag ${selectedDocumentIndex === index ? 'is-selected' : ''}`} type="button" role="listitem" aria-pressed={selectedDocumentIndex === index} key={`document-${index}`} onClick={(event) => { event.stopPropagation(); setSelectedDocumentIndex(index) }}>{String(document.title ?? document.name ?? document.id ?? `文档 ${index + 1}`)}</button>)}
                        </div>
                        <div className="workflow-snapshot-detail__document-preview">
                          <div className="workflow-snapshot-detail__document-preview-head">{String(sourceDocumentsForDisplay[selectedDocumentIndex]?.title ?? sourceDocumentsForDisplay[selectedDocumentIndex]?.name ?? `文档 ${selectedDocumentIndex + 1}`)}</div>
                          <pre className="snapshot-node-run-detail__pre">{String(sourceDocumentsForDisplay[selectedDocumentIndex]?.content ?? '')}</pre>
                        </div>
                      </div>
                    </div> : null}
                  </div>
                )}
              </div>
            </details>
            <details className="workflow-snapshot-detail__io-card workflow-snapshot-detail__io-card--output" aria-label="节点输出" open={outputExpanded} onToggle={(event) => setOutputExpanded(event.currentTarget.open)}>
              <summary className="workflow-snapshot-detail__io-card-head"><span className="snapshot-node-run-detail__span"><IconArrowUp className="snapshot-node-run-detail__iconarrowup" size={14} />输出</span><em className="snapshot-node-run-detail__em">{hasOutputData ? '已产生' : '未产生'}</em></summary>
              <div className="workflow-snapshot-detail__io-card-body">
                {selectedItemRun ? <div className="workflow-snapshot-detail__selected-item-output"><span className="snapshot-node-run-detail__span">对应单条输出 · {selectedItemRun.itemId}</span>{selectedItemRun.videoUrl ? <video className="workflow-snapshot-detail__item-run-video" src={selectedItemRun.videoUrl} controls preload="metadata" /> : selectedItemRun.textOutput ? <div className="workflow-snapshot-detail__item-run-text">{selectedItemRun.textOutput}</div> : <StructuredValue value={selectedItemRun.output} />}</div> : null}
                {view?.itemRuns.length ? <div className="workflow-snapshot-detail__output-items"><div className="workflow-snapshot-detail__context-block-head"><strong className="snapshot-node-run-detail__strong">items[]</strong><span className="snapshot-node-run-detail__span">{view.itemRuns.length} 项</span></div>{view.itemRuns.map((item) => <div className={`workflow-snapshot-detail__output-item workflow-snapshot-detail__output-item--${item.status}`} key={`output-item-${item.runtimeNodeId}`}><span className="snapshot-node-run-detail__span">item {item.index + 1}</span>{item.textOutput ? <div className="snapshot-node-run-detail__div">{item.textOutput}</div> : <StructuredValue value={item.output} />}</div>)}</div> : null}
                {hasMedia ? <ul className="workflow-snapshot-detail__assets">{view?.mediaAssets.map((asset) => <li className={`workflow-snapshot-detail__asset workflow-snapshot-detail__asset--${asset.kind}`} key={asset.url}>{asset.kind === 'image' ? <ManagedImage className="workflow-snapshot-detail__asset-image" src={asset.url} alt={String((node.data as Record<string, unknown>).label ?? '') || node.id} priority="visible" ownerNodeId={node.id} ownerSurface="task-node-skeleton" ownerRequestKey={`snapshot-run-asset:${node.id}:${asset.url}`} draggable={false} decoding="async" referrerPolicy="no-referrer" /> : asset.kind === 'video' ? <video className="workflow-snapshot-detail__asset-video" src={asset.url} controls preload="metadata" /> : <audio className="workflow-snapshot-detail__asset-audio" src={asset.url} controls preload="metadata" />}<span className="workflow-snapshot-detail__asset-meta">{asset.kind}{asset.durationSeconds != null ? ` · ${Math.round(asset.durationSeconds)}s` : ''}</span></li>)}</ul> : null}
                {outputPorts !== undefined ? <StructuredValue value={outputPorts} /> : null}
                {view?.evidence !== undefined ? <details className="workflow-snapshot-detail__io-sources"><summary className="snapshot-node-run-detail__summary">交付证据</summary><StructuredValue value={view.evidence} /></details> : null}
                {!hasMedia && outputPorts === undefined && view?.evidence === undefined ? <p className="workflow-snapshot-detail__empty">本次运行没有声明可展示的输出。</p> : null}
                {run && view && !hasMedia && view.itemRuns.length === 0 && isEmptyOutput(view) && run.status !== 'failed' ? <p className="workflow-snapshot-detail__empty">本次运行成功，但执行器没有声明输出端口。</p> : null}
              </div>
            </details>
          </div>
          <nav className="workflow-snapshot-detail__tabs" aria-label="节点数据分类">
            {tabs.map((tab) => (
              <button
                className={`workflow-snapshot-detail__tab ${activeTab === tab.id ? 'is-active' : ''}`}
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}<span className="snapshot-node-run-detail__span">{tab.label}</span>{tab.count !== undefined ? <em className="snapshot-node-run-detail__em">{tab.count}</em> : null}
              </button>
            ))}
          </nav>
          <div className="workflow-snapshot-detail__tab-content">
            {activeTab === 'provider' ? (
              <div className="workflow-snapshot-detail__references"><p className="workflow-snapshot-detail__data-card-hint">供应商信息来自节点持久化运行记录和工具回执；未记录的字段保持未记录。</p><DataCard title="调用身份" value={{ provider: run?.toolName ?? null, model: run?.modelKey ?? null, nodeType: run?.nodeType ?? null, attempt: run?.attempt ?? null, retryCount: run?.retryCount ?? 0 }} /><DataCard title="供应商错误" value={{ errorCode: run?.errorCode ?? null, errorMessage: run?.errorMessage ?? null, failureStage: run?.failureStage ?? null }} /><DataCard title="工具回执" value={toolCalls ?? []} /></div>
            ) : null}
            {activeTab === 'context' ? (
              <>
                <DataCard title="节点配置上下文" value={node.data} hint="执行时冻结的节点配置；它决定了本节点的输入端口、处理方式与输出声明。" />
                <DataCard title="运行上下文" value={{ nodeId: node.id, nodeType: run?.nodeType ?? node.type, executionId: props.executionId, attempt: run?.attempt ?? null, model: run?.modelKey ?? null, tool: run?.toolName ?? null }} />
              </>
            ) : null}
            {activeTab === 'items' ? (
              itemCount > 0 ? <ol className="workflow-snapshot-detail__item-runs">{view?.itemRuns.map((item) => <li className={`workflow-snapshot-detail__item-run workflow-snapshot-detail__item-run--${item.status}`} key={item.runtimeNodeId}><div className="workflow-snapshot-detail__item-run-head"><span className="workflow-snapshot-detail__item-run-index">#{item.index + 1}</span><strong className="workflow-snapshot-detail__item-run-id">{item.itemId}</strong><span className="workflow-snapshot-detail__item-run-status">{item.status === 'success' ? '完成' : item.status === 'waiting_external' ? '等待外部结果' : item.status === 'running' ? '运行中' : '失败'}</span></div>{item.videoUrl ? <video className="workflow-snapshot-detail__item-run-video" src={item.videoUrl} controls preload="metadata" /> : item.textOutput ? <div className="workflow-snapshot-detail__item-run-text">{item.textOutput}</div> : <StructuredValue value={item.output} />}{item.errorMessage ? <p className="workflow-snapshot-detail__error">{item.errorMessage}</p> : null}</li>)}</ol> : <p className="workflow-snapshot-detail__empty">本节点没有逐条处理记录。</p>
            ) : null}
            {activeTab === 'references' ? (
              <div className="workflow-snapshot-detail__references">
                <p className="workflow-snapshot-detail__data-card-hint">这里显示 Agent 在当前节点或当前 item 上实际加载的 Skill、读取的知识库正文，以及检索回执。没有逐项记录时，使用节点级执行证据；选中左侧具体 item 后，内容会切换到该 item。</p>
                <DataCard title={selectedItemRunIndex !== null ? `${selectedInputLabel} · Skill` : '全部 item · Skill'} value={selectedItemRunIndex !== null ? selectedReferenceFacts.skills : allReferenceFacts.skills} />
                <div className="workflow-snapshot-detail__knowledge-documents">
                  <div className="workflow-snapshot-detail__context-block-head"><strong className="snapshot-node-run-detail__strong">{selectedItemRunIndex !== null ? `${selectedInputLabel} · 知识库正文` : '全部 item · 知识库正文'}</strong><span className="snapshot-node-run-detail__span">{(selectedItemRunIndex !== null ? selectedReferenceFacts.knowledge : displayedKnowledgeDocuments).length} 项</span></div>
                  {(selectedItemRunIndex !== null ? selectedReferenceFacts.knowledge : displayedKnowledgeDocuments).length > 0
                    ? (selectedItemRunIndex !== null ? selectedReferenceFacts.knowledge : displayedKnowledgeDocuments).map((entry, index) => {
                      const content = referenceContent(entry)
                      return <details className="workflow-snapshot-detail__knowledge-document" key={`knowledge-document-${index}`}><summary className="snapshot-node-run-detail__summary"><span className="snapshot-node-run-detail__span">{referenceTitle(entry, `知识正文 ${index + 1}`)}</span><em className="snapshot-node-run-detail__em">{content ? `${content.length} 字` : '读取记录'}</em></summary><div className="workflow-snapshot-detail__knowledge-document-body">{content ? <p className="snapshot-node-run-detail__p">{content}</p> : null}<StructuredValue value={entry} /></div></details>
                    })
                    : <p className="workflow-snapshot-detail__empty">本次运行没有记录可展示的知识库正文。</p>}
                </div>
                <DataCard title="知识取舍记录" value={selectedItemRunIndex !== null ? selectedReferenceFacts.decisions : allReferenceFacts.decisions} hint="保存 Agent 当时的原始取舍说明与请求的工具调用；请求读取不代表读取成功，读取成功也不等于已采纳。没有记录时不推测弃选原因。" />
                <DataCard title={selectedItemRunIndex !== null ? `${selectedInputLabel} · 知识候选` : '全部 item · 知识候选'} value={selectedItemRunIndex !== null ? selectedReferenceFacts.candidates : allReferenceFacts.candidates} hint="这里是检索返回的候选知识卡元数据，表示找到候选，不代表正文已经进入模型上下文。" />
                <DataCard title={selectedItemRunIndex !== null ? `${selectedInputLabel} · 召回回执` : '全部 item · 召回回执'} value={selectedItemRunIndex !== null ? selectedReferenceFacts.searches : allReferenceFacts.searches} />
              </div>
            ) : null}
            {activeTab === 'upstream' ? (
              <div className="workflow-snapshot-detail__references">
                <p className="workflow-snapshot-detail__data-card-hint">这里是实际发送给上游模型的请求快照，不是节点配置摘要。每一轮包含最终 system、模型实际收到的 messages、工具定义和响应格式；下面展开 knowledge_read / prompt_example_read 的调用与返回；仅返回匹配卡片的非空正文才记录为已读取，读取不等于已采纳。</p>
                <DataCard title="知识卡消费依据" value={displayedKnowledgeConsumption} hint="consumed=true 表示同一请求上下文中已找到 knowledge_read 的工具返回；返回内容包含知识卡正文时，才可确认正文进入了后续模型上下文。" />
                {displayedUpstreamRequestContexts.length > 0 ? displayedUpstreamRequestContexts.map((request, index) => (
                  <DataCard key={`upstream-request-${index}`} title={`上游模型请求 · 第 ${String(request.sequence ?? index + 1)} 轮`} value={request} />
                )) : <p className="workflow-snapshot-detail__empty">本次节点运行没有持久化上游请求快照。旧运行只能依据已有的 Skill、候选集、召回回执和正文读取 provenance 判断，无法补造模型当时看到的完整上下文。</p>}
              </div>
            ) : null}
            {activeTab === 'structure' ? (
              <div className="workflow-snapshot-detail__references"><p className="workflow-snapshot-detail__data-card-hint">结构化浏览器使用节点持久化的真实输入、输出和证据；字段路径采用 JSON Pointer，可复制给后续诊断。</p><JsonBrowser label="输入" path="/inputRefs" value={inputRefs ?? null} /><JsonBrowser label="输出" path="/outputRefs" value={run?.outputRefs ?? null} /><JsonBrowser label="工具调用" path="/toolCalls" value={toolCalls ?? []} /></div>
            ) : null}
            {activeTab === 'lineage' ? (
              <div className="workflow-snapshot-detail__references"><p className="workflow-snapshot-detail__data-card-hint">血缘只显示持久化 provenance 和真实资产 URL；没有协议证据的关系不会被猜测。</p><DataCard title="当前节点 provenance" value={view?.provenance ?? '未记录'} /><DataCard title="产出资产" value={view?.mediaAssets ?? []} /><DataCard title="资产身份" value={view?.artifactIds ?? []} /></div>
            ) : null}
            {activeTab === 'tools' ? (
              Array.isArray(toolCalls) && toolCalls.length > 0 ? <div className="workflow-snapshot-detail__tool-list">{toolCalls.map((call, index) => <DataCard key={`tool-${index}`} title={`调用 ${index + 1}`} value={call} />)}</div> : <p className="workflow-snapshot-detail__empty">本节点没有记录工具调用。</p>
            ) : null}
            {activeTab === 'raw' ? <pre className="workflow-snapshot-detail__code-block workflow-snapshot-detail__raw">{prettyJson({ node: node.data, run })}</pre> : null}
          </div>
          <p className="workflow-snapshot-detail__snapshot-note">快照节点数据 · 执行时冻结的原始 data 可在“原始”页查看</p>
        </section>
      </div>

      {props.onRecover && run?.status === 'failed' ? (
        <Button className="workflow-snapshot-detail__recover-button" variant="light" color="yellow" onClick={() => void props.onRecover?.(node.id)}>恢复此节点</Button>
      ) : null}
      {props.onOpenLog ? (
        <footer className="workflow-snapshot-detail__footer">
          <Button
            className="workflow-snapshot-detail__log-button"
            variant="default"
            size="xs"
            leftSection={<IconFileText className="workflow-snapshot-detail__log-button-icon" size={14} />}
            onClick={() => props.onOpenLog?.(props.executionId)}
          >
            查看完整执行日志
          </Button>
        </footer>
      ) : null}
    </aside>
  )
}
