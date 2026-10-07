/**
 * Canonical one-click video workflow canvas template.
 *
 * Pure data: node contracts, runtime data, edges and the structural upgrade
 * patch. The Web canvas renders and edits it; Hono uses the same module to
 * upgrade an equipped workflow whose saved template fingerprint is behind, so
 * both sides can never disagree on what "the latest template" is.
 */
import { authoredSourceUnitLedgerSchema } from '../source-unit-ledger/index.mjs'
import { chapterBeatPlanSchema, chapterAssetPlanSchema, clipDesignSchema } from '../video-authoring-stages/schema.mjs'
import {
  CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE,
  CHAPTER_ASSET_PART_ARTIFACT_TYPE,
  CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE,
  chapterAssetOutlineSchema,
} from '../video-authoring-stages/chapter-asset-fanout.mjs'
import { clipProductionPacketSchema } from '../clip-production-packet/index.mjs'
import { clipProductionTimelineDraftSchema } from '../clip-production-packet/timeline.mjs'
import { chapterSequenceSchema } from '../chapter-sequence/index.mjs'
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
  parseWorkflowPipelineRunSpec,
  WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
  WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
  WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
  WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
  type WorkflowAtomicNodeCategory,
  type WorkflowAtomicNodeSpecV1,
  type WorkflowNodeExecutionMode,
  type WorkflowPipelineRunSpecV1,
} from '../workflow-kernel-protocol'

export type VideoWorkflowExecutionScope = 'media_delivery' | 'prompt_only'

/** Icon node geometry shared by the canvas renderer and template layout. */
export const WORKFLOW_ICON_NODE_SIZE = 56
export const WORKFLOW_ICON_NODE_COLUMN_STRIDE = 136
export const WORKFLOW_ICON_NODE_ROW_STRIDE = 112

export function workflowPortHandleId(direction: 'input' | 'output', portId: string): string {
  const normalizedPortId = portId.trim()
  if (!normalizedPortId) throw new Error('工作流端口身份不能为空')
  const prefix = direction === 'input' ? 'in-workflow:' : 'out-workflow:'
  return `${prefix}${encodeURIComponent(normalizedPortId)}`
}

/** Structural node shape the template creates; the Web canvas Node is a superset. */
export type VideoWorkflowCanvasNode = {
  id: string
  type: string
  parentId?: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}


export const NODE_WIDTH = WORKFLOW_ICON_NODE_SIZE
export const NODE_HEIGHT = WORKFLOW_ICON_NODE_SIZE
export const COLUMN_GAP = WORKFLOW_ICON_NODE_COLUMN_STRIDE - WORKFLOW_ICON_NODE_SIZE
export const ROW_GAP = WORKFLOW_ICON_NODE_ROW_STRIDE - WORKFLOW_ICON_NODE_SIZE
export const SOURCE_GAP = 160
export const COLUMN_COUNT = 5
export {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
}
export const VIDEO_WORKFLOW_EXECUTION_CONCURRENCY = 16 as const
/** Requested upper bound; the frozen model contract validates provider capacity. */
export const VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS = 65_536 as const
/** Asset outline and individual asset artifacts use a smaller output budget. */
export const VIDEO_WORKFLOW_SMALL_AUTHOR_MAX_OUTPUT_TOKENS = 24_000 as const
/** Bound independent asset authoring requests without changing the selected model. */
export const VIDEO_WORKFLOW_CHAPTER_ASSET_PART_CONCURRENCY = 8 as const
/** Bound concurrent Clip authoring and media work against the configured providers. */
export const VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY = 6 as const
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
export const VIDEO_V119_WORKFLOW_CAPABILITY_DESCRIPTION = '读取完整冻结来源，先由单个全章作者规划完整事件时间线与对白，再按供应商窗口投影逐 Clip 连续性和来源范围；逐 Clip 并行创作视频提示词与图像资产意图，使用视频提示词 Skill 和同媒体知识案例。全章按精确资产身份去重并先持久化共享图片节点、视频节点及依赖边。完整成片模式随后逐 Clip 补齐所需真实图片 URL、提交视频并按来源顺序合片；只生成视频节点模式在节点回读后交付。失败保留证据并按统一执行合同处理。媒体模型从用户本轮选择或账号偏好和实时目录继承。'

export type VideoWorkflowExecutionVariant = 'full_video' | 'first_video'
type VideoWorkflowVariantNodeId =
  | 'video-execution-choice'
  | 'video-node-prepare'
type VideoLegacyWorkflowNodeId =
  | 'text-expansion-agent'
  | 'launch-beat-agent'
  | 'source-units-agent'
  | 'beat-sheet-agent'
  | 'chapter-assets-agent'
  | 'clip-design-fan-out'
  | 'clip-design-agent'
  | 'beat-sheet-assemble'
  | 'beat-sheet-format'
  | 'background-fan-out'
  | 'background-image-generate'
  | 'blocking-diagrams'
  | 'asset-coverage'
  | 'chapter-asset-prepare'
  | 'asset-consumer-bind'
  | 'asset-fan-out'
  | 'asset-image-generate'
  | 'clip-fan-out'
  | 'clip-writer-agent'
  | 'prompt-package'
type VideoInlinePipelineStepId =
  | 'chapter-sequence-agent'
  | 'chapter-sequence-project'
  | 'chapter-assets-outline-agent'
  | 'chapter-assets-seeds'
  | 'chapter-assets-part-agent'
  | 'chapter-assets-collect'
  | 'clip-production-agent'
  | 'clip-production-collect'
  | 'clip-production-nodes-materialize'
  | 'clip-production-media-project'
  | 'clip-asset-image-generate'
  | 'clip-production-project'
  | 'chapter-asset-preview'
  | 'chapter-asset-preview-project'
  | 'chapter-asset-preview-generate'
  | 'voice-materialize'
  | 'cost-estimate'
  | 'production-handoff'
  | 'video-execution-choice'
  | 'video-node-prepare'
  | 'video-submit'
  | 'video-results'
  | 'clip-media-pipeline'
  | 'node-only-verify'
  | 'first-media-take'
type VideoWorkflowNodeId = VideoAtomicWorkflowNodeId | VideoWorkflowVariantNodeId | VideoLegacyWorkflowNodeId | VideoInlinePipelineStepId

type VideoAtomicNodeDefinitionBase = Readonly<{
  nodeId: VideoWorkflowNodeId
  label: string
  operation: string
  executionMode: WorkflowNodeExecutionMode
  inputPorts: readonly string[]
  inputArtifactTypes?: Readonly<Record<string, readonly string[]>>
  optionalInputPorts?: readonly string[]
  selectiveOutputPorts?: readonly string[]
  outputPorts: readonly string[]
  outputArtifactTypes?: Readonly<Record<string, readonly string[]>>
  description: string
  skillId?: string
  toolId?: string
  runtimeData?: Readonly<Record<string, unknown>>
  runtimeTemplateNodeId?: VideoWorkflowNodeId
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
    inputPorts: ['canvas-facts'],
    optionalInputPorts: ['expanded-source'],
    outputPorts: ['delivery-contract'],
    description: '基于 canonical canvas-facts 冻结目标、执行范围和真实交付要求；保留扩写的执行变体显式连入 expanded-source 时附加非权威扩写草稿。',
    outputArtifactType: 'tapcanvas.delivery-contract/v2',
  },
  {
    nodeId: 'source-units-agent', label: '原文单位提取 Agent', category: 'agent', operation: 'source_unit_authoring',
    executorRef: 'agents.logical-task/v2', executionMode: 'once', inputPorts: ['delivery-contract'], outputPorts: ['source-ledger'],
    description: '按冻结原文逐行分区，记录说话人及发声、内心、文字和叙述分类；独立持久化来源证据，不编排 Clip。',
    agentOutputArtifactType: 'tapcanvas.source-unit-ledger/v1',
  },
  {
    nodeId: 'beat-sheet-agent',
    label: '章节剧情规划 Agent',
    category: 'agent',
    operation: 'beat_sheet_authoring',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'once',
    inputPorts: ['trigger', 'delivery-contract', 'source-ledger'],
    optionalInputPorts: ['expanded-source'],
    outputPorts: ['chapter-plan'],
    description: '在工作流执行链内读取冻结来源与交付合同；保留扩写的执行变体显式连入 expanded-source 时等待并参考该非权威扩写草稿，只编排整章剧情、对白分配和来源覆盖；视觉细节由各 Clip 独立设计。',
    agentOutputArtifactType: 'tapcanvas.chapter-beat-plan/v3',
  },
  {
    nodeId: 'chapter-assets-agent', label: '章节资产提取 Agent', category: 'agent', operation: 'chapter_asset_authoring',
    executorRef: 'agents.logical-task/v2', executionMode: 'once', inputPorts: ['delivery-contract'], outputPorts: ['chapter-assets'],
    description: '从完整来源和真实项目资产中建立共享对象身份与资产计划，供各 Clip 精确引用。',
    agentOutputArtifactType: 'tapcanvas.chapter-asset-plan/v3',
  },
  {
    nodeId: 'clip-design-fan-out', label: '逐 Clip 设计展开', category: 'control', operation: 'clip_design_inputs',
    executorRef: 'video.clip-design-inputs/v1', executionMode: 'once', inputPorts: ['chapter-plan', 'chapter-assets', 'source-ledger'], outputPorts: ['clip-design-inputs'],
    description: '按章节计划展开独立 Clip，附带相邻剧情事实和同一份共享资产身份。', outputArtifactType: 'tapcanvas.clip-design-inputs/v1',
  },
  {
    nodeId: 'clip-design-agent', label: '逐 Clip 视觉设计 Agent', category: 'agent', operation: 'clip_design',
    executorRef: 'agents.logical-task/v2', executionMode: 'each', inputPorts: ['clip-design-inputs'], outputPorts: ['clip-designs'],
    description: '每个 Clip 独立完成视觉对象状态、站位、构图与局部时间窗，局部修复独立持久化。',
    agentOutputArtifactType: 'tapcanvas.clip-design/v2',
  },
  {
    nodeId: 'beat-sheet-assemble', label: '汇总逐 Clip 设计', category: 'control', operation: 'beat_sheet_assemble',
    executorRef: 'video.beat-sheet.assemble/v1', executionMode: 'collect', inputPorts: ['chapter-plan', 'chapter-assets', 'source-ledger', 'clip-designs'], outputPorts: ['beat-sheet'],
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
    description: '逐 clip 提交真实供应商任务；失败保留回执并暴露原因，结果未知先对账。',
    runtimeData: { workflowRetryPolicy: { maxAttempts: 1 } },
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

function workflowNodeTemplate(nodeId: VideoWorkflowNodeId): VideoAtomicNodeDefinition {
  const definition = VIDEO_REMAINDER_WORKFLOW_NODES.find((candidate) => candidate.nodeId === nodeId)
  if (!definition) throw new Error(`缺少视频工作流节点模板：${nodeId}`)
  return definition
}

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

export const VIDEO_PROMPT_ONLY_WORKFLOW_NODE_IDS: readonly VideoWorkflowNodeId[] = [
  'canvas-source',
  'delivery-contract',
  'source-units-agent',
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
      // optional expanded-source enrichment port.
      return { ...definition, inputPorts: ['canvas-facts'], optionalInputPorts: [] }
    }
    if (definition.nodeId === 'beat-sheet-agent') {
      // Prompt-only workflows intentionally omit text expansion, so the
      // canonical source ledger and delivery contract are sufficient inputs.
      return { ...definition, optionalInputPorts: [] }
    }
    if (definition.nodeId === 'clip-fan-out') {
      return { ...definition, inputPorts: ['delivery-contract', 'beat-sheet'] }
    }
    if (definition.nodeId === 'prompt-package') {
      return { ...definition, inputPorts: ['clip-prompts', 'clip-contexts'] }
    }
    return definition
  })

const VIDEO_CHAPTER_SEQUENCE_NODE_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'chapter-sequence-agent', label: '全章剧情与窗口规划', category: 'agent',
    operation: 'chapter_sequence_authoring', executorRef: 'agents.logical-task/v2', executionMode: 'once',
    inputPorts: ['trigger', 'delivery-contract'],
    inputArtifactTypes: { 'delivery-contract': ['tapcanvas.delivery-contract/v2'] },
    outputPorts: ['chapter-sequence'],
    outputArtifactTypes: { 'chapter-sequence': ['tapcanvas.chapter-sequence/v4'] },
    description: '只调用一次读取完整冻结来源，先规划全章事件、对白与绝对时间线，再提出物理 Clip 窗口及边界引用。',
    agentOutputArtifactType: 'tapcanvas.chapter-sequence/v4',
  },
  {
    nodeId: 'chapter-sequence-project', label: '冻结全章时间线与 Clip 窗口', category: 'control',
    operation: 'chapter_sequence_project', executorRef: 'video.chapter-sequence.project/v2', executionMode: 'once',
    inputPorts: ['chapter-sequence', 'delivery-contract'],
    inputArtifactTypes: {
      'chapter-sequence': ['tapcanvas.chapter-sequence/v4'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['chapter-sequence', 'clip-sequences', 'clip-segments', 'source-receipt'],
    outputArtifactTypes: {
      'chapter-sequence': ['tapcanvas.chapter-sequence-bound/v2'],
      'clip-sequences': ['tapcanvas.chapter-sequence-clips/v2'],
      'clip-segments': ['tapcanvas.clip-source-segments/v1'],
    },
    description: '依据作者提交的全章时间线与窗口累计时长，确定性生成冻结 Clip 身份、UTF-16 来源范围、逐段连续性和逐字对白投影。',
    outputArtifactType: 'tapcanvas.chapter-sequence-clips/v2',
  },
]

/**
 * 章节资产：大纲 → 逐项并行作者 → 汇总。
 *
 * 单个作者一次写整份登记表时耗时 10–29 min（偶发超长思考调用造成波动）；拆成「大纲 1 次 + 每个对象/背景各一个小作者并行」
 * 后，真实原文探针里 20s + 38s。大纲必须看到章节序列，否则会过度规划（序列起范围限定作用）。
 * 汇总后的产物仍是完整的 tapcanvas.chapter-asset-plan/v3，下游无感知。
 */
const VIDEO_CHAPTER_ASSET_STEP_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'chapter-assets-outline-agent',
    label: '章节资产大纲 Agent',
    category: 'agent',
    operation: 'chapter_asset_outline',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'once',
    inputPorts: ['delivery-contract', 'chapter-sequence'],
    inputArtifactTypes: {
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
      'chapter-sequence': ['tapcanvas.chapter-sequence-bound/v2'],
    },
    outputPorts: ['asset-outline'],
    outputArtifactTypes: { 'asset-outline': [CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE] },
    description: '依据冻结来源与章节序列列出本章成片实际需要的共享资产对象与空场背景底图，只做范围与身份规划，不写图像计划。',
    agentOutputArtifactType: CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE,
  },
  {
    nodeId: 'chapter-assets-seeds',
    label: '分配资产身份并展开',
    category: 'control',
    operation: 'chapter_asset_seeds',
    executorRef: 'video.chapter-assets.seeds/v1',
    executionMode: 'once',
    inputPorts: ['asset-outline'],
    inputArtifactTypes: { 'asset-outline': [CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE] },
    outputPorts: ['asset-seeds'],
    outputArtifactTypes: { 'asset-seeds': [CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE] },
    description: '由宿主按大纲顺序分配稳定的 objectId（obj-NN / bg-NN），展开为逐项作者集合；作者不发明身份。',
    outputArtifactType: CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE,
  },
  {
    nodeId: 'chapter-assets-part-agent',
    label: '逐项资产作者',
    category: 'agent',
    operation: 'chapter_asset_part_authoring',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'each',
    inputPorts: ['asset-seed', 'asset-outline', 'delivery-contract'],
    inputArtifactTypes: {
      'asset-seed': [CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE],
      'asset-outline': [CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['asset-parts'],
    outputArtifactTypes: { 'asset-parts': [CHAPTER_ASSET_PART_ARTIFACT_TYPE] },
    description: '每个资产对象或背景底图由一个独立作者并行完成完整登记项与图像计划；身份、种类、名称由宿主钉死。',
    agentOutputArtifactType: CHAPTER_ASSET_PART_ARTIFACT_TYPE,
  },
  {
    nodeId: 'chapter-assets-collect',
    label: '汇总章节资产计划',
    category: 'control',
    operation: 'chapter_asset_collect',
    executorRef: 'video.chapter-assets.collect/v1',
    executionMode: 'collect',
    inputPorts: ['asset-parts', 'asset-seeds'],
    inputArtifactTypes: {
      'asset-parts': [CHAPTER_ASSET_PART_ARTIFACT_TYPE],
      'asset-seeds': [CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE],
    },
    outputPorts: ['chapter-assets'],
    outputArtifactTypes: { 'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'] },
    description: '按种子顺序核对身份并合并为完整 chapter-asset-plan/v3，再按原完整 schema 校验。',
    outputArtifactType: 'tapcanvas.chapter-asset-plan/v3',
  },
]

const VIDEO_CLIP_PRODUCTION_NODE_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'clip-production-agent',
    label: '逐 Clip 提示词与资产意图',
    category: 'agent',
    operation: 'clip_production_authoring',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'each',
    inputPorts: ['clip-segment', 'clip-sequence', 'delivery-contract', 'chapter-assets'],
    inputArtifactTypes: {
      'clip-segment': ['tapcanvas.clip-source-segments/v1', 'tapcanvas.clip-source-segment/v1'],
      'clip-sequence': ['tapcanvas.chapter-sequence-clips/v2', 'tapcanvas.chapter-sequence-clip/v2'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
      'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
    },
    outputPorts: ['packets'],
    outputArtifactTypes: { packets: ['tapcanvas.clip-production-packet/v2'] },
    description: '按冻结来源集合逐 Clip 并行创作完整视频提示词、明确输入模式与图像资产意图；保留逐 Clip 身份和来源，不编造资产 URL。',
    skillId: 'tapcanvas-video-prompt-writer',
    agentOutputArtifactType: 'tapcanvas.clip-production-packet/v2',
  },
  {
    nodeId: 'clip-production-collect',
    label: '按身份汇总 Clip 资产意图',
    category: 'control',
    operation: 'clip_production_collect',
    executorRef: 'video.clip-production.collect/v1',
    executionMode: 'collect',
    inputPorts: ['packets', 'clip-segments', 'chapter-assets'],
    inputArtifactTypes: {
      packets: ['tapcanvas.clip-production-packet/v2'],
      'clip-segments': ['tapcanvas.clip-source-segments/v1'],
      'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
    },
    outputPorts: ['clip-production', 'asset-intents'],
    outputArtifactTypes: {
      'clip-production': ['tapcanvas.clip-production-packets/v2'],
      'asset-intents': ['tapcanvas.clip-production-asset-intents/v1'],
    },
    description: '按相同索引和 Clip ID 核对 Agent 结果与冻结来源，再按精确资产身份合并重复生成意图。',
    outputArtifactType: 'tapcanvas.clip-production-packets/v2',
  },
  {
    nodeId: 'clip-production-nodes-materialize',
    label: '持久化全章节点与共享依赖',
    category: 'delivery',
    operation: 'clip_production_nodes_materialize',
    executorRef: 'video.clip-production.nodes.materialize/v1',
    executionMode: 'once',
    inputPorts: ['clip-production', 'asset-intents', 'delivery-contract'],
    inputArtifactTypes: {
      'clip-production': ['tapcanvas.clip-production-packets/v2'],
      'asset-intents': ['tapcanvas.clip-production-asset-intents/v1'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'],
    outputArtifactTypes: {
      'node-plan': ['tapcanvas.clip-production-node-plan/v1'],
      'prompt-package': ['tapcanvas.prompt-package/v2'],
      'media-items': ['tapcanvas.clip-production-media-items/v1'],
      'prepared-nodes': ['tapcanvas.video-node/v1'],
    },
    description: '全章核对一 Clip 一视频节点，按精确资产身份共享图片节点；持久化节点、依赖边并回读，不提交任何媒体任务。',
    outputArtifactType: 'tapcanvas.clip-production-node-plan/v1',
  },
  {
    nodeId: 'clip-production-media-project',
    label: '读取本 Clip 媒体依赖',
    category: 'control',
    operation: 'clip_production_media_project',
    executorRef: 'video.clip-production.media.project/v1',
    executionMode: 'once',
    inputPorts: ['media-item'],
    inputArtifactTypes: { 'media-item': ['tapcanvas.clip-production-media-item/v1'] },
    outputPorts: ['clip-production', 'asset-items', 'prepared-nodes'],
    outputArtifactTypes: {
      'clip-production': ['tapcanvas.clip-production-packets/v2'],
      'asset-items': ['tapcanvas.asset-plan-items/v2'],
      'prepared-nodes': ['tapcanvas.video-node/v1'],
    },
    description: '只投影本 Clip 已持久化的视频节点和它引用的共享图片生成项；图片 effect 身份保持全章一致。',
    outputArtifactType: 'tapcanvas.clip-production-packets/v2',
  },
  {
    nodeId: 'clip-asset-image-generate',
    label: '并行生成 Clip 图像资产',
    category: 'media',
    operation: 'image_generate',
    executorRef: 'tapcanvas.image.generate/v1',
    executionMode: 'each',
    inputPorts: ['asset-items'],
    inputArtifactTypes: { 'asset-items': ['tapcanvas.asset-plan-items/v2'] },
    outputPorts: ['asset-bindings'],
    outputArtifactTypes: { 'asset-bindings': ['tapcanvas.asset-bindings/v1'] },
    description: '按资产显式规格并行生成真实持久图片，输出供同身份 Clip 引用的 URL 回执。',
    outputArtifactType: 'tapcanvas.asset-bindings/v1',
  },
  {
    nodeId: 'clip-production-project',
    label: '编译 Clip 生产包',
    category: 'delivery',
    operation: 'clip_production_project',
    executorRef: 'video.clip-production.project/v1',
    executionMode: 'collect',
    inputPorts: ['clip-production', 'asset-bindings', 'delivery-contract'],
    inputArtifactTypes: {
      'clip-production': ['tapcanvas.clip-production-packets/v2'],
      'asset-bindings': ['tapcanvas.asset-bindings/v1'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['prompt-package'],
    outputArtifactTypes: { 'prompt-package': ['tapcanvas.prompt-package/v2'] },
    description: '按精确资产身份把真实图片回执合并到完整逐 Clip 提示词包，保留 Agent 原始视频提示词。',
    outputArtifactType: 'tapcanvas.prompt-package/v2',
  },
]

const VIDEO_CHAPTER_ASSET_PREVIEW_STEP_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'chapter-asset-preview-project',
    label: '章节资产卡上画布',
    category: 'control',
    operation: 'chapter_asset_preview_project',
    executorRef: 'video.chapter-assets.preview/v1',
    executionMode: 'once',
    inputPorts: ['chapter-assets', 'delivery-contract'],
    inputArtifactTypes: {
      'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['asset-items'],
    outputArtifactTypes: { 'asset-items': ['tapcanvas.asset-plan-items/v2'] },
    description: '把冻结章级资产计划中需要生成的对象，按与逐 Clip 完全相同的资产身份和生图规格落成画布卡片，不提交媒体任务。',
    outputArtifactType: 'tapcanvas.asset-plan-items/v2',
  },
  {
    ...clipProductionNodeTemplate('clip-asset-image-generate'),
    nodeId: 'chapter-asset-preview-generate',
    label: '并行生成章节资产图',
    description: '章节资产计划冻结后立即为每张资产卡生成真实图片；逐 Clip 阶段按同一 effect 身份认领，不重复提交。',
  },
]

function clipProductionNodeTemplate(nodeId: VideoInlinePipelineStepId): VideoAtomicNodeDefinition {
  const definition = VIDEO_CLIP_PRODUCTION_NODE_DEFINITIONS.find((candidate) => candidate.nodeId === nodeId)
  if (!definition) throw new Error(`缺少 Clip 生产节点模板：${nodeId}`)
  return definition
}

const VIDEO_CLIP_PLANNING_STEP_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  clipProductionNodeTemplate('clip-production-agent'),
  clipProductionNodeTemplate('clip-production-collect'),
  clipProductionNodeTemplate('clip-production-nodes-materialize'),
]

const VIDEO_CLIP_MEDIA_STEP_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  clipProductionNodeTemplate('clip-production-media-project'),
  clipProductionNodeTemplate('clip-asset-image-generate'),
  clipProductionNodeTemplate('clip-production-project'),
  workflowNodeTemplate('voice-materialize'),
  workflowNodeTemplate('cost-estimate'),
  workflowNodeTemplate('production-handoff'),
  { ...workflowNodeTemplate('video-execution-choice'), inputPorts: ['value', 'production-plan'] },
  workflowNodeTemplate('video-node-prepare'),
  workflowNodeTemplate('video-submit'),
  workflowNodeTemplate('video-results'),
]

function inlinePipelineNodeSnapshot(definition: VideoAtomicNodeDefinition) {
  const data: Record<string, unknown> = {
    kind: 'workflowStage',
    label: definition.label,
    workflowNodeId: definition.nodeId,
    workflowNodeKind: definition.operation,
    workflowAtomicSpec: atomicSpec(definition),
    workflowInputPorts: [...definition.inputPorts],
    workflowOptionalInputPorts: [...(definition.optionalInputPorts ?? [])],
    workflowOutputPorts: [...definition.outputPorts],
    workflowOperationDescription: definition.description,
    workflowExecutionScope: 'media_delivery',
    workflowExecutionVariant: 'full_video',
    ...videoNodeRuntimeData(definition),
    ...(definition.skillId ? { workflowSkillId: definition.skillId } : {}),
    ...(definition.toolId ? { workflowToolId: definition.toolId } : {}),
    ...(definition.agentOutputArtifactType
      ? { workflowAgentOutputArtifactType: definition.agentOutputArtifactType }
      : {}),
    ...(definition.agentOutputArtifactType ?? definition.outputArtifactType
      ? { workflowOutputArtifactType: definition.agentOutputArtifactType ?? definition.outputArtifactType }
      : {}),
    ...(definition.runtimeData ?? {}),
  }
  return {
    id: definition.nodeId,
    type: 'taskNode',
    kind: 'workflowStage',
    data,
  } as const
}

function createVideoChapterAssetsPipelineSpec(): WorkflowPipelineRunSpecV1 {
  return parseWorkflowPipelineRunSpec({
    protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
    inputs: [
      { portId: 'delivery-contract', mode: 'value', artifactTypes: ['tapcanvas.delivery-contract/v2'] },
      { portId: 'chapter-sequence', mode: 'value', artifactTypes: ['tapcanvas.chapter-sequence-bound/v2'] },
    ],
    steps: VIDEO_CHAPTER_ASSET_STEP_DEFINITIONS.map((definition) => ({
      stepId: definition.nodeId,
      node: inlinePipelineNodeSnapshot(definition),
    })),
    bindings: [
      { from: { kind: 'input', portId: 'delivery-contract' }, to: { stepId: 'chapter-assets-outline-agent', portId: 'delivery-contract' }, mode: 'value' },
      { from: { kind: 'input', portId: 'chapter-sequence' }, to: { stepId: 'chapter-assets-outline-agent', portId: 'chapter-sequence' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'chapter-assets-outline-agent', portId: 'asset-outline' }, to: { stepId: 'chapter-assets-seeds', portId: 'asset-outline' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'chapter-assets-seeds', portId: 'asset-seeds' }, to: { stepId: 'chapter-assets-part-agent', portId: 'asset-seed' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'chapter-assets-outline-agent', portId: 'asset-outline' }, to: { stepId: 'chapter-assets-part-agent', portId: 'asset-outline' }, mode: 'value' },
      { from: { kind: 'input', portId: 'delivery-contract' }, to: { stepId: 'chapter-assets-part-agent', portId: 'delivery-contract' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'chapter-assets-part-agent', portId: 'asset-parts' }, to: { stepId: 'chapter-assets-collect', portId: 'asset-parts' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'chapter-assets-seeds', portId: 'asset-seeds' }, to: { stepId: 'chapter-assets-collect', portId: 'asset-seeds' }, mode: 'collection' },
    ],
    outputs: [
      { portId: 'chapter-assets', from: { stepId: 'chapter-assets-collect', portId: 'chapter-assets' }, mode: 'value' },
    ],
  })
}

const VIDEO_CHAPTER_ASSETS_PIPELINE_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'chapter-assets-agent',
  label: '章节资产（大纲 → 逐项并行 → 汇总）',
  category: 'subworkflow',
  operation: 'inline_pipeline',
  executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
  executionMode: 'once',
  inputPorts: ['delivery-contract', 'chapter-sequence'],
  inputArtifactTypes: {
    'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    'chapter-sequence': ['tapcanvas.chapter-sequence-bound/v2'],
  },
  outputPorts: ['chapter-assets'],
  outputArtifactTypes: { 'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'] },
  description: '先由一个大纲作者按章节序列限定本章需要的资产与背景底图，再由每个对象/背景各一个小作者并行完成登记项与图像计划，最后汇总并按完整 chapter-asset-plan/v3 校验。',
  runtimeData: { workflowPipeline: createVideoChapterAssetsPipelineSpec() },
}

function createVideoChapterAssetPreviewPipelineSpec(): WorkflowPipelineRunSpecV1 {
  return parseWorkflowPipelineRunSpec({
    protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
    inputs: [
      { portId: 'chapter-assets', mode: 'value', artifactTypes: ['tapcanvas.chapter-asset-plan/v3'] },
      { portId: 'delivery-contract', mode: 'value', artifactTypes: ['tapcanvas.delivery-contract/v2'] },
    ],
    steps: VIDEO_CHAPTER_ASSET_PREVIEW_STEP_DEFINITIONS.map((definition) => ({
      stepId: definition.nodeId,
      node: inlinePipelineNodeSnapshot(definition),
    })),
    bindings: [
      { from: { kind: 'input', portId: 'chapter-assets' }, to: { stepId: 'chapter-asset-preview-project', portId: 'chapter-assets' }, mode: 'value' },
      { from: { kind: 'input', portId: 'delivery-contract' }, to: { stepId: 'chapter-asset-preview-project', portId: 'delivery-contract' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'chapter-asset-preview-project', portId: 'asset-items' }, to: { stepId: 'chapter-asset-preview-generate', portId: 'asset-items' }, mode: 'collection' },
    ],
    outputs: [
      { portId: 'asset-bindings', from: { stepId: 'chapter-asset-preview-generate', portId: 'asset-bindings' }, mode: 'collection' },
    ],
  })
}

/**
 * Canvas-first asset stage: the chapter asset plan is frozen long before the
 * per-Clip writers finish, and every image spec is fully determined by it. Cards
 * and images land on the canvas here, in parallel with Clip authoring, so the
 * user sees identities (and provider-sensitive faces) early; Clip pipelines claim
 * the same effect identities instead of generating again.
 */
const VIDEO_CHAPTER_ASSET_PREVIEW_PIPELINE_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'chapter-asset-preview',
  label: '章节资产图（先上画布）',
  category: 'subworkflow',
  operation: 'inline_pipeline',
  executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
  executionMode: 'once',
  inputPorts: ['chapter-assets', 'delivery-contract'],
  inputArtifactTypes: {
    'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
    'delivery-contract': ['tapcanvas.delivery-contract/v2'],
  },
  outputPorts: ['asset-bindings'],
  outputArtifactTypes: { 'asset-bindings': ['tapcanvas.asset-bindings/v1'] },
  description: '章节资产计划冻结后立即把需要生成的角色、场景、道具卡落到画布并并行出图，与逐 Clip 创作同时进行；逐 Clip 按同一资产身份复用结果。',
  runtimeData: { workflowPipeline: createVideoChapterAssetPreviewPipelineSpec() },
}

function createVideoClipPlanningPipelineSpec(): WorkflowPipelineRunSpecV1 {
  return parseWorkflowPipelineRunSpec({
    protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
    inputs: [
      { portId: 'delivery-contract', mode: 'value', artifactTypes: ['tapcanvas.delivery-contract/v2'] },
      { portId: 'source-segments', mode: 'collection', artifactTypes: ['tapcanvas.clip-source-segments/v1'] },
      { portId: 'clip-sequences', mode: 'collection', artifactTypes: ['tapcanvas.chapter-sequence-clips/v2'] },
      { portId: 'chapter-assets', mode: 'value', artifactTypes: ['tapcanvas.chapter-asset-plan/v3'] },
    ],
    steps: VIDEO_CLIP_PLANNING_STEP_DEFINITIONS.map((definition) => ({
      stepId: definition.nodeId,
      node: inlinePipelineNodeSnapshot(definition),
    })),
    bindings: [
      { from: { kind: 'input', portId: 'source-segments' }, to: { stepId: 'clip-production-agent', portId: 'clip-segment' }, mode: 'collection' },
      { from: { kind: 'input', portId: 'clip-sequences' }, to: { stepId: 'clip-production-agent', portId: 'clip-sequence' }, mode: 'collection' },
      { from: { kind: 'input', portId: 'delivery-contract' }, to: { stepId: 'clip-production-agent', portId: 'delivery-contract' }, mode: 'value' },
      { from: { kind: 'input', portId: 'chapter-assets' }, to: { stepId: 'clip-production-agent', portId: 'chapter-assets' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'clip-production-agent', portId: 'packets' }, to: { stepId: 'clip-production-collect', portId: 'packets' }, mode: 'collection' },
      { from: { kind: 'input', portId: 'source-segments' }, to: { stepId: 'clip-production-collect', portId: 'clip-segments' }, mode: 'collection' },
      { from: { kind: 'input', portId: 'chapter-assets' }, to: { stepId: 'clip-production-collect', portId: 'chapter-assets' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'clip-production-collect', portId: 'clip-production' }, to: { stepId: 'clip-production-nodes-materialize', portId: 'clip-production' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'clip-production-collect', portId: 'asset-intents' }, to: { stepId: 'clip-production-nodes-materialize', portId: 'asset-intents' }, mode: 'value' },
      { from: { kind: 'input', portId: 'delivery-contract' }, to: { stepId: 'clip-production-nodes-materialize', portId: 'delivery-contract' }, mode: 'value' },
    ],
    outputs: [
      { portId: 'node-plan', from: { stepId: 'clip-production-nodes-materialize', portId: 'node-plan' }, mode: 'value' },
      { portId: 'prompt-package', from: { stepId: 'clip-production-nodes-materialize', portId: 'prompt-package' }, mode: 'value' },
      { portId: 'media-items', from: { stepId: 'clip-production-nodes-materialize', portId: 'media-items' }, mode: 'collection' },
      { portId: 'prepared-nodes', from: { stepId: 'clip-production-nodes-materialize', portId: 'prepared-nodes' }, mode: 'collection' },
    ],
  })
}

function createVideoClipMediaPipelineSpec(): WorkflowPipelineRunSpecV1 {
  return parseWorkflowPipelineRunSpec({
    protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
    inputs: [
      { portId: 'authorization', mode: 'value', artifactTypes: [] },
      { portId: 'delivery-contract', mode: 'value', artifactTypes: ['tapcanvas.delivery-contract/v2'] },
      { portId: 'media-items', mode: 'collection', artifactTypes: ['tapcanvas.clip-production-media-items/v1'], itemArtifactTypes: ['tapcanvas.clip-production-media-item/v1'] },
    ],
    steps: VIDEO_CLIP_MEDIA_STEP_DEFINITIONS.map((definition) => ({ stepId: definition.nodeId, node: inlinePipelineNodeSnapshot(definition) })),
    bindings: [
      { from: { kind: 'input', portId: 'media-items' }, to: { stepId: 'clip-production-media-project', portId: 'media-item' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'clip-production-media-project', portId: 'asset-items' }, to: { stepId: 'clip-asset-image-generate', portId: 'asset-items' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'clip-production-media-project', portId: 'clip-production' }, to: { stepId: 'clip-production-project', portId: 'clip-production' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'clip-asset-image-generate', portId: 'asset-bindings' }, to: { stepId: 'clip-production-project', portId: 'asset-bindings' }, mode: 'collection' },
      { from: { kind: 'input', portId: 'delivery-contract' }, to: { stepId: 'clip-production-project', portId: 'delivery-contract' }, mode: 'value' },
      { from: { kind: 'input', portId: 'authorization' }, to: { stepId: 'voice-materialize', portId: 'trigger' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'clip-production-project', portId: 'prompt-package' }, to: { stepId: 'cost-estimate', portId: 'prompt-package' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'clip-production-project', portId: 'prompt-package' }, to: { stepId: 'production-handoff', portId: 'prompt-package' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'cost-estimate', portId: 'estimate' }, to: { stepId: 'production-handoff', portId: 'estimate' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'clip-asset-image-generate', portId: 'asset-bindings' }, to: { stepId: 'production-handoff', portId: 'asset-bindings' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'voice-materialize', portId: 'voice-manifest' }, to: { stepId: 'production-handoff', portId: 'voice-manifest' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'production-handoff', portId: 'production-plan' }, to: { stepId: 'video-submit', portId: 'production-plan' }, mode: 'collection' },
      { from: { kind: 'input', portId: 'authorization' }, to: { stepId: 'video-execution-choice', portId: 'value' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'production-handoff', portId: 'production-plan' }, to: { stepId: 'video-execution-choice', portId: 'production-plan' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'production-handoff', portId: 'production-plan' }, to: { stepId: 'video-node-prepare', portId: 'production-plan' }, mode: 'collection' },
      { from: { kind: 'step', stepId: 'video-execution-choice', portId: 'matched' }, to: { stepId: 'video-node-prepare', portId: 'authorization' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'video-execution-choice', portId: 'unmatched' }, to: { stepId: 'video-submit', portId: 'authorization' }, mode: 'value' },
      { from: { kind: 'step', stepId: 'video-submit', portId: 'provider-receipts' }, to: { stepId: 'video-results', portId: 'provider-receipts' }, mode: 'collection' },
    ],
    outputs: [
      { portId: 'prompt-package', from: { stepId: 'clip-production-project', portId: 'prompt-package' }, mode: 'value' },
      { portId: 'estimate', from: { stepId: 'cost-estimate', portId: 'estimate' }, mode: 'value' },
      { portId: 'video-assets', from: { stepId: 'video-results', portId: 'video-assets' }, mode: 'collection' },
      { portId: 'prepared-nodes', from: { stepId: 'video-node-prepare', portId: 'prepared-nodes' }, mode: 'collection' },
    ],
  })
}

/**
 * Canvas-first barrier: every Clip is authored (bounded by the writer
 * concurrency) and the whole chapter's video nodes plus shared image
 * dependencies are persisted to the canvas before any media stage starts.
 * Splitting authoring from media keeps the canvas complete even when a writer
 * stalls, and keeps media submissions from competing with writers.
 */
const CLIP_PLANNING_PIPELINE_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'clip-production-pipeline',
  label: '全章 Clip 提示词与节点规划',
  category: 'subworkflow',
  operation: 'inline_pipeline',
  executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
  executionMode: 'once',
  inputPorts: ['delivery-contract', 'source-segments', 'clip-sequences', 'chapter-assets'],
  inputArtifactTypes: {
    'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    'source-segments': ['tapcanvas.clip-source-segments/v1'],
    'clip-sequences': ['tapcanvas.chapter-sequence-clips/v2'],
    'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
  },
  outputPorts: ['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'],
  outputArtifactTypes: {
    'node-plan': ['tapcanvas.clip-production-node-plan/v1'],
    'prompt-package': ['tapcanvas.prompt-package/v2'],
    'media-items': ['tapcanvas.clip-production-media-items/v1'],
    'prepared-nodes': ['tapcanvas.video-node/v1'],
  },
  description: '全章 Clip 按作者并发上限并行写提示词，全部完成后一次性去重共享图像资产，把每个 Clip 的视频节点与依赖边持久化到画布并回读；媒体阶段只在全章节点落画布后开始。',
  runtimeData: { workflowPipeline: createVideoClipPlanningPipelineSpec() },
}

const CLIP_MEDIA_PIPELINE_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'clip-media-pipeline',
  label: '逐 Clip 图片与视频生产',
  category: 'subworkflow',
  operation: 'inline_pipeline',
  executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
  executionMode: 'each',
  inputPorts: ['authorization', 'delivery-contract', 'media-items'],
  inputArtifactTypes: {
    'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    'media-items': ['tapcanvas.clip-production-media-items/v1'],
  },
  outputPorts: ['prompt-package', 'estimate', 'video-assets', 'prepared-nodes'],
  selectiveOutputPorts: ['video-assets', 'prepared-nodes'],
  outputArtifactTypes: {
    'prompt-package': ['tapcanvas.prompt-package/v2'],
    estimate: ['tapcanvas.video-estimate/v1'],
    'video-assets': ['tapcanvas.video-clips/v1'],
    'prepared-nodes': ['tapcanvas.video-node/v1'],
  },
  description: '对每个已落画布的 Clip 节点生成或复用真实图片 URL，再按本轮选择准备视频节点或提交视频；共享图片按全章稳定身份复用。',
  runtimeData: { workflowPipeline: createVideoClipMediaPipelineSpec() },
}

const VIDEO_V119_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  workflowNodeTemplate('canvas-source'),
  {
    ...workflowNodeTemplate('delivery-contract'),
    inputPorts: ['canvas-facts'],
    optionalInputPorts: [],
  },
  ...VIDEO_CHAPTER_SEQUENCE_NODE_DEFINITIONS,
  VIDEO_CHAPTER_ASSETS_PIPELINE_NODE,
  VIDEO_CHAPTER_ASSET_PREVIEW_PIPELINE_NODE,
  CLIP_PLANNING_PIPELINE_NODE,
  CLIP_MEDIA_PIPELINE_NODE,
  {
    nodeId: 'node-only-verify',
    label: '节点图交付验收',
    category: 'delivery',
    operation: 'delivery_verify',
    executorRef: 'agents.delivery.verify/v2',
    executionMode: 'collect',
    inputPorts: ['result'],
    inputArtifactTypes: { result: ['tapcanvas.video-node/v1'] },
    outputPorts: ['delivery-evidence'],
    description: '只在选择生成节点时，验收本次选择的 Clip 已持久化完整提示词及真实图片 URL 引用。',
    outputArtifactType: 'tapcanvas.delivery-evidence/v2',
    runtimeData: {
      workflowDeliveryRequirement: '本次选择的每个 Clip 均有一个真实持久视频节点、完整提示词及可执行的真实图片 URL 引用。',
      workflowDeliveryRequiredFacts: ['persisted', 'promptPersisted', 'dependenciesReady'],
    },
  },
  {
    nodeId: 'clip-production-aggregate',
    label: '按来源顺序汇总全部 Clip',
    category: 'delivery',
    operation: 'clip_production_aggregate',
    executorRef: 'video.clip-production.aggregate/v1',
    executionMode: 'collect',
    inputPorts: ['source-segments', 'prompt-packages', 'estimates', 'video-assets', 'prepared-nodes'],
    optionalInputPorts: ['video-assets', 'prepared-nodes'],
    inputArtifactTypes: {
      'source-segments': ['tapcanvas.clip-source-segments/v1'],
      'prompt-packages': ['tapcanvas.prompt-package/v2'],
      estimates: ['tapcanvas.video-estimate/v1'],
      'video-assets': ['tapcanvas.video-clips/v1'],
      'prepared-nodes': ['tapcanvas.video-node/v1'],
    },
    outputPorts: ['prompt-package', 'estimate', 'video-assets', 'prepared-nodes'],
    outputArtifactTypes: {
      'prompt-package': ['tapcanvas.prompt-package/v2'],
      estimate: ['tapcanvas.video-estimate/v1'],
      'video-assets': ['tapcanvas.video-clips/v1'],
      'prepared-nodes': ['tapcanvas.video-node/v1'],
    },
    selectiveOutputPorts: ['video-assets', 'prepared-nodes'],
    description: '按冻结 Clip 身份和来源顺序汇总全部真实视频回执或图片已就绪的视频节点，并保留对应提示词、估价。',
  },
  workflowNodeTemplate('concat'),
  workflowNodeTemplate('delivery-verify'),
]

export const VIDEO_ATOMIC_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = VIDEO_V119_WORKFLOW_NODES

const FIRST_MEDIA_TAKE_NODE: VideoAtomicNodeDefinition = {
  nodeId: 'first-media-take',
  label: '首 Clip 媒体选择',
  category: 'control',
  operation: 'collection_take',
  executorRef: 'workflow.collection.take/v1',
  executionMode: 'once',
  inputPorts: ['items'],
  inputArtifactTypes: { items: ['tapcanvas.clip-production-media-items/v1'] },
  outputPorts: ['items'],
  outputArtifactTypes: { items: ['tapcanvas.clip-production-media-items/v1'] },
  description: '节点图已按全部冻结 Clip 持久化；媒体阶段只选择原始顺序中的首 Clip。',
  outputArtifactType: 'tapcanvas.clip-production-media-items/v1',
  runtimeData: { workflowCollectionTakeCount: 1 },
}

export const VIDEO_FIRST_VIDEO_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  ...VIDEO_V119_WORKFLOW_NODES.filter((definition) => !['clip-production-pipeline', 'clip-media-pipeline', 'chapter-asset-preview', 'clip-production-aggregate', 'concat', 'delivery-verify'].includes(definition.nodeId)),
  CLIP_PLANNING_PIPELINE_NODE,
  FIRST_MEDIA_TAKE_NODE,
  CLIP_MEDIA_PIPELINE_NODE,
  FIRST_VIDEO_DELIVERY_VERIFY_NODE,
]

export type VideoAtomicEdgeDefinition = Readonly<{
  sourceNodeId: 'manual-trigger' | VideoWorkflowNodeId
  sourcePort: string
  targetNodeId: VideoWorkflowNodeId
  targetPort: string
}>

const VIDEO_V119_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'chapter-sequence-agent', targetPort: 'trigger' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-sequence-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'chapter-sequence-agent', sourcePort: 'chapter-sequence', targetNodeId: 'chapter-sequence-project', targetPort: 'chapter-sequence' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-sequence-project', targetPort: 'delivery-contract' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-assets-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'chapter-sequence', targetNodeId: 'chapter-assets-agent', targetPort: 'chapter-sequence' },
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'clip-segments', targetNodeId: 'clip-production-pipeline', targetPort: 'source-segments' },
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'clip-sequences', targetNodeId: 'clip-production-pipeline', targetPort: 'clip-sequences' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'clip-production-pipeline', targetPort: 'chapter-assets' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-production-pipeline', targetPort: 'delivery-contract' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'chapter-asset-preview', targetPort: 'chapter-assets' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-asset-preview', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-production-pipeline', sourcePort: 'media-items', targetNodeId: 'clip-media-pipeline', targetPort: 'media-items' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-media-pipeline', targetPort: 'delivery-contract' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'clip-media-pipeline', targetPort: 'authorization' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'prepared-nodes', targetNodeId: 'node-only-verify', targetPort: 'result' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'prompt-package', targetNodeId: 'clip-production-aggregate', targetPort: 'prompt-packages' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'estimate', targetNodeId: 'clip-production-aggregate', targetPort: 'estimates' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'video-assets', targetNodeId: 'clip-production-aggregate', targetPort: 'video-assets' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'prepared-nodes', targetNodeId: 'clip-production-aggregate', targetPort: 'prepared-nodes' },
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'clip-segments', targetNodeId: 'clip-production-aggregate', targetPort: 'source-segments' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'video-assets', targetNodeId: 'concat', targetPort: 'video-assets' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'estimate', targetNodeId: 'concat', targetPort: 'estimate' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'prompt-package', targetNodeId: 'concat', targetPort: 'prompt-package' },
  { sourceNodeId: 'concat', sourcePort: 'master-video', targetNodeId: 'delivery-verify', targetPort: 'master-video' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'prompt-package', targetNodeId: 'delivery-verify', targetPort: 'prompt-package' },
]

export const VIDEO_ATOMIC_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
	...VIDEO_V119_WORKFLOW_EDGES,
]

export const VIDEO_FIRST_VIDEO_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  ...VIDEO_V119_WORKFLOW_EDGES.filter((edge) => (
    !['clip-production-aggregate', 'concat', 'delivery-verify', 'chapter-asset-preview', 'clip-production-pipeline', 'clip-media-pipeline'].includes(edge.targetNodeId)
    && !['clip-production-aggregate', 'concat', 'delivery-verify', 'chapter-asset-preview', 'clip-production-pipeline', 'clip-media-pipeline'].includes(edge.sourceNodeId)
  )),
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'clip-segments', targetNodeId: 'clip-production-pipeline', targetPort: 'source-segments' },
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'clip-sequences', targetNodeId: 'clip-production-pipeline', targetPort: 'clip-sequences' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'clip-production-pipeline', targetPort: 'chapter-assets' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-production-pipeline', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-production-pipeline', sourcePort: 'media-items', targetNodeId: 'first-media-take', targetPort: 'items' },
  { sourceNodeId: 'first-media-take', sourcePort: 'items', targetNodeId: 'clip-media-pipeline', targetPort: 'media-items' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-media-pipeline', targetPort: 'delivery-contract' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'clip-media-pipeline', targetPort: 'authorization' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'video-assets', targetNodeId: 'delivery-verify', targetPort: 'video-assets' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'prepared-nodes', targetNodeId: 'node-only-verify', targetPort: 'result' },
]

export const VIDEO_PROMPT_ONLY_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'beat-sheet-agent', targetPort: 'trigger' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'beat-sheet-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-assets-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'source-units-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'source-units-agent', sourcePort: 'source-ledger', targetNodeId: 'beat-sheet-agent', targetPort: 'source-ledger' },
  { sourceNodeId: 'source-units-agent', sourcePort: 'source-ledger', targetNodeId: 'clip-design-fan-out', targetPort: 'source-ledger' },
  { sourceNodeId: 'source-units-agent', sourcePort: 'source-ledger', targetNodeId: 'beat-sheet-assemble', targetPort: 'source-ledger' },
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
  createNodes?: readonly VideoWorkflowCanvasNode[]
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
export function applyVideoWorkflowCanvasDefinitionPatch<
  N extends Readonly<{ id: string; data?: unknown }>,
  E extends VideoWorkflowExistingEdge & Readonly<{ id: string }>,
>(input: Readonly<{
  nodes: readonly N[]
  edges: readonly E[]
  patch: VideoWorkflowCanvasDefinitionPatch
}>): { nodes: N[]; edges: E[] } {
  const deletedNodes = new Set(input.patch.deleteNodeIds)
  const deletedEdges = new Set(input.patch.deleteEdgeIds)
  const nodePatches = new Map(input.patch.patchNodeData.map((item) => [item.id, item.data] as const))
  const nodes = input.nodes
    .filter((node) => !deletedNodes.has(node.id))
    .map((node) => {
      const patch = nodePatches.get(node.id)
      return patch ? { ...node, data: { ...(node.data as Record<string, unknown> | undefined), ...patch } } : { ...node }
    })
  for (const created of input.patch.createNodes ?? []) {
    if (!nodes.some(node => node.id === created.id)) nodes.push({ ...created } as unknown as N)
  }
  const existingSignatures = new Set(input.edges.map(workflowEdgeSignature))
  const edges = input.edges
    .filter((edge) => !deletedEdges.has(edge.id) && !deletedNodes.has(edge.source) && !deletedNodes.has(edge.target))
    .map((edge) => ({ ...edge }))
  for (const edge of input.patch.createEdges) {
    if (existingSignatures.has(workflowEdgeSignature(edge))) continue
    edges.push({ ...edge, type: 'default' } as unknown as E)
    existingSignatures.add(workflowEdgeSignature(edge))
  }
  return { nodes, edges }
}

export function isVideoWorkflowCanvasUpgradeSafe(nodes: readonly Readonly<{ data?: unknown }>[], workflowInstanceId: string): boolean {
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

export function atomicSpec(definition: VideoAtomicNodeDefinition): WorkflowAtomicNodeSpecV1 {
  const portArtifactContract = definition.executorRef
    ? resolveWorkflowExecutorPortArtifactContract(
      definition.executorRef,
      definition.runtimeData?.workflowPipeline === undefined
        ? undefined
        : { workflowPipeline: definition.runtimeData.workflowPipeline },
    )
    : null
  const resolvePortArtifactTypes = (
    direction: 'input' | 'output',
    ports: readonly string[],
    registered: Readonly<Record<string, readonly string[]>>,
    declared: Readonly<Record<string, readonly string[]>> | undefined,
  ): Readonly<Record<string, readonly string[]>> => {
    const result = Object.fromEntries(ports.flatMap((port) => (
      registered[port] ? [[port, registered[port]] as const] : []
    ))) as Record<string, readonly string[]>
    for (const [port, artifactTypes] of Object.entries(declared ?? {})) {
      if (!ports.includes(port)) {
        throw new Error(`Workflow node ${definition.nodeId} declares an unknown ${direction} artifact port ${port}`)
      }
      if (artifactTypes.length === 0 || artifactTypes.some((artifactType) => !artifactType.trim())
        || new Set(artifactTypes).size !== artifactTypes.length) {
        throw new Error(`Workflow node ${definition.nodeId} declares an invalid ${direction} artifact contract for ${port}`)
      }
      const registeredTypes = registered[port]
      if (registeredTypes && (registeredTypes.length !== artifactTypes.length
        || registeredTypes.some((artifactType, index) => artifactType !== artifactTypes[index]))) {
        throw new Error(`Workflow node ${definition.nodeId} ${direction} artifact contract for ${port} disagrees with its executor`)
      }
      result[port] = artifactTypes
    }
    return result
  }
  const inputArtifactTypes = resolvePortArtifactTypes(
    'input',
    definition.inputPorts,
    portArtifactContract?.inputArtifactTypes ?? {},
    definition.inputArtifactTypes,
  )
  const outputArtifactTypes = resolvePortArtifactTypes(
    'output',
    definition.outputPorts,
    portArtifactContract?.outputArtifactTypes ?? {},
    definition.outputArtifactTypes,
  )
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
  if (definition.nodeId === 'clip-media-pipeline') {
    return { workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY } }
  }
  if (definition.nodeId === 'chapter-asset-preview-generate') {
    return {
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY },
      workflowImageReferenceAssetBindings: [],
    }
  }
  if (definition.nodeId === 'chapter-sequence-agent') {
    return {
      workflowInstruction: '读取冻结 authoritativeSources、用户意图与 generationContract，按动态 schema 交付本轮完整范围的全章执行稿。依据已加载编剧 Skill 组织剧情、声画表达及片段归属。片段总时长使用供应商允许值；用户未限定全片时长时，片段数量由内容需要决定。来源引用和结构字段按 schema 提交，authoringRecord 仅记录真实工作。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: Object.keys(chapterSequenceSchema.properties as object),
        jsonSchema: chapterSequenceSchema,
      },
      workflowAgentOutputArtifactType: 'tapcanvas.chapter-sequence/v4',
      workflowAgentDeliveryRequirement: '交付本轮完整范围的 chapter-sequence/v4 执行稿，包含剧情、发声与合法片段归属。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentStructuredOutputTokenBudget: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentFailurePolicy: 'single_submission',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'scoped',
      workflowRequiredSkills: ['tapcanvas-screenwriter', 'tapcanvas-video-authoring-stages'],
      workflowKnowledgeRetrieval: true,
      // The full chapter source is inline in delivery-contract and nothing
      // upstream ran yet: execution history, project asset and image tools are
      // dead weight in every round of the largest authoring request.
      workflowExecutionInspection: false,
      workflowProjectAssetInspection: false,
    }
  }
  if (definition.nodeId === 'chapter-assets-outline-agent') {
    return {
      workflowInstruction: '依据冻结来源、chapter-sequence 与 generationContract，按 asset-outline schema 规划本章需要的共享资产及身份。该节点交付资产范围，不写生图提示词；资产方法按需读取已加载 Skill。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: Object.keys(chapterAssetOutlineSchema.properties as object),
        jsonSchema: chapterAssetOutlineSchema,
      },
      workflowAgentOutputArtifactType: CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE,
      workflowAgentDeliveryRequirement: '交付符合 asset-outline schema、覆盖当前章序列所需资产的完整大纲。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_SMALL_AUTHOR_MAX_OUTPUT_TOKENS,
      workflowAgentFailurePolicy: 'single_submission',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'scoped',
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
    }
  }
  if (definition.nodeId === 'chapter-assets-part-agent') {
    return {
      workflowInstruction: '按动态 schema 为 asset-seed 指定的唯一对象交付资产计划。保留 seed 的精确身份，依据冻结来源、asset-outline 与 generationContract 设计；其它对象只作上下文。图像计划方法按需读取已加载 Skill。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: Object.keys(chapterAssetPlanSchema.properties as object),
        jsonSchema: chapterAssetPlanSchema,
      },
      workflowAgentOutputArtifactType: CHAPTER_ASSET_PART_ARTIFACT_TYPE,
      workflowAgentDeliveryRequirement: '交付 asset-seed 指定对象的完整资产计划，身份与动态 schema 一致。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_SMALL_AUTHOR_MAX_OUTPUT_TOKENS,
      workflowAgentFailurePolicy: 'single_submission',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'scoped',
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
      // 并发 16 时上游被限流：46 次失败、单次 180–316s、26 分钟未完成；每次提示词约 3.6 万 token，16 路同时预填充压垮渠道。
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: VIDEO_WORKFLOW_CHAPTER_ASSET_PART_CONCURRENCY },
    }
  }
  if (definition.nodeId === 'clip-production-agent') {
    return {
      workflowInstruction: '读取当前 clip-sequence、来源片段、相邻边界、chapter-assets 与 generationContract，按动态 packet schema 交付本段完整视频提示词。以 clip-sequence.wholeFilmIntent 和冻结事件、发声为依据，具体声画表达由作者按需选用 Skill 方法。videoPrompt.shots 按播放顺序排列，通过 storyEventIds/speechEventIds 关联事件和完整台词；没有单镜时长，内部节奏交给视频模型适配。sourceSlices/sourceRanges 仅用于回溯原文。资产使用注册表中的精确身份与 imageSource，依据供应商能力选择 videoInputMode；生成参数、片段身份和范围沿用冻结合同。此节点只交付生产包，不提交媒体。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: Object.keys(clipProductionPacketSchema.properties as object),
        jsonSchema: {
          ...clipProductionPacketSchema,
          properties: {
            ...(clipProductionPacketSchema.properties as Record<string, unknown>),
            videoPrompt: clipProductionTimelineDraftSchema,
          },
        },
      },
      workflowAgentOutputArtifactType: 'tapcanvas.clip-production-packet/v2',
      workflowAgentDeliveryRequirement: '交付当前 Clip 的完整生产包，保留冻结事件、发声、片段和资产身份。',
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentStructuredOutputTokenBudget: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentFailurePolicy: 'single_submission',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowPromptExampleMediaType: 'video',
      workflowKnowledgeRetrieval: true,
      workflowRequiredSkills: ['tapcanvas-video-prompt-writer', 'tapcanvas-video-authoring-stages'],
      // 全章规划一次扇出全部 Clip 作者，与资产作者共用同一 deepseek 渠道，沿用同一并发上限。
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY },
    }
  }
  if (definition.nodeId === 'clip-asset-image-generate') {
    return {
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 16 },
      workflowImageReferenceAssetBindings: [],
    }
  }
  if (definition.nodeId === 'clip-production-project') {
    return {
      workflowDeliveryRequirement: '按 exact assetId/state 将图像生成回执绑定到对应 Clip；保留 packet.videoPrompt 原文、videoInputMode、首帧/参考资产身份、来源范围、时长与 Clip 顺序，并为显式 image_to_video/reference_to_video 策略解析真实图片 URL；reference_to_video 还必须由供应商能力合同明确支持。',
      workflowDeliveryArtifactType: 'tapcanvas.prompt-package/v2',
    }
  }
  const stageSchema = definition.nodeId === 'source-units-agent' ? authoredSourceUnitLedgerSchema
    : definition.nodeId === 'beat-sheet-agent' ? chapterBeatPlanSchema
    : definition.nodeId === 'chapter-assets-agent' && definition.executorRef === 'agents.logical-task/v2' ? chapterAssetPlanSchema
      : definition.nodeId === 'clip-design-agent' ? clipDesignSchema : null
  if (stageSchema) {
    const properties = stageSchema.properties as Record<string, unknown>
    const clipDesignInputInstruction = definition.nodeId === 'clip-design-agent'
      ? '只设计本节点收到的 clip-design-inputs 集合，逐项保留冻结 clipIndex 与 clipId；不得补写未传入的 Clip。'
      : ''
    return {
      workflowInstruction: ['执行 tapcanvas-video-authoring-stages Skill 中与本节点 output artifact 对应的职责，只交付本节点 schema 中的字段；冻结上游事实和精确身份不改写，完整章节来源不得截短。', clipDesignInputInstruction].filter(Boolean).join(' '),
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: { allowedFields: Object.keys(properties), jsonSchema: stageSchema },
      workflowAgentDeliveryRequirement: '交付本节点声明的结构化产物，不重写其它阶段产物；一次交稿，不合合同即本节点失败。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
      ...(definition.nodeId === 'chapter-assets-agent' ? {
        workflowAgentFailurePolicy: 'single_submission',
        workflowAgentExecutionPolicy: 'multi_inference',
        workflowAgentToolPolicy: 'scoped',
      } : {}),
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

const INLINE_MODEL_CONFIGURATION_FIELDS = [
  'workflowAgentModelSelection',
  'workflowAgentModelKey',
  'workflowVideoModelSelection',
  'workflowVideoModelKey',
  'workflowVideoResolution',
  'workflowVideoSize',
  'workflowVideoAspectRatio',
  'workflowImageModelSelection',
  'workflowImageModelKey',
  'workflowImageAspectRatio',
  'workflowImageSize',
  'workflowImageQuality',
] as const

/**
 * Chapter asset previews must submit the exact image contract Clip pipelines
 * later claim, so they inherit the Clip image step's model configuration until
 * the preview step itself is configured.
 */
const INLINE_MODEL_CONFIGURATION_SOURCE_STEP: Readonly<Record<string, string>> = {
  'chapter-asset-preview-generate': 'clip-asset-image-generate',
}

function inheritInlinePipelineModelConfiguration(
  value: unknown,
  existingNodes: readonly VideoWorkflowExistingNode[] | undefined,
): WorkflowPipelineRunSpecV1 {
  const spec = parseWorkflowPipelineRunSpec(value)
  if (!existingNodes?.length) return spec
  const priorPipelineSteps = existingNodes.flatMap((node) => {
    if (node.data?.workflowPipeline === undefined) return []
    return parseWorkflowPipelineRunSpec(node.data.workflowPipeline).steps
  })
  const steps = spec.steps.map((step) => {
    const sourceStepId = INLINE_MODEL_CONFIGURATION_SOURCE_STEP[step.stepId] ?? step.stepId
    const priorStep = priorPipelineSteps.find((candidate) => candidate.stepId === step.stepId)
      ?? priorPipelineSteps.find((candidate) => candidate.stepId === sourceStepId)
    const priorFlatNode = existingNodes.find((node) => node.data?.workflowNodeId === step.stepId)
      ?? existingNodes.find((node) => node.data?.workflowNodeId === sourceStepId)
    const priorData = priorStep?.node.data ?? priorFlatNode?.data
    if (!priorData) return step
    const inherited = Object.fromEntries(INLINE_MODEL_CONFIGURATION_FIELDS.flatMap((field) => {
      const selected = priorData[field]
      return typeof selected === 'string' && selected.trim() ? [[field, selected] as const] : []
    }))
    if (Object.keys(inherited).length === 0) return step
    return { ...step, node: { ...step.node, data: { ...step.node.data, ...inherited } } }
  })
  return parseWorkflowPipelineRunSpec({ ...spec, steps })
}

const RESETTABLE_VIDEO_WORKFLOW_RUNTIME_DATA: Readonly<Record<string, undefined>> = {
  workflowPipeline: undefined,
  workflowInstruction: undefined,
  workflowAgentOutputEncoding: undefined,
  workflowAgentJsonArrayContract: undefined,
  workflowAgentJsonObjectContract: undefined,
  workflowPreparedBeatSheetJsonObjectContract: undefined,
  workflowAgentDeliveryRequirement: undefined,
  workflowAgentDefinitionId: undefined,
  workflowPromptExampleMediaType: undefined,
  workflowAgentMaxOutputTokens: undefined,
  workflowAgentStructuredOutputTokenBudget: undefined,
  workflowAgentProjectContextPromptMode: undefined,
  workflowAgentPromptMode: undefined,
  workflowAgentFailurePolicy: undefined,
  workflowAgentExecutionPolicy: undefined,
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
	workflowKnowledgeRetrieval: undefined,
	workflowConfigurationSourceNodeId: undefined,
  workflowExecutionInspection: undefined,
  workflowProjectAssetInspection: undefined,
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
  const definitions = workflowDefinitions(input.executionScope, executionVariant).map((definition) => {
    if (definition.runtimeData?.workflowPipeline === undefined) return definition
    return {
      ...definition,
      runtimeData: {
        ...definition.runtimeData,
        workflowPipeline: inheritInlinePipelineModelConfiguration(definition.runtimeData?.workflowPipeline, input.existingNodes),
      },
    }
  })
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
    node.id.startsWith(`${workflowInstanceId}:`)
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
        workflowCapabilityDescription: VIDEO_V119_WORKFLOW_CAPABILITY_DESCRIPTION,
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
  const createNodes: VideoWorkflowCanvasNode[] = input.existingNodes ? definitions.flatMap((definition, index) => {
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
      edge.source.startsWith(`${workflowInstanceId}:`)
      && edge.target.startsWith(`${workflowInstanceId}:`)
      && !expectedEdgeSignatures.has(workflowEdgeSignature(edge))
      && edge.id
        ? [edge.id]
        : []
    )),
    allowOverwrite: true,
  }
}


type PersistedCanvasRecord = Record<string, unknown>

function persistedRecord(value: unknown): PersistedCanvasRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PersistedCanvasRecord : null
}

function persistedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export type VideoWorkflowFlowDataUpgrade = Readonly<{
  data: string
  upgradedWorkflowInstanceIds: readonly string[]
}>

/**
 * Brings every one-click workflow instance in a saved flow to the current
 * template with the same structural patch the canvas uses: executable node
 * contracts, instructions and internal edges are replaced, while explicit model
 * selections, clip limits, runtime telemetry and nodes outside the workflow
 * instance are preserved. Flow-level fields (viewport, lifecycle, sources) are
 * carried over untouched.
 */
export function upgradeVideoWorkflowFlowData(flowData: string): VideoWorkflowFlowDataUpgrade {
  const root = persistedRecord(JSON.parse(flowData || '{}'))
  if (!root) throw new Error('Workflow flow data must be an object')
  let nodes = (Array.isArray(root.nodes) ? root.nodes : []).flatMap((node) => {
    const record = persistedRecord(node)
    return record && persistedString(record.id) ? [record as PersistedCanvasRecord & { id: string; data?: unknown }] : []
  })
  let edges = (Array.isArray(root.edges) ? root.edges : []).flatMap((edge) => {
    const record = persistedRecord(edge)
    return record && persistedString(record.id) && persistedString(record.source) && persistedString(record.target)
      ? [record as PersistedCanvasRecord & { id: string; source: string; target: string }]
      : []
  })
  const groups = nodes.filter((node) => {
    const data = persistedRecord(node.data) ?? {}
    return (node.type === 'groupNode' || node.type === 'group')
      && persistedString(data.workflowKey) === VIDEO_PRODUCTION_WORKFLOW_KEY
      && Boolean(persistedString(data.workflowInstanceId))
  })
  const upgradedWorkflowInstanceIds: string[] = []
  for (const group of groups) {
    const data = persistedRecord(group.data) ?? {}
    const workflowInstanceId = persistedString(data.workflowInstanceId)
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId,
      workflowGroupId: group.id,
      executionScope: data.workflowExecutionScope === 'prompt_only' ? 'prompt_only' : 'media_delivery',
      executionVariant: data.workflowExecutionVariant === 'first_video' ? 'first_video' : 'full_video',
      existingNodes: nodes.map((node) => ({
        id: node.id,
        parentId: persistedString(node.parentId) || null,
        data: persistedRecord(node.data) ?? {},
      })),
      existingEdges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: persistedString(edge.sourceHandle) || null,
        targetHandle: persistedString(edge.targetHandle) || null,
      })),
    })
    const applied = applyVideoWorkflowCanvasDefinitionPatch({ nodes, edges, patch })
    nodes = applied.nodes
    edges = applied.edges
    upgradedWorkflowInstanceIds.push(workflowInstanceId)
  }
  return {
    data: JSON.stringify({ ...root, nodes, edges }),
    upgradedWorkflowInstanceIds,
  }
}
