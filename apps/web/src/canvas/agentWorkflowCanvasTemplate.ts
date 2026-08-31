import type { Node } from '@xyflow/react'
import {
  ADMIN_WORKFLOW_PERMISSION,
  AGENT_WORKFLOW_KEY,
  createManualWorkflowTriggerSpec,
  createScheduleWorkflowTriggerSpec,
  createWebhookWorkflowTriggerSpec,
  createEventWorkflowTriggerSpec,
  type WorkflowAtomicNodeCategory,
  type WorkflowAtomicNodeSpecV1,
  type WorkflowNodeExecutionMode,
} from '@tapcanvas/workflow-kernel-protocol'
import { isCurrentUserAdmin } from '../auth/isAdmin'
import { useRFStore } from './store'
import { workflowPortHandleId } from './workflowCanvasPorts'
import {
  WORKFLOW_ICON_NODE_COLUMN_STRIDE,
  WORKFLOW_ICON_NODE_SIZE,
} from './workflowNodeGeometry'

export type AtomicWorkflowPresetId =
  | 'source'
  | 'textInput'
  | 'javascript'
  | 'collectionSplit'
  | 'agent'
  | 'imageGeneration'
  | 'videoGeneration'
  | 'skill'
  | 'knowledgeSearch'
  | 'knowledgeRead'
  | 'toolInvocation'
  | 'humanApproval'
  | 'condition'
  | 'terminal'
  | 'subworkflow'
  | 'tool'
  | 'control'
  | 'artifact'
  | 'delivery'

export type AtomicWorkflowPreset = Readonly<{
  id: AtomicWorkflowPresetId
  label: string
  category: WorkflowAtomicNodeCategory
  operation: string
  executorRef: string | null
  executionMode: WorkflowNodeExecutionMode
  inputPorts: readonly string[]
  optionalInputPorts?: readonly string[]
  outputPorts: readonly string[]
  selectiveOutputPorts?: readonly string[]
  description: string
  instruction?: string
  agentOutputArtifactType?: string
  allowedTools?: readonly string[]
  cachePolicy?: WorkflowAtomicNodeSpecV1['cachePolicy']
}>

export const ATOMIC_WORKFLOW_PRESETS: Readonly<Record<AtomicWorkflowPresetId, AtomicWorkflowPreset>> = {
  source: {
    id: 'source',
    label: '输入来源',
    category: 'source',
    operation: 'workflow_input',
    executorRef: 'workflow.input/v1',
    executionMode: 'once',
    inputPorts: ['trigger'],
    outputPorts: ['input-facts'],
    cachePolicy: { version: 1, strategy: 'content_addressed', contractVersion: 'workflow.input/v1@1' },
    description: '声明本次执行使用的真实输入与上下文范围。',
  },
  textInput: {
    id: 'textInput',
    label: '文本输入',
    category: 'source',
    operation: 'text_input',
    executorRef: 'workflow.input.text/v1',
    executionMode: 'once',
    inputPorts: ['trigger'],
    outputPorts: ['text'],
    cachePolicy: { version: 1, strategy: 'content_addressed', contractVersion: 'workflow.input.text/v1@1' },
    description: '提供可直接用于节点测试或工作流运行的显式文本输入。',
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript 脚本',
    category: 'tool',
    operation: 'javascript',
    executorRef: 'workflow.script.javascript/v1',
    executionMode: 'each',
    inputPorts: ['input'],
    outputPorts: ['result'],
    description: '用管理员可信 JavaScript 在本地独立子进程中转换上游 JSON 值。',
  },
  collectionSplit: {
    id: 'collectionSplit',
    label: '拆分为数据项',
    category: 'control',
    operation: 'collection_split',
    executorRef: 'workflow.collection.split/v1',
    executionMode: 'once',
    inputPorts: ['value'],
    outputPorts: ['items'],
    description: '把上游显式数组转换为带稳定身份和来源追踪的数据项集合。',
  },
  agent: {
    id: 'agent',
    label: 'Agent 任务',
    category: 'agent',
    operation: 'agent_task',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'each',
    inputPorts: ['input', 'skills', 'tools', 'knowledge-candidates', 'knowledge-evidence'],
    optionalInputPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence'],
    outputPorts: ['result'],
    description: '由 agents-cli 自主规划、调用能力并完成明确目标。',
  },
  imageGeneration: {
    id: 'imageGeneration',
    label: '图片生成',
    category: 'media',
    operation: 'image_generate',
    executorRef: 'tapcanvas.image.generate/v1',
    executionMode: 'each',
    inputPorts: ['prompt-package'],
    outputPorts: ['image'],
    description: '消费 Agent 动态生成的结构化提示词包，逐项提交真实图片任务并等待持久图片 URL。',
  },
  videoGeneration: {
    id: 'videoGeneration',
    label: '视频生成',
    category: 'media',
    operation: 'video_generate',
    executorRef: 'tapcanvas.video.generate/v1',
    executionMode: 'each',
    inputPorts: ['prompt'],
    outputPorts: ['video'],
    description: '逐项提交真实视频任务；受理后持久等待同一 taskId，成片 URL 到达后才放行下游。',
  },
  skill: {
    id: 'skill',
    label: 'Skill',
    category: 'skill',
    operation: 'skill_requirement',
    executorRef: 'agents.skill.require/v1',
    executionMode: 'once',
    inputPorts: ['trigger'],
    outputPorts: ['skills'],
    cachePolicy: { version: 1, strategy: 'content_addressed', contractVersion: 'agents.skill.require/v1@1' },
    description: '把必须加载的 Skill 身份作为 Agent 的显式配置输入。',
  },
  knowledgeSearch: {
    id: 'knowledgeSearch',
    label: '知识检索',
    category: 'tool',
    operation: 'knowledge_search',
    executorRef: 'agents.knowledge.search/v1',
    executionMode: 'once',
    inputPorts: ['query'],
    optionalInputPorts: ['query'],
    outputPorts: ['knowledge-candidates'],
    description: '调用 agents-cli 的真实向量知识库，产出可持久、可审计的候选集；不替 Agent 选择卡片。',
  },
  knowledgeRead: {
    id: 'knowledgeRead',
    label: '知识读取',
    category: 'tool',
    operation: 'knowledge_read',
    executorRef: 'agents.knowledge.read/v1',
    executionMode: 'once',
    inputPorts: ['knowledge-candidates', 'card-id'],
    optionalInputPorts: ['card-id'],
    outputPorts: ['knowledge-evidence'],
    description: '只读取上游候选集内被明确选中的卡片，输出带候选集身份的完整知识证据。',
  },
  toolInvocation: {
    id: 'toolInvocation',
    label: '工具调用',
    category: 'tool',
    operation: 'tool_invocation',
    executorRef: 'agents.tool.invoke/v1',
    executionMode: 'once',
    inputPorts: ['arguments'],
    optionalInputPorts: ['arguments'],
    outputPorts: ['result'],
    description: '按当前作用域的真实工具目录解析精确 JSON Schema，结构校验通过后执行一次工具调用。',
  },
  humanApproval: {
    id: 'humanApproval',
    label: '人工审批',
    category: 'control',
    operation: 'human_approval',
    executorRef: 'workflow.human.approval/v1',
    executionMode: 'once',
    inputPorts: ['input'],
    optionalInputPorts: ['input'],
    outputPorts: ['decision'],
    description: '持久暂停当前执行，等待管理员明确批准或拒绝；响应后恢复同一 execution 与 node run。',
  },
  condition: {
    id: 'condition',
    label: '条件分支',
    category: 'control',
    operation: 'condition',
    executorRef: 'workflow.control.condition/v1',
    executionMode: 'once',
    inputPorts: ['value'],
    outputPorts: ['matched', 'unmatched'],
    selectiveOutputPorts: ['matched', 'unmatched'],
    description: '按显式 JSON Pointer 与结构运算符选择唯一输出分支；不做文本语义猜测。',
  },
  terminal: {
    id: 'terminal',
    label: '明确终态',
    category: 'control',
    operation: 'terminal',
    executorRef: 'workflow.control.terminal/v1',
    executionMode: 'once',
    inputPorts: ['input'],
    optionalInputPorts: ['input'],
    outputPorts: ['result'],
    description: '以显式配置结束当前选中路径；失败终态会如实终止工作流，成功终态保留可审计回执。',
  },
  subworkflow: {
    id: 'subworkflow',
    label: '子工作流',
    category: 'control',
    operation: 'subworkflow',
    executorRef: 'workflow.subworkflow.run/v1',
    executionMode: 'once',
    inputPorts: ['input'],
    optionalInputPorts: ['input'],
    outputPorts: ['result'],
    description: '运行指定 flow 的固定不可变版本，持久等待子 execution 完成，并输出全部子节点回执。',
  },
  tool: {
    id: 'tool',
    label: '工具授权',
    category: 'tool',
    operation: 'tool_capability',
    executorRef: 'agents.tool.allow/v1',
    executionMode: 'once',
    inputPorts: ['trigger'],
    outputPorts: ['tools'],
    cachePolicy: { version: 1, strategy: 'content_addressed', contractVersion: 'agents.tool.allow/v1@1' },
    description: '把精确工具 allowlist 作为 Agent 的显式授权输入；本节点不执行工具。',
  },
  control: {
    id: 'control',
    label: '控制节点',
    category: 'control',
    operation: 'join',
    executorRef: 'workflow.control.join/v1',
    executionMode: 'collect',
    inputPorts: ['branches'],
    outputPorts: ['joined'],
    description: '表达并行汇合、等待或后续控制策略。',
  },
  artifact: {
    id: 'artifact',
    label: '产物合同',
    category: 'artifact',
    operation: 'artifact_contract',
    executorRef: 'workflow.artifact.contract/v1',
    executionMode: 'collect',
    inputPorts: ['input'],
    outputPorts: ['artifact'],
    description: '声明节点消费与产出的可追溯事实类型。',
  },
  delivery: {
    id: 'delivery',
    label: '交付验收',
    category: 'delivery',
    operation: 'delivery_verify',
    executorRef: 'agents.delivery.verify/v2',
    executionMode: 'collect',
    inputPorts: ['result'],
    outputPorts: ['delivery-evidence'],
    description: '用 expectedDelivery → evidence → verification 裁决终态。',
  },
}

export type AgentWorkflowCanvasTemplateResult = Readonly<{
  workflowInstanceId: string
  workflowGroupId: string
  nodeIds: readonly string[]
}>

export function createIdentity(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持安全 UUID，无法创建可追踪的工作流实例')
  }
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

function selectedWorkflowContext(nodes: readonly Node[]): { workflowInstanceId: string; parentId: string | null } | null {
  const selected = nodes.filter((node) => node.selected)
  for (const node of selected) {
    const data = nodeData(node)
    const workflowInstanceId = typeof data.workflowInstanceId === 'string' ? data.workflowInstanceId.trim() : ''
    if (workflowInstanceId) {
      return { workflowInstanceId, parentId: node.type === 'groupNode' ? node.id : node.parentId ?? null }
    }
  }
  return null
}

export function workflowAnchor(nodes: readonly Node[]): { x: number; y: number } {
  const topLevel = nodes.filter((node) => !node.parentId)
  if (topLevel.length === 0) return { x: 120, y: 120 }
  const maxX = Math.max(...topLevel.map((node) => {
    const measuredWidth = typeof node.measured?.width === 'number' ? node.measured.width : null
    const styleWidth = typeof node.style?.width === 'number' ? node.style.width : null
    return node.position.x + (measuredWidth ?? styleWidth ?? 360)
  }))
  const minY = Math.min(...topLevel.map((node) => node.position.y))
  return { x: maxX + 160, y: minY }
}

export function atomicSpec(preset: AtomicWorkflowPreset): WorkflowAtomicNodeSpecV1 {
  return {
    version: 1,
    category: preset.category,
    operation: preset.operation,
    executorRef: preset.executorRef,
    executionMode: preset.executionMode,
    inputPorts: preset.inputPorts,
    ...(preset.optionalInputPorts ? { optionalInputPorts: preset.optionalInputPorts } : {}),
    outputPorts: preset.outputPorts,
    ...(preset.selectiveOutputPorts ? { selectiveOutputPorts: preset.selectiveOutputPorts } : {}),
    ...(preset.cachePolicy ? { cachePolicy: preset.cachePolicy } : {}),
  }
}

export function atomicNodeExtra(
  workflowInstanceId: string,
  preset: AtomicWorkflowPreset,
  nodeId: string,
): Record<string, unknown> {
  return {
    nodeId,
    autoLabel: false,
    kind: 'workflowStage',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowNodeId: nodeId.slice(nodeId.lastIndexOf(':') + 1) || preset.id,
    workflowNodeKind: preset.operation,
    workflowAtomicSpec: atomicSpec(preset),
    workflowInputPorts: [...preset.inputPorts],
    workflowOptionalInputPorts: [...(preset.optionalInputPorts ?? [])],
    workflowOutputPorts: [...preset.outputPorts],
    workflowSelectiveOutputPorts: [...(preset.selectiveOutputPorts ?? [])],
    workflowOperationDescription: preset.description,
    workflowStatus: 'queued',
    ...(preset.id === 'textInput' ? { workflowTextInput: '' } : {}),
    ...(preset.id === 'javascript' ? { workflowJavascriptCode: '', workflowJavascriptTestInput: '' } : {}),
    ...(preset.id === 'collectionSplit' ? {
      workflowCollectionPath: '',
      workflowCollectionParseJson: false,
      workflowCollectionItemIdField: '',
    } : {}),
    ...(preset.id === 'knowledgeSearch' ? {
      workflowKnowledgeQuery: '',
      workflowKnowledgeRoleScope: '',
      workflowKnowledgeDomain: '',
      workflowKnowledgeStrictFilters: false,
      workflowKnowledgeLimit: 5,
    } : {}),
    ...(preset.id === 'knowledgeRead' ? { workflowKnowledgeCardId: '' } : {}),
    ...(preset.id === 'toolInvocation' ? {
      workflowToolInvocationName: '',
      workflowToolInvocationArgs: '{}',
    } : {}),
    ...(preset.id === 'humanApproval' ? { workflowHumanPrompt: '' } : {}),
    ...(preset.id === 'condition' ? {
      workflowConditionPointer: '',
      workflowConditionOperator: 'equals',
      workflowConditionExpectedJson: 'true',
    } : {}),
    ...(preset.id === 'terminal' ? {
      workflowTerminalOutcome: 'succeeded',
      workflowTerminalMessage: '',
    } : {}),
    ...(preset.id === 'subworkflow' ? {
      workflowSubflowFlowId: '',
      workflowSubflowVersionId: '',
      workflowSubflowTriggerNodeId: '',
    } : {}),
    ...(preset.id === 'agent' ? {
      workflowAgentOutputArtifactType: 'tapcanvas.json/v1',
      workflowAgentOutputEncoding: 'plain_text',
      workflowAgentDeliveryRequirement: '',
      workflowAgentModelKey: '',
      workflowAgentMaxOutputTokens: 4096,
    } : {}),
    ...(preset.id === 'imageGeneration' ? {
      workflowImageModelSelection: '',
      workflowImageModelKey: '',
      workflowImageAspectRatio: '',
      workflowImageSize: '',
      workflowImageReferenceAssetBindings: [],
    } : {}),
    ...(preset.instruction ? { workflowInstruction: preset.instruction } : {}),
    ...(preset.agentOutputArtifactType ? { workflowAgentOutputArtifactType: preset.agentOutputArtifactType } : {}),
    ...(preset.allowedTools ? { workflowAllowedTools: [...preset.allowedTools] } : {}),
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  }
}

function defaultAgentWorkflowEdges(workflowInstanceId: string): readonly Readonly<{
  source: string
  sourcePort: string
  target: string
  targetPort: string
}>[] {
  const triggerNodeId = `${workflowInstanceId}:manual-trigger`
  const textInputNodeId = `${workflowInstanceId}:textInput`
  const agentNodeId = `${workflowInstanceId}:agent`
  const skillNodeId = `${workflowInstanceId}:skill`
  const toolNodeId = `${workflowInstanceId}:tool`
  const deliveryNodeId = `${workflowInstanceId}:delivery`
  return [
    { source: triggerNodeId, sourcePort: 'trigger', target: textInputNodeId, targetPort: 'trigger' },
    { source: triggerNodeId, sourcePort: 'trigger', target: skillNodeId, targetPort: 'trigger' },
    { source: triggerNodeId, sourcePort: 'trigger', target: toolNodeId, targetPort: 'trigger' },
    { source: textInputNodeId, sourcePort: 'text', target: agentNodeId, targetPort: 'input' },
    { source: skillNodeId, sourcePort: 'skills', target: agentNodeId, targetPort: 'skills' },
    { source: toolNodeId, sourcePort: 'tools', target: agentNodeId, targetPort: 'tools' },
    { source: agentNodeId, sourcePort: 'result', target: deliveryNodeId, targetPort: 'result' },
  ]
}

function connectAgentWorkflowEdges(workflowInstanceId: string): void {
  for (const edge of defaultAgentWorkflowEdges(workflowInstanceId)) {
    useRFStore.getState().onConnect({
      source: edge.source,
      target: edge.target,
      sourceHandle: workflowPortHandleId('output', edge.sourcePort),
      targetHandle: workflowPortHandleId('input', edge.targetPort),
    })
  }
}

export function connectWorkflowEdge(edge: Readonly<{
  source: string
  sourcePort: string
  target: string
  targetPort: string
}>): void {
  useRFStore.getState().onConnect({
    source: edge.source,
    target: edge.target,
    sourceHandle: workflowPortHandleId('output', edge.sourcePort),
    targetHandle: workflowPortHandleId('input', edge.targetPort),
  })
}

export function restoreAgentWorkflowDefaultConnections(workflowInstanceId: string): number {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以重建工作流连接')
  const normalizedWorkflowId = workflowInstanceId.trim()
  if (!normalizedWorkflowId) throw new Error('缺少工作流实例身份')
  const store = useRFStore.getState()
  const presetIds: readonly AtomicWorkflowPresetId[] = ['textInput', 'agent', 'skill', 'tool', 'delivery']
  const expectedNodeIds = new Set([
    `${normalizedWorkflowId}:manual-trigger`,
    ...presetIds.map((presetId) => `${normalizedWorkflowId}:${presetId}`),
  ])
  const missingNodeId = Array.from(expectedNodeIds).find((nodeId) => !store.nodes.some((node) => node.id === nodeId))
  if (missingNodeId) throw new Error(`不能重建连接：标准模板缺少节点 ${missingNodeId}`)
  for (const presetId of presetIds) {
    const preset = ATOMIC_WORKFLOW_PRESETS[presetId]
    store.updateNodeData(`${normalizedWorkflowId}:${presetId}`, {
      workflowAtomicSpec: atomicSpec(preset),
      workflowInputPorts: [...preset.inputPorts],
      workflowOptionalInputPorts: [...(preset.optionalInputPorts ?? [])],
      workflowOutputPorts: [...preset.outputPorts],
      workflowOperationDescription: preset.description,
    })
  }
  const internalEdgeIds = useRFStore.getState().edges
    .filter((edge) => expectedNodeIds.has(edge.source) && expectedNodeIds.has(edge.target))
    .map((edge) => edge.id)
  for (const edgeId of internalEdgeIds) useRFStore.getState().deleteEdge(edgeId)
  connectAgentWorkflowEdges(normalizedWorkflowId)
  return defaultAgentWorkflowEdges(normalizedWorkflowId).length
}

export function addAtomicWorkflowNode(presetId: AtomicWorkflowPresetId): string {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const preset = ATOMIC_WORKFLOW_PRESETS[presetId]
  const store = useRFStore.getState()
  const context = selectedWorkflowContext(store.nodes)
  const workflowInstanceId = context?.workflowInstanceId ?? createIdentity('agent-workflow')
  const nodeId = `${workflowInstanceId}:${preset.id}-${createIdentity('node')}`
  store.addNode('taskNode', preset.label, {
    ...atomicNodeExtra(workflowInstanceId, preset, nodeId),
    parentId: context?.parentId ?? undefined,
  })
  return nodeId
}

export function addManualWorkflowTrigger(): string {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const store = useRFStore.getState()
  const context = selectedWorkflowContext(store.nodes)
  const workflowInstanceId = context?.workflowInstanceId ?? createIdentity('agent-workflow')
  const nodeId = `${workflowInstanceId}:manual-trigger-${createIdentity('node')}`
  store.addNode('taskNode', '手动触发', {
    nodeId,
    autoLabel: false,
    parentId: context?.parentId ?? undefined,
    kind: 'workflowTrigger',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowTriggerSpec: createManualWorkflowTriggerSpec(),
    workflowOutputPorts: ['trigger'],
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  })
  return nodeId
}

export function addScheduleWorkflowTrigger(): string {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim()
  if (!timezone) throw new Error('浏览器未提供 IANA 时区，无法创建定时触发器')
  const store = useRFStore.getState()
  const context = selectedWorkflowContext(store.nodes)
  const workflowInstanceId = context?.workflowInstanceId ?? createIdentity('agent-workflow')
  const nodeId = `${workflowInstanceId}:schedule-trigger-${createIdentity('node')}`
  store.addNode('taskNode', '定时触发', {
    nodeId,
    autoLabel: false,
    parentId: context?.parentId ?? undefined,
    kind: 'workflowTrigger',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowTriggerSpec: createScheduleWorkflowTriggerSpec({
      scheduleId: createIdentity('schedule'),
      cron: '0 9 * * *',
      timezone,
      enabled: false,
      misfirePolicy: 'skip',
      maxCatchUpRuns: 0,
    }),
    workflowOutputPorts: ['trigger'],
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  })
  return nodeId
}

function addExternalWorkflowTrigger(kind: 'webhook' | 'event'): string {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const store = useRFStore.getState()
  const context = selectedWorkflowContext(store.nodes)
  const workflowInstanceId = context?.workflowInstanceId ?? createIdentity('agent-workflow')
  const nodeId = `${workflowInstanceId}:${kind}-trigger-${createIdentity('node')}`
  const workflowTriggerSpec = kind === 'webhook'
    ? createWebhookWorkflowTriggerSpec({
      webhookId: createIdentity('webhook'),
      secretRef: 'env://TAPCANVAS_WORKFLOW_WEBHOOK_SECRET',
    })
    : createEventWorkflowTriggerSpec({ topic: 'tapcanvas.workflow.event', filter: {} })
  store.addNode('taskNode', kind === 'webhook' ? 'Webhook 触发' : '事件触发', {
    nodeId,
    autoLabel: false,
    parentId: context?.parentId ?? undefined,
    kind: 'workflowTrigger',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowTriggerSpec,
    workflowOutputPorts: ['trigger'],
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  })
  return nodeId
}

export function addWebhookWorkflowTrigger(): string {
  return addExternalWorkflowTrigger('webhook')
}

export function addEventWorkflowTrigger(): string {
  return addExternalWorkflowTrigger('event')
}

export function createAgentWorkflowCanvasTemplate(): AgentWorkflowCanvasTemplateResult {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以创建工作流编排节点')
  const store = useRFStore.getState()
  const workflowInstanceId = createIdentity('agent-workflow')
  const anchor = workflowAnchor(store.nodes)
  const triggerNodeId = `${workflowInstanceId}:manual-trigger`
  store.addNode('taskNode', '手动触发', {
    nodeId: triggerNodeId,
    autoLabel: false,
    position: anchor,
    kind: 'workflowTrigger',
    nodeWidth: WORKFLOW_ICON_NODE_SIZE,
    nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowTriggerSpec: createManualWorkflowTriggerSpec(),
    workflowOutputPorts: ['trigger'],
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
    status: 'idle',
  })

  const presetIds: readonly AtomicWorkflowPresetId[] = ['textInput', 'agent', 'skill', 'tool', 'delivery']
  const stageNodeIds = presetIds.map((presetId, index) => {
    const preset = ATOMIC_WORKFLOW_PRESETS[presetId]
    const nodeId = `${workflowInstanceId}:${presetId}`
    store.addNode('taskNode', preset.label, {
      ...atomicNodeExtra(workflowInstanceId, preset, nodeId),
      position: { x: anchor.x + (index + 1) * WORKFLOW_ICON_NODE_COLUMN_STRIDE, y: anchor.y },
      ...(presetId === 'textInput' ? { workflowTextInput: '' } : {}),
      ...(presetId === 'agent' ? { workflowInstruction: '' } : {}),
      ...(presetId === 'skill' ? { workflowSkillId: '' } : {}),
      ...(presetId === 'tool' ? { workflowToolId: '' } : {}),
      ...(presetId === 'delivery' ? { workflowDeliveryRequirement: '' } : {}),
    })
    return nodeId
  })
  const nodeIds = [triggerNodeId, ...stageNodeIds]
  connectAgentWorkflowEdges(workflowInstanceId)
  const workflowGroupId = store.createGroupForNodeIds(nodeIds, '智能体工作流', { preserveLayout: true })
  if (!workflowGroupId) throw new Error('工作流节点已经创建，但未能建立工作流组')
  useRFStore.getState().updateNodeData(workflowGroupId, {
    workflowKey: AGENT_WORKFLOW_KEY,
    workflowDefinitionVersion: 1,
    workflowInstanceId,
    workflowPermission: ADMIN_WORKFLOW_PERMISSION,
    adminWorkflow: true,
  })
  useRFStore.getState().arrangeGroupChildren(workflowGroupId, 'flow')
  return { workflowInstanceId, workflowGroupId, nodeIds }
}
