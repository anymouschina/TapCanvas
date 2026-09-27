import type { Node } from '@xyflow/react'
import { VIDEO_PRODUCTION_WORKFLOW_DEFINITION, VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import {
  WORKFLOW_ATOMIC_NODE_CATEGORIES,
  type WorkflowAtomicNodeCategory,
} from '@tapcanvas/workflow-kernel-protocol'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
  VIDEO_WORKFLOW_MAX_CLIPS_MAX,
  VIDEO_WORKFLOW_MAX_CLIPS_MIN,
  atomicSpec,
  stageNodeId,
  videoNodeRuntimeData,
  workflowDefinitions,
  workflowEdges,
} from './videoWorkflowDefinition'
import { compileReachableWorkflowGraph } from './workflowCanvasGraph'
import { compileWorkflowPortEdges, type CompiledWorkflowEdge } from './workflowCanvasPorts'
import { markVideoWorkflowRequested } from './videoWorkflowProjectionSync'
import { requestWorkflowExecution } from './workflowExecutionRequest'
import { toast } from '../ui/toast'

type CompiledVideoWorkflowNode = Readonly<{
  id: string
  workflowNodeId: string
  category: WorkflowAtomicNodeCategory
  operation: string
  executorRef: string | null
  skillId: string | null
  toolId: string | null
  inputPorts: readonly string[]
  outputPorts: readonly string[]
  agentDefinitionId: string | null
  agentModelKey: string | null
  agentMaxOutputTokens: number | null
  outputArtifactType: string | null
  outputEncoding: string | null
  deliveryRequirement: string | null
  instruction: string | null
  maxClipCount: number | null
  requestedMediaConfiguration: CompiledVideoWorkflowMediaConfiguration
}>

type CompiledVideoWorkflowMediaConfiguration = Readonly<{
  kind: 'image'
  modelKey: string
  aspectRatio: string
  imageSize: string
}> | Readonly<{
  kind: 'video'
  modelKey: string
  resolution: string
  aspectRatio: string
}> | null

export type VideoWorkflowExecutionScope = 'media_delivery' | 'prompt_only'
export type VideoWorkflowExecutionVariant = 'full_video' | 'first_video'

type CompiledVideoWorkflowSource = Readonly<{
  kind: 'canvas_group'
  groupId: string
  sourceRecipeId: string | null
  targetDurationSeconds: number | null
  videoAspect: string | null
  videoModel: string | null
  videoProfileId: string | null
}> | Readonly<{
  kind: 'inline_text'
  text: string
}> | Readonly<{
  kind: 'project_context'
}>

export type CompiledVideoWorkflow = Readonly<{
  protocolVersion: '1'
  workflowKey: typeof VIDEO_PRODUCTION_WORKFLOW_KEY
  backendDefinitionVersion: number
  canvasDefinitionVersion: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
  canvasDefinitionFingerprint: typeof VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT
  executionScope: VideoWorkflowExecutionScope
  executionVariant: VideoWorkflowExecutionVariant
  workflowInstanceId: string
  triggerNodeId: string
  source: CompiledVideoWorkflowSource
  nodes: readonly CompiledVideoWorkflowNode[]
  edges: readonly CompiledWorkflowEdge[]
}>

type JsonRecord = Record<string, unknown>

function nodeData(node: Node): JsonRecord {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as JsonRecord
    : {}
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]))
}

function readString(data: JsonRecord, key: string): string | null {
  const value = data[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readPositiveNumber(data: JsonRecord, key: string): number | null {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readExecutionScope(data: JsonRecord, label: string): VideoWorkflowExecutionScope {
  if (data.workflowExecutionScope === 'prompt_only' || data.workflowExecutionScope === 'media_delivery') {
    return data.workflowExecutionScope
  }
  throw new Error(`${label} 缺少有效的不可变执行范围`)
}

function readExecutionVariant(data: JsonRecord, label: string): VideoWorkflowExecutionVariant {
  if (data.workflowExecutionVariant === 'full_video' || data.workflowExecutionVariant === 'first_video') {
    return data.workflowExecutionVariant
  }
  throw new Error(`${label} 缺少有效的不可变执行变体`)
}

function assertCurrentCanvasDefinition(data: JsonRecord, label: string): void {
  if (data.workflowCanvasDefinitionVersion !== VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
    || data.workflowCanvasDefinitionFingerprint !== VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT) {
    throw new Error(`${label} 的一键成片画布定义已过期；请重新创建 v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION} 工作流`)
  }
}

function requestedMediaConfiguration(
  data: JsonRecord,
  operation: string,
  workflowNodeId: string,
): CompiledVideoWorkflowMediaConfiguration {
  if (operation === 'image_generate') {
    const modelKey = readString(data, 'workflowImageModelKey')
    const aspectRatio = readString(data, 'workflowImageAspectRatio')
    const imageSize = readString(data, 'workflowImageSize')
    if (!modelKey && !aspectRatio && !imageSize) return null
    if (!modelKey || !aspectRatio || !imageSize) {
      throw new Error(`图片节点 ${workflowNodeId} 的显式模型、比例和尺寸必须同时完整`)
    }
    return { kind: 'image', modelKey, aspectRatio, imageSize }
  }
  if (operation === 'estimate') {
    const modelKey = readString(data, 'workflowVideoModelKey')
    const resolution = readString(data, 'workflowVideoResolution')
    const aspectRatio = readString(data, 'workflowVideoAspectRatio')
    if (!modelKey && !resolution && !aspectRatio) return null
    if (!modelKey || !resolution || !aspectRatio) {
      throw new Error(`费用节点 ${workflowNodeId} 的显式模型、分辨率和比例必须同时完整`)
    }
    return { kind: 'video', modelKey, resolution, aspectRatio }
  }
  return null
}

function assertNodeMatchesDefinition(node: Node, definition: ReturnType<typeof workflowDefinitions>[number]): void {
  const data = nodeData(node)
  const spec = data.workflowAtomicSpec
  const runtimeNodeData = videoNodeRuntimeData(definition)
  const runtimeSpec = runtimeNodeData.workflowAtomicSpec
  const definitionRuntimeSpec = definition.runtimeData?.workflowAtomicSpec
  const expectedSpec = isRecord(runtimeSpec)
    ? runtimeSpec
    : isRecord(definitionRuntimeSpec)
      ? definitionRuntimeSpec
      : atomicSpec(definition)
  if (node.type !== 'taskNode' || data.kind !== 'workflowStage'
    || data.workflowNodeId !== definition.nodeId
    || data.workflowNodeKind !== definition.operation
    || !structurallyEqual(spec, expectedSpec)
    || !structurallyEqual(data.workflowInputPorts, definition.inputPorts)
    || !structurallyEqual(data.workflowOptionalInputPorts, definition.optionalInputPorts ?? [])
    || !structurallyEqual(data.workflowOutputPorts, definition.outputPorts)) {
    throw new Error(`工作流节点 ${node.id} 与 v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION} typed-port 合同不一致`)
  }
}

function compileNode(node: Node, definition: ReturnType<typeof workflowDefinitions>[number]): CompiledVideoWorkflowNode {
  const data = nodeData(node)
  assertNodeMatchesDefinition(node, definition)
  const spec = data.workflowAtomicSpec as JsonRecord
  const category = WORKFLOW_ATOMIC_NODE_CATEGORIES.find((candidate) => candidate === spec.category)
  const operation = readString(spec, 'operation')
  if (!category || !operation) throw new Error(`视频原子节点 ${node.id} 的合同不完整`)
  const rawMaxClipCount = data.workflowBeatSheetTakeCount
  const maxClipCount = operation === 'max_clip'
    ? typeof rawMaxClipCount === 'number'
      && Number.isInteger(rawMaxClipCount)
      && rawMaxClipCount >= VIDEO_WORKFLOW_MAX_CLIPS_MIN
      && rawMaxClipCount <= VIDEO_WORKFLOW_MAX_CLIPS_MAX
        ? rawMaxClipCount
        : null
    : null
  if (operation === 'max_clip' && maxClipCount === null) {
    throw new Error(`Clip 上限节点 ${definition.nodeId} 必须配置 ${VIDEO_WORKFLOW_MAX_CLIPS_MIN}–${VIDEO_WORKFLOW_MAX_CLIPS_MAX} 的正整数`)
  }
  return {
    id: node.id,
    workflowNodeId: definition.nodeId,
    category,
    operation,
    executorRef: typeof spec.executorRef === 'string' ? spec.executorRef : null,
    skillId: readString(data, 'workflowSkillId'),
    toolId: readString(data, 'workflowToolId'),
    inputPorts: readStringArray(spec.inputPorts),
    outputPorts: readStringArray(spec.outputPorts),
    agentDefinitionId: readString(data, 'workflowAgentDefinitionId'),
    agentModelKey: readString(data, 'workflowAgentModelKey'),
    agentMaxOutputTokens: typeof data.workflowAgentMaxOutputTokens === 'number' && Number.isInteger(data.workflowAgentMaxOutputTokens)
      ? data.workflowAgentMaxOutputTokens
      : null,
    outputArtifactType: readString(data, 'workflowAgentOutputArtifactType') ?? readString(data, 'workflowOutputArtifactType'),
    outputEncoding: readString(data, 'workflowAgentOutputEncoding'),
    deliveryRequirement: readString(data, 'workflowAgentDeliveryRequirement') ?? readString(data, 'workflowDeliveryRequirement'),
    instruction: readString(data, 'workflowInstruction'),
    maxClipCount,
    requestedMediaConfiguration: requestedMediaConfiguration(data, operation, definition.nodeId),
  }
}

export function compileVideoWorkflow(triggerNodeId: string): CompiledVideoWorkflow {
  const normalizedTriggerNodeId = triggerNodeId.trim()
  if (!normalizedTriggerNodeId) throw new Error('一键成片触发器身份不能为空')
  const store = useRFStore.getState()
  const trigger = store.nodes.find((node) => node.id === normalizedTriggerNodeId)
  if (!trigger) throw new Error('一键成片触发器不存在')
  const triggerData = nodeData(trigger)
  if (trigger.type !== 'taskNode' || triggerData.kind !== 'workflowTrigger'
    || triggerData.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY
    || triggerData.adminWorkflow !== true) {
    throw new Error('该节点不是有效的一键成片工作流触发器')
  }
  const workflowInstanceId = readString(triggerData, 'workflowInstanceId')
  if (!workflowInstanceId) throw new Error('一键成片触发器缺少工作流实例身份')
  assertCurrentCanvasDefinition(triggerData, '一键成片触发器')
  const executionScope = readExecutionScope(triggerData, '一键成片触发器')
  const executionVariant = readExecutionVariant(triggerData, '一键成片触发器')
  if (executionScope === 'prompt_only' && executionVariant !== 'full_video') {
    throw new Error('提示词工作流不支持首视频媒体变体')
  }

  const group = typeof trigger.parentId === 'string'
    ? store.nodes.find((node) => node.id === trigger.parentId && node.type === 'groupNode')
    : undefined
  if (!group) throw new Error('一键成片触发器没有所属工作流组')
  const groupData = nodeData(group)
  assertCurrentCanvasDefinition(groupData, '一键成片工作流组')
  if (groupData.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY
    || groupData.adminWorkflow !== true
    || groupData.workflowInstanceId !== workflowInstanceId
    || readExecutionScope(groupData, '一键成片工作流组') !== executionScope
    || readExecutionVariant(groupData, '一键成片工作流组') !== executionVariant) {
    throw new Error('一键成片工作流组与触发器身份或执行范围不一致')
  }

  const definitions = workflowDefinitions(executionScope, executionVariant)
  const edges = workflowEdges(executionScope, executionVariant)
  const expectedById = new Map(definitions.map((definition) => [definition.nodeId, definition] as const))
  const expectedIds = new Set(definitions.map((definition) => stageNodeId(workflowInstanceId, definition.nodeId)))
  const instanceStages = store.nodes.filter((node) => {
    const data = nodeData(node)
    return data.workflowInstanceId === workflowInstanceId && data.kind === 'workflowStage'
  })
  if (instanceStages.length !== definitions.length) {
    throw new Error(`一键成片工作流节点数量与 v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION} 定义不一致`)
  }
  for (const node of instanceStages) {
    if (!expectedIds.has(node.id) || node.parentId !== group.id) {
      throw new Error(`工作流包含不属于当前 v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION} 组的阶段节点 ${node.id}`)
    }
  }
  for (const definition of definitions) {
    const nodeId = stageNodeId(workflowInstanceId, definition.nodeId)
    const node = instanceStages.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`工作流缺少 v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION} 阶段节点 ${definition.nodeId}`)
    const data = nodeData(node)
    assertCurrentCanvasDefinition(data, `工作流阶段节点 ${definition.nodeId}`)
    if (data.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY
      || data.adminWorkflow !== true
      || data.workflowInstanceId !== workflowInstanceId) {
      throw new Error(`工作流阶段节点 ${definition.nodeId} 的身份合同不一致`)
    }
    assertNodeMatchesDefinition(node, definition)
  }

  const graph = compileReachableWorkflowGraph({
    triggerNodeId: normalizedTriggerNodeId,
    nodes: store.nodes,
    edges: store.edges,
    isEligibleNode: (node) => {
      const data = nodeData(node)
      return data.adminWorkflow === true
        && data.workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
        && data.workflowInstanceId === workflowInstanceId
    },
  })
  const reachableStageIds = new Set(graph.nodes
    .filter((node) => node.id !== normalizedTriggerNodeId)
    .map((node) => node.id))
  const unreachableNodeId = Array.from(expectedIds).find((nodeId) => !reachableStageIds.has(nodeId))
  if (unreachableNodeId) {
    throw new Error(`工作流阶段节点 ${unreachableNodeId} 未连接到触发器可达图`)
  }
  const compiledEdges = compileWorkflowPortEdges(graph.nodes, graph.edges)
  const sourceNode = graph.nodes.find((node) => node.id === stageNodeId(workflowInstanceId, 'canvas-source'))
  if (!sourceNode) throw new Error('当前可达图缺少“画布来源”节点')
  if (executionScope === 'media_delivery'
    && !expectedById.has('delivery-verify')) {
    throw new Error('完整成片工作流定义缺少交付验收终点')
  }
  if (executionScope === 'prompt_only' && !expectedById.has('prompt-package')) {
    throw new Error('提示词工作流定义缺少提示词包终点')
  }

  const sourceNodeData = nodeData(sourceNode)
  const sourceMode = readString(sourceNodeData, 'workflowSourceMode')
  let source: CompiledVideoWorkflowSource
  if (sourceMode === 'inline_text') {
    const text = readString(sourceNodeData, 'workflowSourceText')
    if (!text) throw new Error('“画布来源”节点的测试文本为空')
    source = { kind: 'inline_text', text }
  } else if (sourceMode === 'project_context') {
    source = { kind: 'project_context' }
  } else if (sourceMode === 'canvas_group') {
    const sourceGroupId = readString(sourceNodeData, 'sourceGroupId')
    if (!sourceGroupId) throw new Error('“画布来源”节点没有绑定来源组')
    const sourceGroup = store.nodes.find((node) => {
      const data = nodeData(node)
      return node.id === sourceGroupId && node.type === 'groupNode' && data.adminWorkflow !== true
    })
    if (!sourceGroup) throw new Error('绑定的来源组已不存在，请重新选择')
    const sourceData = nodeData(sourceGroup)
    source = {
      kind: 'canvas_group',
      groupId: sourceGroupId,
      sourceRecipeId: readString(sourceData, 'sourceRecipeId'),
      targetDurationSeconds: readPositiveNumber(sourceData, 'targetDurationSeconds'),
      videoAspect: readString(sourceData, 'videoAspect'),
      videoModel: readString(sourceData, 'videoModel'),
      videoProfileId: readString(sourceData, 'videoProfileId'),
    }
  } else {
    throw new Error('“画布来源”节点缺少明确的来源模式')
  }

  const compiledNodes = graph.nodes.flatMap((node) => {
    if (node.id === normalizedTriggerNodeId) return []
    const workflowNodeId = readString(nodeData(node), 'workflowNodeId')
    const definition = workflowNodeId
      ? definitions.find((candidate) => candidate.nodeId === workflowNodeId)
      : undefined
    if (!definition) throw new Error(`触发器可达图包含未知工作流阶段节点 ${node.id}`)
    return [compileNode(node, definition)]
  })
  return {
    protocolVersion: '1',
    workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    backendDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
    canvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
    canvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
    executionScope,
    executionVariant,
    workflowInstanceId,
    triggerNodeId: normalizedTriggerNodeId,
    source,
    nodes: compiledNodes,
    edges: compiledEdges,
  }
}

function dispatchVideoWorkflow(definition: CompiledVideoWorkflow): void {
  const requestedAt = new Date().toISOString()
  markVideoWorkflowRequested(definition.workflowInstanceId, requestedAt, definition.executionScope)
  requestWorkflowExecution(definition.triggerNodeId)
  toast(
    definition.executionScope === 'prompt_only'
      ? '正在保存当前画布并启动提示词工作流；该范围不会提交图片或视频任务'
      : '正在保存当前画布并启动一键成片持久工作流',
    'info',
  )
}

export function runVideoWorkflow(triggerNodeId: string): void {
  dispatchVideoWorkflow(compileVideoWorkflow(triggerNodeId))
}
