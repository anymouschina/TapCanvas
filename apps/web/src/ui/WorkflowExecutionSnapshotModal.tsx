import React from 'react'
import { ActionIcon, Badge, Group, Loader, Modal, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  getWorkflowExecutionFamily,
  getWorkflowEventHistory,
  getWorkflowExecutionSnapshot,
  listWorkflowNodeRuns,
  streamWorkflowExecutionEvents,
  type WorkflowExecutionEventMessage,
  type WorkflowExecutionFamilyDto,
  type WorkflowExecutionSnapshotDto,
  type WorkflowNodeRunDto,
  resumeWorkflowExecution,
} from '../api/server'
import { CANVAS_EDGE_TYPES, CANVAS_NODE_TYPES } from '../canvas/canvasElementTypes'
import {
  buildWorkflowExecutionSnapshotGraph,
  type WorkflowExecutionSnapshotGraph,
  type WorkflowExecutionSnapshotNode,
} from './workflowExecutionSnapshotGraph'
import { SnapshotNodeRunDetail } from './SnapshotNodeRunDetail'
import { ExecutionWaterfall } from './execution-insights/ExecutionWaterfall'
import './WorkflowExecutionSnapshotModal.css'

const ReactFlowProviderWithClass = ReactFlowProvider as unknown as React.FC<React.PropsWithChildren<{ className?: string }>>

function SnapshotCanvas(props: Readonly<{
  graph: WorkflowExecutionSnapshotGraph
  selectedNode: WorkflowExecutionSnapshotNode | null
  selectedRun: WorkflowNodeRunDto | null
  executionId: string
  unavailableMessage?: string
  hint: string
  onNodeClick: NodeMouseHandler<WorkflowExecutionSnapshotNode>
  onPaneClick: () => void
  onCloseDetail: () => void
  onRecover?: (nodeId: string) => Promise<void>
  onOpenLog?: (executionId: string) => void
  events: readonly WorkflowExecutionEventMessage[]
  nodeLabelById: Readonly<Record<string, string>>
}>): React.JSX.Element {
  const [nodes, setNodes] = React.useState(props.graph.nodes)
  React.useEffect(() => {
    setNodes(previous => {
      const measuredById = new Map(previous.map(node => [node.id, node.measured]))
      return props.graph.nodes.map(node => ({ ...node, measured: measuredById.get(node.id) }))
    })
  }, [props.graph.nodes])
  const onNodesChange = React.useCallback((changes: NodeChange<WorkflowExecutionSnapshotNode>[]) => {
    // Controlled snapshots still need measured dimensions for MiniMap rendering.
    // Accept measurement only; the frozen graph remains read-only.
    setNodes(previous => applyNodeChanges(changes.filter(change => change.type === 'dimensions'), previous))
  }, [])
  const workflowNodes = props.graph.nodes.filter(node => node.data.workflowShowLabel === true)
  const entryX = Math.min(...workflowNodes.map(node => node.position.x))
  const initialNodes = workflowNodes.filter(node => node.position.x <= entryX + 1100)
  return (
    <div className="workflow-snapshot-modal__canvas-layout">
      <ReactFlowProviderWithClass className="workflow-snapshot-modal__provider">
        <ReactFlow
          className="workflow-snapshot-modal__flow"
          nodes={nodes}
          onNodesChange={onNodesChange}
          edges={props.graph.edges}
          nodeTypes={CANVAS_NODE_TYPES}
          edgeTypes={CANVAS_EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          onNodeClick={props.onNodeClick}
          onPaneClick={props.onPaneClick}
          // The persisted viewport belongs to the editor surface that created
          // the snapshot. The modal has a different size, so reusing that
          // viewport translates/scales the same node coordinates incorrectly.
          // Fit the presentation layout of the frozen DAG to this container.
          // The persisted snapshot and its execution dependencies remain unchanged.
          fitView
          fitViewOptions={{ padding: 0.2, includeHiddenNodes: true, ...(initialNodes.length ? { nodes: initialNodes, minZoom: 0.7, maxZoom: 1 } : {}) }}
          minZoom={0.08}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: 'typed',
            style: { strokeWidth: 2, strokeLinecap: 'round' },
            interactionWidth: 1,
          }}
        >
          <Background className="workflow-snapshot-modal__background" gap={24} size={1} />
          <Controls className="workflow-snapshot-modal__controls" showInteractive={false} />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={node => node.type === 'groupNode' ? 'transparent' : '#8593ab'} nodeStrokeColor="#cbd5e1" nodeStrokeWidth={2} bgColor="#202936" maskColor="rgba(9,15,24,0.28)" maskStrokeColor="#67e8f9" maskStrokeWidth={3} ariaLabel="工作流导航图：拖动定位，滚轮缩放" />
        </ReactFlow>
      </ReactFlowProviderWithClass>
      {props.unavailableMessage ? (
        <div className="workflow-snapshot-modal__legacy-notice" role="status">{props.unavailableMessage}</div>
      ) : null}
      {!props.selectedNode ? (
        <div className="workflow-snapshot-modal__hint" aria-hidden="true">{props.hint}</div>
      ) : null}
      {props.selectedNode ? (
        <SnapshotNodeRunDetail
          node={props.selectedNode}
          run={props.selectedRun}
          executionId={props.executionId}
          nodeLabelById={props.nodeLabelById}
          onClose={props.onCloseDetail}
          onRecover={props.onRecover}
          onOpenLog={props.onOpenLog}
          events={props.events}
        />
      ) : null}
    </div>
  )
}

function formatSnapshotDuration(runs: readonly WorkflowNodeRunDto[]): string {
  const starts = runs.map((run) => Date.parse(run.startedAt ?? '')).filter((value) => Number.isFinite(value))
  const finishes = runs.map((run) => Date.parse(run.finishedAt ?? '')).filter((value) => Number.isFinite(value))
  if (starts.length > 0 && finishes.length > 0) {
    const elapsed = Math.max(0, Math.max(...finishes) - Math.min(...starts))
    if (elapsed < 1_000) return `${Math.round(elapsed)} ms`
    if (elapsed < 60_000) return `${(elapsed / 1_000).toFixed(elapsed < 10_000 ? 1 : 0)} 秒`
    return `${Math.floor(elapsed / 60_000)} 分 ${Math.floor((elapsed % 60_000) / 1_000)} 秒`
  }
  const durations = runs.map((run) => run.durationMs).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  if (durations.length === 0) return '—'
  const total = Math.max(...durations)
  if (total < 1_000) return `${Math.round(total)} ms`
  if (total < 60_000) return `${(total / 1_000).toFixed(total < 10_000 ? 1 : 0)} 秒`
  return `${Math.floor(total / 60_000)} 分 ${Math.floor((total % 60_000) / 1_000)} 秒`
}

export function WorkflowExecutionSnapshotModal(props: Readonly<{
  opened: boolean
  executionId: string | null
  onClose: () => void
  onOpenLog?: (executionId: string) => void
}>): React.JSX.Element {
  const [snapshot, setSnapshot] = React.useState<WorkflowExecutionSnapshotDto | null>(null)
  const [executionFamily, setExecutionFamily] = React.useState<WorkflowExecutionFamilyDto | null>(null)
  const [familyError, setFamilyError] = React.useState<string | null>(null)
  const [nodeRuns, setNodeRuns] = React.useState<WorkflowNodeRunDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [eventCount, setEventCount] = React.useState(0)
  const [events, setEvents] = React.useState<WorkflowExecutionEventMessage[]>([])
  const eventCursorRef = React.useRef(0)
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [activeView, setActiveView] = React.useState<string>('execution')
  const requestSequence = React.useRef(0)

  const load = React.useCallback(async (): Promise<void> => {
    const executionId = props.executionId?.trim() ?? ''
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    if (!props.opened || !executionId) return
    setLoading(true)
    setError(null)
    try {
      const [nextSnapshot, nextNodeRuns] = await Promise.all([
        getWorkflowExecutionSnapshot(executionId),
        listWorkflowNodeRuns(executionId),
      ])
      let nextFamily: WorkflowExecutionFamilyDto | null = null
      let nextFamilyError: string | null = null
      try {
        nextFamily = await getWorkflowExecutionFamily(executionId, 50)
      } catch (familyLoadError: unknown) {
        nextFamilyError = familyLoadError instanceof Error ? familyLoadError.message : '执行族读取失败'
      }
      if (requestSequence.current !== requestId) return
      setSnapshot(nextSnapshot)
      setExecutionFamily(nextFamily)
      setFamilyError(nextFamilyError)
      const safeNodeRuns = Array.isArray(nextNodeRuns) ? nextNodeRuns : []
      setNodeRuns(safeNodeRuns)
      try {
        const history = await getWorkflowEventHistory(executionId)
        if (requestSequence.current !== requestId) return
        setEvents(history.items.map((event) => ({ id: String(event.seq), event: event.eventType, data: event })))
        eventCursorRef.current = history.items[history.items.length - 1]?.seq ?? 0
      } catch (historyError: unknown) {
        if (requestSequence.current !== requestId) return
        const message = historyError instanceof Error ? historyError.message : String(historyError)
        console.error('[workflow-snapshot] event history read failed', { executionId, message })
        setError(`执行事件读取失败：${message}`)
      }
    } catch (loadError: unknown) {
      if (requestSequence.current !== requestId) return
      setSnapshot(null)
      setExecutionFamily(null)
      setFamilyError(null)
      setNodeRuns([])
      setError(loadError instanceof Error ? loadError.message : '无法读取执行快照')
    } finally {
      if (requestSequence.current === requestId) setLoading(false)
    }
  }, [props.executionId, props.opened])

  React.useEffect(() => {
    setSelectedNodeId(null)
    setActiveView('execution')
    setEventCount(0)
    setEvents([])
    eventCursorRef.current = 0
    void load()
    return () => { requestSequence.current += 1 }
  }, [load])

  React.useEffect(() => {
    if (!props.opened || !props.executionId || !nodeRuns.some((run) => run.status === 'queued' || run.status === 'running' || run.status === 'waiting_external')) return undefined
    const controller = new AbortController()
    let stopped = false
    let retryDelayMs = 1_000
    const consume = async (): Promise<void> => {
      while (!stopped && !controller.signal.aborted) {
        try {
          await streamWorkflowExecutionEvents(props.executionId!, {
            after: eventCursorRef.current,
            signal: controller.signal,
            onEvent: (event) => {
              retryDelayMs = 1_000
              const numericId = Number(event.id)
              if (Number.isFinite(numericId) && numericId > eventCursorRef.current) eventCursorRef.current = numericId
              setEventCount((count) => count + 1)
              setEvents((current) => [...current, event].slice(-100))
            },
          })
          if (!stopped && !controller.signal.aborted) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelayMs))
          }
        } catch {
          if (stopped || controller.signal.aborted) return
          const delay = retryDelayMs
          retryDelayMs = Math.min(10_000, retryDelayMs * 2)
          await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
        }
      }
    }
    void consume()
    return () => { stopped = true; controller.abort() }
  }, [nodeRuns, props.executionId, props.opened])

  React.useEffect(() => {
    if (!props.opened || !props.executionId) return undefined
    const hasActiveNode = nodeRuns.some((run) => (
      run.status === 'queued' || run.status === 'running' || run.status === 'waiting_external'
    ))
    if (!hasActiveNode) return undefined
    const timer = window.setInterval(() => { void load() }, 5_000)
    return () => window.clearInterval(timer)
  }, [load, nodeRuns, props.executionId, props.opened])

  const executionGraph = React.useMemo(() => {
    if (!snapshot) return null
    try {
      return buildWorkflowExecutionSnapshotGraph(snapshot, nodeRuns)
    } catch (graphError: unknown) {
      return graphError instanceof Error ? graphError : new Error('执行快照无法投影为画布')
    }
  }, [nodeRuns, snapshot])

  const callerCanvasGraph = React.useMemo(() => {
    if (!snapshot || snapshot.canvasData === undefined) return null
    try {
      return buildWorkflowExecutionSnapshotGraph({ ...snapshot, data: snapshot.canvasData }, [])
    } catch (graphError: unknown) {
      return graphError instanceof Error ? graphError : new Error('调用方项目画布快照无法投影')
    }
  }, [snapshot])

  const graph = activeView === 'canvas' ? callerCanvasGraph : executionGraph

  const nodeLabelById = React.useMemo(() => {
    if (!graph || graph instanceof Error) return {}
    return Object.fromEntries(graph.nodes.map((node) => [node.id, String((node.data as Record<string, unknown>).label ?? node.id)]))
  }, [graph])

  const selectedNode = graph && !(graph instanceof Error)
    ? graph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null
  const selectedRun = activeView === 'execution' && selectedNode
    ? (() => {
        const data = selectedNode.data as Record<string, unknown>
        const workflowNodeId = typeof data.workflowNodeId === 'string' ? data.workflowNodeId.trim() : ''
        return nodeRuns.find((run) => run.nodeId === selectedNode.id)
          ?? (workflowNodeId ? nodeRuns.find((run) => run.nodeId === workflowNodeId) : undefined)
          ?? null
      })()
    : null
  const openNodeDetail = React.useCallback<NodeMouseHandler<WorkflowExecutionSnapshotNode>>((_event, node) => {
    setSelectedNodeId(node.id)
  }, [])
  const closeNodeDetail = React.useCallback((): void => {
    setSelectedNodeId(null)
  }, [])
  const changeView = React.useCallback((value: string | null): void => {
    if (!value) return
    setSelectedNodeId(null)
    setActiveView(value)
  }, [])
  const recoverNode = React.useCallback(async (nodeId: string): Promise<void> => {
    if (!props.executionId) return
    setError(null)
    try { await resumeWorkflowExecution(props.executionId, { nodeId }); await load() }
    catch (recoverError: unknown) { setError(recoverError instanceof Error ? recoverError.message : '节点恢复失败') }
  }, [load, props.executionId])

  return (
    <Modal
      className="workflow-snapshot-modal"
      opened={props.opened}
      onClose={props.onClose}
      withCloseButton={false}
      centered
      size="calc(100vw - 64px)"
      padding={0}
      zIndex={10200}
    >
      <Stack className="workflow-snapshot-modal__body" gap={0}>
        <header className="workflow-snapshot-modal__header">
          <div className="workflow-snapshot-modal__identity">
            <strong className="workflow-snapshot-modal__title">执行时画布快照</strong>
            {snapshot ? (
              <>
                <span className="workflow-snapshot-modal__name">{snapshot.name}</span>
                <Badge className="workflow-snapshot-modal__version" size="xs" variant="light">
                  {snapshot.flowVersionId.slice(0, 12)}
                </Badge>
                <time className="workflow-snapshot-modal__time" dateTime={snapshot.createdAt}>
                  {new Date(snapshot.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
              </>
            ) : null}
          </div>
          {snapshot && nodeRuns.length > 0 ? (
            <div className="workflow-snapshot-modal__summary" aria-label="执行摘要">
              <span className="workflow-execution-snapshot-modal__span">节点 {nodeRuns.length}</span>
              <span className="workflow-execution-snapshot-modal__span">完成 {nodeRuns.filter((run) => run.status === 'success').length}</span>
              <span className="workflow-execution-snapshot-modal__span">失败 {nodeRuns.filter((run) => run.status === 'failed').length}</span>
              <span className="workflow-execution-snapshot-modal__span">运行中 {nodeRuns.filter((run) => run.status === 'running').length}</span>
              <span className="workflow-execution-snapshot-modal__span">等待 {nodeRuns.filter((run) => run.status === 'waiting_external').length}</span>
              <span className="workflow-execution-snapshot-modal__span">取消 {nodeRuns.filter((run) => run.status === 'canceled').length}</span>
              <span className="workflow-execution-snapshot-modal__span">跳过 {nodeRuns.filter((run) => run.status === 'skipped' || run.status === 'not_selected').length}</span>
              <span className="workflow-execution-snapshot-modal__span">总耗时 {formatSnapshotDuration(nodeRuns)}</span>
              {(() => {
                const active = nodeRuns.some((run) => run.status === 'queued' || run.status === 'running' || run.status === 'waiting_external')
                return <span className={`workflow-snapshot-modal__live-indicator${active ? ' is-active' : ''}`}>{active ? `实时更新中 · ${eventCount} 条事件` : `执行已结束 · ${eventCount} 条事件`}</span>
              })()}
            </div>
          ) : null}
          <Group className="workflow-snapshot-modal__actions" gap={4}>
            <Tooltip className="workflow-snapshot-modal__close-tooltip" label="关闭">
              <ActionIcon className="workflow-snapshot-modal__action" variant="subtle" aria-label="关闭执行快照" onClick={props.onClose}>
                <IconX className="workflow-snapshot-modal__action-icon" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </header>
        {loading && !snapshot ? (
          <div className="workflow-snapshot-modal__state" role="status">
            <Loader className="workflow-snapshot-modal__loader" size="sm" />
            <Text className="workflow-snapshot-modal__state-text" size="sm">读取不可变执行快照</Text>
          </div>
        ) : null}
        {error ? <div className="workflow-snapshot-modal__state workflow-snapshot-modal__state--error">{error}</div> : null}
        {executionGraph instanceof Error ? (
          <div className="workflow-snapshot-modal__state workflow-snapshot-modal__state--error">{executionGraph.message}</div>
        ) : null}
        {callerCanvasGraph instanceof Error ? (
          <div className="workflow-snapshot-modal__state workflow-snapshot-modal__state--error">{callerCanvasGraph.message}</div>
        ) : null}
        {snapshot && executionGraph && !(executionGraph instanceof Error) && !(callerCanvasGraph instanceof Error) ? (
          <Tabs className="workflow-snapshot-modal__tabs" value={activeView} onChange={changeView} keepMounted={false}>
            <Tabs.List className="workflow-snapshot-modal__tab-list">
              {callerCanvasGraph ? <Tabs.Tab className="workflow-snapshot-modal__tab" value="canvas">项目画布</Tabs.Tab> : null}
              <Tabs.Tab className="workflow-snapshot-modal__tab" value="execution">执行图</Tabs.Tab>
              <Tabs.Tab className="workflow-snapshot-modal__tab" value="family">执行族</Tabs.Tab>
              <Tabs.Tab className="workflow-snapshot-modal__tab" value="waterfall">耗时瀑布</Tabs.Tab>
              <Tabs.Tab className="workflow-snapshot-modal__tab" value="json">原始快照</Tabs.Tab>
            </Tabs.List>
            {callerCanvasGraph ? (
              <Tabs.Panel className="workflow-snapshot-modal__panel" value="canvas">
                <SnapshotCanvas
                  graph={callerCanvasGraph}
                  selectedNode={selectedNode}
                  selectedRun={selectedRun}
                  executionId={snapshot.executionId}
                  hint="点击节点查看执行当时冻结的项目数据"
                  nodeLabelById={nodeLabelById}
                  onNodeClick={openNodeDetail}
                  onPaneClick={closeNodeDetail}
                  onCloseDetail={closeNodeDetail}
                  onRecover={recoverNode}
                  onOpenLog={props.onOpenLog}
                  events={events}
                />
              </Tabs.Panel>
            ) : null}
            <Tabs.Panel className="workflow-snapshot-modal__panel workflow-snapshot-modal__panel--family" value="family">
              {executionFamily ? (
                <div className="workflow-snapshot-family" aria-label="执行族视图">
                  <div className="workflow-snapshot-family__summary">
                    <strong className="workflow-execution-snapshot-modal__strong">执行族 {executionFamily.executionFamilyId}</strong>
                    <span className="workflow-execution-snapshot-modal__span">共 {executionFamily.executionCount} 次执行</span>
                    <span className="workflow-execution-snapshot-modal__span">成功 {executionFamily.successfulExecutionCount} 次</span>
                    <span className="workflow-execution-snapshot-modal__span">节点尝试 {executionFamily.nodeAttemptCount} 次</span><span className="workflow-execution-snapshot-modal__span">版本 {new Set(executionFamily.executions.map((item) => item.flowVersionId)).size} 个</span>
                  </div>
                  <div className="workflow-snapshot-family__list">
                    {executionFamily.executions.map((member) => (
                      <div className={`workflow-snapshot-family__item${member.id === snapshot.executionId ? ' is-current' : ''}`} key={member.id}>
                        <span className="workflow-execution-snapshot-modal__span">{member.id}</span><Badge size="sm" variant="light">{member.status}</Badge>
                        <span className="workflow-execution-snapshot-modal__span">{member.retryCount ? `重试 ${member.retryCount}` : '首次执行'}</span>
                        <span className="workflow-execution-snapshot-modal__span">{member.durationMs == null ? '—' : `${member.durationMs} ms`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div className="workflow-snapshot-modal__hint">{familyError ?? '暂无执行族数据'}</div>}
            </Tabs.Panel>
            <Tabs.Panel className="workflow-snapshot-modal__panel workflow-snapshot-modal__panel--waterfall" value="waterfall">
              <ExecutionWaterfall runs={nodeRuns} labels={nodeLabelById} onSelect={(nodeId) => { setActiveView('execution'); setSelectedNodeId(nodeId) }} />
            </Tabs.Panel>
            <Tabs.Panel className="workflow-snapshot-modal__panel" value="execution">
              <SnapshotCanvas
                graph={executionGraph}
                selectedNode={selectedNode}
                selectedRun={selectedRun}
                executionId={snapshot.executionId}
                hint="拖动画布或右下角导航查看分支 · 点击节点查看结果与过程"
                nodeLabelById={nodeLabelById}
                unavailableMessage={snapshot.canvasData === undefined ? '该历史执行创建时尚未冻结调用方项目画布；这里保留其内部执行图，不用当前画布冒充旧快照。' : undefined}
                onNodeClick={openNodeDetail}
                onPaneClick={closeNodeDetail}
                onCloseDetail={closeNodeDetail}
                onRecover={recoverNode}
                onOpenLog={props.onOpenLog}
                events={events}
              />
            </Tabs.Panel>
            <Tabs.Panel className="workflow-snapshot-modal__panel workflow-snapshot-modal__panel--json" value="json">
              <pre className="workflow-snapshot-modal__json">{JSON.stringify(snapshot.data, null, 2)}</pre>
            </Tabs.Panel>
          </Tabs>
        ) : null}
      </Stack>
    </Modal>
  )
}
