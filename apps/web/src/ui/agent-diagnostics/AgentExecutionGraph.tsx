import React from 'react'
import { ActionIcon, Badge, Group, Select, Text, Tooltip } from '@mantine/core'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  IconBinaryTree,
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDatabase,
  IconGitBranch,
  IconRobot,
  IconSparkles,
  IconTool,
  IconUsersGroup,
  IconArrowsMaximize,
  IconArrowsMinimize,
} from '@tabler/icons-react'
import type { AgentDiagnosticsTraceDto } from '../../api/server'
import BodyPortal from '../BodyPortal'
import type { LiveChatRunRecord } from '../chat/liveChatRunStore'
import { buildLiveExecutionGraph, buildTraceExecutionGraph } from './buildExecutionGraph'
import type { ExecutionGraph, ExecutionGraphNode, ExecutionGraphNodeStatus } from './executionGraph.types'
import { formatElapsedDuration } from './executionTiming'
import { buildExecutionRunOptions } from './executionRunTree'
import AgentDiagnosticSummary from './AgentDiagnosticSummary'
import WorkflowNodeInspector from './WorkflowNodeInspector'
import './AgentExecutionGraph.css'

type AgentExecutionGraphProps = {
  className?: string
  traces: AgentDiagnosticsTraceDto[]
  liveRun: LiveChatRunRecord | null
}

type ExecutionFlowNodeData = Record<string, unknown> & {
  graphNode: ExecutionGraphNode
  expanded: boolean
  bounded: boolean
  onToggle: (nodeId: string) => void
}

type ExecutionFlowNode = Node<ExecutionFlowNodeData, 'execution'>

type DiagnosticIdCopyStatus = 'idle' | 'copying' | 'copied' | 'failed'

const EXPANDED_NODE_MIN_HEIGHT = 252
const LAYER_GAP = 64
const LEFT_LANE_X = 24
const MAIN_LANE_X = 390
const RIGHT_LANE_X = 756
const CLIPBOARD_WRITE_TIMEOUT_MS = 1_200

async function writeClipboardText(value: string): Promise<void> {
  const clipboard = window.navigator.clipboard
  if (!clipboard) throw new Error('clipboard_unavailable')

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('clipboard_write_timeout')), CLIPBOARD_WRITE_TIMEOUT_MS)
    void clipboard.writeText(value).then(
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      (reason: unknown) => {
        window.clearTimeout(timeout)
        reject(reason)
      },
    )
  })
}

function copyStatusLabel(status: DiagnosticIdCopyStatus): string {
  if (status === 'copying') return '复制中'
  if (status === 'copied') return '已复制'
  if (status === 'failed') return '复制失败'
  return '复制诊断 ID'
}

function statusLabel(status: ExecutionGraphNodeStatus): string {
  if (status === 'succeeded') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已中断'
  if (status === 'running') return '运行中'
  if (status === 'warning') return '需关注'
  if (status === 'inactive') return '未执行'
  if (status === 'unavailable') return '不可追溯'
  return '信息'
}

function statusColor(status: ExecutionGraphNodeStatus): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'cancelled') return 'gray'
  if (status === 'running') return 'orange'
  if (status === 'warning') return 'yellow'
  return 'gray'
}

function trackLabel(node: ExecutionGraphNode): string {
  if (node.status === 'inactive') return '未执行分支'
  if (node.kind === 'skill') return 'Skill 分支'
  if (node.kind === 'domain') return 'Knowledge 分支'
  if (node.kind === 'learning') return '持续学习'
  if (node.kind === 'subagent') return '角色分支'
  return '小T 主进程'
}

function nodeIcon(node: ExecutionGraphNode): JSX.Element {
  if (node.kind === 'decision') return <IconGitBranch className="agent-execution-node__kind-svg" size={15} />
  if (node.kind === 'skill') return <IconSparkles className="agent-execution-node__kind-svg" size={15} />
  if (node.kind === 'domain') return <IconBook2 className="agent-execution-node__kind-svg" size={15} />
  if (node.kind === 'learning') return <IconDatabase className="agent-execution-node__kind-svg" size={15} />
  if (node.kind === 'tool') return <IconTool className="agent-execution-node__kind-svg" size={15} />
  if (node.kind === 'subagent') return <IconUsersGroup className="agent-execution-node__kind-svg" size={15} />
  if (node.lane === 0) return <IconRobot className="agent-execution-node__kind-svg" size={15} />
  return <IconBinaryTree className="agent-execution-node__kind-svg" size={15} />
}

function AgentExecutionFlowNode(props: NodeProps<ExecutionFlowNode>): JSX.Element {
  const { graphNode, expanded, bounded, onToggle } = props.data
  const isDecision = graphNode.kind === 'decision'
  return (
    <article
      className={`agent-execution-node agent-execution-node--${graphNode.kind} agent-execution-node--${graphNode.status}${expanded ? ' is-expanded' : ''}`}
      aria-label={`${graphNode.title}，${statusLabel(graphNode.status)}`}
    >
      <Handle className="agent-execution-node__target-handle" id={bounded ? 'bounded-target' : undefined} type="target" position={bounded ? Position.Left : Position.Top} isConnectable={false} />
      <header className="agent-execution-node__header">
        <span className="agent-execution-node__kind-icon" aria-hidden="true">
          {nodeIcon(graphNode)}
        </span>
        <div className="agent-execution-node__heading">
          <span className="agent-execution-node__kind">{trackLabel(graphNode)}</span>
          <strong className="agent-execution-node__title">{graphNode.title}</strong>
        </div>
        {!bounded ? <Tooltip className="agent-execution-node__toggle-tooltip" label={expanded ? '折叠节点详情' : '展开节点详情'} withArrow>
          <ActionIcon
            className="agent-execution-node__toggle"
            variant="subtle"
            size="sm"
            aria-label={expanded ? `折叠 ${graphNode.title}` : `展开 ${graphNode.title}`}
            aria-expanded={expanded}
            onClick={() => onToggle(graphNode.id)}
          >
            {expanded
              ? <IconChevronDown className="agent-execution-node__toggle-icon" size={15} />
              : <IconChevronRight className="agent-execution-node__toggle-icon" size={15} />}
          </ActionIcon>
        </Tooltip> : null}
      </header>
      <p className="agent-execution-node__summary">{graphNode.summary}</p>
      {graphNode.timing ? (
        <div className="agent-execution-node__timing" aria-label={`${graphNode.title} 执行计时`}>
          <span className="agent-execution-node__timing-label">{graphNode.timing.live ? '实时耗时' : '耗时'}</span>
          <time className="agent-execution-node__timing-value" dateTime={graphNode.timing.startedAt}>
            {formatElapsedDuration(graphNode.timing.elapsedMs)}
          </time>
        </div>
      ) : null}
      {graphNode.primaryItems.length > 0 ? (
        <div className="agent-execution-node__primary" aria-label={`${graphNode.title} 主要信息`}>
          {graphNode.primaryItems.map((item, index) => (
            <div className="agent-execution-node__primary-item" key={`${graphNode.id}-primary-${index}-${item}`} title={item}>
              <span className="agent-execution-node__primary-marker" aria-hidden="true" />
              <span className="agent-execution-node__primary-text">{item}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="agent-execution-node__meta">
        <span className={`agent-execution-node__status agent-execution-node__status--${graphNode.status}`}>
          {statusLabel(graphNode.status)}
        </span>
        {graphNode.badges.slice(0, 3).map((badge, index) => (
          <span className="agent-execution-node__badge" key={`${graphNode.id}-${index}-${badge}`}>{badge}</span>
        ))}
      </div>
      {expanded ? (
        <dl className="agent-execution-node__details">
          {graphNode.details.length > 0 ? graphNode.details.map((detail, index) => (
            <div className="agent-execution-node__detail" key={`${graphNode.id}-${detail.label}-${index}`}>
              <dt className="agent-execution-node__detail-label">{detail.label}</dt>
              <dd className="agent-execution-node__detail-value">{detail.value}</dd>
            </div>
          )) : (
            <div className="agent-execution-node__detail">
              <dt className="agent-execution-node__detail-label">detail</dt>
              <dd className="agent-execution-node__detail-value">无可用详情</dd>
            </div>
          )}
        </dl>
      ) : null}
      <Handle className="agent-execution-node__source-handle" id={bounded ? 'bounded-source' : 'main'} type="source" position={bounded ? Position.Right : Position.Bottom} isConnectable={false} />
      <Handle className="agent-execution-node__fork-handle agent-execution-node__fork-handle--left" id="fork-left" type="source" position={Position.Left} isConnectable={false} />
      <Handle className="agent-execution-node__fork-handle agent-execution-node__fork-handle--right" id="fork-right" type="source" position={Position.Right} isConnectable={false} />
      {isDecision ? <Handle className="agent-execution-node__branch-handle" id="branch" type="source" position={Position.Right} isConnectable={false} /> : null}
    </article>
  )
}

const NODE_TYPES = { execution: AgentExecutionFlowNode }
const ReactFlowProviderWithClass = ReactFlowProvider as unknown as React.FC<React.PropsWithChildren<{ className?: string }>>

function collapsedNodeHeight(node: ExecutionGraphNode): number {
  const titleCharsPerLine = node.lane === 0 ? 34 : 28
  const titleLines = Math.max(1, Math.ceil(node.title.length / titleCharsPerLine))
  return 116
    + (titleLines - 1) * 17
    + (node.timing ? 18 : 0)
    + Math.min(node.primaryItems.length, 4) * 22
    + (node.primaryItems.length > 0 ? 8 : 0)
}

function expandedNodeHeight(node: ExecutionGraphNode): number {
  if (node.details.length === 0) return EXPANDED_NODE_MIN_HEIGHT
  const detailLines = node.details.reduce((total, detail) => total + Math.max(1, Math.ceil(detail.value.length / 44)), 0)
  return Math.max(
    EXPANDED_NODE_MIN_HEIGHT,
    Math.min(560, collapsedNodeHeight(node) + 48 + detailLines * 18 + node.details.length * 28),
  )
}

function toFlowElements(
  graph: ExecutionGraph,
  expandedNodeIds: ReadonlySet<string>,
  onToggle: (nodeId: string) => void,
): { nodes: ExecutionFlowNode[]; edges: Edge[] } {
  const bounded = graph.layout === 'bounded_workflow'
  const layerHeights = new Map<number, number>()
  for (const node of graph.nodes) {
    const height = expandedNodeIds.has(node.id) ? expandedNodeHeight(node) : collapsedNodeHeight(node)
    layerHeights.set(node.layer, Math.max(layerHeights.get(node.layer) ?? 0, height))
  }
  const layerY = new Map<number, number>()
  let currentY = 24
  const maxLayer = Math.max(0, ...graph.nodes.map((node) => node.layer))
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    layerY.set(layer, currentY)
    currentY += (layerHeights.get(layer) ?? 116) + LAYER_GAP
  }
  const nodes: ExecutionFlowNode[] = graph.nodes.map((graphNode) => {
    const expanded = expandedNodeIds.has(graphNode.id)
    return {
      id: graphNode.id,
      type: 'execution',
      position: {
        x: bounded
          ? 24 + graphNode.layer * 184
          : graphNode.lane === -1 ? LEFT_LANE_X : graphNode.lane === 0 ? MAIN_LANE_X : RIGHT_LANE_X,
        y: bounded ? 76 : layerY.get(graphNode.layer) ?? 0,
      },
      data: { graphNode, expanded: bounded ? false : expanded, bounded, onToggle },
      draggable: false,
      selectable: true,
      connectable: false,
      style: {
        width: bounded ? 156 : graphNode.lane === 0 ? 340 : 300,
        height: bounded ? 102 : expanded ? expandedNodeHeight(graphNode) : collapsedNodeHeight(graphNode),
      },
    }
  })
  const inactiveNodeIds = new Set(graph.nodes.filter((node) => node.status === 'inactive').map((node) => node.id))
  const nodeLaneById = new Map(graph.nodes.map((node) => [node.id, node.lane]))
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.relation === 'fork'
      ? nodeLaneById.get(edge.target) === -1 ? 'fork-left' : 'fork-right'
      : bounded ? 'bounded-source' : inactiveNodeIds.has(edge.target) ? 'branch' : 'main',
    targetHandle: bounded ? 'bounded-target' : undefined,
    label: edge.label,
    type: 'smoothstep',
    animated: edge.active && graph.status === 'running',
    className: `agent-execution-edge agent-execution-edge--${edge.relation}${edge.active ? ' is-active' : ' is-inactive'}`,
    style: {
      stroke: !edge.active
        ? 'var(--tc-ai-trace-edge-inactive)'
        : edge.relation === 'fork'
          ? 'var(--tc-ai-trace-edge-fork)'
          : edge.relation === 'return'
            ? 'var(--tc-ai-trace-edge-return)'
            : 'var(--tc-ai-trace-edge-active)',
      strokeWidth: edge.active ? 2 : 1,
      strokeDasharray: edge.active ? undefined : '5 5',
    },
    labelStyle: {
      fill: edge.active ? 'var(--tc-ai-trace-text)' : 'var(--tc-ai-trace-muted)',
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: 'var(--tc-ai-trace-surface)',
      fillOpacity: 0.96,
    },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }))
  return { nodes, edges }
}

function InitializeGraphViewport(props: { layoutKey: string; bounded: boolean }): null {
  const reactFlow = useReactFlow<ExecutionFlowNode>()
  const nodesInitialized = useNodesInitialized()
  React.useEffect(() => {
    if (!nodesInitialized) return undefined
    const frame = window.requestAnimationFrame(() => {
      const initialNodes = props.bounded
        ? reactFlow.getNodes()
        : reactFlow.getNodes().filter((node) => node.data.graphNode.lane === 0).slice(0, 3)
      if (initialNodes.length === 0) return
      void reactFlow.fitView({
        nodes: initialNodes,
        padding: 0.08,
        minZoom: props.bounded ? 0.5 : 0.42,
        maxZoom: props.bounded ? 1 : 0.9,
        duration: 260,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [nodesInitialized, props.bounded, props.layoutKey, reactFlow])
  return null
}

export default function AgentExecutionGraph(props: AgentExecutionGraphProps): JSX.Element | null {
  const { className, traces, liveRun } = props
  const liveKey = liveRun ? `live:${liveRun.runId}` : ''
  const traceKeys = React.useMemo(() => new Set(traces.map((trace) => `trace:${trace.id}`)), [traces])
  const [selectedKey, setSelectedKey] = React.useState(liveKey || (traces[0] ? `trace:${traces[0].id}` : ''))
  const [expandedNodeIds, setExpandedNodeIds] = React.useState<Set<string>>(() => new Set())
  const [fullscreen, setFullscreen] = React.useState(false)
  const [copyStatus, setCopyStatus] = React.useState<DiagnosticIdCopyStatus>('idle')
  const [selectedNodeId, setSelectedNodeId] = React.useState('')
  const [clockMs, setClockMs] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (liveRun?.status === 'active') setSelectedKey(`live:${liveRun.runId}`)
  }, [liveRun?.runId, liveRun?.status])

  React.useEffect(() => {
    if (selectedKey === liveKey && liveKey) return
    if (traceKeys.has(selectedKey)) return
    setSelectedKey(liveKey || (traces[0] ? `trace:${traces[0].id}` : ''))
  }, [liveKey, selectedKey, traceKeys, traces])

  React.useEffect(() => {
    setExpandedNodeIds(new Set())
    setCopyStatus('idle')
    setSelectedNodeId('')
  }, [selectedKey])

  React.useEffect(() => {
    if (copyStatus === 'idle' || copyStatus === 'copying') return undefined
    const timer = window.setTimeout(() => setCopyStatus('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  React.useEffect(() => {
    if (!fullscreen) return undefined
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [fullscreen])

  const graph = React.useMemo(() => {
    if (liveRun && selectedKey === liveKey) return buildLiveExecutionGraph(liveRun, clockMs)
    const traceId = selectedKey.startsWith('trace:') ? selectedKey.slice('trace:'.length) : ''
    const selectedTrace = traces.find((trace) => trace.id === traceId) ?? traces[0]
    return selectedTrace ? buildTraceExecutionGraph(selectedTrace, clockMs) : null
  }, [clockMs, liveKey, liveRun, selectedKey, traces])

  const selectedTrace = React.useMemo(() => {
    if (!selectedKey.startsWith('trace:')) return null
    const traceId = selectedKey.slice('trace:'.length)
    return traces.find((trace) => trace.id === traceId) ?? null
  }, [selectedKey, traces])

  React.useEffect(() => {
    if (graph?.status !== 'running') return undefined
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [graph?.status])

  React.useEffect(() => {
    if (!graph) {
      setSelectedNodeId('')
      return
    }
    const currentExists = graph.nodes.some((node) => node.id === selectedNodeId)
    if (currentExists) return
    const active = graph.nodes.find((node) => node.status === 'running' || node.status === 'warning')
    const promptAssemblyNode = graph.nodes.find((node) => (node.promptAssemblies?.length ?? 0) > 0)
    setSelectedNodeId(active?.id ?? promptAssemblyNode?.id ?? graph.nodes[0]?.id ?? '')
  }, [graph, selectedNodeId])

  const toggleNode = React.useCallback((nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const copyDiagnosticId = React.useCallback(async () => {
    if (!graph) return
    setCopyStatus('copying')
    try {
      await writeClipboardText(graph.id)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }, [graph])

  const flow = React.useMemo(
    () => graph ? toFlowElements(graph, expandedNodeIds, toggleNode) : { nodes: [], edges: [] },
    [expandedNodeIds, graph, toggleNode],
  )
  const options = React.useMemo(() => [
    ...(liveRun ? [{ value: liveKey, label: `实时 · ${liveRun.status}` }] : []),
    ...buildExecutionRunOptions(traces),
  ], [liveKey, liveRun, traces])

  if (!graph) return null
  const bounded = graph.layout === 'bounded_workflow'
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0] ?? null
  const completedWorkflowNodeCount = bounded
    ? graph.nodes.filter((node) => node.status === 'succeeded').length
    : 0
  const workflowIssueCount = bounded
    ? graph.nodes.filter((node) => node.status === 'failed' || node.status === 'warning').length
    : 0
  const graphContent = (
    <section className={`${className ?? ''} agent-execution-graph${fullscreen ? ' agent-execution-graph--fullscreen' : ''}`.trim()} aria-label={bounded ? 'AI 执行工作流' : 'AI 执行历史记录'}>
      <header className="agent-execution-graph__header">
        <div className="agent-execution-graph__heading">
          <div className="agent-execution-graph__title-row">
            <IconBinaryTree className="agent-execution-graph__title-icon" size={18} aria-hidden="true" />
            <Text className="agent-execution-graph__title" fw={650}>{bounded ? 'AI 执行工作流' : 'AI 执行历史记录'}</Text>
          </div>
          <Text className="agent-execution-graph__subtitle" size="xs" c="dimmed" lineClamp={1}>{graph.title}</Text>
          <div className="agent-execution-graph__diagnostic-id-row">
            <span className="agent-execution-graph__diagnostic-id-label">诊断 ID</span>
            <code className="agent-execution-graph__diagnostic-id">{graph.id}</code>
            <Tooltip
              className="agent-execution-graph__diagnostic-id-tooltip"
              label={copyStatusLabel(copyStatus)}
              withArrow
            >
              <ActionIcon
                className="agent-execution-graph__diagnostic-id-copy"
                variant="subtle"
                size="xs"
                aria-label={`复制诊断 ID ${graph.id}`}
                disabled={copyStatus === 'copying'}
                onClick={() => void copyDiagnosticId()}
              >
                {copyStatus === 'copied'
                  ? <IconCheck className="agent-execution-graph__diagnostic-id-copy-icon" size={13} />
                  : <IconCopy className="agent-execution-graph__diagnostic-id-copy-icon" size={13} />}
              </ActionIcon>
            </Tooltip>
            {copyStatus !== 'idle' ? (
              <span className={`agent-execution-graph__diagnostic-id-feedback agent-execution-graph__diagnostic-id-feedback--${copyStatus}`}>
                {copyStatusLabel(copyStatus)}
              </span>
            ) : null}
          </div>
          {selectedTrace ? (
            <div className="agent-execution-graph__lineage" aria-label="本轮执行链路">
              <span className="agent-execution-graph__lineage-item" title={selectedTrace.logicalTaskId ?? '未记录'}>
                逻辑任务 {selectedTrace.logicalTaskId?.slice(0, 12) ?? '未记录'}
              </span>
              <span className="agent-execution-graph__lineage-item" title={selectedTrace.rootTraceId ?? selectedTrace.id}>
                根执行 {(selectedTrace.rootTraceId ?? selectedTrace.id).slice(0, 12)}
              </span>
              {selectedTrace.parentTraceId ? (
                <span className="agent-execution-graph__lineage-item" title={selectedTrace.parentTraceId}>
                  父执行 {selectedTrace.parentTraceId.slice(0, 12)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <Group className="agent-execution-graph__header-actions" gap="xs" wrap="nowrap">
          <Select
            className="agent-execution-graph__run-select"
            aria-label="选择 AI 执行记录"
            data={options}
            value={selectedKey}
            onChange={(value) => value && setSelectedKey(value)}
            size="xs"
            searchable
            allowDeselect={false}
          />
          <Tooltip className="agent-execution-graph__fullscreen-tooltip" label={fullscreen ? '退出全屏' : '全屏查看'} withArrow>
            <ActionIcon
              className="agent-execution-graph__fullscreen-action"
              variant="subtle"
              size="sm"
              aria-label={fullscreen ? '退出 AI 执行工作流全屏' : '全屏查看 AI 执行工作流'}
              onClick={() => setFullscreen((current) => !current)}
            >
              {fullscreen
                ? <IconArrowsMinimize className="agent-execution-graph__fullscreen-icon" size={16} />
                : <IconArrowsMaximize className="agent-execution-graph__fullscreen-icon" size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </header>
      <Group className="agent-execution-graph__summary" gap="xs" wrap="wrap">
        <Badge className="agent-execution-graph__status" variant="light" color={statusColor(graph.status)}>{statusLabel(graph.status)}</Badge>
        {graph.timing ? (
          <Badge className="agent-execution-graph__timing" variant="outline" color={graph.timing.live ? 'orange' : 'gray'}>
            {`${graph.timing.live ? '本轮实时' : '本轮耗时'} ${formatElapsedDuration(graph.timing.elapsedMs)}`}
          </Badge>
        ) : null}
        {bounded ? (
          <>
            <Badge className="agent-execution-graph__count" variant="outline" color="gray">{`${completedWorkflowNodeCount}/${graph.nodes.length} 节点完成`}</Badge>
            <Badge className="agent-execution-graph__issues" variant="outline" color={workflowIssueCount > 0 ? 'yellow' : 'gray'}>{`${workflowIssueCount} 个问题`}</Badge>
            <Badge className="agent-execution-graph__domains" variant="outline" color="teal">{`Knowledge ${graph.knowledgeSourceCount}`}</Badge>
          </>
        ) : (
          <>
            <Badge className="agent-execution-graph__count" variant="outline" color="gray">{`阶段 ${graph.activePathNodeCount}/${graph.nodes.length}`}</Badge>
            <Badge className="agent-execution-graph__skills" variant="outline" color="orange">{`skills ${graph.skillCount}`}</Badge>
            <Badge className="agent-execution-graph__domains" variant="outline" color="teal">{`Knowledge ${graph.knowledgeSourceCount}`}</Badge>
            <Badge className="agent-execution-graph__provenance" variant="outline" color={graph.provenanceState === 'complete' ? 'green' : 'gray'}>{graph.provenanceState}</Badge>
          </>
        )}
      </Group>
      <AgentDiagnosticSummary diagnosis={graph.diagnosis} onFocusNode={setSelectedNodeId} />
      <div className={`agent-execution-graph__workspace${bounded ? ' is-bounded' : ''}`}>
      <div className="agent-execution-graph__viewport">
        <ReactFlowProviderWithClass className="agent-execution-graph__provider">
          <ReactFlow
            className="agent-execution-graph__flow"
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            panOnScroll
            zoomOnScroll={false}
            minZoom={0.18}
            maxZoom={1.35}
            proOptions={{ hideAttribution: true }}
          >
            <Background className="agent-execution-graph__background" variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls className="agent-execution-graph__controls" showInteractive={false} position="bottom-right" />
            <InitializeGraphViewport layoutKey={`${graph.id}:${fullscreen ? 'fullscreen' : 'panel'}`} bounded={bounded} />
          </ReactFlow>
        </ReactFlowProviderWithClass>
      </div>
      {bounded && selectedNode ? (
        <WorkflowNodeInspector
          node={selectedNode}
          statusLabel={statusLabel}
          observedAtMs={clockMs}
          knowledgeReceipt={graph.knowledgeReceipt}
          executionTraceId={graph.executionTraceId}
        />
      ) : null}
      </div>
    </section>
  )
  return fullscreen ? <BodyPortal>{graphContent}</BodyPortal> : graphContent
}
