import React from 'react'
import { ActionIcon, Badge, Group, Loader, Modal, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { IconRefresh, IconX } from '@tabler/icons-react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  getWorkflowExecutionSnapshot,
  listWorkflowNodeRuns,
  type WorkflowExecutionSnapshotDto,
  type WorkflowNodeRunDto,
} from '../api/server'
import { CANVAS_EDGE_TYPES, CANVAS_NODE_TYPES } from '../canvas/canvasElementTypes'
import {
  buildWorkflowExecutionSnapshotGraph,
  type WorkflowExecutionSnapshotGraph,
  type WorkflowExecutionSnapshotNode,
} from './workflowExecutionSnapshotGraph'
import { SnapshotNodeRunDetail } from './SnapshotNodeRunDetail'
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
  onOpenLog?: (executionId: string) => void
}>): React.JSX.Element {
  return (
    <div className="workflow-snapshot-modal__canvas-layout">
      <ReactFlowProviderWithClass className="workflow-snapshot-modal__provider">
        <ReactFlow
          className="workflow-snapshot-modal__flow"
          nodes={props.graph.nodes}
          edges={props.graph.edges}
          nodeTypes={CANVAS_NODE_TYPES}
          edgeTypes={CANVAS_EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          onNodeClick={props.onNodeClick}
          onPaneClick={props.onPaneClick}
          fitView={props.graph.viewport === undefined}
          fitViewOptions={{ padding: 0.16 }}
          defaultViewport={props.graph.viewport}
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
          onClose={props.onCloseDetail}
          onOpenLog={props.onOpenLog}
        />
      ) : null}
    </div>
  )
}

export function WorkflowExecutionSnapshotModal(props: Readonly<{
  opened: boolean
  executionId: string | null
  onClose: () => void
  onOpenLog?: (executionId: string) => void
}>): React.JSX.Element {
  const [snapshot, setSnapshot] = React.useState<WorkflowExecutionSnapshotDto | null>(null)
  const [nodeRuns, setNodeRuns] = React.useState<WorkflowNodeRunDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [activeView, setActiveView] = React.useState<string>('canvas')
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
      if (requestSequence.current !== requestId) return
      setSnapshot(nextSnapshot)
      setNodeRuns(nextNodeRuns)
      setActiveView(nextSnapshot.canvasData === undefined ? 'execution' : 'canvas')
    } catch (loadError: unknown) {
      if (requestSequence.current !== requestId) return
      setSnapshot(null)
      setNodeRuns([])
      setError(loadError instanceof Error ? loadError.message : '无法读取执行快照')
    } finally {
      if (requestSequence.current === requestId) setLoading(false)
    }
  }, [props.executionId, props.opened])

  React.useEffect(() => {
    setSelectedNodeId(null)
    void load()
    return () => { requestSequence.current += 1 }
  }, [load])

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

  const selectedNode = graph && !(graph instanceof Error)
    ? graph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null
  const selectedRun = activeView === 'execution' && selectedNode
    ? nodeRuns.find((run) => run.nodeId === selectedNode.id) ?? null
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
          <Group className="workflow-snapshot-modal__actions" gap={4}>
            <Tooltip className="workflow-snapshot-modal__refresh-tooltip" label="刷新快照状态">
              <ActionIcon
                className="workflow-snapshot-modal__action"
                variant="subtle"
                aria-label="刷新执行快照"
                loading={loading}
                onClick={() => void load()}
              >
                <IconRefresh className="workflow-snapshot-modal__action-icon" size={15} />
              </ActionIcon>
            </Tooltip>
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
                  onNodeClick={openNodeDetail}
                  onPaneClick={closeNodeDetail}
                  onCloseDetail={closeNodeDetail}
                  onOpenLog={props.onOpenLog}
                />
              </Tabs.Panel>
            ) : null}
            <Tabs.Panel className="workflow-snapshot-modal__panel" value="execution">
              <SnapshotCanvas
                graph={executionGraph}
                selectedNode={selectedNode}
                selectedRun={selectedRun}
                executionId={snapshot.executionId}
                hint="点击节点查看该节点的运行结果与过程"
                unavailableMessage={snapshot.canvasData === undefined ? '该历史执行创建时尚未冻结调用方项目画布；这里保留其内部执行图，不用当前画布冒充旧快照。' : undefined}
                onNodeClick={openNodeDetail}
                onPaneClick={closeNodeDetail}
                onCloseDetail={closeNodeDetail}
                onOpenLog={props.onOpenLog}
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
