import {
  WORKFLOW_ATOMIC_NODE_CATEGORIES,
  WORKFLOW_TRIGGER_KINDS,
  type WorkflowAtomicNodeCategory,
  type WorkflowTriggerKind,
} from '@tapcanvas/workflow-kernel-protocol'

export type WorkflowNodeVisualVariant = WorkflowAtomicNodeCategory | 'trigger' | 'stage'

export type WorkflowNodePresentation = Readonly<{
  variant: WorkflowNodeVisualVariant
  category: WorkflowAtomicNodeCategory | null
  categoryLabel: string
  operation: string
  operationLabel: string
  executorRef: string
  executionModeLabel: string
  triggerKind: WorkflowTriggerKind | 'invalid' | null
  inputPorts: readonly string[]
  outputPorts: readonly string[]
  summary: string
  iconUrl: string | null
}>

const CATEGORY_LABELS: Readonly<Record<WorkflowAtomicNodeCategory, string>> = {
  source: '数据输入',
  agent: '智能体',
  media: '媒体',
  skill: 'Skill',
  tool: '工具',
  control: '控制',
  artifact: '产物',
  delivery: '最终输出',
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  workflow_input: '上下文输入',
  canvas_source: '画布来源',
  delivery_contract: '成片交付合同',
  beat_sheet: 'BeatSheet 规划',
  max_clip: 'Clip 上限',
  asset_coverage: '视觉资产规划',
  asset_fan_out: '逐资产展开',
  fan_out: '逐 Clip 展开',
  clip_writer: '逐镜提示词',
  prompt_package: '提示词包汇总',
  estimate: '费用预估',
  production_handoff: '生产交接',
  video_submission: '视频生成提交',
  video_result: 'Clip 视频输出',
  concat: '成片合成',
  text_input: '文本输入',
  javascript: 'JavaScript',
  collection_split: '拆分数据项',
  agent_task: 'Agent 任务',
  image_generate: '图片生成',
  video_generate: '视频生成',
  skill_requirement: 'Skill 依赖',
  tool_capability: '工具授权',
  knowledge_search: '知识检索',
  knowledge_read: '知识读取',
  skill_reference: '实际 Skill 引用',
  knowledge_reference: '实际知识引用',
  tool_invocation: '工具调用',
  human_approval: '人工审批',
  condition: '条件分支',
  terminal: '明确终态',
  subworkflow: '子工作流',
  join: '分支汇合',
  artifact_contract: '产物合同',
  delivery_verify: '交付验收',
}

export function workflowCategoryLabel(category: WorkflowAtomicNodeCategory | null): string {
  return category ? CATEGORY_LABELS[category] : '工作流'
}

export function workflowOperationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? (operation || '未声明操作')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveWorkflowIconUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function readStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readAtomicCategory(spec: Record<string, unknown>): WorkflowAtomicNodeCategory | null {
  const category = spec.category
  return WORKFLOW_ATOMIC_NODE_CATEGORIES.find((candidate) => candidate === category) ?? null
}

function readTriggerKind(data: Record<string, unknown>): WorkflowTriggerKind | 'invalid' | null {
  if (data.kind !== 'workflowTrigger') return null
  if (!isRecord(data.workflowTriggerSpec)) return 'invalid'
  const kind = data.workflowTriggerSpec.kind
  return WORKFLOW_TRIGGER_KINDS.find((candidate) => candidate === kind) ?? 'invalid'
}

export function workflowExecutionModeLabel(spec: Record<string, unknown>): string {
  const mode = readString(spec, 'executionMode')
  if (mode === 'once') return '单次'
  if (mode === 'collect') return '汇总'
  if (mode === 'each') {
    const itemConcurrency = spec.itemConcurrency
    const concurrency = typeof itemConcurrency === 'number'
      && Number.isInteger(itemConcurrency)
      && itemConcurrency > 0
      ? itemConcurrency
      : 1
    return `逐项 · 并发上限 ${concurrency}`
  }
  return '执行方式未声明'
}

export function workflowNodeSummary(data: Record<string, unknown>, operation: string): string {
  if (operation === 'max_clip') {
    const maxClips = data.workflowBeatSheetTakeCount
    return typeof maxClips === 'number' && Number.isInteger(maxClips)
      ? `最多生产 ${maxClips} 个 Clip；达到上限即交付`
      : '必须配置 1–1000 的 Clip 上限'
  }
  if (operation === 'skill_reference' || operation === 'knowledge_reference') {
    return readString(data, 'workflowOperationDescription') || '来自 Agent 本轮真实读取证据'
  }
  if (operation === 'text_input') {
    return readString(data, 'workflowTextInput') || '在配置面板填写本轮显式文本输入'
  }
  if (operation === 'javascript') {
    const code = readString(data, 'workflowJavascriptCode')
    return code ? `已配置 ${code.split('\n').length} 行脚本` : '在隔离子进程中转换上游 JSON 值'
  }
  if (operation === 'agent_task') {
    return readString(data, 'workflowInstruction') || '由 Agent 自主规划并完成当前目标'
  }
  if (operation === 'video_generate') {
    const model = readString(data, 'workflowVideoModelSelection') || readString(data, 'workflowVideoModelKey')
    const duration = data.workflowVideoDurationSeconds
    const resolution = readString(data, 'workflowVideoResolution')
    const aspect = readString(data, 'workflowVideoAspectRatio')
    const durationLabel = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? `${duration}s` : ''
    const configured = [model, durationLabel, resolution, aspect].filter(Boolean)
    return configured.length > 0 ? configured.join(' · ') : '逐项生成真实视频资产'
  }
  if (operation === 'image_generate') {
    const model = readString(data, 'workflowImageModelSelection') || readString(data, 'workflowImageModelKey')
    const size = readString(data, 'workflowImageSize')
    const aspect = readString(data, 'workflowImageAspectRatio')
    const configured = [model, size, aspect].filter(Boolean)
    return configured.length > 0 ? configured.join(' · ') : '逐项生成真实图片资产'
  }
  if (operation === 'skill_requirement') {
    return readString(data, 'workflowSkillId') || '声明 Agent 必须加载的 Skill'
  }
  if (operation === 'tool_capability') {
    return readString(data, 'workflowToolId') || '授权 Agent 调用精确工具；本节点不执行'
  }
  if (operation === 'knowledge_search') {
    return readString(data, 'workflowKnowledgeQuery') || '从真实向量知识库召回可审计候选集'
  }
  if (operation === 'knowledge_read') {
    return readString(data, 'workflowKnowledgeCardId') || '读取候选集内 Agent 明确选中的知识卡'
  }
  if (operation === 'tool_invocation') {
    return readString(data, 'workflowToolInvocationName') || '按注册 JSON Schema 校验并执行精确工具'
  }
  if (operation === 'human_approval') {
    return readString(data, 'workflowHumanPrompt') || '暂停执行并等待管理员批准或拒绝'
  }
  if (operation === 'condition') {
    const pointer = readString(data, 'workflowConditionPointer') || '输入根值'
    const operator = readString(data, 'workflowConditionOperator') || '未配置运算符'
    return `${pointer} · ${operator}`
  }
  if (operation === 'terminal') {
    const outcome = readString(data, 'workflowTerminalOutcome') === 'failed' ? '失败' : '成功'
    return `${outcome} · ${readString(data, 'workflowTerminalMessage') || '待填写终态说明'}`
  }
  if (operation === 'subworkflow') {
    const flowId = readString(data, 'workflowSubflowFlowId')
    const versionId = readString(data, 'workflowSubflowVersionId')
    return flowId && versionId ? `${flowId} · ${versionId}` : '待绑定固定 flow version'
  }
  if (operation === 'delivery_verify') {
    return readString(data, 'workflowDeliveryRequirement')
      || readString(data, 'workflowOperationDescription')
      || '核对期望交付、事实证据与验收结论'
  }
  if (operation === 'canvas_source') {
    const sourceMode = readString(data, 'workflowSourceMode') || 'canvas_group'
    if (sourceMode === 'inline_text') return readString(data, 'workflowSourceText') || '提供显式测试文本'
		if (sourceMode === 'project_context') return '动态读取当前项目上下文'
    return readString(data, 'sourceGroupId') ? '已绑定真实画布组' : '绑定真实画布来源组'
  }
  return readString(data, 'workflowOperationDescription') || '查看配置、输入、输出与运行事实'
}

/**
 * Converts the persisted, explicit workflow contract into canvas presentation facts. The resolver
 * never infers a node role from its label or prompt: missing/unknown contracts stay visibly
 * unclassified instead of being silently routed to a guessed style.
 */
export function resolveWorkflowNodePresentation(data: Record<string, unknown>): WorkflowNodePresentation {
  const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : {}
  const category = readAtomicCategory(spec)
  const operation = readString(spec, 'operation') || readString(data, 'workflowNodeKind')
  const triggerKind = readTriggerKind(data)
  const isTrigger = data.kind === 'workflowTrigger'
  const inputPorts = readStrings(data.workflowInputPorts)
  const configuredOutputPorts = readStrings(data.workflowOutputPorts)
  const outputPorts = isTrigger && configuredOutputPorts.length === 0 ? ['trigger'] : configuredOutputPorts

  return {
    variant: isTrigger ? 'trigger' : category ?? 'stage',
    category,
    categoryLabel: isTrigger ? '触发器' : workflowCategoryLabel(category),
    operation,
    operationLabel: isTrigger
      ? triggerKind === 'manual' ? '手动触发'
        : triggerKind === 'schedule' ? '定时触发'
          : triggerKind === 'webhook' ? 'Webhook'
            : triggerKind === 'event' ? '事件触发'
              : '触发配置无效'
      : workflowOperationLabel(operation),
    executorRef: readString(spec, 'executorRef'),
    executionModeLabel: isTrigger ? '执行入口' : workflowExecutionModeLabel(spec),
    triggerKind,
    inputPorts,
    outputPorts,
    summary: isTrigger
      ? triggerKind === 'manual' ? '从画布原位显式启动一次真实工作流'
        : triggerKind === 'schedule' ? '按已验证的计划与时区创建工作流运行'
          : triggerKind === 'webhook' ? '由已注册的 Webhook 请求创建工作流运行'
            : triggerKind === 'event' ? '由已注册事件创建工作流运行'
              : '触发器合同缺失或无效'
      : workflowNodeSummary(data, operation),
    iconUrl: resolveWorkflowIconUrl(data.workflowIconUrl),
  }
}
