import type { Connection, Node } from '@xyflow/react'
import { VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT, VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION, VIDEO_PRODUCTION_WORKFLOW_DEFINITION, VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import { ADMIN_WORKFLOW_PERMISSION, createManualWorkflowTriggerSpec } from '@tapcanvas/workflow-kernel-protocol'
import { useRFStore } from './store'
import { getNodeAbsPosition } from './utils/nodeBounds'
import { isCurrentUserAdmin } from '../auth/isAdmin'
import { workflowPortHandleId } from './workflowCanvasPorts'
import { WORKFLOW_ICON_NODE_SIZE } from './workflowNodeGeometry'
import type { VideoWorkflowExecutionScope } from './videoWorkflowExecution'
import {
  NODE_WIDTH, NODE_HEIGHT, COLUMN_GAP, ROW_GAP, COLUMN_COUNT,
  VIDEO_WORKFLOW_EXECUTION_CONCURRENCY,
  workflowDefinitions, workflowEdges, assertWorkflowDefinitionTopology,
  readWorkflowExecutionVariant, atomicSpec, videoNodeRuntimeData, stageNodeId,
  type VideoAtomicEdgeDefinition, type VideoWorkflowCanvasTemplateResult, type VideoWorkflowExecutionVariant,
} from './videoWorkflowDefinition'
export * from './videoWorkflowDefinition'

const SOURCE_GAP = 160

function createIdentity(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持安全 UUID，无法创建可追踪的工作流实例')
  }
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

function isSourceGroup(node: Node): boolean {
  const data = nodeData(node)
  return node.type === 'groupNode' && data.adminWorkflow !== true
}

export function listWorkflowSourceGroups(nodes: readonly Node[]): readonly Readonly<{ value: string; label: string }>[] {
  return nodes.filter(isSourceGroup).map((node) => {
    const data = nodeData(node)
    const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : node.id
    return { value: node.id, label }
  })
}

function selectedSourceGroup(nodes: readonly Node[]): Node | null {
  const selected = nodes.filter((node) => node.selected)
  const directGroups = selected.filter(isSourceGroup)
  if (directGroups.length === 1) return directGroups[0]
  if (directGroups.length > 1) return null
  const parentIds = new Set(selected
    .map((node) => typeof node.parentId === 'string' ? node.parentId.trim() : '')
    .filter(Boolean))
  if (parentIds.size !== 1) return null
  const [parentId] = Array.from(parentIds)
  return nodes.find((node) => node.id === parentId && isSourceGroup(node)) ?? null
}

function sourceBounds(node: Node, nodes: readonly Node[]): { x: number; y: number; width: number } {
  const style = node.style ?? {}
  const measured = node.measured ?? {}
  const absolute = getNodeAbsPosition(node, new Map(nodes.map((item) => [item.id, item] as const)))
  const width = typeof measured.width === 'number'
    ? measured.width
    : typeof style.width === 'number'
      ? style.width
      : 420
  return { x: absolute.x, y: absolute.y, width }
}

function graphAnchor(nodes: readonly Node[], source: Node | null): { x: number; y: number } {
  if (source) {
    const bounds = sourceBounds(source, nodes)
    return { x: bounds.x + bounds.width + SOURCE_GAP, y: bounds.y }
  }
  const topLevelNodes = nodes.filter((node) => !node.parentId)
  if (topLevelNodes.length === 0) return { x: 120, y: 120 }
  const maxX = Math.max(...topLevelNodes.map((node) => {
    const bounds = sourceBounds(node, nodes)
    return bounds.x + bounds.width
  }))
  const minY = Math.min(...topLevelNodes.map((node) => getNodeAbsPosition(node, new Map(nodes.map((item) => [item.id, item] as const))).y))
  return { x: maxX + SOURCE_GAP, y: minY }
}

function connectVideoWorkflowEdge(workflowInstanceId: string, edge: VideoAtomicEdgeDefinition): void {
  const connection: Connection = {
    source: stageNodeId(workflowInstanceId, edge.sourceNodeId),
    target: stageNodeId(workflowInstanceId, edge.targetNodeId),
    sourceHandle: workflowPortHandleId('output', edge.sourcePort),
    targetHandle: workflowPortHandleId('input', edge.targetPort),
  }
  useRFStore.getState().onConnect(connection)
}

export function restoreVideoWorkflowDefaultConnections(workflowInstanceId: string): number {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以重建工作流连接')
  const normalizedWorkflowId = workflowInstanceId.trim()
  if (!normalizedWorkflowId) throw new Error('缺少工作流实例身份')
  const store = useRFStore.getState()
  const trigger = store.nodes.find((node) => node.id === stageNodeId(normalizedWorkflowId, 'manual-trigger'))
  const triggerData = trigger ? nodeData(trigger) : {}
  const workflowGroup = trigger?.parentId
    ? store.nodes.find((node) => node.id === trigger.parentId && node.type === 'groupNode')
    : undefined
  const workflowGroupData = workflowGroup ? nodeData(workflowGroup) : {}
  const executionScope = triggerData.workflowExecutionScope
  if (executionScope !== 'prompt_only' && executionScope !== 'media_delivery') {
    throw new Error('不能重建连接：触发器缺少不可变执行范围')
  }
  const executionVariant = readWorkflowExecutionVariant(workflowGroupData.workflowExecutionVariant)
  const definitions = workflowDefinitions(executionScope, executionVariant)
  const edges = workflowEdges(executionScope, executionVariant)
  const expectedNodeIds = new Set([
    stageNodeId(normalizedWorkflowId, 'manual-trigger'),
    ...definitions.map((node) => stageNodeId(normalizedWorkflowId, node.nodeId)),
  ])
  const existingNodeIds = new Set(store.nodes.map((node) => node.id))
  const missingNodeId = Array.from(expectedNodeIds).find((nodeId) => !existingNodeIds.has(nodeId))
  if (missingNodeId) throw new Error(`不能重建连接：工作流缺少节点 ${missingNodeId}`)

  let addedCount = 0
  for (const edge of edges) {
    const source = stageNodeId(normalizedWorkflowId, edge.sourceNodeId)
    const target = stageNodeId(normalizedWorkflowId, edge.targetNodeId)
    const sourceHandle = workflowPortHandleId('output', edge.sourcePort)
    const targetHandle = workflowPortHandleId('input', edge.targetPort)
    const exists = useRFStore.getState().edges.some((candidate) => (
      candidate.source === source
      && candidate.target === target
      && candidate.sourceHandle === sourceHandle
      && candidate.targetHandle === targetHandle
    ))
    if (exists) continue
    connectVideoWorkflowEdge(normalizedWorkflowId, edge)
    addedCount += 1
  }
  return addedCount
}

function assertSourceGroupAvailable(nodes: readonly Node[], sourceGroupId: string, workflowInstanceId: string): Node {
  const source = nodes.find((node) => node.id === sourceGroupId && isSourceGroup(node))
  if (!source) throw new Error('所选来源组不存在或不是可绑定的普通画布组')
  const duplicate = nodes.some((node) => {
    const data = nodeData(node)
    return data.workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
      && data.workflowInstanceId !== workflowInstanceId
      && data.sourceGroupId === sourceGroupId
  })
  if (duplicate) throw new Error('该来源组已经绑定其他一键成片工作流')
  return source
}

export function bindVideoWorkflowSourceGroup(workflowInstanceId: string, sourceGroupId: string): void {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以绑定工作流来源')
  const normalizedWorkflowId = workflowInstanceId.trim()
  const normalizedSourceId = sourceGroupId.trim()
  if (!normalizedWorkflowId || !normalizedSourceId) throw new Error('缺少工作流或来源组身份')
  const store = useRFStore.getState()
  assertSourceGroupAvailable(store.nodes, normalizedSourceId, normalizedWorkflowId)
  const workflowNodeIds = store.nodes
    .filter((node) => nodeData(node).workflowInstanceId === normalizedWorkflowId)
    .map((node) => node.id)
  for (const nodeId of workflowNodeIds) {
    store.updateNodeData(nodeId, {
      sourceGroupId: normalizedSourceId,
      sourceBindingStatus: 'bound',
      ...(nodeId.endsWith(':canvas-source') ? { workflowSourceMode: 'canvas_group' } : {}),
    })
  }
}

export function createVideoWorkflowCanvasTemplate(input: Readonly<{
  executionScope?: VideoWorkflowExecutionScope
  executionVariant?: VideoWorkflowExecutionVariant
}> = {}): VideoWorkflowCanvasTemplateResult {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const store = useRFStore.getState()
  const sourceGroup = selectedSourceGroup(store.nodes)
  if (sourceGroup) assertSourceGroupAvailable(store.nodes, sourceGroup.id, '')
  const executionScope = input.executionScope ?? 'media_delivery'
  const executionVariant = input.executionVariant ?? 'full_video'
  if (executionScope === 'prompt_only' && executionVariant !== 'full_video') {
    throw new Error('提示词工作流不支持首视频媒体变体')
  }
  const definitions = workflowDefinitions(executionScope, executionVariant)
  const edges = workflowEdges(executionScope, executionVariant)
  assertWorkflowDefinitionTopology(definitions, edges)

  const workflowInstanceId = createIdentity('video-workflow')
  const anchor = graphAnchor(store.nodes, sourceGroup)
  const triggerNodeId = stageNodeId(workflowInstanceId, 'manual-trigger')
  store.addNode('taskNode', '手动触发', {
    nodeId: triggerNodeId,
    autoLabel: false,
    position: { x: anchor.x, y: anchor.y },
    kind: 'workflowTrigger',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
    workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
    workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
    workflowInstanceId,
    workflowExecutionScope: executionScope,
    workflowExecutionVariant: executionVariant,
    sourceGroupId: sourceGroup?.id,
    sourceBindingStatus: sourceGroup ? 'bound' : 'unbound',
    workflowTriggerSpec: createManualWorkflowTriggerSpec(),
    workflowExecutionConcurrency: VIDEO_WORKFLOW_EXECUTION_CONCURRENCY,
    workflowOutputPorts: ['trigger'],
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  })

  const stageNodeIds = definitions.map((definition, index) => {
    const nodeId = stageNodeId(workflowInstanceId, definition.nodeId)
    const linearIndex = index + 1
    const column = linearIndex % COLUMN_COUNT
    const row = Math.floor(linearIndex / COLUMN_COUNT)
    store.addNode('taskNode', definition.label, {
      nodeId,
      autoLabel: false,
      position: {
        x: anchor.x + column * (NODE_WIDTH + COLUMN_GAP),
        y: anchor.y + row * (NODE_HEIGHT + ROW_GAP),
      },
      kind: 'workflowStage',
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
      workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
      workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
      workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
      workflowInstanceId,
      workflowExecutionScope: executionScope,
      workflowExecutionVariant: executionVariant,
      workflowNodeId: definition.nodeId,
      workflowNodeKind: definition.operation,
      workflowAtomicSpec: atomicSpec(definition),
      workflowInputPorts: [...definition.inputPorts],
      workflowOptionalInputPorts: [...(definition.optionalInputPorts ?? [])],
      workflowOutputPorts: [...definition.outputPorts],
      workflowOperationDescription: definition.description,
      ...(definition.runtimeData ?? {}),
      ...videoNodeRuntimeData(definition),
      workflowSkillId: definition.skillId,
      workflowToolId: definition.toolId,
      workflowAgentOutputArtifactType: definition.agentOutputArtifactType,
      workflowOutputArtifactType: definition.agentOutputArtifactType ?? definition.outputArtifactType,
      workflowStatus: 'queued',
      ...(definition.nodeId === 'canvas-source' ? { workflowSourceMode: 'project_context' } : {}),
      sourceGroupId: sourceGroup?.id,
      sourceBindingStatus: sourceGroup ? 'bound' : 'unbound',
      workflowPermission: ADMIN_WORKFLOW_PERMISSION,
      adminWorkflow: true,
      status: 'idle',
    })
    return nodeId
  })
  const nodeIds = [triggerNodeId, ...stageNodeIds]

  for (const edge of edges) {
    connectVideoWorkflowEdge(workflowInstanceId, edge)
  }

  const workflowGroupLabel = executionScope === 'prompt_only'
    ? '一键成片 · 提示词工作流'
    : executionVariant === 'first_video'
      ? '一键成片 · 首视频验证工作流'
      : '一键成片 · 原子工作流'
  const workflowGroupId = store.createGroupForNodeIds(nodeIds, workflowGroupLabel, { preserveLayout: true })
  if (!workflowGroupId) throw new Error('工作流节点已经创建，但未能建立工作流组')
  useRFStore.getState().updateNodeData(workflowGroupId, {
    workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
    workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
    workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
    workflowInstanceId,
    workflowExecutionScope: executionScope,
    workflowExecutionVariant: executionVariant,
    sourceGroupId: sourceGroup?.id,
    sourceBindingStatus: sourceGroup ? 'bound' : 'unbound',
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
  })
  useRFStore.getState().arrangeGroupChildren(workflowGroupId, 'flow')
  return {
    workflowInstanceId,
    workflowGroupId,
    sourceGroupId: sourceGroup?.id ?? null,
    nodeIds,
  }
}
