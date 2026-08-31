import type { Edge, Node, Viewport } from '@xyflow/react'
import type { WorkflowExecutionSnapshotDto, WorkflowNodeRunDto } from '../api/server'
import {
  isCanvasEdgeTypeName,
  isCanvasNodeTypeName,
} from '../canvas/canvasElementTypes'
import { buildWorkflowAgentVisibleGraph } from '../canvas/workflowAgentReferenceProjection'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: JsonRecord, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value.trim() : ''
}

/** 工作流节点 kind：live 画布投影会把 run 状态写进 data.workflowStatus。 */
const WORKFLOW_NODE_KINDS = new Set(['workflowStage', 'workflowTrigger'])

const RUNNING_EDGE_TARGET_STATUSES = new Set<string>(['running', 'waiting_external', 'queued'])

/** 快照节点 data：保留原始画布 data（label 保证存在），并叠加只读标记与运行状态。 */
export type WorkflowExecutionSnapshotNodeData = JsonRecord & { label: string }

export type WorkflowExecutionSnapshotNode = Node<WorkflowExecutionSnapshotNodeData>

export type WorkflowExecutionSnapshotGraph = Readonly<{
  nodes: WorkflowExecutionSnapshotNode[]
  edges: Edge[]
  viewport?: Viewport
}>

/**
 * live 画布同款工作流状态投影（workflowExecutionProjection.applyWorkflowNodeRuns）：
 * success→succeeded、canceled→cancelled，其余原样透传。
 */
function projectWorkflowStatus(status: WorkflowNodeRunDto['status']): string {
  if (status === 'success') return 'succeeded'
  if (status === 'canceled') return 'cancelled'
  return status
}

/**
 * 普通任务节点的画布状态条映射（TaskNodeSkeleton 的 status pill 只识别 running / queued / error；
 * success 在画布上表现为结果缩略图，不出现状态条）。
 */
function projectTaskNodePillStatus(status: WorkflowNodeRunDto['status']): string | null {
  if (status === 'running' || status === 'waiting_external') return 'running'
  if (status === 'queued') return 'queued'
  if (status === 'failed') return 'error'
  return null
}

function readRunOutputArtifacts(outputRefs: unknown): unknown[] | null {
  if (!isRecord(outputRefs) || !Array.isArray(outputRefs.artifacts)) return null
  return outputRefs.artifacts
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 按 live 画布投影语义，把一次 node run 的状态叠加到快照节点 data 上（不修改原始对象）。 */
function overlayRunData(baseData: WorkflowExecutionSnapshotNodeData, run: WorkflowNodeRunDto): WorkflowExecutionSnapshotNodeData {
  const overlay: JsonRecord = {
    workflowStatus: projectWorkflowStatus(run.status),
  }
  const startedAt = readOptionalString(run.startedAt)
  if (startedAt) overlay.workflowExecutionStartedAt = startedAt
  const finishedAt = readOptionalString(run.finishedAt)
  if (finishedAt) overlay.workflowExecutionFinishedAt = finishedAt
  const artifacts = readRunOutputArtifacts(run.outputRefs)
  if (artifacts) overlay.workflowOutputArtifacts = artifacts
  const kind = readString(baseData, 'kind')
  if (!WORKFLOW_NODE_KINDS.has(kind)) {
    const pillStatus = projectTaskNodePillStatus(run.status)
    if (pillStatus) overlay.status = pillStatus
  }
  return { ...baseData, ...overlay }
}

export function buildWorkflowExecutionSnapshotGraph(
  snapshot: WorkflowExecutionSnapshotDto,
  nodeRuns: readonly WorkflowNodeRunDto[],
): WorkflowExecutionSnapshotGraph {
  if (!isRecord(snapshot.data) || !Array.isArray(snapshot.data.nodes) || !Array.isArray(snapshot.data.edges)) {
    throw new Error('执行快照缺少有效的 nodes / edges 画布数据')
  }
  const runByNodeId = new Map(nodeRuns.map((run) => [run.nodeId, run] as const))
  const nodes = snapshot.data.nodes.map((value, index): WorkflowExecutionSnapshotNode => {
    if (!isRecord(value)) throw new Error(`执行快照 nodes[${index}] 不是对象`)
    const id = readString(value, 'id')
    if (!id) throw new Error(`执行快照 nodes[${index}] 缺少节点 ID`)
    const data = isRecord(value.data) ? value.data : {}
    const position = isRecord(value.position) ? value.position : {}
    const x = typeof position.x === 'number' && Number.isFinite(position.x) ? position.x : (index % 4) * 250
    const y = typeof position.y === 'number' && Number.isFinite(position.y) ? position.y : Math.floor(index / 4) * 140
    const rawType = readString(value, 'type')
    const type = isCanvasNodeTypeName(rawType) ? rawType : 'taskNode'
    const label = readString(data, 'label') || readString(data, 'workflowNodeId') || id
    const baseData: WorkflowExecutionSnapshotNodeData = { ...data, readOnly: true, label }
    const run = runByNodeId.get(id)
    const node: WorkflowExecutionSnapshotNode = {
      id,
      type,
      position: { x, y },
      data: run ? overlayRunData(baseData, run) : baseData,
      draggable: false,
      connectable: false,
    }
    // 保留组嵌套与几何信息，让快照画布与 live 画布布局一致（组内子节点在组内渲染）。
    const parentId = readOptionalString(value.parentId)
    if (parentId) node.parentId = parentId
    if (isRecord(value.style)) node.style = value.style
    if (typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0) node.width = value.width
    if (typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0) node.height = value.height
    if (value.extent === 'parent') node.extent = 'parent'
    return node
  })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = snapshot.data.edges.flatMap((value, index): Edge[] => {
    if (!isRecord(value)) throw new Error(`执行快照 edges[${index}] 不是对象`)
    const source = readString(value, 'source')
    const target = readString(value, 'target')
    if (!source || !target) throw new Error(`执行快照 edges[${index}] 缺少 source / target`)
    if (!nodeIds.has(source) || !nodeIds.has(target)) return []
    const rawType = readString(value, 'type')
    const edge: Edge = {
      id: readString(value, 'id') || `snapshot-edge-${source}-${target}-${index}`,
      source,
      target,
      sourceHandle: readOptionalString(value.sourceHandle) ?? undefined,
      targetHandle: readOptionalString(value.targetHandle) ?? undefined,
      ...(isCanvasEdgeTypeName(rawType) ? { type: rawType } : {}),
      animated: RUNNING_EDGE_TARGET_STATUSES.has(runByNodeId.get(target)?.status ?? ''),
    }
    const edgeData = isRecord(value.data) ? value.data : null
    if (edgeData) edge.data = { ...edgeData, readOnly: true }
    return [edge]
  })
  const visibleGraph = buildWorkflowAgentVisibleGraph({
    nodes,
    edges,
    workflowExecutionId: snapshot.executionId,
    outputRefsByAgentNodeId: new Map(nodeRuns.map((run) => [run.nodeId, run.outputRefs] as const)),
    readOnly: true,
  })
  const visibleNodes = visibleGraph.nodes.map((node): WorkflowExecutionSnapshotNode => {
    const data = isRecord(node.data) ? node.data : {}
    return {
      ...node,
      data: {
        ...data,
        label: readString(data, 'label') || readString(data, 'workflowNodeId') || node.id,
        readOnly: true,
      },
      draggable: false,
      connectable: false,
    }
  })
  const visibleEdges = visibleGraph.edges.map((edge): Edge => ({
    ...edge,
    data: {
      ...(isRecord(edge.data) ? edge.data : {}),
      readOnly: true,
    },
  }))
  const rawViewport = isRecord(snapshot.data.viewport) ? snapshot.data.viewport : null
  const viewport = rawViewport
    && typeof rawViewport.x === 'number' && Number.isFinite(rawViewport.x)
    && typeof rawViewport.y === 'number' && Number.isFinite(rawViewport.y)
    && typeof rawViewport.zoom === 'number' && Number.isFinite(rawViewport.zoom)
    && rawViewport.zoom > 0
    ? { x: rawViewport.x, y: rawViewport.y, zoom: rawViewport.zoom }
    : undefined
  return { nodes: visibleNodes, edges: visibleEdges, ...(viewport ? { viewport } : {}) }
}
