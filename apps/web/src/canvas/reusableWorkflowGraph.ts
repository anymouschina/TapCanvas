import type { Edge, Node } from '@xyflow/react'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import type { CanvasImportData, SerializedCanvas } from './utils/serialization'
import { extractCanvasGraph } from './utils/serialization'
import { withoutWorkflowExecutionProjectionData } from './workflowExecutionProjectionData'

export type ReusableWorkflowGraph = Readonly<{
  name: string
  nodes: Node[]
  edges: Edge[]
}>

const WORKFLOW_RUNTIME_DATA_KEYS = new Set([
  'status',
  'progress',
  'logs',
  'canceled',
  'lastError',
  'triggerStatus',
  'workflowStatus',
  'workflowRequestedAt',
  'previousWorkflowTraceId',
  'workflowTraceId',
  'workflowTraceStatus',
  'workflowTraceUpdatedAt',
  'workflowLogicalTaskId',
  'workflowPhysicalRunId',
  'workflowExecutionId',
  'workflowNodeRunId',
	'workflowPinnedOutputSource',
	'workflowResolvedOutputReuse',
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isWorkflowGroup(node: Node): boolean {
  const data = record(node.data)
  return node.type === 'groupNode'
    && data.adminWorkflow === true
    && data.workflowKey === AGENT_WORKFLOW_KEY
    && Boolean(text(data.workflowInstanceId))
}

function descendantsOf(groupId: string, nodes: readonly Node[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    const parentId = text(node.parentId)
    if (!parentId) continue
    const ids = children.get(parentId) ?? []
    ids.push(node.id)
    children.set(parentId, ids)
  }
  const result = new Set<string>([groupId])
  const queue = [...(children.get(groupId) ?? [])]
  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (!nodeId || result.has(nodeId)) continue
    result.add(nodeId)
    queue.push(...(children.get(nodeId) ?? []))
  }
  return result
}

function workflowGroupForNode(node: Node, nodesById: ReadonlyMap<string, Node>): Node | null {
  let current: Node | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (isWorkflowGroup(current)) return current
    const parentId = text(current.parentId)
    current = parentId ? nodesById.get(parentId) : undefined
  }
  return null
}

function resolveSingleWorkflowGroup(nodes: readonly Node[], useSelection: boolean): Node {
  const workflowGroups = nodes.filter(isWorkflowGroup)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const selectedGroups = useSelection
    ? Array.from(new Map(nodes
      .filter((node) => node.selected)
      .flatMap((node) => {
        const group = workflowGroupForNode(node, nodesById)
        return group ? [[group.id, group] as const] : []
      })).values())
    : workflowGroups
  const candidates = selectedGroups.length > 0 ? selectedGroups : workflowGroups
  if (candidates.length === 0) {
    throw new Error('画布中没有可复用的智能体工作流组')
  }
  if (candidates.length !== 1) {
    throw new Error(useSelection
      ? '请选中一个工作流组，或选中该组内的任一节点'
      : '工作流文件必须只包含一个智能体工作流组')
  }
  return candidates[0]
}

function withoutRuntimeData(node: Node): Node {
  const data = withoutWorkflowExecutionProjectionData(record(node.data))
  const nextData = Object.fromEntries(Object.entries(data).filter(([key]) => !WORKFLOW_RUNTIME_DATA_KEYS.has(key)))
  return {
    ...node,
    selected: false,
    dragging: false,
    data: nextData,
  }
}

function projectWorkflowGraph(
  nodes: readonly Node[],
  edges: readonly Edge[],
  group: Node,
): ReusableWorkflowGraph {
  const nodeIds = descendantsOf(group.id, nodes)
  const projectedNodes = nodes.filter((node) => nodeIds.has(node.id)).map(withoutRuntimeData)
  const projectedEdges = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ ...edge, selected: false, animated: false }))
  if (projectedNodes.length < 2) throw new Error('工作流组中没有可复用的原子节点')
  const groupData = record(group.data)
  return {
    name: text(groupData.label) || '智能体工作流',
    nodes: projectedNodes,
    edges: projectedEdges,
  }
}

export function createReusableWorkflowGraph(
  nodes: readonly Node[],
  edges: readonly Edge[],
): ReusableWorkflowGraph {
  return projectWorkflowGraph(nodes, edges, resolveSingleWorkflowGroup(nodes, true))
}

export function readReusableWorkflowGraph(
  input: CanvasImportData | SerializedCanvas | null | undefined,
): ReusableWorkflowGraph {
  const graph = extractCanvasGraph(input)
  if (!graph) throw new Error('工作流文件没有合法的节点与连接')
  return projectWorkflowGraph(graph.nodes, graph.edges, resolveSingleWorkflowGroup(graph.nodes, false))
}

export function remapImportedWorkflowInstanceData(
  data: unknown,
  workflowInstanceIds: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const source = record(data)
  const currentId = text(source.workflowInstanceId)
  const nextId = currentId ? workflowInstanceIds.get(currentId) : null
  return {
    ...source,
    ...(nextId ? { workflowInstanceId: nextId } : {}),
  }
}
