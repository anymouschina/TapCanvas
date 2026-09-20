import { chapterBeatPlanSchema, chapterAssetPlanSchema, clipDesignSchema } from '../../../../packages/schemas/video-authoring-stages/schema.mjs'
import type { Edge, Node } from '@xyflow/react'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
  VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  type VideoAtomicWorkflowNodeId,
} from '@tapcanvas/video-orchestrator-protocol'
import {
  ADMIN_WORKFLOW_PERMISSION,
  createManualWorkflowTriggerSpec,
  resolveWorkflowExecutorPortArtifactContract,
  WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
  WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
  type WorkflowAtomicNodeCategory,
  type WorkflowAtomicNodeSpecV1,
  type WorkflowNodeExecutionMode,
} from '@tapcanvas/workflow-kernel-protocol'
import { workflowPortHandleId } from './workflowCanvasPorts'
import {
  WORKFLOW_ICON_NODE_COLUMN_STRIDE,
  WORKFLOW_ICON_NODE_ROW_STRIDE,
  WORKFLOW_ICON_NODE_SIZE,
} from './workflowNodeGeometry'
import type { VideoWorkflowExecutionScope } from './videoWorkflowExecution'

export const NODE_WIDTH = WORKFLOW_ICON_NODE_SIZE
export const NODE_HEIGHT = WORKFLOW_ICON_NODE_SIZE
export const COLUMN_GAP = WORKFLOW_ICON_NODE_COLUMN_STRIDE - WORKFLOW_ICON_NODE_SIZE
export const ROW_GAP = WORKFLOW_ICON_NODE_ROW_STRIDE - WORKFLOW_ICON_NODE_SIZE
export const COLUMN_COUNT = 5
export {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
}
export const VIDEO_WORKFLOW_EXECUTION_CONCURRENCY = 16 as const
/**
 * 结构化 Agent 节点的单次输出额度。
 *
 * 章级 BeatSheet 合同要求在一次终端提交里交付整章 beats + blockingPlans +
 * sequenceControlPlan；一章实测约 3.0–4.3 万 token（含中文 JSON），高于旧的
 * 32768。额度不足时供应商会在到达终端提交前按 length 截断，节点只能重试，
 * 而重试是否成功完全取决于当次是否恰好没有溢出——同一份输入实测要 10 次物理
 * 重试才偶然成功一次，把到视频生成的时间从分钟级推到小时级。
 * 这里取协议上限，让合同产物一次装得下，不依赖重试概率。
 */
export const VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS = 65_536 as const
export const VIDEO_WORKFLOW_MAX_CLIPS_MIN = 1 as const
export const VIDEO_WORKFLOW_MAX_CLIPS_MAX = 1_000 as const
/**
 * 整章一键成片的默认物理片段上限。
 *
 * 上限是每轮生产的成本/规模上界，不是创作目标：实际片段数由作者按章节内容决定，
 * 这里只保证它够用。单 clip 受供应商窗口限制（当前 4–15 秒），一章"完整沉浸版"
 * 成片约 20 分钟即约 80 个片段；默认值低于这个量级会把作者合法的整章计划截断成
 * 半部成片，并让作者在"计划必须覆盖全章"与"只生产前 N 个片段"之间无解。
 */
export const VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS = 80 as const

export type VideoWorkflowExecutionVariant = 'full_video' | 'first_video'
type VideoWorkflowVariantNodeId =
  | 'video-execution-choice'
  | 'video-node-prepare'
  | 'text-expansion-agent'
  | 'launch-beat-agent'
  | 'launch-beat-take'
  | 'launch-background-fan-out'
  | 'launch-background-image-generate'
  | 'launch-blocking-diagrams'
  | 'launch-clip-fan-out'
  | 'launch-clip-writer-agent'
  | 'launch-prompt-package'
  | 'launch-asset-coverage'
  | 'launch-asset-fan-out'
  | 'launch-asset-image-generate'
  | 'launch-empty-voice-manifest'
  | 'launch-cost-estimate'
  | 'launch-production-handoff'
  | 'launch-video-submit'
  | 'launch-video-results'
type VideoWorkflowNodeId = VideoAtomicWorkflowNodeId | VideoWorkflowVariantNodeId

type VideoAtomicNodeDefinitionBase = Readonly<{
  nodeId: VideoWorkflowNodeId
  label: string
  operation: string
  executionMode: WorkflowNodeExecutionMode
  inputPorts: readonly string[]
  optionalInputPorts?: readonly string[]
  selectiveOutputPorts?: readonly string[]
  outputPorts: readonly string[]
  description: string
  skillId?: string
  toolId?: string
  runtimeData?: Readonly<Record<string, unknown>>
  runtimeTemplateNodeId?: VideoAtomicWorkflowNodeId
}>

type VideoAtomicAgentNodeDefinition = VideoAtomicNodeDefinitionBase & Readonly<{
  category: 'agent'
  executorRef: 'agents.logical-task/v2'
  agentOutputArtifactType: string
  outputArtifactType?: never
}>

type VideoAtomicNonAgentNodeDefinition = VideoAtomicNodeDefinitionBase & Readonly<{
  category: Exclude<WorkflowAtomicNodeCategory, 'agent'>
  executorRef: Exclude<string, 'agents.logical-task/v2'> | null
  agentOutputArtifactType?: never
  outputArtifactType?: string
}>

type VideoAtomicNodeDefinition = VideoAtomicAgentNodeDefinition | VideoAtomicNonAgentNodeDefinition

/**
 * This graph is the durable one-click production workflow. Canvas runs and 小T's
 * tapcanvas_workflow_run tool both start the same frozen graph through ExecutionDO.
 * Media nodes reuse the canonical agents-cli and media executors, idempotency ledger,
 * asynchronous receipts and delivery contracts instead of implementing a browser runtime.
 */
const VIDEO_REMAINDER_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'canvas-source',
    label: '画布来源',
    category: 'source',
    operation: 'canvas_source',
    executorRef: 'tapcanvas.canvas.group.read/v1',
    executionMode: 'once',
    inputPorts: ['trigger'],
    outputPorts: ['canvas-facts'],
    description: '运行时动态读取调用者 ProjectContext；有明确选择时使用选择，否则要求当前画布只有一个就绪文本来源。',
    outputArtifactType: 'tapcanvas.canvas-facts/v1',
  },
  {
    nodeId: 'delivery-contract',
    label: '成片交付合同',
    category: 'artifact',
    operation: 'delivery_contract',
    executorRef: 'agents.delivery.contract/v2',
    executionMode: 'once',
    inputPorts: ['canvas-facts', 'expanded-source'],
    outputPorts: ['delivery-contract'],
    description: '冻结目标、执行范围和真实交付要求。',
    outputArtifactType: 'tapcanvas.delivery-contract/v2',
  },
  {
    nodeId: 'beat-sheet-agent',
    label: '章节剧情规划 Agent',
    category: 'agent',
    operation: 'beat_sheet_authoring',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'once',
    inputPorts: ['trigger', 'delivery-contract'],
    outputPorts: ['chapter-plan'],
    description: '在工作流执行链内读取冻结来源与交付合同，只编排整章剧情、对白分配和来源覆盖；视觉细节由各 Clip 独立设计。',
    agentOutputArtifactType: 'tapcanvas.chapter-beat-plan/v1',
  },
  {
    nodeId: 'chapter-assets-agent', label: '章节资产提取 Agent', category: 'agent', operation: 'chapter_asset_authoring',
    executorRef: 'agents.logical-task/v2', executionMode: 'once', inputPorts: ['delivery-contract'], outputPorts: ['chapter-assets'],
    description: '从完整来源和真实项目资产中建立共享对象身份与资产计划，供各 Clip 精确引用。',
    agentOutputArtifactType: 'tapcanvas.chapter-asset-plan/v1',
  },
  {
    nodeId: 'clip-design-fan-out', label: '逐 Clip 设计展开', category: 'control', operation: 'clip_design_inputs',
    executorRef: 'video.clip-design-inputs/v1', executionMode: 'once', inputPorts: ['chapter-plan', 'chapter-assets'], outputPorts: ['clip-design-inputs'],
    description: '按章节计划展开独立 Clip，附带相邻剧情事实和同一份共享资产身份。', outputArtifactType: 'tapcanvas.clip-design-inputs/v1',
  },
  {
    nodeId: 'clip-design-agent', label: '逐 Clip 视觉设计 Agent', category: 'agent', operation: 'clip_design',
    executorRef: 'agents.logical-task/v2', executionMode: 'each', inputPorts: ['clip-design-inputs'], outputPorts: ['clip-designs'],
    description: '每个 Clip 独立完成视觉对象状态、站位、构图与局部时间窗，局部修复独立持久化。',
    agentOutputArtifactType: 'tapcanvas.clip-design/v1',
  },
  {
    nodeId: 'beat-sheet-assemble', label: '汇总逐 Clip 设计', category: 'control', operation: 'beat_sheet_assemble',
    executorRef: 'video.beat-sheet.assemble/v1', executionMode: 'collect', inputPorts: ['chapter-plan', 'chapter-assets', 'clip-designs'], outputPorts: ['beat-sheet'],
    description: '按精确 Clip 身份合并已保存产物，编译全章时间坐标，不执行第二次整章创作。', outputArtifactType: 'tapcanvas.beat-sheet/v2',
  },
  {
    nodeId: 'beat-sheet-format',
    label: 'Clip 上限',
    category: 'control',
    operation: 'max_clip',
    executorRef: 'video.beat-sheet.take/v1',
    executionMode: 'once',
    inputPorts: ['beat-sheet'],
    outputPorts: ['beat-sheet'],
    description: '确定性冻结 BeatSheet 的前 N 个 Clip；后续只生产该集合，达到上限即按完整工作流交付。',
    outputArtifactType: 'tapcanvas.beat-sheet/v2',
    runtimeData: { workflowBeatSheetTakeCount: VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS },
  },
  {
    nodeId: 'background-fan-out', label: '场景底图计划', category: 'control',
    operation: 'blocking_background_split', executorRef: 'tapcanvas.chapter-backgrounds.split/v1',
    executionMode: 'once', inputPorts: ['chapter-assets'], outputPorts: ['asset-items'],
    description: '按 Agent 指定的稳定资产身份展开场景底图计划，同一底图只生产一次。',
    outputArtifactType: 'tapcanvas.asset-plan-items/v2',
  },
  {
    nodeId: 'background-image-generate', label: '生成场景底图', category: 'media',
    operation: 'image_generate', executorRef: 'tapcanvas.image.generate/v1',
    executionMode: 'each', inputPorts: ['asset-items'], outputPorts: ['asset-bindings'],
    description: '生成真实场景俯视底图，持久化图片后交给站位图叠加。',
    outputArtifactType: 'tapcanvas.asset-bindings/v1',
  },
  {
    nodeId: 'blocking-diagrams',
    label: '逐 Clip 站位图',
    category: 'media',
    operation: 'blocking_diagram_materialize',
    executorRef: 'tapcanvas.blocking-diagrams.materialize/v1',
    executionMode: 'once',
    inputPorts: ['beat-sheet', 'background-bindings'],
    outputPorts: ['beat-sheet'],
    description: '把 Agent 冻结的逐 Clip 空间调度合同确定性渲染为真实站位图，并把节点身份绑定回 BeatSheet。',
    outputArtifactType: 'tapcanvas.beat-sheet/v2',
  },
  {
    nodeId: 'chapter-asset-prepare', label: '独立资产准备', category: 'control', operation: 'chapter_asset_prepare',
    executorRef: 'video.chapter-assets.prepare/v1', executionMode: 'once', inputPorts: ['chapter-assets'], outputPorts: ['asset-items'],
    description: '章节资产计划完成即可准备图片，与 Clip 设计并行；引用范围在设计完成后绑定。',
    outputArtifactType: 'tapcanvas.asset-plan-items/v2',
  },
  {
    nodeId: 'asset-consumer-bind', label: '绑定 Clip 资产引用', category: 'control', operation: 'asset_consumer_bind',
    executorRef: 'video.asset-consumers.bind/v1', executionMode: 'collect', inputPorts: ['asset-bindings', 'asset-items'], outputPorts: ['asset-bindings'],
    description: '按精确资产身份绑定实际 Clip 消费者，保留全部已生成图片。', outputArtifactType: 'tapcanvas.asset-bindings/v1',
  },
  {
    nodeId: 'asset-coverage',
    label: '视觉资产计划投影',
    category: 'control',
    operation: 'asset_coverage',
    executorRef: 'video.asset-plans.project/v1',
    executionMode: 'once',
    inputPorts: ['beat-sheet'],
    outputPorts: ['asset-plans'],
    description: '从同一次 BeatSheet 创作结果确定性投影人物、场景和道具参考图计划，不再二次理解章节。',
    outputArtifactType: 'tapcanvas.asset-plans/v1',
  },
  {
    nodeId: 'asset-fan-out',
    label: '逐资产展开',
    category: 'control',
    operation: 'asset_fan_out',
    executorRef: 'video.asset-plans.split/v1',
    executionMode: 'once',
    inputPorts: ['asset-plans', 'beat-sheet', 'asset-bindings'],
    outputPorts: ['asset-items'],
    description: '付费前核对每张计划图的真实 Clip 消费者，再展开稳定数据项。',
    outputArtifactType: 'tapcanvas.asset-plan-items/v2',
  },
  {
		nodeId: 'asset-image-generate',
		label: '逐资产验真 / 补图',
    category: 'media',
    operation: 'image_generate',
    executorRef: 'tapcanvas.image.generate/v1',
    executionMode: 'each',
    inputPorts: ['asset-items'],
    outputPorts: ['asset-bindings'],
		description: '逐项复用已就绪资产；仅对缺口生成图片，验真持久资产后才放行。',
    outputArtifactType: 'tapcanvas.asset-bindings/v1',
  },
  {
    nodeId: 'clip-fan-out',
    label: '逐 Clip 展开',
    category: 'control',
    operation: 'fan_out',
    executorRef: 'video.clip-contexts/v1',
    executionMode: 'once',
    inputPorts: ['delivery-contract', 'beat-sheet'],
    outputPorts: ['clip-contexts'],
    description: '按冻结的 clip 合同动态展开并行分支。',
    outputArtifactType: 'tapcanvas.clip-contracts/v1',
  },
  {
    nodeId: 'clip-writer-agent',
    label: '逐镜提示词 Agent',
    category: 'agent',
    operation: 'clip_writer',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'each',
    inputPorts: ['clip-contexts', 'skills', 'tools', 'knowledge-candidates', 'knowledge-evidence', 'asset-bindings', 'delivery-contract'],
    optionalInputPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence', 'asset-bindings', 'delivery-contract'],
    outputPorts: ['clip-prompts'],
    description: '每个 clip 独立生成模型可执行的视频提示词。',
    skillId: 'tapcanvas-video-prompt-writer',
    agentOutputArtifactType: 'tapcanvas.clip-prompts/v2',
  },
  {
    nodeId: 'prompt-package',
    label: '提示词包汇总',
    category: 'delivery',
    operation: 'prompt_package',
    executorRef: 'video.prompt-package.persist/v1',
    executionMode: 'collect',
    inputPorts: ['clip-prompts', 'clip-contexts', 'asset-items'],
    outputPorts: ['prompt-package'],
    description: '持久化逐镜提示词与来源追溯。',
    outputArtifactType: 'tapcanvas.prompt-package/v2',
  },
  {
    nodeId: 'voice-materialize',
    label: '原生音频合同',
    category: 'control',
    operation: 'voice_manifest_empty',
    executorRef: 'video.voice-manifest.empty/v1',
    executionMode: 'once',
    inputPorts: ['trigger'],
    outputPorts: ['voice-manifest'],
    description: '供应商原生对白音频不使用参考音频，确定性输出空 VoiceManifest。',
    outputArtifactType: 'tapcanvas.voice-manifest/v1',
  },
  {
    nodeId: 'cost-estimate',
    label: '费用预估',
    category: 'tool',
    operation: 'estimate',
    executorRef: 'video.estimate/v1',
    executionMode: 'collect',
    inputPorts: ['prompt-package'],
    outputPorts: ['estimate'],
    description: '按冻结参数计算真实媒体生产费用。',
    toolId: 'workflow.media.estimate',
    outputArtifactType: 'tapcanvas.video-estimate/v1',
  },
  {
    nodeId: 'production-handoff',
    label: '生产交接',
    category: 'control',
    operation: 'production_handoff',
    executorRef: 'video.production.handoff/v1',
    executionMode: 'collect',
    inputPorts: ['prompt-package', 'estimate', 'asset-bindings', 'voice-manifest'],
    outputPorts: ['production-plan'],
    description: '冻结生产参数并交给持久异步执行器；不等待与供应商原生音频无关的选声链。',
    outputArtifactType: 'tapcanvas.production-plan/v1',
    runtimeData: { workflowReferenceAudioPolicy: 'optional' },
  },
  {
    nodeId: 'video-execution-choice', label: '是否只生成视频节点', category: 'control', operation: 'condition',
    executorRef: 'workflow.control.condition/v1', executionMode: 'once', inputPorts: ['value'], outputPorts: ['matched', 'unmatched'],
    description: '按本次明确选择分支；开启只生成视频节点时不提交视频任务。',
    selectiveOutputPorts: ['matched', 'unmatched'],
    runtimeData: { workflowConditionPointer: '/onlyVideoNodes', workflowConditionOperator: 'is_true' },
  },
  {
    nodeId: 'video-node-prepare', label: '填充待生成视频节点', category: 'delivery', operation: 'video_prepare',
    executorRef: 'tapcanvas.video.prepare/v1', executionMode: 'each', inputPorts: ['production-plan', 'authorization'], outputPorts: ['prepared-nodes'],
    description: '把每段完整提示词、真实参考资产和视频规格落到画布；不调用视频供应商。',
    runtimeData: { workflowVideoReferencePolicy: 'forbidden' }, outputArtifactType: 'tapcanvas.video-node/v1',
  },
  {
    nodeId: 'video-submit',
    label: '视频生成提交',
    category: 'tool',
    operation: 'video_submission',
    executorRef: 'tapcanvas.video.generate/v1',
    executionMode: 'each',
    inputPorts: ['production-plan', 'authorization'],
    outputPorts: ['provider-receipts'],
    description: '逐 clip 提交真实供应商任务；失败最多重试 2 次，已受理任务复用回执，结果未知先对账。',
    runtimeData: { workflowRetryPolicy: { maxAttempts: 3 } },
    toolId: 'workflow.media.submit',
    outputArtifactType: 'tapcanvas.provider-receipts/v1',
  },
  {
    nodeId: 'video-results',
    label: 'Clip 视频输出',
    category: 'control',
    operation: 'video_result',
    executorRef: 'workflow.control.join/v1',
    executionMode: 'each',
    inputPorts: ['provider-receipts'],
    outputPorts: ['video-assets'],
    description: '等待并输出每个 Clip 的真实视频资产 URL 与供应商结果。',
    outputArtifactType: 'tapcanvas.video-clips/v1',
  },
  {
    nodeId: 'concat',
    label: '成片合成',
    category: 'tool',
    operation: 'concat',
    executorRef: 'video.concat/v1',
    executionMode: 'collect',
    inputPorts: ['video-assets', 'estimate', 'prompt-package'],
    outputPorts: ['master-video'],
    description: '按冻结顺序合成唯一主片，并把结果保留在当前工作流运行输出中。',
    toolId: 'workflow.media.concat',
    outputArtifactType: 'tapcanvas.master-video/v1',
  },
  {
    nodeId: 'delivery-verify',
    label: '交付验收',
    category: 'delivery',
    operation: 'delivery_verify',
    executorRef: 'agents.delivery.verify/v2',
    executionMode: 'collect',
    inputPorts: ['master-video', 'prompt-package'],
    outputPorts: ['delivery-evidence'],
    description: '依据真实 URL、持久化状态与执行证据裁决交付。',
    outputArtifactType: 'tapcanvas.delivery-evidence/v2',
  },
]

function workflowNodeTemplate(nodeId: VideoAtomicWorkflowNodeId): VideoAtomicNodeDefinition {
  const definition = VIDEO_REMAINDER_WORKFLOW_NODES.find((candidate) => candidate.nodeId === nodeId)
  if (!definition) throw new Error(`缺少视频工作流节点模板：${nodeId}`)
  return definition
}

function cloneWorkflowNode(input: Readonly<{
  nodeId: VideoWorkflowVariantNodeId
  templateNodeId: VideoAtomicWorkflowNodeId
  label: string
  inputPorts?: readonly string[]
  outputPorts?: readonly string[]
}>): VideoAtomicNodeDefinition {
  const template = workflowNodeTemplate(input.templateNodeId)
  return {
    ...template,
    nodeId: input.nodeId,
    label: input.label,
    runtimeTemplateNodeId: input.templateNodeId,
    ...(input.inputPorts ? { inputPorts: input.inputPorts } : {}),
    ...(input.outputPorts ? { outputPorts: input.outputPorts } : {}),
  } as VideoAtomicNodeDefinition
}

const LAUNCH_BEAT_AGENT_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'launch-beat-agent',
  label: '首 Clip 快速创作 Agent',
  category: 'agent',
  operation: 'launch_beat_authoring',
  executorRef: 'agents.logical-task/v2',
  executionMode: 'once',
  inputPorts: ['trigger', 'delivery-contract'],
  outputPorts: ['beat-sheet'],
  description: '先冻结唯一首 Clip 及其人物/场景对象合同，在完整章级规划完成前启动真实参考资产和视频生产。',
  agentOutputArtifactType: 'tapcanvas.launch-beat-sheet/v1',
}

const TEXT_EXPANSION_AGENT_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'text-expansion-agent',
  label: '文本扩写（可选）',
  category: 'agent',
  operation: 'text_expansion',
  executorRef: 'agents.logical-task/v2',
  executionMode: 'once',
  inputPorts: ['canvas-facts'],
  outputPorts: ['expanded-source'],
  description: '在一键成片内部处理文本；输入已完整时原样放行，需要时在同一链内扩写后交给 BeatSheet。',
  agentOutputArtifactType: 'tapcanvas.text/v1',
}

const LAUNCH_BEAT_TAKE_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'launch-beat-take',
  label: '首 Clip 合同冻结',
  category: 'control',
  operation: 'beat_sheet_take',
  executorRef: 'video.beat-sheet.take/v1',
  executionMode: 'once',
  inputPorts: ['beat-sheet'],
  outputPorts: ['beat-sheet'],
  description: '确定性冻结唯一首 Beat，作为快速生产与整章续写共享的不可改写前缀。',
  outputArtifactType: 'tapcanvas.launch-beat-sheet/v1',
  runtimeData: { workflowBeatSheetTakeCount: 1 },
}

const launchBackgroundTemplate = cloneWorkflowNode({
  nodeId: 'launch-background-fan-out', templateNodeId: 'background-fan-out', label: '首 Clip 底图计划',
})
if (launchBackgroundTemplate.category === 'agent') throw new Error('场景底图计划必须是确定性工作流节点')
const LAUNCH_BACKGROUND_FAN_OUT_NODE: VideoAtomicNodeDefinition = {
  ...launchBackgroundTemplate,
  executorRef: 'tapcanvas.blocking-backgrounds.split/v1',
  inputPorts: ['beat-sheet'],
}
const LAUNCH_BACKGROUND_IMAGE_NODE = cloneWorkflowNode({
  nodeId: 'launch-background-image-generate', templateNodeId: 'background-image-generate', label: '首 Clip 场景底图',
})

const LAUNCH_BLOCKING_DIAGRAMS_NODE = cloneWorkflowNode({
  nodeId: 'launch-blocking-diagrams', templateNodeId: 'blocking-diagrams', label: '首 Clip 站位图',
})

const LAUNCH_CLIP_FAN_OUT_NODE = cloneWorkflowNode({
  nodeId: 'launch-clip-fan-out', templateNodeId: 'clip-fan-out', label: '首 Clip 展开',
  inputPorts: ['delivery-contract', 'beat-sheet'],
})
const LAUNCH_CLIP_WRITER_NODE = cloneWorkflowNode({
  nodeId: 'launch-clip-writer-agent', templateNodeId: 'clip-writer-agent', label: '首 Clip 提示词 Agent',
})
const LAUNCH_PROMPT_PACKAGE_NODE = cloneWorkflowNode({
  nodeId: 'launch-prompt-package', templateNodeId: 'prompt-package', label: '首 Clip 提示词包',
  inputPorts: ['clip-prompts', 'clip-contexts', 'asset-items'],
})
const LAUNCH_ASSET_COVERAGE_NODE = cloneWorkflowNode({
  nodeId: 'launch-asset-coverage', templateNodeId: 'asset-coverage', label: '首 Clip 视觉资产计划投影',
  inputPorts: ['beat-sheet'],
})
const LAUNCH_ASSET_FAN_OUT_NODE = cloneWorkflowNode({
  nodeId: 'launch-asset-fan-out', templateNodeId: 'asset-fan-out', label: '首 Clip 逐资产展开',
  inputPorts: ['asset-plans', 'beat-sheet'],
})
const LAUNCH_ASSET_IMAGE_GENERATE_NODE = cloneWorkflowNode({
  nodeId: 'launch-asset-image-generate', templateNodeId: 'asset-image-generate', label: '首 Clip 身份与场景资产',
})
const LAUNCH_EMPTY_VOICE_MANIFEST_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'launch-empty-voice-manifest',
  label: '首 Clip 原生音频合同',
  category: 'control',
  operation: 'voice_manifest_empty',
  executorRef: 'video.voice-manifest.empty/v1',
  executionMode: 'once',
  inputPorts: ['trigger'],
  outputPorts: ['voice-manifest'],
  description: '首 Clip 纯文生视频直接使用模型原生对白音频，不在供应商启动前生成或绑定音色样本。',
  outputArtifactType: 'tapcanvas.voice-manifest/v1',
}
const LAUNCH_ESTIMATE_NODE = cloneWorkflowNode({ nodeId: 'launch-cost-estimate', templateNodeId: 'cost-estimate', label: '首 Clip 费用预估' })
const LAUNCH_HANDOFF_NODE: VideoAtomicNodeDefinition = {
  ...cloneWorkflowNode({ nodeId: 'launch-production-handoff', templateNodeId: 'production-handoff', label: '首 Clip 生产交接' }),
  runtimeData: { workflowReferenceAudioPolicy: 'optional' },
  description: '冻结首 Clip 生产参数；先绑定当前 Clip 所需的规范身份与场景资产，再提交视频。',
}
const LAUNCH_VIDEO_SUBMIT_NODE: VideoAtomicNodeDefinition = { ...cloneWorkflowNode({ nodeId: 'launch-video-submit', templateNodeId: 'video-submit', label: '首 Clip 视频提交' }), inputPorts: ['production-plan'] }
const LAUNCH_VIDEO_RESULTS_NODE = cloneWorkflowNode({ nodeId: 'launch-video-results', templateNodeId: 'video-results', label: '首 Clip 视频输出' })

const VIDEO_FAST_LAUNCH_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  LAUNCH_BEAT_AGENT_NODE,
  LAUNCH_BEAT_TAKE_NODE,
  LAUNCH_BACKGROUND_FAN_OUT_NODE,
  LAUNCH_BACKGROUND_IMAGE_NODE,
  LAUNCH_BLOCKING_DIAGRAMS_NODE,
  LAUNCH_CLIP_FAN_OUT_NODE,
  LAUNCH_CLIP_WRITER_NODE,
  LAUNCH_PROMPT_PACKAGE_NODE,
  LAUNCH_ASSET_COVERAGE_NODE,
  LAUNCH_ASSET_FAN_OUT_NODE,
  LAUNCH_ASSET_IMAGE_GENERATE_NODE,
  LAUNCH_EMPTY_VOICE_MANIFEST_NODE,
  LAUNCH_ESTIMATE_NODE,
  LAUNCH_HANDOFF_NODE,
  LAUNCH_VIDEO_SUBMIT_NODE,
  LAUNCH_VIDEO_RESULTS_NODE,
]

export const VIDEO_ATOMIC_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  TEXT_EXPANSION_AGENT_NODE,
  ...VIDEO_REMAINDER_WORKFLOW_NODES,
]

const FIRST_VIDEO_DELIVERY_VERIFY_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'delivery-verify',
  label: '首视频交付验收',
  category: 'delivery',
  operation: 'delivery_verify',
  executorRef: 'agents.delivery.verify/v2',
  executionMode: 'collect',
  inputPorts: ['video-assets'],
  outputPorts: ['delivery-evidence'],
  description: '验真并交付首个真实持久视频 URL 及执行证据，不继续生成其余视频或合成主片。',
  outputArtifactType: 'tapcanvas.delivery-evidence/v2',
}

export const VIDEO_FIRST_VIDEO_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  workflowNodeTemplate('canvas-source'),
  workflowNodeTemplate('delivery-contract'),
  TEXT_EXPANSION_AGENT_NODE,
  ...VIDEO_FAST_LAUNCH_WORKFLOW_NODES,
  FIRST_VIDEO_DELIVERY_VERIFY_NODE,
]

export const VIDEO_PROMPT_ONLY_WORKFLOW_NODE_IDS: readonly VideoAtomicWorkflowNodeId[] = [
  'canvas-source',
  'delivery-contract',
  'beat-sheet-agent',
  'chapter-assets-agent',
  'clip-design-fan-out',
  'clip-design-agent',
  'beat-sheet-assemble',
  'beat-sheet-format',
  'background-fan-out',
  'background-image-generate',
  'blocking-diagrams',
  'clip-fan-out',
  'clip-writer-agent',
  'prompt-package',
]

const VIDEO_PROMPT_ONLY_WORKFLOW_NODE_ID_SET = new Set<string>(VIDEO_PROMPT_ONLY_WORKFLOW_NODE_IDS)

export const VIDEO_PROMPT_ONLY_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = VIDEO_REMAINDER_WORKFLOW_NODES
  .filter((definition) => VIDEO_PROMPT_ONLY_WORKFLOW_NODE_ID_SET.has(definition.nodeId))
  .map((definition) => {
    if (definition.nodeId === 'delivery-contract') {
      // Prompt-only workflows intentionally do not include the optional
      // text-expansion stage. Keep their delivery contract scoped to the
      // canvas facts input instead of inheriting the media template's
      // expanded-source port.
      return { ...definition, inputPorts: ['canvas-facts'] }
    }
    if (definition.nodeId === 'beat-sheet-agent') {
      return { ...definition, inputPorts: ['trigger', 'delivery-contract'] }
    }
    if (definition.nodeId === 'clip-fan-out') {
      return { ...definition, inputPorts: ['delivery-contract', 'beat-sheet'] }
    }
    if (definition.nodeId === 'prompt-package') {
      return { ...definition, inputPorts: ['clip-prompts', 'clip-contexts'] }
    }
    return definition
  })

export type VideoAtomicEdgeDefinition = Readonly<{
  sourceNodeId: 'manual-trigger' | VideoWorkflowNodeId
  sourcePort: string
  targetNodeId: VideoWorkflowNodeId
  targetPort: string
}>

/** The editable graph mirrors real data dependencies; it is intentionally not a visual-only chain. */
const VIDEO_FAST_LAUNCH_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'text-expansion-agent', targetPort: 'canvas-facts' },
  { sourceNodeId: 'text-expansion-agent', sourcePort: 'expanded-source', targetNodeId: 'delivery-contract', targetPort: 'expanded-source' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'launch-beat-agent', targetPort: 'trigger' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'launch-beat-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'launch-beat-agent', sourcePort: 'beat-sheet', targetNodeId: 'launch-beat-take', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-beat-take', sourcePort: 'beat-sheet', targetNodeId: 'launch-blocking-diagrams', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-beat-take', sourcePort: 'beat-sheet', targetNodeId: 'launch-background-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-background-fan-out', sourcePort: 'asset-items', targetNodeId: 'launch-background-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'launch-background-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'launch-blocking-diagrams', targetPort: 'background-bindings' },
  { sourceNodeId: 'launch-blocking-diagrams', sourcePort: 'beat-sheet', targetNodeId: 'launch-asset-coverage', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-asset-coverage', sourcePort: 'asset-plans', targetNodeId: 'launch-asset-fan-out', targetPort: 'asset-plans' },
  { sourceNodeId: 'launch-blocking-diagrams', sourcePort: 'beat-sheet', targetNodeId: 'launch-asset-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'launch-asset-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'launch-blocking-diagrams', sourcePort: 'beat-sheet', targetNodeId: 'launch-clip-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'launch-clip-fan-out', targetPort: 'delivery-contract' },
  { sourceNodeId: 'launch-clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'launch-clip-writer-agent', targetPort: 'clip-contexts' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'launch-clip-writer-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'launch-asset-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'launch-clip-writer-agent', targetPort: 'asset-bindings' },
  { sourceNodeId: 'launch-clip-writer-agent', sourcePort: 'clip-prompts', targetNodeId: 'launch-prompt-package', targetPort: 'clip-prompts' },
  { sourceNodeId: 'launch-clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'launch-prompt-package', targetPort: 'clip-contexts' },
  { sourceNodeId: 'launch-asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'launch-prompt-package', targetPort: 'asset-items' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'launch-empty-voice-manifest', targetPort: 'trigger' },
  { sourceNodeId: 'launch-prompt-package', sourcePort: 'prompt-package', targetNodeId: 'launch-cost-estimate', targetPort: 'prompt-package' },
  { sourceNodeId: 'launch-prompt-package', sourcePort: 'prompt-package', targetNodeId: 'launch-production-handoff', targetPort: 'prompt-package' },
  { sourceNodeId: 'launch-cost-estimate', sourcePort: 'estimate', targetNodeId: 'launch-production-handoff', targetPort: 'estimate' },
  { sourceNodeId: 'launch-asset-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'launch-production-handoff', targetPort: 'asset-bindings' },
  { sourceNodeId: 'launch-empty-voice-manifest', sourcePort: 'voice-manifest', targetNodeId: 'launch-production-handoff', targetPort: 'voice-manifest' },
  { sourceNodeId: 'launch-production-handoff', sourcePort: 'production-plan', targetNodeId: 'launch-video-submit', targetPort: 'production-plan' },
  { sourceNodeId: 'launch-video-submit', sourcePort: 'provider-receipts', targetNodeId: 'launch-video-results', targetPort: 'provider-receipts' },
]

const VIDEO_FULL_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
	{ sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
	{ sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'text-expansion-agent', targetPort: 'canvas-facts' },
  { sourceNodeId: 'text-expansion-agent', sourcePort: 'expanded-source', targetNodeId: 'delivery-contract', targetPort: 'expanded-source' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'beat-sheet-agent', targetPort: 'trigger' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'beat-sheet-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-assets-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'beat-sheet-agent', sourcePort: 'chapter-plan', targetNodeId: 'clip-design-fan-out', targetPort: 'chapter-plan' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'clip-design-fan-out', targetPort: 'chapter-assets' },
  { sourceNodeId: 'clip-design-fan-out', sourcePort: 'clip-design-inputs', targetNodeId: 'clip-design-agent', targetPort: 'clip-design-inputs' },
  { sourceNodeId: 'beat-sheet-agent', sourcePort: 'chapter-plan', targetNodeId: 'beat-sheet-assemble', targetPort: 'chapter-plan' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'beat-sheet-assemble', targetPort: 'chapter-assets' },
  { sourceNodeId: 'clip-design-agent', sourcePort: 'clip-designs', targetNodeId: 'beat-sheet-assemble', targetPort: 'clip-designs' },
  { sourceNodeId: 'beat-sheet-assemble', sourcePort: 'beat-sheet', targetNodeId: 'beat-sheet-format', targetPort: 'beat-sheet' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'blocking-diagrams', targetPort: 'beat-sheet' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'background-fan-out', targetPort: 'chapter-assets' },
  { sourceNodeId: 'background-fan-out', sourcePort: 'asset-items', targetNodeId: 'background-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'background-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'blocking-diagrams', targetPort: 'background-bindings' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'asset-coverage', targetPort: 'beat-sheet' },
  { sourceNodeId: 'asset-coverage', sourcePort: 'asset-plans', targetNodeId: 'asset-fan-out', targetPort: 'asset-plans' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'asset-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'chapter-asset-prepare', targetPort: 'chapter-assets' },
  { sourceNodeId: 'chapter-asset-prepare', sourcePort: 'asset-items', targetNodeId: 'asset-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'asset-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'asset-fan-out', targetPort: 'asset-bindings' },
  { sourceNodeId: 'asset-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'asset-consumer-bind', targetPort: 'asset-bindings' },
  { sourceNodeId: 'asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'asset-consumer-bind', targetPort: 'asset-items' },
  { sourceNodeId: 'blocking-diagrams', sourcePort: 'beat-sheet', targetNodeId: 'clip-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-fan-out', targetPort: 'delivery-contract' },
	{ sourceNodeId: 'clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'clip-writer-agent', targetPort: 'clip-contexts' },
	{ sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-writer-agent', targetPort: 'delivery-contract' },
	{ sourceNodeId: 'asset-consumer-bind', sourcePort: 'asset-bindings', targetNodeId: 'clip-writer-agent', targetPort: 'asset-bindings' },
	{ sourceNodeId: 'clip-writer-agent', sourcePort: 'clip-prompts', targetNodeId: 'prompt-package', targetPort: 'clip-prompts' },
  { sourceNodeId: 'clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'prompt-package', targetPort: 'clip-contexts' },
  { sourceNodeId: 'asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'prompt-package', targetPort: 'asset-items' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'voice-materialize', targetPort: 'trigger' },
  { sourceNodeId: 'prompt-package', sourcePort: 'prompt-package', targetNodeId: 'cost-estimate', targetPort: 'prompt-package' },
  { sourceNodeId: 'prompt-package', sourcePort: 'prompt-package', targetNodeId: 'production-handoff', targetPort: 'prompt-package' },
  { sourceNodeId: 'cost-estimate', sourcePort: 'estimate', targetNodeId: 'production-handoff', targetPort: 'estimate' },
  { sourceNodeId: 'asset-consumer-bind', sourcePort: 'asset-bindings', targetNodeId: 'production-handoff', targetPort: 'asset-bindings' },
  { sourceNodeId: 'voice-materialize', sourcePort: 'voice-manifest', targetNodeId: 'production-handoff', targetPort: 'voice-manifest' },
	{ sourceNodeId: 'production-handoff', sourcePort: 'production-plan', targetNodeId: 'video-submit', targetPort: 'production-plan' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'video-execution-choice', targetPort: 'value' },
  { sourceNodeId: 'video-execution-choice', sourcePort: 'unmatched', targetNodeId: 'video-submit', targetPort: 'authorization' },
  { sourceNodeId: 'video-execution-choice', sourcePort: 'matched', targetNodeId: 'video-node-prepare', targetPort: 'authorization' },
  { sourceNodeId: 'production-handoff', sourcePort: 'production-plan', targetNodeId: 'video-node-prepare', targetPort: 'production-plan' },
  { sourceNodeId: 'video-submit', sourcePort: 'provider-receipts', targetNodeId: 'video-results', targetPort: 'provider-receipts' },
	{ sourceNodeId: 'video-results', sourcePort: 'video-assets', targetNodeId: 'concat', targetPort: 'video-assets' },
  { sourceNodeId: 'cost-estimate', sourcePort: 'estimate', targetNodeId: 'concat', targetPort: 'estimate' },
  { sourceNodeId: 'prompt-package', sourcePort: 'prompt-package', targetNodeId: 'concat', targetPort: 'prompt-package' },
  { sourceNodeId: 'concat', sourcePort: 'master-video', targetNodeId: 'delivery-verify', targetPort: 'master-video' },
  { sourceNodeId: 'prompt-package', sourcePort: 'prompt-package', targetNodeId: 'delivery-verify', targetPort: 'prompt-package' },
]

export const VIDEO_ATOMIC_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
	...VIDEO_FULL_WORKFLOW_EDGES,
]

export const VIDEO_FIRST_VIDEO_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  ...VIDEO_FAST_LAUNCH_WORKFLOW_EDGES,
  { sourceNodeId: 'launch-video-results', sourcePort: 'video-assets', targetNodeId: 'delivery-verify', targetPort: 'video-assets' },
]

export const VIDEO_PROMPT_ONLY_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'beat-sheet-agent', targetPort: 'trigger' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'beat-sheet-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-assets-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'beat-sheet-agent', sourcePort: 'chapter-plan', targetNodeId: 'clip-design-fan-out', targetPort: 'chapter-plan' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'clip-design-fan-out', targetPort: 'chapter-assets' },
  { sourceNodeId: 'clip-design-fan-out', sourcePort: 'clip-design-inputs', targetNodeId: 'clip-design-agent', targetPort: 'clip-design-inputs' },
  { sourceNodeId: 'beat-sheet-agent', sourcePort: 'chapter-plan', targetNodeId: 'beat-sheet-assemble', targetPort: 'chapter-plan' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'beat-sheet-assemble', targetPort: 'chapter-assets' },
  { sourceNodeId: 'clip-design-agent', sourcePort: 'clip-designs', targetNodeId: 'beat-sheet-assemble', targetPort: 'clip-designs' },
  { sourceNodeId: 'beat-sheet-assemble', sourcePort: 'beat-sheet', targetNodeId: 'beat-sheet-format', targetPort: 'beat-sheet' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'blocking-diagrams', targetPort: 'beat-sheet' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'background-fan-out', targetPort: 'chapter-assets' },
  { sourceNodeId: 'background-fan-out', sourcePort: 'asset-items', targetNodeId: 'background-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'background-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'blocking-diagrams', targetPort: 'background-bindings' },
  { sourceNodeId: 'blocking-diagrams', sourcePort: 'beat-sheet', targetNodeId: 'clip-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-fan-out', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'clip-writer-agent', targetPort: 'clip-contexts' },
  { sourceNodeId: 'clip-writer-agent', sourcePort: 'clip-prompts', targetNodeId: 'prompt-package', targetPort: 'clip-prompts' },
  { sourceNodeId: 'clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'prompt-package', targetPort: 'clip-contexts' },
]

export type VideoWorkflowCanvasTemplateResult = Readonly<{
  workflowInstanceId: string
  workflowGroupId: string
  sourceGroupId: string | null
  nodeIds: readonly string[]
}>

export type VideoWorkflowExistingEdge = Readonly<{
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}>

export type VideoWorkflowExistingNode = Readonly<{
  id: string
  parentId?: string | null
  data?: Readonly<Record<string, unknown>>
}>

export type VideoWorkflowCanvasDefinitionPatch = Readonly<{
  createNodes?: readonly Node[]
  patchNodeData: readonly Readonly<{
    id: string
    data: Readonly<Record<string, unknown>>
    allowOverwrite: true
  }>[]
  createEdges: readonly Readonly<{
    id: string
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }>[]
  deleteNodeIds: readonly string[]
  deleteEdgeIds: readonly string[]
  allowOverwrite: true
}>

/** Apply a structural template patch without touching runtime execution facts. */
export function applyVideoWorkflowCanvasDefinitionPatch(input: Readonly<{
  nodes: readonly Node[]
  edges: readonly Edge[]
  patch: VideoWorkflowCanvasDefinitionPatch
}>): { nodes: Node[]; edges: Edge[] } {
  const deletedNodes = new Set(input.patch.deleteNodeIds)
  const deletedEdges = new Set(input.patch.deleteEdgeIds)
  const nodePatches = new Map(input.patch.patchNodeData.map((item) => [item.id, item.data] as const))
  const nodes = input.nodes
    .filter((node) => !deletedNodes.has(node.id))
    .map((node) => {
      const patch = nodePatches.get(node.id)
      return patch ? { ...node, data: { ...node.data, ...patch } } : { ...node }
    })
  for (const created of input.patch.createNodes ?? []) {
    if (!nodes.some(node => node.id === created.id)) nodes.push({ ...created })
  }
  const existingSignatures = new Set(input.edges.map(workflowEdgeSignature))
  const edges = input.edges
    .filter((edge) => !deletedEdges.has(edge.id) && !deletedNodes.has(edge.source) && !deletedNodes.has(edge.target))
    .map((edge) => ({ ...edge }))
  for (const edge of input.patch.createEdges) {
    if (existingSignatures.has(workflowEdgeSignature(edge))) continue
    edges.push({ ...edge, type: 'default' })
    existingSignatures.add(workflowEdgeSignature(edge))
  }
  return { nodes, edges }
}

export function isVideoWorkflowCanvasUpgradeSafe(nodes: readonly Node[], workflowInstanceId: string): boolean {
  const instance = workflowInstanceId.trim()
  if (!instance) return false
  return nodes
    .filter((node) => String((node.data as Record<string, unknown> | undefined)?.workflowInstanceId ?? '') === instance)
    .every((node) => {
      const data = (node.data ?? {}) as Record<string, unknown>
      const status = String(data.workflowStatus ?? data.workflowTraceStatus ?? '').trim()
      if (status && !['idle', 'queued'].includes(status)) return false
      const artifactKeys = ['videoUrl', 'videoResults', 'imageUrl', 'imageResults', 'workflowExecutionId', 'workflowRunId']
      return artifactKeys.every((key) => {
        const value = data[key]
        return value == null || (Array.isArray(value) && value.length === 0) || value === ''
      })
    })
}

export function workflowDefinitions(
  executionScope: VideoWorkflowExecutionScope,
  executionVariant: VideoWorkflowExecutionVariant,
): readonly VideoAtomicNodeDefinition[] {
  if (executionScope === 'prompt_only') return VIDEO_PROMPT_ONLY_WORKFLOW_NODES
  return executionVariant === 'first_video' ? VIDEO_FIRST_VIDEO_WORKFLOW_NODES : VIDEO_ATOMIC_WORKFLOW_NODES
}

export function workflowEdges(
  executionScope: VideoWorkflowExecutionScope,
  executionVariant: VideoWorkflowExecutionVariant,
): readonly VideoAtomicEdgeDefinition[] {
  if (executionScope === 'prompt_only') return VIDEO_PROMPT_ONLY_WORKFLOW_EDGES
  return executionVariant === 'first_video' ? VIDEO_FIRST_VIDEO_WORKFLOW_EDGES : VIDEO_ATOMIC_WORKFLOW_EDGES
}

export function assertWorkflowDefinitionTopology(
  definitions: readonly VideoAtomicNodeDefinition[],
  edges: readonly VideoAtomicEdgeDefinition[],
): void {
  const nodePorts = new Map<string, Readonly<{
    inputPorts: readonly string[]
    optionalInputPorts: readonly string[]
    outputPorts: readonly string[]
  }>>([
    ['manual-trigger', { inputPorts: [], optionalInputPorts: [], outputPorts: ['trigger'] }],
    ...definitions.map((definition) => [definition.nodeId, {
      inputPorts: definition.inputPorts,
      optionalInputPorts: definition.optionalInputPorts ?? [],
      outputPorts: definition.outputPorts,
    }] as const),
  ])
  const incomingPorts = new Set<string>()
  const outgoingNodeIds = new Map<string, Set<string>>()
  const indegree = new Map(Array.from(nodePorts.keys()).map((nodeId) => [nodeId, 0]))

  for (const edge of edges) {
    const source = nodePorts.get(edge.sourceNodeId)
    const target = nodePorts.get(edge.targetNodeId)
    if (!source) throw new Error(`工作流定义边引用未知来源节点 ${edge.sourceNodeId}`)
    if (!target) throw new Error(`工作流定义边引用未知目标节点 ${edge.targetNodeId}`)
    if (!source.outputPorts.includes(edge.sourcePort)) {
      throw new Error(`工作流定义边引用未知来源端口 ${edge.sourceNodeId}.${edge.sourcePort}`)
    }
    if (![...target.inputPorts, ...target.optionalInputPorts].includes(edge.targetPort)) {
      throw new Error(`工作流定义边引用未知目标端口 ${edge.targetNodeId}.${edge.targetPort}`)
    }
    incomingPorts.add(`${edge.targetNodeId}\u0000${edge.targetPort}`)
    const targets = outgoingNodeIds.get(edge.sourceNodeId) ?? new Set<string>()
    if (!targets.has(edge.targetNodeId)) {
      targets.add(edge.targetNodeId)
      outgoingNodeIds.set(edge.sourceNodeId, targets)
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
    }
  }

  for (const definition of definitions) {
    for (const inputPort of definition.inputPorts) {
      if (definition.optionalInputPorts?.includes(inputPort)) continue
      if (!incomingPorts.has(`${definition.nodeId}\u0000${inputPort}`)) {
        throw new Error(`工作流定义节点 ${definition.nodeId} 的必需输入端口 ${inputPort} 没有连线`)
      }
    }
  }

  const ready = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId)
  let visitedCount = 0
  while (ready.length > 0) {
    const nodeId = ready.shift()
    if (!nodeId) continue
    visitedCount += 1
    for (const targetNodeId of outgoingNodeIds.get(nodeId) ?? []) {
      const nextDegree = (indegree.get(targetNodeId) ?? 0) - 1
      indegree.set(targetNodeId, nextDegree)
      if (nextDegree === 0) ready.push(targetNodeId)
    }
  }
  if (visitedCount !== nodePorts.size) throw new Error('工作流定义图存在循环依赖')
}

export function readWorkflowExecutionVariant(value: unknown): VideoWorkflowExecutionVariant {
  return value === 'first_video' ? 'first_video' : 'full_video'
}

export function atomicSpec(definition: VideoAtomicNodeDefinition): WorkflowAtomicNodeSpecV1 {
  const portArtifactContract = definition.executorRef
    ? resolveWorkflowExecutorPortArtifactContract(definition.executorRef)
    : null
  const inputArtifactTypes = portArtifactContract
    ? Object.fromEntries(definition.inputPorts.flatMap((port) => (
        portArtifactContract.inputArtifactTypes[port]
          ? [[port, portArtifactContract.inputArtifactTypes[port]] as const]
          : []
      )))
    : {}
  const outputArtifactTypes = portArtifactContract
    ? Object.fromEntries(definition.outputPorts.flatMap((port) => (
        portArtifactContract.outputArtifactTypes[port]
          ? [[port, portArtifactContract.outputArtifactTypes[port]] as const]
          : []
      )))
    : {}
  return {
    version: 1,
    category: definition.category,
    operation: definition.operation,
    executorRef: definition.executorRef,
    executionMode: definition.executionMode,
    inputPorts: definition.inputPorts,
    ...(definition.optionalInputPorts ? { optionalInputPorts: definition.optionalInputPorts } : {}),
    ...(definition.selectiveOutputPorts ? { selectiveOutputPorts: definition.selectiveOutputPorts } : {}),
    outputPorts: definition.outputPorts,
    ...(Object.keys(inputArtifactTypes).length > 0 ? { inputArtifactTypes } : {}),
    ...(Object.keys(outputArtifactTypes).length > 0 ? { outputArtifactTypes } : {}),
  }
}

export function videoNodeRuntimeData(definition: VideoAtomicNodeDefinition): Record<string, unknown> {
  const runtimeNodeId = definition.runtimeTemplateNodeId ?? definition.nodeId
  const stageSchema = definition.nodeId === 'beat-sheet-agent' ? chapterBeatPlanSchema
    : definition.nodeId === 'chapter-assets-agent' ? chapterAssetPlanSchema
      : definition.nodeId === 'clip-design-agent' ? clipDesignSchema : null
  if (stageSchema) {
    const properties = stageSchema.properties as Record<string, unknown>
    return {
      workflowInstruction: '执行 tapcanvas-video-authoring-stages Skill 中与本节点 output artifact 对应的职责，只交付本节点 schema 中的字段；冻结上游事实和精确身份不改写，完整章节来源不得截短。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: { allowedFields: Object.keys(properties), jsonSchema: stageSchema },
      workflowAgentDeliveryRequirement: '交付本节点声明的结构化产物；局部错误在同一节点内修复，不重写其它阶段产物。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
      ...(definition.nodeId === 'clip-design-agent' ? { workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 16 } } : {}),
    }
  }

  if (runtimeNodeId === 'text-expansion-agent') {
    return {
      workflowInstruction: '读取 canvas-facts.authoritativeSources 的完整正文。你是成片流程中的可选文本处理步骤：如果正文已经足够完整，原样返回；如果存在明显缺失，补足必要的连续动作、因果、人物选择与可拍结果。不得改变原有人物、事件、对白事实，不得输出提纲、分析、Markdown 或质检报告，只返回最终可供 BeatSheet 改编的正文。',
      workflowAgentOutputArtifactType: 'tapcanvas.text/v1',
      workflowAgentOutputEncoding: 'plain_text',
      workflowAgentDeliveryRequirement: '交付一份非空正文；输入完整时保持原文，确需处理时仅在同一链内完成必要扩写。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      // 前置扩写产出的是交给 BeatSheet 的可拍正文，不是小说散文：owner 是编剧 skill。
      // 绑回 writing-expert 会让该节点退化成小说补全，与 Skill 自身声明的边界冲突。
      workflowRequiredSkills: ['tapcanvas-screenwriter'],
    }
  }
  if (definition.nodeId === 'launch-beat-agent') {
    return {
      workflowInstruction: '执行已预载的 tapcanvas-dramatic-adapter 及其运行时合同，以冻结 delivery-contract、generationContract、canvasFacts.authoritativeSources 和项目素材快照为输入。本节点只负责首 Clip，按冻结交付范围提交唯一 beat，并在 blockingPlans 中为该 Clip 冻结俯视空间调度：角色站位、朝向、走位、场景地标、机位、轴线和关键帧构图合同；归一化坐标使用 [x,y]，原点左上。逐段视觉依赖提取、资产复用、连续性与创作自检按该 Skill 及其 references 执行；节点不维护另一套创作方法。只提交运行时 schema 要求的严格 JSON，宿主派生字段以实际 schema 为准。结构性拒因沿同一逻辑任务回灌 Agent 修订，保留来源和精确资产身份，不由本地代码猜绑或改写语义。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        contractName: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
        contractVersion: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
        requiredStringFields: ['sourceId', 'sourceFingerprint', 'protocolVersion'],
        requiredObjectFields: ['sourceCoveragePlan', 'chapterArc', 'sequenceControlPlan'],
        requiredNonEmptyStringPaths: ['sequenceControlPlan.segments[].transitionFromPrevious', 'sequenceControlPlan.segments[].transitionToNext', 'blockingPlans[].backgroundPlan.assetId', 'blockingPlans[].backgroundPlan.displayName', 'blockingPlans[].backgroundPlan.prompt', 'blockingPlans[].backgroundPlan.negativePrompt'],
        requiredArrayFields: ['objectRegistry', 'assetPlans', 'blockingPlans', 'beats'],
        arrayItemRequiredStringFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'referenceRole', 'identityInvariant'],
          assetPlans: ['role'],
          blockingPlans: ['title', 'sceneName'],
          beats: ['startKeyframe', 'endKeyframe', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext'],
        },
        arrayItemRequiredStringArrayFields: { objectRegistry: ['referenceImageNodeIds'] },
        arrayItemRequiredNonEmptyStringArrayFields: { assetPlans: ['identityAnchors', 'prohibitedDrift'] },
        arrayItemAllowedFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'physicalIdentityKey', 'referenceImageNodeIds', 'referenceAssetIds', 'referenceRole', 'forbiddenTransfer', 'identityInvariant', 'scale'],
          assetPlans: ['role', 'prompt', 'negativePrompt', 'identityBoardSpec', 'sceneCard', 'identityAnchors', 'prohibitedDrift'],
          blockingPlans: ['clipIndex', 'title', 'sceneName', 'durationSeconds', 'backgroundPlan', 'bg', 'width', 'height', 'landmarks', 'characters', 'camera', 'axisLine', 'compositionContract'],
          beats: ['clipId', 'clipIndex', 'durationSeconds', 'sourceSpan', 'narrativeIntent', 'visualIntent', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext', 'startKeyframe', 'endKeyframe', 'exitState', 'characters', 'speakers', 'narrativeAudioPlan', 'dialoguePaceRate', 'storyEvents', 'objectStates'],
        },
        allowedFields: ['sourceId', 'sourceFingerprint', 'protocolVersion', 'sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc', 'sequenceControlPlan', 'objectRegistry', 'assetPlans', 'blockingPlans', 'beats'],
      },
      workflowAgentDeliveryRequirement: '交付唯一、可解析且 beats 恰好一项的首 Clip Keyframe BeatSheet；clipIndex=0，来源身份、首段对白、事件相位、人物唯一身体身份、对象状态和交接状态均可追溯。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
		workflowRequiredSkills: ['tapcanvas-dramatic-adapter', 'tapcanvas-scene-card'],
    }
  }
  if (runtimeNodeId === 'asset-coverage') {
    return {}
  }
  if (runtimeNodeId === 'asset-fan-out') {
    return {}
  }
  if (runtimeNodeId === 'asset-image-generate' || runtimeNodeId === 'background-image-generate') {
    return {
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
      },
      workflowImageReferenceAssetBindings: [],
    }
  }
  if (runtimeNodeId === 'clip-fan-out') {
    return { workflowCollectionItemIdField: 'clipId' }
  }
  if (runtimeNodeId === 'clip-writer-agent') {
    return {
      workflowInstruction: '执行已预载的 tapcanvas-video-prompt-writer 及其 authoring contract，以冻结 clip-context、spokenScript、sequenceContext、generationContract 与 assetObjectContracts 为输入。镜头、对白、对象身份和同链创作自检均由该 Skill 统一定义，本节点不复制创作规则。只提交运行时 schema 要求的最终 JSON；结构性拒因沿同一逻辑任务回灌 writer 修订，保留冻结来源。宿主只执行确定性投影、真实引用解析与镜头内声音展示，不代写创作内容，不手工修订已提交产物。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        requiredArrayFields: ['clips'],
        allowedFields: ['clips', 'selfQaNote', 'creativeReview', 'sourceFidelityAudit'],
        itemRequiredNonEmptyArrayFields: ['shots'],
      },
      workflowAgentDeliveryRequirement: '一次性交付一个符合当前 runtime JSON contract 的完整 clips 信封；创作语义由 tapcanvas-video-prompt-writer 在提交前自行验收，宿主不以第二套提示词或返回纠偏覆盖。',
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowPromptExampleMediaType: 'video',
		// 对白戏扩展与父 Skill 一起预加载：人声密度（静默镜比例、连续人声上限、旁白额度）
		// 是 writer 写 shots 时必须当场做的取舍。此前它只作为 optional extension 可见、
		// 由 agent 自行决定是否加载，实测整章交付里三个 Agent 节点的 loadedKnowledgeSources
		// 全为空、也没有一个加载该扩展，于是逐字搬原文对白、满轨人声。
		// 规则仍由 Skill 持有，节点只声明依赖，不复制创作方法。
		workflowRequiredSkills: ['tapcanvas-video-prompt-writer', 'tapcanvas-dialogue-drama'],
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
        inputAlignment: {
          strategy: 'keyed_join',
          primaryPort: 'clip-contexts',
          primaryKeyPath: 'beat.clipId',
          candidateKeyPath: 'assetPlan.consumerClipIds',
          candidatePorts: ['asset-bindings'],
        },
      },
    }
  }
  if (runtimeNodeId === 'prompt-package') {
    return {
      workflowDeliveryRequirement: '持久化完整逐 Clip 提示词包；每个动态 Clip 都有稳定 itemId、原始顺序、来源谱系、合法语义时长、冻结参与者、逐字退出态、完整对白守恒、精确说话人绑定、资产角色结构和 embedded_authoring 复盘证据，以及由唯一 renderer 生成的非空纯执行提示词。provider prompt 只包含自然视听语言、真实 @图N 参考令牌、对白、镜头时间/动作/摄影/光线/材质/声音与结束状态；不得包含 AUDIO/ENTRY+REFERENCES/SHOTS/EXIT、VISUAL_ONLY/SFX_ONLY、SpeechEvent/SpokenText/VoiceManifest、canonical 映射或节点说明。writer 的 clips/selfQaNote/creativeReview/sourceFidelityAudit 信封、图片 prompt 与 negativePrompt 不得进入视频模型正文；prompt_only 不产生媒体副作用。',
      workflowDeliveryArtifactType: 'tapcanvas.prompt-package/v2',
    }
  }
  if (runtimeNodeId === 'cost-estimate') {
    return {
      workflowDeliveryRequirement: '基于本轮持久 Prompt Package、逐 Clip 时长和实时启用模型计费目录生成新的费用预估；冻结模型、分辨率、比例、逐 Clip 积分和 estimateIdentity。',
    }
  }
  if (runtimeNodeId === 'video-submit') {
    return {
      workflowVideoReferencePolicy: 'forbidden',
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
      },
    }
  }
  if (runtimeNodeId === 'delivery-verify') {
    if (definition.inputPorts.includes('video-assets')) {
      return {
        workflowDeliveryRequirement: '首个动态 Clip 具有真实持久视频 URL，且数据项、供应商任务与资产证据可追溯。',
        workflowDeliveryArtifactType: 'tapcanvas.video/v1',
      }
    }
    return {
      workflowDeliveryRequirement: 'Clip 上限节点选中的全部动态 Clip 均具有真实持久视频 URL，主片具有唯一真实持久 concatVideoUrl；交付只验收该冻结集合，不要求继续覆盖上限之外的章节片段。同一工作流运行的 Prompt Package 已证明对白守恒、角色资产绑定、embedded authoring 复盘与动态时长总和，且数据项、供应商任务与资产证据可追溯。',
      workflowDeliveryArtifactType: 'tapcanvas.master-video/v1',
    }
  }
  return {}
}

export function stageNodeId(workflowInstanceId: string, workflowNodeId: string): string {
  return `${workflowInstanceId}:${workflowNodeId}`
}

function workflowEdgeSignature(edge: Readonly<{
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}>): string {
  return [edge.source, edge.sourceHandle ?? '', edge.target, edge.targetHandle ?? ''].join('\u0000')
}

function persistedMaxClipCount(
  nodes: readonly VideoWorkflowExistingNode[] | undefined,
  nodeId: string,
): number | null {
  const value = nodes?.find((node) => node.id === nodeId)?.data?.workflowBeatSheetTakeCount
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= VIDEO_WORKFLOW_MAX_CLIPS_MIN
    && value <= VIDEO_WORKFLOW_MAX_CLIPS_MAX
    ? value
    : null
}

const RESETTABLE_VIDEO_WORKFLOW_RUNTIME_DATA: Readonly<Record<string, undefined>> = {
  workflowInstruction: undefined,
  workflowAgentOutputEncoding: undefined,
  workflowAgentJsonArrayContract: undefined,
  workflowAgentJsonObjectContract: undefined,
  workflowPreparedBeatSheetJsonObjectContract: undefined,
  workflowAgentDeliveryRequirement: undefined,
  workflowAgentDefinitionId: undefined,
  workflowPromptExampleMediaType: undefined,
  workflowAgentMaxOutputTokens: undefined,
  workflowRequiredSkills: undefined,
  workflowAllowedTools: undefined,
  workflowSkillId: undefined,
  workflowToolId: undefined,
  workflowAgentOutputArtifactType: undefined,
  workflowOutputArtifactType: undefined,
  workflowDeliveryRequirement: undefined,
  workflowDeliveryArtifactType: undefined,
  workflowCollectionItemIdField: undefined,
  workflowImageReferenceAssetBindings: undefined,
  workflowKnowledgeCardIds: undefined,
  workflowDisabledSkillReferences: undefined,
  workflowDisabledKnowledgeCardIds: undefined,
  workflowKnowledgeQuery: undefined,
  workflowKnowledgeCardId: undefined,
  workflowKnowledgeRoleScope: undefined,
  workflowKnowledgeDomain: undefined,
  workflowKnowledgeStrictFilters: undefined,
  workflowKnowledgeLimit: undefined,
	workflowConfigurationSourceNodeId: undefined,
}

/**
 * Produces a structural hard-cutover patch for a persisted workflow project.
 * Runtime telemetry and explicit model selections remain untouched; executable
 * node contracts, agent instructions and internal DAG edges are replaced by the
 * current template so a prior test invocation cannot become authoring truth.
 */
export function buildVideoWorkflowCanvasDefinitionPatch(input: Readonly<{
  workflowInstanceId: string
  workflowGroupId: string
  executionScope: VideoWorkflowExecutionScope
  executionVariant?: VideoWorkflowExecutionVariant
  existingNodes?: readonly VideoWorkflowExistingNode[]
  existingEdges: readonly VideoWorkflowExistingEdge[]
}>): VideoWorkflowCanvasDefinitionPatch {
  const workflowInstanceId = input.workflowInstanceId.trim()
  const workflowGroupId = input.workflowGroupId.trim()
  if (!workflowInstanceId || !workflowGroupId) throw new Error('缺少工作流实例或工作流组身份')
  const executionVariant = input.executionVariant ?? 'full_video'
  if (input.executionScope === 'prompt_only' && executionVariant !== 'full_video') {
    throw new Error('提示词工作流不支持首视频媒体变体')
  }
  const definitions = workflowDefinitions(input.executionScope, executionVariant)
  const definitionNodeIds = new Set(definitions.map((definition) => definition.nodeId))
  const edges = workflowEdges(input.executionScope, executionVariant)
  assertWorkflowDefinitionTopology(definitions, edges)
  const workflowNodeIds = new Set([
    stageNodeId(workflowInstanceId, 'manual-trigger'),
    ...definitions.map((definition) => stageNodeId(workflowInstanceId, definition.nodeId)),
  ])
  const expectedEdges = edges.map((edge) => ({
    id: `workflow-v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION}:${workflowInstanceId}:${edge.sourceNodeId}:${edge.sourcePort}:${edge.targetNodeId}:${edge.targetPort}`,
    source: stageNodeId(workflowInstanceId, edge.sourceNodeId),
    target: stageNodeId(workflowInstanceId, edge.targetNodeId),
    sourceHandle: workflowPortHandleId('output', edge.sourcePort),
    targetHandle: workflowPortHandleId('input', edge.targetPort),
  }))
  const expectedEdgeSignatures = new Set(expectedEdges.map(workflowEdgeSignature))
  const existingEdgeSignatures = new Set(input.existingEdges.map(workflowEdgeSignature))
  const deleteNodeIds = (input.existingNodes ?? []).flatMap((node) => (
    node.parentId === workflowGroupId
    && node.id.startsWith(`${workflowInstanceId}:`)
    && !workflowNodeIds.has(node.id)
      ? [node.id]
      : []
  ))
  const patchNodeData = [
    {
      id: workflowGroupId,
      data: {
        workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
        workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
        workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
        workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
        workflowInstanceId,
        workflowExecutionScope: input.executionScope,
        workflowExecutionVariant: executionVariant,
        workflowPermission: ADMIN_WORKFLOW_PERMISSION,
        adminWorkflow: true,
      },
      allowOverwrite: true as const,
    },
    {
      id: stageNodeId(workflowInstanceId, 'manual-trigger'),
      data: {
        workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
        workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
        workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
        workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
        workflowInstanceId,
        workflowExecutionScope: input.executionScope,
        workflowExecutionVariant: executionVariant,
        workflowTriggerSpec: createManualWorkflowTriggerSpec(),
        workflowExecutionConcurrency: VIDEO_WORKFLOW_EXECUTION_CONCURRENCY,
        workflowTriggerPayload: null,
        workflowOutputPorts: ['trigger'],
        workflowPermission: ADMIN_WORKFLOW_PERMISSION,
        adminWorkflow: true,
      },
      allowOverwrite: true as const,
    },
    ...definitions.map((definition) => {
      const nodeId = stageNodeId(workflowInstanceId, definition.nodeId)
      const existingMaxClipCount = definition.operation === 'max_clip'
        ? persistedMaxClipCount(input.existingNodes, nodeId)
        : null
      return {
        id: nodeId,
        data: {
          label: definition.label,
          workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
          workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
          workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
          workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
          workflowInstanceId,
          workflowExecutionScope: input.executionScope,
          workflowExecutionVariant: executionVariant,
          workflowNodeId: definition.nodeId,
          workflowNodeKind: definition.operation,
          workflowAtomicSpec: atomicSpec(definition),
          workflowInputPorts: [...definition.inputPorts],
          workflowOptionalInputPorts: [...(definition.optionalInputPorts ?? [])],
          workflowOutputPorts: [...definition.outputPorts],
          workflowOperationDescription: definition.description,
          ...RESETTABLE_VIDEO_WORKFLOW_RUNTIME_DATA,
          ...videoNodeRuntimeData(definition),
          ...(definition.skillId ? { workflowSkillId: definition.skillId } : {}),
          ...(definition.toolId ? { workflowToolId: definition.toolId } : {}),
          ...(definition.agentOutputArtifactType
            ? { workflowAgentOutputArtifactType: definition.agentOutputArtifactType }
            : {}),
          ...(definition.agentOutputArtifactType ?? definition.outputArtifactType
            ? { workflowOutputArtifactType: definition.agentOutputArtifactType ?? definition.outputArtifactType }
            : {}),
          ...(definition.nodeId === 'canvas-source' ? { workflowSourceMode: 'project_context' } : {}),
		  ...(definition.runtimeTemplateNodeId && definitionNodeIds.has(definition.runtimeTemplateNodeId)
		    ? { workflowConfigurationSourceNodeId: definition.runtimeTemplateNodeId }
		    : {}),
          ...(definition.runtimeData ?? {}),
          ...(existingMaxClipCount === null ? {} : { workflowBeatSheetTakeCount: existingMaxClipCount }),
          workflowPermission: ADMIN_WORKFLOW_PERMISSION,
          adminWorkflow: true,
        },
        allowOverwrite: true as const,
      }
    }),
  ]
  const createNodes: Node[] = input.existingNodes ? definitions.flatMap((definition, index) => {
    const id = stageNodeId(workflowInstanceId, definition.nodeId)
    if (input.existingNodes?.some(node => node.id === id)) return []
    const patch = patchNodeData.find(item => item.id === id)
    if (!patch) throw new Error('Missing new workflow node contract')
    return [{ id, type: 'taskNode', parentId: workflowGroupId, position: { x: 40 + ((index + 1) % COLUMN_COUNT) * (NODE_WIDTH + COLUMN_GAP), y: 80 + Math.floor((index + 1) / COLUMN_COUNT) * (NODE_HEIGHT + ROW_GAP) }, data: { ...patch.data, kind: 'workflowStage', status: 'idle', nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT } }]
  }) : []
  return {
    ...(createNodes.length ? { createNodes } : {}),
    patchNodeData,
    deleteNodeIds,
    createEdges: expectedEdges.filter((edge) => !existingEdgeSignatures.has(workflowEdgeSignature(edge))),
    deleteEdgeIds: input.existingEdges.flatMap((edge) => (
      workflowNodeIds.has(edge.source)
      && workflowNodeIds.has(edge.target)
      && !expectedEdgeSignatures.has(workflowEdgeSignature(edge))
      && edge.id
        ? [edge.id]
        : []
    )),
    allowOverwrite: true,
  }
}


function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}
