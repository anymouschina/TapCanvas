import type { Node } from '@xyflow/react'
import { VIDEO_PRODUCTION_WORKFLOW_DEFINITION, VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import {
  WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
  WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN,
  WORKFLOW_ATOMIC_NODE_CATEGORIES,
  type WorkflowAtomicNodeCategory,
} from '@tapcanvas/workflow-kernel-protocol'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
  VIDEO_WORKFLOW_MAX_CLIPS_MAX,
  VIDEO_WORKFLOW_MAX_CLIPS_MIN,
} from './videoWorkflowCanvasTemplate'
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
  executionScope: VideoWorkflowExecutionScope
  workflowInstanceId: string
  triggerNodeId: string
  source: CompiledVideoWorkflowSource
  nodes: readonly CompiledVideoWorkflowNode[]
  edges: readonly CompiledWorkflowEdge[]
}>

const PROMPT_ONLY_NODE_IDS = new Set([
  'canvas-source',
  'delivery-contract',
  'beat-sheet-agent',
  'beat-sheet-format',
  'clip-fan-out',
  'clip-writer-agent',
  'prompt-package',
])

function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readPositiveNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function configuredExecutionScope(data: Record<string, unknown>): VideoWorkflowExecutionScope {
	if (data.workflowExecutionScope === 'prompt_only' || data.workflowExecutionScope === 'media_delivery') {
		return data.workflowExecutionScope
	}
	throw new Error('一键成片触发器缺少不可变执行范围；请重新创建“完整成片”或“只出首个视频”模板')
}

function atomicSpec(data: Record<string, unknown>): Record<string, unknown> {
  const value = data.workflowAtomicSpec
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('原子节点缺少 workflowAtomicSpec')
  return value as Record<string, unknown>
}

function requestedMediaConfiguration(
  data: Record<string, unknown>,
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

function compileNode(node: Node): CompiledVideoWorkflowNode | null {
  const data = nodeData(node)
  if (data.kind !== 'workflowStage') return null
  const spec = atomicSpec(data)
  const categoryValue = spec.category
  const category = WORKFLOW_ATOMIC_NODE_CATEGORIES.find((candidate) => candidate === categoryValue)
  const operation = readString(spec, 'operation')
  const workflowNodeId = readString(data, 'workflowNodeId')
  if (!category || !operation || !workflowNodeId) throw new Error(`视频原子节点 ${node.id} 的合同不完整`)
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
    throw new Error(`Clip 上限节点 ${workflowNodeId} 必须配置 ${VIDEO_WORKFLOW_MAX_CLIPS_MIN}–${VIDEO_WORKFLOW_MAX_CLIPS_MAX} 的正整数`)
  }
  return {
    id: node.id,
    workflowNodeId,
    category,
    operation,
    executorRef: readString(spec, 'executorRef'),
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
    requestedMediaConfiguration: requestedMediaConfiguration(data, operation, workflowNodeId),
  }
}

export function compileVideoWorkflow(
  triggerNodeId: string,
): CompiledVideoWorkflow {
  const store = useRFStore.getState()
  const trigger = store.nodes.find((node) => node.id === triggerNodeId)
  if (!trigger) throw new Error('一键成片触发器不存在')
  const triggerData = nodeData(trigger)
  if (triggerData.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) throw new Error('该触发器不是一键成片工作流')
  const workflowInstanceId = readString(triggerData, 'workflowInstanceId')
  if (!workflowInstanceId) throw new Error('一键成片触发器缺少工作流实例身份')
  const executionScope = configuredExecutionScope(triggerData)

  const graph = compileReachableWorkflowGraph({
    triggerNodeId,
    nodes: store.nodes,
    edges: store.edges,
    isEligibleNode: (node) => {
      const data = nodeData(node)
      return data.adminWorkflow === true
        && data.workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
        && data.workflowInstanceId === workflowInstanceId
    },
  })
  const compiledNodes = graph.nodes.map(compileNode).filter((node): node is CompiledVideoWorkflowNode => node !== null)
  if (compiledNodes.length === 0) {
    const stageCount = store.nodes.filter((node) => {
      const data = nodeData(node)
      return data.workflowInstanceId === workflowInstanceId && data.kind === 'workflowStage'
    }).length
    if (stageCount > 0) {
      throw new Error(`触发器没有连接到原子图；当前实例有 ${stageCount} 个节点。请点击“重建默认连接”，或从 trigger 端口连接到“画布来源”`)
    }
    throw new Error('当前工作流实例没有原子节点，请重新创建一键成片原子模板')
  }
  const compiledEdges = compileWorkflowPortEdges(graph.nodes, graph.edges)
  const incompatibleEdge = compiledEdges.find((edge) => edge.sourcePort !== edge.targetPort)
  if (incompatibleEdge) {
    throw new Error(`一键成片端口类型不兼容：${incompatibleEdge.sourcePort} → ${incompatibleEdge.targetPort}`)
  }
  const sourceNode = graph.nodes.find((node) => {
    const compiled = compileNode(node)
    return compiled?.category === 'source'
  })
  if (!sourceNode) throw new Error('当前可达图缺少“画布来源”节点')
  if (executionScope === 'media_delivery' && !compiledNodes.some((node) => node.category === 'delivery')) {
    throw new Error('当前可达图缺少“交付验收”节点')
  }
  if (executionScope === 'prompt_only' && !compiledNodes.some((node) => node.workflowNodeId === 'prompt-package')) {
    throw new Error('当前提示词工作流缺少“提示词包汇总”终点')
  }
  const sourceNodeData = nodeData(sourceNode)
  const sourceMode = readString(sourceNodeData, 'workflowSourceMode') ?? 'canvas_group'
  let source: CompiledVideoWorkflowSource
  if (sourceMode === 'inline_text') {
    const text = readString(sourceNodeData, 'workflowSourceText')
    if (!text) throw new Error('请在“画布来源”节点中填写测试文本')
    source = { kind: 'inline_text', text }
  } else if (sourceMode === 'project_context') {
    source = { kind: 'project_context' }
  } else if (sourceMode === 'canvas_group') {
    const sourceGroupId = readString(sourceNodeData, 'sourceGroupId')
    if (!sourceGroupId) throw new Error('请在“画布来源”节点中绑定来源组，或切换为“测试文本”')
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
    throw new Error(`不支持的来源模式：${sourceMode}`)
  }

  const deliveryContractNode = graph.nodes.find((node) => readString(nodeData(node), 'workflowNodeId') === 'delivery-contract')
  const deliveryContractData = deliveryContractNode ? nodeData(deliveryContractNode) : {}
  const deliveryTargetDuration = deliveryContractNode
    ? readPositiveNumber(deliveryContractData, 'workflowTargetDurationSeconds')
    : null
  if (!deliveryTargetDuration || !Number.isInteger(deliveryTargetDuration)) {
    throw new Error('请在“成片交付合同”节点中填写正整数目标总时长')
  }
  const deliveryVideoModelKey = readString(deliveryContractData, 'workflowVideoModelKey')
  if (!deliveryVideoModelKey) {
    throw new Error('请在“成片交付合同”节点中选择用于时长规划的视频模型')
  }
  if (executionScope === 'media_delivery') {
    const estimateNode = compiledNodes.find((node) => node.workflowNodeId === 'cost-estimate')
    const estimateConfiguration = estimateNode?.requestedMediaConfiguration
    if (!estimateConfiguration || estimateConfiguration.kind !== 'video') {
      throw new Error('请在“费用预估”节点中选择视频模型、分辨率和比例')
    }
    if (estimateConfiguration.modelKey !== deliveryVideoModelKey) {
      throw new Error('“成片交付合同”的时长能力模型必须与“费用预估”的视频模型一致')
    }
  }

  const scopedNodes = executionScope === 'prompt_only'
    ? compiledNodes
      .filter((node) => PROMPT_ONLY_NODE_IDS.has(node.workflowNodeId))
      .map((node) => node.workflowNodeId === 'clip-fan-out'
        ? { ...node, inputPorts: node.inputPorts.filter((port) => port !== 'asset-items') }
        : node)
    : compiledNodes
  const scopedNodeIds = new Set([triggerNodeId, ...scopedNodes.map((node) => node.id)])
  const scopedEdges = executionScope === 'prompt_only'
    ? compiledEdges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target))
    : compiledEdges

  const agentNodes = scopedNodes.filter((node) => node.category === 'agent')
  const unboundAgent = agentNodes.find((node) => !node.agentDefinitionId)
  if (unboundAgent) throw new Error(`Agent 节点“${unboundAgent.workflowNodeId}”还没有选择执行智能体`)
  const unboundAgentModel = agentNodes.find((node) => !node.agentModelKey)
  if (unboundAgentModel) throw new Error(`Agent 节点“${unboundAgentModel.workflowNodeId}”还没有从实时目录选择文本模型`)
  const invalidAgentOutputBudget = agentNodes.find((node) => node.agentMaxOutputTokens === null
    || node.agentMaxOutputTokens < WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN
    || node.agentMaxOutputTokens > WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX)
  if (invalidAgentOutputBudget) {
    throw new Error(`Agent 节点“${invalidAgentOutputBudget.workflowNodeId}”必须配置 ${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN}–${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX} 的单次最大输出 Token`)
  }
  const incompleteAgentContract = agentNodes.find((node) => !node.instruction
    || !node.outputArtifactType
    || !node.outputEncoding
    || !node.deliveryRequirement)
  if (incompleteAgentContract) {
    throw new Error(`Agent 节点“${incompleteAgentContract.workflowNodeId}”缺少任务、输出格式或本节点交付合同`)
  }
  if (executionScope === 'media_delivery') {
    const unconfiguredMediaNode = scopedNodes.find((node) => (
      node.operation === 'image_generate' || node.operation === 'estimate'
    ) && node.requestedMediaConfiguration === null)
    if (unconfiguredMediaNode) {
      throw new Error(`媒体节点“${unconfiguredMediaNode.workflowNodeId}”还没有从实时目录完成模型与规格配置`)
    }
  }

  return {
    protocolVersion: '1',
    workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    backendDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
    canvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
    executionScope,
    workflowInstanceId,
    triggerNodeId,
    source,
    nodes: scopedNodes,
    edges: scopedEdges,
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
