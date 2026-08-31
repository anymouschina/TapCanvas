import type { Connection, Node } from '@xyflow/react'
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
import { useRFStore } from './store'
import { getNodeAbsPosition } from './utils/nodeBounds'
import { isCurrentUserAdmin } from '../auth/isAdmin'
import { workflowPortHandleId } from './workflowCanvasPorts'
import {
  WORKFLOW_ICON_NODE_COLUMN_STRIDE,
  WORKFLOW_ICON_NODE_ROW_STRIDE,
  WORKFLOW_ICON_NODE_SIZE,
} from './workflowNodeGeometry'
import type { VideoWorkflowExecutionScope } from './videoWorkflowExecution'

const NODE_WIDTH = WORKFLOW_ICON_NODE_SIZE
const NODE_HEIGHT = WORKFLOW_ICON_NODE_SIZE
const COLUMN_GAP = WORKFLOW_ICON_NODE_COLUMN_STRIDE - WORKFLOW_ICON_NODE_SIZE
const ROW_GAP = WORKFLOW_ICON_NODE_ROW_STRIDE - WORKFLOW_ICON_NODE_SIZE
const SOURCE_GAP = 160
const COLUMN_COUNT = 5
export {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
}
export const VIDEO_WORKFLOW_EXECUTION_CONCURRENCY = 16 as const
export const VIDEO_WORKFLOW_BEAT_SHEET_MAX_OUTPUT_TOKENS = 8_192 as const
export const VIDEO_WORKFLOW_MAX_CLIPS_MIN = 1 as const
export const VIDEO_WORKFLOW_MAX_CLIPS_MAX = 1_000 as const
export const VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS = 24 as const

export function needsVideoWorkflowCanvasDefinitionUpgrade(
  data: Readonly<Record<string, unknown>>,
): boolean {
  return data.workflowCanvasDefinitionVersion !== VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
    || data.workflowCanvasDefinitionFingerprint !== VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT
}

export type VideoWorkflowExecutionVariant = 'full_video' | 'first_video'
type VideoWorkflowVariantNodeId =
  | 'launch-beat-agent'
  | 'launch-beat-take'
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
    inputPorts: ['canvas-facts'],
    outputPorts: ['delivery-contract'],
    description: '冻结目标、执行范围和真实交付要求。',
    outputArtifactType: 'tapcanvas.delivery-contract/v2',
  },
  {
    nodeId: 'beat-sheet-agent',
    label: 'BeatSheet 创作 Agent',
    category: 'agent',
    operation: 'beat_sheet_authoring',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'once',
    inputPorts: ['trigger', 'delivery-contract'],
    outputPorts: ['beat-sheet'],
    description: '在工作流执行链内读取冻结来源与交付合同，创作并验真完整 BeatSheet。',
    agentOutputArtifactType: 'tapcanvas.beat-sheet/v2',
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
    inputPorts: ['asset-plans', 'beat-sheet'],
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
    inputPorts: ['clip-contexts', 'skills', 'tools', 'knowledge-candidates', 'knowledge-evidence'],
    optionalInputPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence'],
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
    nodeId: 'video-submit',
    label: '视频生成提交',
    category: 'tool',
    operation: 'video_submission',
    executorRef: 'tapcanvas.video.generate/v1',
    executionMode: 'each',
    inputPorts: ['production-plan'],
    outputPorts: ['provider-receipts'],
    description: '以幂等身份逐 clip 提交真实供应商任务。',
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
const LAUNCH_VIDEO_SUBMIT_NODE = cloneWorkflowNode({ nodeId: 'launch-video-submit', templateNodeId: 'video-submit', label: '首 Clip 视频提交' })
const LAUNCH_VIDEO_RESULTS_NODE = cloneWorkflowNode({ nodeId: 'launch-video-results', templateNodeId: 'video-results', label: '首 Clip 视频输出' })

const VIDEO_FAST_LAUNCH_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  LAUNCH_BEAT_AGENT_NODE,
  LAUNCH_BEAT_TAKE_NODE,
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
  ...VIDEO_FAST_LAUNCH_WORKFLOW_NODES,
  FIRST_VIDEO_DELIVERY_VERIFY_NODE,
]

export const VIDEO_PROMPT_ONLY_WORKFLOW_NODE_IDS: readonly VideoAtomicWorkflowNodeId[] = [
  'canvas-source',
  'delivery-contract',
  'beat-sheet-agent',
  'beat-sheet-format',
  'clip-fan-out',
  'clip-writer-agent',
  'prompt-package',
]

const VIDEO_PROMPT_ONLY_WORKFLOW_NODE_ID_SET = new Set<string>(VIDEO_PROMPT_ONLY_WORKFLOW_NODE_IDS)

export const VIDEO_PROMPT_ONLY_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = VIDEO_REMAINDER_WORKFLOW_NODES
  .filter((definition) => VIDEO_PROMPT_ONLY_WORKFLOW_NODE_ID_SET.has(definition.nodeId))
  .map((definition) => {
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

type VideoAtomicEdgeDefinition = Readonly<{
  sourceNodeId: 'manual-trigger' | VideoWorkflowNodeId
  sourcePort: string
  targetNodeId: VideoWorkflowNodeId
  targetPort: string
}>

/** The editable graph mirrors real data dependencies; it is intentionally not a visual-only chain. */
const VIDEO_FAST_LAUNCH_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'launch-beat-agent', targetPort: 'trigger' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'launch-beat-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'launch-beat-agent', sourcePort: 'beat-sheet', targetNodeId: 'launch-beat-take', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-beat-take', sourcePort: 'beat-sheet', targetNodeId: 'launch-asset-coverage', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-asset-coverage', sourcePort: 'asset-plans', targetNodeId: 'launch-asset-fan-out', targetPort: 'asset-plans' },
  { sourceNodeId: 'launch-beat-take', sourcePort: 'beat-sheet', targetNodeId: 'launch-asset-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'launch-asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'launch-asset-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'launch-beat-take', sourcePort: 'beat-sheet', targetNodeId: 'launch-clip-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'launch-clip-fan-out', targetPort: 'delivery-contract' },
  { sourceNodeId: 'launch-clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'launch-clip-writer-agent', targetPort: 'clip-contexts' },
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
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'beat-sheet-agent', targetPort: 'trigger' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'beat-sheet-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'beat-sheet-agent', sourcePort: 'beat-sheet', targetNodeId: 'beat-sheet-format', targetPort: 'beat-sheet' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'asset-coverage', targetPort: 'beat-sheet' },
  { sourceNodeId: 'asset-coverage', sourcePort: 'asset-plans', targetNodeId: 'asset-fan-out', targetPort: 'asset-plans' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'asset-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'asset-image-generate', targetPort: 'asset-items' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'clip-fan-out', targetPort: 'beat-sheet' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-fan-out', targetPort: 'delivery-contract' },
	{ sourceNodeId: 'clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'clip-writer-agent', targetPort: 'clip-contexts' },
	{ sourceNodeId: 'clip-writer-agent', sourcePort: 'clip-prompts', targetNodeId: 'prompt-package', targetPort: 'clip-prompts' },
  { sourceNodeId: 'clip-fan-out', sourcePort: 'clip-contexts', targetNodeId: 'prompt-package', targetPort: 'clip-contexts' },
  { sourceNodeId: 'asset-fan-out', sourcePort: 'asset-items', targetNodeId: 'prompt-package', targetPort: 'asset-items' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'voice-materialize', targetPort: 'trigger' },
  { sourceNodeId: 'prompt-package', sourcePort: 'prompt-package', targetNodeId: 'cost-estimate', targetPort: 'prompt-package' },
  { sourceNodeId: 'prompt-package', sourcePort: 'prompt-package', targetNodeId: 'production-handoff', targetPort: 'prompt-package' },
  { sourceNodeId: 'cost-estimate', sourcePort: 'estimate', targetNodeId: 'production-handoff', targetPort: 'estimate' },
  { sourceNodeId: 'asset-image-generate', sourcePort: 'asset-bindings', targetNodeId: 'production-handoff', targetPort: 'asset-bindings' },
  { sourceNodeId: 'voice-materialize', sourcePort: 'voice-manifest', targetNodeId: 'production-handoff', targetPort: 'voice-manifest' },
	{ sourceNodeId: 'production-handoff', sourcePort: 'production-plan', targetNodeId: 'video-submit', targetPort: 'production-plan' },
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
  { sourceNodeId: 'beat-sheet-agent', sourcePort: 'beat-sheet', targetNodeId: 'beat-sheet-format', targetPort: 'beat-sheet' },
  { sourceNodeId: 'beat-sheet-format', sourcePort: 'beat-sheet', targetNodeId: 'clip-fan-out', targetPort: 'beat-sheet' },
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

function workflowDefinitions(
  executionScope: VideoWorkflowExecutionScope,
  executionVariant: VideoWorkflowExecutionVariant,
): readonly VideoAtomicNodeDefinition[] {
  if (executionScope === 'prompt_only') return VIDEO_PROMPT_ONLY_WORKFLOW_NODES
  return executionVariant === 'first_video' ? VIDEO_FIRST_VIDEO_WORKFLOW_NODES : VIDEO_ATOMIC_WORKFLOW_NODES
}

function workflowEdges(
  executionScope: VideoWorkflowExecutionScope,
  executionVariant: VideoWorkflowExecutionVariant,
): readonly VideoAtomicEdgeDefinition[] {
  if (executionScope === 'prompt_only') return VIDEO_PROMPT_ONLY_WORKFLOW_EDGES
  return executionVariant === 'first_video' ? VIDEO_FIRST_VIDEO_WORKFLOW_EDGES : VIDEO_ATOMIC_WORKFLOW_EDGES
}

function assertWorkflowDefinitionTopology(
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
    if (!target.inputPorts.includes(edge.targetPort)) {
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

function readWorkflowExecutionVariant(value: unknown): VideoWorkflowExecutionVariant {
  return value === 'first_video' ? 'first_video' : 'full_video'
}

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

function atomicSpec(definition: VideoAtomicNodeDefinition): WorkflowAtomicNodeSpecV1 {
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
    outputPorts: definition.outputPorts,
    ...(Object.keys(inputArtifactTypes).length > 0 ? { inputArtifactTypes } : {}),
    ...(Object.keys(outputArtifactTypes).length > 0 ? { outputArtifactTypes } : {}),
  }
}

function videoNodeRuntimeData(definition: VideoAtomicNodeDefinition): Record<string, unknown> {
  const runtimeNodeId = definition.runtimeTemplateNodeId ?? definition.nodeId
  if (definition.nodeId === 'launch-beat-agent') {
    return {
      workflowInstruction: '执行已预载的 tapcanvas-dramatic-adapter，只创作能够立即进入真实资产与视频生产的唯一首 Clip。读取 delivery-contract 中冻结的 adaptationMode、generationContract 与 canvasFacts.authoritativeSources；后者是唯一故事事实源。首 Clip 必须从来源开头建立陌生观众可懂的进入状态、触发、动作过程、不可逆结果及向后续剧情的交接，禁止摘要整章、创作第二个 Clip 或等待完整章级规划。根级 objectRegistry 只声明每个真实出场角色、场景与持续因果对象一次，beat.objectStates 只写本段状态。每个对象都必须提交 physicalIdentityKey、referenceImageNodeIds 和 referenceRole；character 的 physicalIdentityKey 非空，其它 kind 严格为 null。只有冻结 ProjectContext 能明确识别时才写入 referenceAssetIds。共享肉身的不同称谓、人格、灵魂或意识复用同一 key、资产绑定和 identityInvariant，附体、伤势、持物、服装与情绪只写状态。assetPlans 为每个 referenceRole!=none 的唯一 role 一次提交中性参考图 prompt、negativePrompt、identityAnchors 与 prohibitedDrift；role 使用 character://physicalIdentityKey 或其它 kind://name，禁止把剧情瞬时状态写入身份基态。beats 必须恰好一项且 clipIndex=0，durationSeconds 来自 generationContract.durationOptions；每个 storyEvent 一次写全 entryState、exitState、startSeconds 与 endSeconds，beat.exitState 必须等于最后一个 storyEvent.exitState。sourceFidelityAudit 可省略；若输出，只作为模型自检诊断，宿主不会生成或修订它。每个语义事实只写一次；clipId、characters、speakers、dialogueScript 与 assetObjectContracts 由宿主根据已提交的确定性事实编译。提交前自行完整验收，只返回唯一一份严格 JSON；runtime 不会把错误返回给模型，不会补字段、合并候选或重生成。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        contractName: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
        contractVersion: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
        requiredStringFields: ['sourceId', 'sourceFingerprint', 'protocolVersion'],
        requiredObjectFields: ['sourceCoveragePlan', 'chapterArc'],
        requiredArrayFields: ['objectRegistry', 'assetPlans', 'beats'],
        arrayItemRequiredStringFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'referenceRole', 'identityInvariant'],
          assetPlans: ['role', 'prompt', 'negativePrompt'],
          beats: ['startKeyframe', 'endKeyframe', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext'],
        },
        arrayItemRequiredStringArrayFields: { objectRegistry: ['referenceImageNodeIds'] },
        arrayItemRequiredNonEmptyStringArrayFields: { assetPlans: ['identityAnchors', 'prohibitedDrift'] },
        arrayItemAllowedFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'physicalIdentityKey', 'referenceImageNodeIds', 'referenceAssetIds', 'referenceRole', 'forbiddenTransfer', 'identityInvariant', 'scale'],
          assetPlans: ['role', 'prompt', 'negativePrompt', 'identityAnchors', 'prohibitedDrift'],
          beats: ['clipId', 'clipIndex', 'durationSeconds', 'sourceSpan', 'narrativeIntent', 'visualIntent', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext', 'startKeyframe', 'endKeyframe', 'exitState', 'characters', 'speakers', 'narrativeAudioPlan', 'dialoguePaceRate', 'storyEvents', 'objectStates'],
        },
        allowedFields: ['sourceId', 'sourceFingerprint', 'protocolVersion', 'sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc', 'objectRegistry', 'assetPlans', 'beats'],
      },
      workflowAgentDeliveryRequirement: '交付唯一、可解析且 beats 恰好一项的首 Clip Keyframe BeatSheet；clipIndex=0，来源身份、首段对白、事件相位、人物唯一身体身份、对象状态和交接状态均可追溯。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: 4096,
		workflowRequiredSkills: ['tapcanvas-dramatic-adapter'],
    }
  }
  if (runtimeNodeId === 'beat-sheet-agent') {
    return {
      workflowInstruction: '执行已预载的 tapcanvas-dramatic-adapter，且只把它及其自动加载 references 作为章级改编方法真源。读取 delivery-contract 中冻结的 adaptationMode、generationContract 与 canvasFacts.authoritativeSources；后者是唯一故事事实源。一次性规划完整章级 BeatSheet，按 clipIndex 连续排序全部 beats，禁止先过首 Clip 再逐段追加。以紧凑制作提纲表达，每个字段只写推进拍摄所需的最短完整事实，禁止同义复述、背景解释、修辞扩写和把同一事实复制到多个字段。根级 objectRegistry 只声明每个跨段对象一次，beat.objectStates 只写本段真实参与对象的状态、空间关系、驱动与变化。每个对象都必须提交 physicalIdentityKey、referenceImageNodeIds 和 referenceRole；character 的 key 非空，其它 kind 严格为 null。只有冻结 ProjectContext 能明确识别时才写入 referenceAssetIds。同一肉身的称谓、人格、灵魂或意识复用同一 key、资产绑定和 identityInvariant，附体、伤势、持物、服装与情绪只写状态。assetPlans 为每个 referenceRole!=none 的唯一 role 一次提交中性参考图 prompt、negativePrompt、identityAnchors 与 prohibitedDrift；role 使用 character://physicalIdentityKey 或其它 kind://name，禁止把表演、伤势、附体结果、环境色或偶发动作污染身份基态。每个 storyEvent 都必须一次写全 entryState、exitState、startSeconds 与 endSeconds；跨事件、跨 Beat 的 entryState 由模型自行保持连续，每个 beat.exitState 必须等于本 Beat 最后一项 storyEvent.exitState。sourceFidelityAudit 可省略；若输出，只作为模型自检诊断，宿主不会生成或修订它。每个语义事实只写一次；clipId、characters、speakers、dialogueScript 与 assetObjectContracts 由宿主根据已提交的确定性事实编译，stagingPlan 不属于交付。提交前自行完整验收，只返回唯一一份严格 JSON；runtime 不会把错误返回给模型，不会补字段、合并候选或重生成。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        contractName: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
        contractVersion: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
        requiredStringFields: ['sourceId', 'sourceFingerprint', 'protocolVersion'],
        requiredObjectFields: ['sourceCoveragePlan', 'chapterArc'],
        requiredArrayFields: ['objectRegistry', 'assetPlans', 'beats'],
        arrayItemRequiredStringFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'referenceRole', 'identityInvariant'],
          assetPlans: ['role', 'prompt', 'negativePrompt'],
          beats: ['startKeyframe', 'endKeyframe', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext'],
        },
        arrayItemRequiredStringArrayFields: { objectRegistry: ['referenceImageNodeIds'] },
        arrayItemRequiredNonEmptyStringArrayFields: { assetPlans: ['identityAnchors', 'prohibitedDrift'] },
        arrayItemAllowedFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'physicalIdentityKey', 'referenceImageNodeIds', 'referenceAssetIds', 'referenceRole', 'forbiddenTransfer', 'identityInvariant', 'scale'],
          assetPlans: ['role', 'prompt', 'negativePrompt', 'identityAnchors', 'prohibitedDrift'],
          beats: ['clipId', 'clipIndex', 'durationSeconds', 'sourceSpan', 'narrativeIntent', 'visualIntent', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext', 'startKeyframe', 'endKeyframe', 'exitState', 'characters', 'speakers', 'narrativeAudioPlan', 'dialoguePaceRate', 'storyEvents', 'objectStates'],
        },
        allowedFields: ['sourceId', 'sourceFingerprint', 'protocolVersion', 'sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc', 'objectRegistry', 'assetPlans', 'beats'],
      },
      workflowAgentDeliveryRequirement: '交付一个非空、可解析且符合 BeatSheet v20 单一事实源合同的完整章级 Keyframe BeatSheet，并在同一产物中交付每个视觉职责唯一的可执行中性参考图计划；宿主只编译可由已提交事件、对白、对象与资产计划事实逐字推导的机器字段。',
      workflowAgentDefinitionId: 'writer',
		workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_BEAT_SHEET_MAX_OUTPUT_TOKENS,
		workflowRequiredSkills: ['tapcanvas-dramatic-adapter'],
    }
  }
  if (runtimeNodeId === 'asset-coverage') {
    return {}
  }
  if (runtimeNodeId === 'asset-fan-out') {
    return {}
  }
  if (runtimeNodeId === 'asset-image-generate') {
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
      workflowInstruction: '执行已预载的 tapcanvas-video-prompt-writer 及其 authoring contract，且只把它们作为单 Clip 创作方法真源。当前节点指令只声明职责与传输协议，不补充第二套镜头、对白、节奏或质量方法。把当前 clip-context、spokenScript、sequenceContext、generationContract 与对象合同视为冻结事实；在唯一一次提交前完成 embedded authoring 自检，直接返回符合 runtime JSON contract 的完整最终 JSON。宿主只编译机器身份、冻结 Clip 信封、对象合同、事件覆盖、逐秒状态轨和 shots[].speechEventIds；shots、动作、摄影、表演、事件索引、SpeechEvent 与时长参数必须由 writer 一次写对。runtime 不会把校验错误返回给 writer，不会补字段、缩放参数、重映射语义或重生成；不得输出 Markdown 或说明。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        requiredArrayFields: ['clips'],
        allowedFields: ['clips', 'selfQaNote', 'creativeReview', 'sourceFidelityAudit'],
        itemRequiredNonEmptyArrayFields: ['shots'],
      },
      workflowAgentDeliveryRequirement: '一次性交付一个符合当前 runtime JSON contract 的完整 clips 信封；创作语义由 tapcanvas-video-prompt-writer 在提交前自行验收，宿主不以第二套提示词或返回纠偏覆盖。',
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowAgentMaxOutputTokens: 4096,
      workflowPromptExampleMediaType: 'video',
		workflowRequiredSkills: ['tapcanvas-video-prompt-writer'],
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
      },
    }
  }
  if (runtimeNodeId === 'prompt-package') {
    return {
      workflowDeliveryRequirement: '持久化完整逐 Clip 提示词包；每个动态 Clip 都有稳定 itemId、原始顺序、来源谱系、合法语义时长、冻结参与者、逐字退出态、完整对白守恒、精确说话人绑定、资产角色结构和 embedded_authoring 复盘证据，以及由唯一 renderer 生成的非空纯执行提示词。writer 的 clips/selfQaNote/creativeReview/sourceFidelityAudit 信封、图片 prompt 与 negativePrompt 不得进入视频模型正文；prompt_only 不产生媒体副作用。',
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

function stageNodeId(workflowInstanceId: string, workflowNodeId: string): string {
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
		workflowExecutionRecoveryPolicy: 'fresh_only',
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
  return {
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

function connectVideoWorkflowEdge(workflowInstanceId: string, edge: VideoAtomicEdgeDefinition): void {
  const connection: Connection = {
    source: stageNodeId(workflowInstanceId, edge.sourceNodeId),
    target: stageNodeId(workflowInstanceId, edge.targetNodeId),
    sourceHandle: workflowPortHandleId('output', edge.sourcePort),
    targetHandle: workflowPortHandleId('input', edge.targetPort),
  }
  useRFStore.getState().onConnect(connection)
}

export function upgradeVideoWorkflowCanvasDefinition(workflowInstanceId: string): Readonly<{
  upgradedNodeCount: number
  createdEdgeCount: number
  deletedEdgeCount: number
}> {
  if (!isCurrentUserAdmin()) throw new Error('只有管理员可以升级工作流定义')
  const normalizedWorkflowId = workflowInstanceId.trim()
  if (!normalizedWorkflowId) throw new Error('缺少工作流实例身份')

  const store = useRFStore.getState()
  const trigger = store.nodes.find((node) => (
    node.id === stageNodeId(normalizedWorkflowId, 'manual-trigger')
    && node.type !== 'groupNode'
  ))
  if (!trigger) throw new Error('不能升级：工作流缺少手动触发器')
  const workflowGroupId = typeof trigger.parentId === 'string' ? trigger.parentId.trim() : ''
  const workflowGroup = store.nodes.find((node) => node.id === workflowGroupId && node.type === 'groupNode')
  if (!workflowGroup) throw new Error('不能升级：工作流缺少持久化分组')

  const triggerData = nodeData(trigger)
  const workflowGroupData = nodeData(workflowGroup)
  const executionScope = triggerData.workflowExecutionScope
  if (executionScope !== 'prompt_only' && executionScope !== 'media_delivery') {
    throw new Error('不能升级：触发器缺少不可变执行范围')
  }
	const executionVariant = readWorkflowExecutionVariant(workflowGroupData.workflowExecutionVariant)
	const definitions = workflowDefinitions(executionScope, executionVariant)
	const definitionNodeIds = new Set(definitions.map((definition) => definition.nodeId))
	const expectedNodeIds = new Set([
		stageNodeId(normalizedWorkflowId, 'manual-trigger'),
		...definitions.map((definition) => stageNodeId(normalizedWorkflowId, definition.nodeId)),
	])
	const sourceGroupId = typeof workflowGroupData.sourceGroupId === 'string'
		? workflowGroupData.sourceGroupId.trim()
		: ''
	const sourceBindingStatus = sourceGroupId ? 'bound' : 'unbound'

	definitions.forEach((definition, index) => {
		const nodeId = stageNodeId(normalizedWorkflowId, definition.nodeId)
		if (useRFStore.getState().nodes.some((node) => node.id === nodeId)) return
		const linearIndex = index + 1
		const column = linearIndex % COLUMN_COUNT
		const row = Math.floor(linearIndex / COLUMN_COUNT)
		useRFStore.getState().addNode('taskNode', definition.label, {
			nodeId,
			autoLabel: false,
			parentId: workflowGroupId,
			position: {
				x: 8 + column * (NODE_WIDTH + COLUMN_GAP),
				y: 8 + row * (NODE_HEIGHT + ROW_GAP),
			},
			kind: 'workflowStage',
			nodeWidth: NODE_WIDTH,
			nodeHeight: NODE_HEIGHT,
			workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
			workflowDefinitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
			workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
			workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
			workflowInstanceId: normalizedWorkflowId,
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
			...(definition.runtimeTemplateNodeId && definitionNodeIds.has(definition.runtimeTemplateNodeId)
			  ? { workflowConfigurationSourceNodeId: definition.runtimeTemplateNodeId }
			  : {}),
			...(sourceGroupId ? { sourceGroupId } : {}),
			sourceBindingStatus,
			workflowPermission: ADMIN_WORKFLOW_PERMISSION,
			adminWorkflow: true,
			status: 'idle',
		})
	})

	const obsoleteNodeIds = useRFStore.getState().nodes.flatMap((node) => (
		node.parentId === workflowGroupId
		&& node.id.startsWith(`${normalizedWorkflowId}:`)
		&& !expectedNodeIds.has(node.id)
			? [node.id]
			: []
	))
	if (obsoleteNodeIds.length > 0) {
		useRFStore.getState().onNodesChange(obsoleteNodeIds.map((id) => ({ id, type: 'remove' as const })))
	}

  const patch = buildVideoWorkflowCanvasDefinitionPatch({
    workflowInstanceId: normalizedWorkflowId,
    workflowGroupId,
    executionScope,
    executionVariant,
    existingNodes: useRFStore.getState().nodes,
    existingEdges: useRFStore.getState().edges,
  })
  for (const entry of patch.patchNodeData) {
    const node = useRFStore.getState().nodes.find((candidate) => candidate.id === entry.id)
    if (!node) throw new Error(`不能升级：工作流缺少节点 ${entry.id}`)
    useRFStore.getState().updateNodeData(entry.id, entry.data)
  }
  if (patch.deleteEdgeIds.length > 0) {
    useRFStore.getState().onEdgesChange(patch.deleteEdgeIds.map((id) => ({ id, type: 'remove' as const })))
  }
  for (const edge of patch.createEdges) {
    useRFStore.getState().onConnect({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })
  }
	useRFStore.getState().arrangeGroupChildren(workflowGroupId, 'flow')
  return {
    upgradedNodeCount: patch.patchNodeData.length,
    createdEdgeCount: patch.createEdges.length,
    deletedEdgeCount: patch.deleteEdgeIds.length,
  }
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
	workflowExecutionRecoveryPolicy: 'fresh_only',
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
