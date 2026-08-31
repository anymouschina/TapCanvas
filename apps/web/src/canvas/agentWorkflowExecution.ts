import type { Node } from '@xyflow/react'
import {
  AGENT_WORKFLOW_KEY,
  WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
  WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN,
  WORKFLOW_CONCURRENCY_MAX,
  WORKFLOW_CONCURRENCY_MIN,
  WORKFLOW_ATOMIC_NODE_CATEGORIES,
  WORKFLOW_AGENT_OUTPUT_ENCODINGS,
  WORKFLOW_NODE_EXECUTION_MODES,
  type WorkflowAtomicNodeCategory,
  type WorkflowAgentOutputEncoding,
  type WorkflowNodeExecutionMode,
} from '@tapcanvas/workflow-kernel-protocol'
import { toast } from '../ui/toast'
import { useRFStore } from './store'
import { compileReachableWorkflowGraph } from './workflowCanvasGraph'
import { compileWorkflowPortEdges, type CompiledWorkflowEdge } from './workflowCanvasPorts'
import { requestWorkflowExecution } from './workflowExecutionRequest'

type CompiledWorkflowNode = Readonly<{
  id: string
  label: string
  category: WorkflowAtomicNodeCategory
  operation: string
  executorRef: string | null
  executionMode: WorkflowNodeExecutionMode
  itemConcurrency: number
  instruction: string | null
  skillId: string | null
  toolId: string | null
  deliveryRequirement: string | null
  inputDescription: string | null
  textInput: string | null
  javascriptCode: string | null
  agentDefinitionId: string | null
  agentModelKey: string | null
  agentMaxOutputTokens: number | null
  outputArtifactType: string | null
  outputEncoding: WorkflowAgentOutputEncoding | null
  agentDeliveryRequirement: string | null
}>

export type CompiledAgentWorkflow = Readonly<{
  protocolVersion: '1'
  workflowKey: typeof AGENT_WORKFLOW_KEY
  workflowInstanceId: string
  triggerNodeId: string
  nodes: readonly CompiledWorkflowNode[]
  edges: readonly CompiledWorkflowEdge[]
}>

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dataRecord(node: Node): Record<string, unknown> {
  return unknownRecord(node.data)
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readAtomicCategory(data: Record<string, unknown>): WorkflowAtomicNodeCategory | null {
  const spec = data.workflowAtomicSpec
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null
  const category = (spec as Record<string, unknown>).category
  return WORKFLOW_ATOMIC_NODE_CATEGORIES.find((candidate) => candidate === category) ?? null
}

function readAtomicField(data: Record<string, unknown>, key: string): string | null {
  const spec = data.workflowAtomicSpec
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null
  return readString(spec as Record<string, unknown>, key)
}

function readAgentOutputEncoding(data: Record<string, unknown>): WorkflowAgentOutputEncoding | null {
  const value = readString(data, 'workflowAgentOutputEncoding')
  return WORKFLOW_AGENT_OUTPUT_ENCODINGS.find((encoding) => encoding === value) ?? null
}

function hasPositiveInteger(data: Record<string, unknown>, key: string): boolean {
  const value = data[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function compileNode(node: Node): CompiledWorkflowNode | null {
  const data = dataRecord(node)
  const kind = readString(data, 'kind')
  const executorRef = readAtomicField(data, 'executorRef')
  const executableTextNode = kind === 'text' && executorRef === 'workflow.input.text/v1'
  if (kind !== 'workflowStage' && !executableTextNode) return null
  const category = readAtomicCategory(data)
  const operation = readAtomicField(data, 'operation')
  const rawExecutionMode = readAtomicField(data, 'executionMode')
  const executionMode = WORKFLOW_NODE_EXECUTION_MODES.find((mode) => mode === rawExecutionMode)
  if (!category || !operation || !executionMode) throw new Error(`节点“${readString(data, 'label') ?? node.id}”缺少完整原子节点合同`)
  const rawItemConcurrency = unknownRecord(data.workflowAtomicSpec).itemConcurrency
  const itemConcurrency = rawItemConcurrency === undefined
    ? 1
    : typeof rawItemConcurrency === 'number'
      && Number.isInteger(rawItemConcurrency)
      && rawItemConcurrency >= WORKFLOW_CONCURRENCY_MIN
      && rawItemConcurrency <= WORKFLOW_CONCURRENCY_MAX
      ? rawItemConcurrency
      : null
  if (itemConcurrency === null) {
    throw new Error(`节点“${readString(data, 'label') ?? node.id}”的逐项并发上限必须是 ${WORKFLOW_CONCURRENCY_MIN}–${WORKFLOW_CONCURRENCY_MAX} 的整数`)
  }
  return {
    id: node.id,
    label: readString(data, 'label') ?? node.id,
    category,
    operation,
    executorRef,
    executionMode,
    itemConcurrency,
    instruction: readString(data, 'workflowInstruction'),
    skillId: readString(data, 'workflowSkillId'),
    toolId: readString(data, 'workflowToolId'),
    deliveryRequirement: readString(data, 'workflowDeliveryRequirement'),
    inputDescription: readString(data, 'workflowInputDescription'),
    textInput: readString(data, 'workflowTextInput') ?? readString(data, 'prompt') ?? readString(data, 'content'),
    javascriptCode: readString(data, 'workflowJavascriptCode'),
    agentDefinitionId: readString(data, 'workflowAgentDefinitionId'),
    agentModelKey: readString(data, 'workflowAgentModelKey'),
    agentMaxOutputTokens: typeof data.workflowAgentMaxOutputTokens === 'number'
      && Number.isInteger(data.workflowAgentMaxOutputTokens)
      ? data.workflowAgentMaxOutputTokens
      : null,
    outputArtifactType: readString(data, 'workflowAgentOutputArtifactType'),
    outputEncoding: readAgentOutputEncoding(data),
    agentDeliveryRequirement: readString(data, 'workflowAgentDeliveryRequirement'),
  }
}

export function compileAgentWorkflow(triggerNodeId: string, stopAfterNodeId?: string): CompiledAgentWorkflow {
  const store = useRFStore.getState()
  const trigger = store.nodes.find((node) => node.id === triggerNodeId)
  if (!trigger) throw new Error('触发器节点不存在')
  const triggerData = dataRecord(trigger)
  if (triggerData.workflowKey !== AGENT_WORKFLOW_KEY) throw new Error('该触发器不是通用智能体工作流')
  const workflowInstanceId = readString(triggerData, 'workflowInstanceId')
  if (!workflowInstanceId) throw new Error('触发器缺少工作流实例身份')
  const partialExecution = Boolean(stopAfterNodeId?.trim())

  const graph = compileReachableWorkflowGraph({
    triggerNodeId,
    ...(stopAfterNodeId ? { stopAfterNodeId } : {}),
    nodes: store.nodes,
    edges: store.edges,
    isEligibleNode: (node) => {
      const data = dataRecord(node)
      return data.adminWorkflow === true
        && data.workflowKey === AGENT_WORKFLOW_KEY
        && data.workflowInstanceId === workflowInstanceId
    },
  })
  const compiledNodes = graph.nodes.map(compileNode).filter((node): node is CompiledWorkflowNode => node !== null)
  if (compiledNodes.length === 0) throw new Error('触发器后没有已连接的原子节点')
  const compiledEdges = compileWorkflowPortEdges(graph.nodes, graph.edges)

  for (const searchNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'knowledge_search')) {
    const data = dataRecord(searchNode)
    const hasQueryEdge = compiledEdges.some((edge) => edge.target === searchNode.id && edge.targetPort === 'query')
    if (!hasQueryEdge && !readString(data, 'workflowKnowledgeQuery')) {
      throw new Error(`知识检索节点“${readString(data, 'label') ?? searchNode.id}”需要查询输入或显式查询文本`)
    }
  }
  for (const readNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'knowledge_read')) {
    const data = dataRecord(readNode)
    const hasCardIdEdge = compiledEdges.some((edge) => edge.target === readNode.id && edge.targetPort === 'card-id')
    if (!hasCardIdEdge && !readString(data, 'workflowKnowledgeCardId')) {
      throw new Error(`知识读取节点“${readString(data, 'label') ?? readNode.id}”需要 Agent 输出的 card-id 或显式卡片身份`)
    }
  }
  for (const toolNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'tool_invocation')) {
    const data = dataRecord(toolNode)
    if (!readString(data, 'workflowToolInvocationName')) {
      throw new Error(`工具调用节点“${readString(data, 'label') ?? toolNode.id}”需要精确工具身份`)
    }
    const hasArgumentsEdge = compiledEdges.some((edge) => edge.target === toolNode.id && edge.targetPort === 'arguments')
    if (!hasArgumentsEdge) {
      const rawArgs = readString(data, 'workflowToolInvocationArgs')
      try {
        const parsed = JSON.parse(rawArgs ?? '{}') as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是 JSON 对象')
      } catch (error: unknown) {
        throw new Error(`工具调用节点“${readString(data, 'label') ?? toolNode.id}”的参数无效：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const emptyHumanApproval = graph.nodes.find((node) => {
    const data = dataRecord(node)
    return readAtomicField(data, 'operation') === 'human_approval' && !readString(data, 'workflowHumanPrompt')
  })
  if (emptyHumanApproval) {
    throw new Error(`人工审批节点“${readString(dataRecord(emptyHumanApproval), 'label') ?? emptyHumanApproval.id}”需要审批问题`)
  }
  for (const conditionNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'condition')) {
    const data = dataRecord(conditionNode)
    const label = readString(data, 'label') ?? conditionNode.id
    const operator = readString(data, 'workflowConditionOperator')
    const validOperators = new Set(['equals', 'not_equals', 'exists', 'is_true', 'is_false', 'greater_than', 'less_than'])
    if (!operator || !validOperators.has(operator)) throw new Error(`条件分支节点“${label}”需要有效的结构运算符`)
    const pointer = readString(data, 'workflowConditionPointer') ?? ''
    if (pointer && !pointer.startsWith('/')) throw new Error(`条件分支节点“${label}”的 JSON Pointer 必须以 / 开头`)
    if (operator === 'equals' || operator === 'not_equals' || operator === 'greater_than' || operator === 'less_than') {
      const expectedJson = readString(data, 'workflowConditionExpectedJson')
      if (!expectedJson) throw new Error(`条件分支节点“${label}”需要期望值 JSON`)
      try {
        JSON.parse(expectedJson)
      } catch (error: unknown) {
        throw new Error(`条件分支节点“${label}”的期望值不是有效 JSON：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  for (const terminalNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'terminal')) {
    const data = dataRecord(terminalNode)
    const label = readString(data, 'label') ?? terminalNode.id
    const outcome = readString(data, 'workflowTerminalOutcome')
    if (outcome !== 'succeeded' && outcome !== 'failed') throw new Error(`明确终态节点“${label}”需要选择成功或失败`)
    if (!readString(data, 'workflowTerminalMessage')) throw new Error(`明确终态节点“${label}”需要终态说明`)
  }
  for (const subworkflowNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'subworkflow')) {
    const data = dataRecord(subworkflowNode)
    const label = readString(data, 'label') ?? subworkflowNode.id
    if (!readString(data, 'workflowSubflowFlowId') || !readString(data, 'workflowSubflowVersionId') || !readString(data, 'workflowSubflowTriggerNodeId')) {
      throw new Error(`子工作流节点“${label}”需要目标 Flow、固定版本和版本内触发节点身份`)
    }
  }

  const emptyTextInput = compiledNodes.find((node) => node.operation === 'text_input' && !node.textInput)
  if (emptyTextInput) throw new Error(`文本输入节点“${emptyTextInput.label}”还没有填写测试文本`)
  const emptyJavascript = compiledNodes.find((node) => node.operation === 'javascript' && !node.javascriptCode)
  if (emptyJavascript) throw new Error(`JavaScript 节点“${emptyJavascript.label}”还没有填写脚本`)
  for (const videoNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'video_generate')) {
    const data = dataRecord(videoNode)
    const label = readString(data, 'label') ?? videoNode.id
    if (!readString(data, 'workflowVideoModelKey')) throw new Error(`视频节点“${label}”还没有从实时目录选择模型`)
    if (!hasPositiveInteger(data, 'workflowVideoDurationSeconds')) throw new Error(`视频节点“${label}”还没有选择模型支持的时长`)
    if (!readString(data, 'workflowVideoResolution')) throw new Error(`视频节点“${label}”还没有选择模型支持的分辨率`)
    if (!readString(data, 'workflowVideoAspectRatio')) throw new Error(`视频节点“${label}”还没有选择模型支持的画面比例`)
  }
  for (const imageNode of graph.nodes.filter((node) => readAtomicField(dataRecord(node), 'operation') === 'image_generate')) {
    const data = dataRecord(imageNode)
    const label = readString(data, 'label') ?? imageNode.id
    if (!readString(data, 'workflowImageModelKey')) throw new Error(`图片节点“${label}”还没有从实时目录选择模型`)
    if (!readString(data, 'workflowImageAspectRatio')) throw new Error(`图片节点“${label}”还没有选择模型支持的画面比例`)
    if (!readString(data, 'workflowImageSize')) throw new Error(`图片节点“${label}”还没有选择模型支持的图片尺寸`)
  }

  const agentNodes = compiledNodes.filter((node) => node.category === 'agent')
  if (!partialExecution && agentNodes.length === 0) throw new Error('工作流至少需要一个已连接的 Agent 节点')
  const emptyAgent = agentNodes.find((node) => !node.instruction)
  if (emptyAgent) throw new Error(`Agent 节点“${emptyAgent.label}”还没有填写任务目标`)
  const unboundAgent = agentNodes.find((node) => !node.agentDefinitionId)
  if (unboundAgent) throw new Error(`Agent 节点“${unboundAgent.label}”还没有选择执行智能体`)
  const unboundAgentModel = agentNodes.find((node) => !node.agentModelKey)
  if (unboundAgentModel) throw new Error(`Agent 节点“${unboundAgentModel.label}”还没有从实时目录选择文本模型`)
  const invalidAgentOutputBudget = agentNodes.find((node) => node.agentMaxOutputTokens === null
    || node.agentMaxOutputTokens < WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN
    || node.agentMaxOutputTokens > WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX)
  if (invalidAgentOutputBudget) throw new Error(`Agent 节点“${invalidAgentOutputBudget.label}”必须配置 ${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN}–${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX} 的单次最大输出 Token`)
  const emptyAgentOutput = agentNodes.find((node) => !node.outputArtifactType)
  if (emptyAgentOutput) throw new Error(`Agent 节点“${emptyAgentOutput.label}”还没有声明输出产物合同`)
  const emptyAgentOutputEncoding = agentNodes.find((node) => !node.outputEncoding)
  if (emptyAgentOutputEncoding) throw new Error(`Agent 节点“${emptyAgentOutputEncoding.label}”还没有声明输出端口格式`)
  const emptyAgentDelivery = agentNodes.find((node) => !node.agentDeliveryRequirement)
  if (emptyAgentDelivery) throw new Error(`Agent 节点“${emptyAgentDelivery.label}”还没有填写本节点交付合同`)
  const deliveryNodes = compiledNodes.filter((node) => node.category === 'delivery')
  if (!partialExecution && deliveryNodes.length === 0) throw new Error('工作流至少需要一个已连接的交付验收节点')
  const emptyDelivery = deliveryNodes.find((node) => !node.deliveryRequirement)
  if (emptyDelivery) throw new Error(`交付节点“${emptyDelivery.label}”还没有填写期望交付`)

  return {
    protocolVersion: '1',
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowInstanceId,
    triggerNodeId,
    nodes: compiledNodes,
    edges: compiledEdges,
  }
}

export function runAgentWorkflow(
  triggerNodeId: string,
  stopAfterNodeId?: string,
  replay?: Readonly<{ sourceExecutionId: string; startFromNodeId: string }>,
): void {
  const definition = compileAgentWorkflow(triggerNodeId, stopAfterNodeId)
  const requestedAt = new Date().toISOString()
  const store = useRFStore.getState()
  const affectedIds = new Set([definition.triggerNodeId, ...definition.nodes.map((node) => node.id)])
  for (const nodeId of affectedIds) {
    const node = store.nodes.find((candidate) => candidate.id === nodeId)
    const data = node ? dataRecord(node) : {}
    store.updateNodeData(nodeId, {
      workflowRequestedAt: requestedAt,
      previousWorkflowTraceId: data.workflowTraceId,
      workflowTraceId: undefined,
      workflowTraceStatus: undefined,
      workflowTraceUpdatedAt: undefined,
      workflowLogicalTaskId: undefined,
      workflowPhysicalRunId: undefined,
      ...(data.kind === 'workflowTrigger' ? { triggerStatus: 'requested' } : { workflowStatus: 'queued' }),
    })
  }

  requestWorkflowExecution(triggerNodeId, stopAfterNodeId, replay)
  toast(
    replay
      ? '正在保存当前画布，复用未变化的上游输出并从所选节点继续运行'
      : stopAfterNodeId
        ? '正在保存当前画布并执行到所选节点'
        : '正在保存当前画布并启动完整工作流执行',
    'info',
  )
}
