import {
  WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
  WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
  parseWorkflowPipelineRunSpec,
  type WorkflowPipelineRunSpecV1,
} from '@tapcanvas/workflow-kernel-protocol'
import {
  VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS,
} from './videoWorkflowDefinitionConstants'
import type { VideoAtomicNodeDefinition, VideoWorkflowNodeId, VideoInlinePipelineStepId } from './videoWorkflowDefinitionTypes'
import { atomicSpec, videoNodeRuntimeData } from './videoWorkflowAtomicRuntime'

/**
 * This graph is the durable one-click production workflow. Canvas runs and 小T's
 * tapcanvas_workflow_run tool both start the same frozen graph through ExecutionDO.
 * Media nodes reuse the canonical agents-cli and media executors, idempotency ledger,
 * asynchronous receipts and delivery contracts instead of implementing a browser runtime.
 */
export const VIDEO_REMAINDER_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
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

export function workflowNodeTemplate(nodeId: VideoWorkflowNodeId): VideoAtomicNodeDefinition {
  const definition = VIDEO_REMAINDER_WORKFLOW_NODES.find((candidate) => candidate.nodeId === nodeId)
  if (!definition) throw new Error(`缺少视频工作流节点模板：${nodeId}`)
  return definition
}

export const FIRST_VIDEO_DELIVERY_VERIFY_NODE: VideoAtomicNodeDefinition = {
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

export const VIDEO_CLIP_SEGMENTATION_NODE_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'clip-segmentation-agent',
    label: '来源分段 Agent',
    category: 'agent',
    operation: 'clip_segmentation_authoring',
    executorRef: 'agents.logical-task/v2',
    executionMode: 'once',
    inputPorts: ['trigger', 'delivery-contract'],
    inputArtifactTypes: { 'delivery-contract': ['tapcanvas.delivery-contract/v2'] },
    outputPorts: ['segmentation'],
    outputArtifactTypes: { segmentation: ['tapcanvas.chapter-clip-segmentation/v1'] },
    description: '只按冻结原文与供应商时长合同切分完整来源；不加载 Skill 或知识，不做视觉设计或提示词创作。',
    agentOutputArtifactType: 'tapcanvas.chapter-clip-segmentation/v1',
  },
  {
    nodeId: 'clip-segmentation-project',
    label: '冻结 Clip 来源段',
    category: 'control',
    operation: 'clip_segmentation_project',
    executorRef: 'video.clip-segmentation.project/v1',
    executionMode: 'once',
    inputPorts: ['segmentation', 'delivery-contract'],
    outputPorts: ['clip-segments', 'source-receipt'],
    description: '验证分段精确覆盖冻结原文后，为每个 Clip 生成稳定身份与精确来源范围。',
    outputArtifactTypes: { 'clip-segments': ['tapcanvas.clip-source-segments/v1'] },
    outputArtifactType: 'tapcanvas.clip-source-segments/v1',
  },
]

export const VIDEO_CHAPTER_SEQUENCE_NODE_DEFINITIONS: readonly VideoAtomicNodeDefinition[] = [
  {
    nodeId: 'chapter-sequence-agent', label: '全章连续性与对白规划', category: 'agent',
    operation: 'chapter_sequence_authoring', executorRef: 'agents.logical-task/v2', executionMode: 'each',
    inputPorts: ['clip-segment', 'delivery-contract'],
    inputArtifactTypes: {
      'clip-segment': ['tapcanvas.clip-source-segments/v1', 'tapcanvas.clip-source-segment/v1'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['chapter-sequence'],
    outputArtifactTypes: { 'chapter-sequence': ['tapcanvas.chapter-sequence/v1'] },
    description: '每次只为一个冻结 Clip 提交起止状态、事件时窗与逐字对白来源区间；全章按来源顺序合并。',
    agentOutputArtifactType: 'tapcanvas.chapter-sequence/v1',
  },
  {
    nodeId: 'chapter-sequence-project', label: '冻结逐 Clip 连续性', category: 'control',
    operation: 'chapter_sequence_project', executorRef: 'video.chapter-sequence.project/v1', executionMode: 'once',
    inputPorts: ['chapter-sequence', 'clip-segments', 'delivery-contract'],
    inputArtifactTypes: {
      'chapter-sequence': ['tapcanvas.chapter-sequence/v1'],
      'clip-segments': ['tapcanvas.clip-source-segments/v1'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['chapter-sequence', 'clip-sequences'],
    outputArtifactTypes: {
      'chapter-sequence': ['tapcanvas.chapter-sequence-bound/v1'],
      'clip-sequences': ['tapcanvas.chapter-sequence-clips/v1'],
    },
    description: '合并逐 Clip 回执，核对冻结来源与 UTF-16 区间，投影准确对白正文和相邻段边界。',
    outputArtifactType: 'tapcanvas.chapter-sequence-clips/v1',
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
      'clip-sequence': ['tapcanvas.chapter-sequence-clips/v1', 'tapcanvas.chapter-sequence-clip/v1'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
      'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
    },
    outputPorts: ['packets'],
    outputArtifactTypes: { packets: ['tapcanvas.clip-production-packet/v1'] },
    description: '按冻结来源集合逐 Clip 并行创作完整视频提示词、明确输入模式与图像资产意图；保留逐 Clip 身份和来源，不编造资产 URL。',
    skillId: 'tapcanvas-video-prompt-writer',
    agentOutputArtifactType: 'tapcanvas.clip-production-packet/v1',
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
      packets: ['tapcanvas.clip-production-packet/v1'],
      'clip-segments': ['tapcanvas.clip-source-segments/v1'],
      'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
    },
    outputPorts: ['clip-production', 'asset-intents'],
    outputArtifactTypes: {
      'clip-production': ['tapcanvas.clip-production-packets/v1'],
      'asset-intents': ['tapcanvas.clip-production-asset-intents/v1'],
    },
    description: '按相同索引和 Clip ID 核对 Agent 结果与冻结来源，再按精确资产身份合并重复生成意图。',
    outputArtifactType: 'tapcanvas.clip-production-packets/v1',
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
      'clip-production': ['tapcanvas.clip-production-packets/v1'],
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
      'clip-production': ['tapcanvas.clip-production-packets/v1'],
      'asset-items': ['tapcanvas.asset-plan-items/v2'],
      'prepared-nodes': ['tapcanvas.video-node/v1'],
    },
    description: '只投影本 Clip 已持久化的视频节点和它引用的共享图片生成项；图片 effect 身份保持全章一致。',
    outputArtifactType: 'tapcanvas.clip-production-packets/v1',
  },
  {
    nodeId: 'clip-production-assets-project',
    label: '展开去重图像资产',
    category: 'control',
    operation: 'clip_production_assets_project',
    executorRef: 'video.clip-production.assets.project/v1',
    executionMode: 'once',
    inputPorts: ['asset-intents'],
    inputArtifactTypes: { 'asset-intents': ['tapcanvas.clip-production-asset-intents/v1'] },
    outputPorts: ['asset-items'],
    outputArtifactTypes: { 'asset-items': ['tapcanvas.asset-plan-items/v2'] },
    description: '将显式媒体规格与逻辑资产身份投影为可执行的图片生成项，不推断提示词或模型参数。',
    outputArtifactType: 'tapcanvas.asset-plan-items/v2',
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
      'clip-production': ['tapcanvas.clip-production-packets/v1'],
      'asset-bindings': ['tapcanvas.asset-bindings/v1'],
      'delivery-contract': ['tapcanvas.delivery-contract/v2'],
    },
    outputPorts: ['prompt-package'],
    outputArtifactTypes: { 'prompt-package': ['tapcanvas.prompt-package/v2'] },
    description: '按精确资产身份把真实图片回执合并到完整逐 Clip 提示词包，保留 Agent 原始视频提示词。',
    outputArtifactType: 'tapcanvas.prompt-package/v2',
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

export function createVideoClipPlanningPipelineSpec(): WorkflowPipelineRunSpecV1 {
  return parseWorkflowPipelineRunSpec({
    protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
    inputs: [
      { portId: 'delivery-contract', mode: 'value', artifactTypes: ['tapcanvas.delivery-contract/v2'] },
      { portId: 'source-segments', mode: 'collection', artifactTypes: ['tapcanvas.clip-source-segments/v1'] },
      { portId: 'clip-sequences', mode: 'collection', artifactTypes: ['tapcanvas.chapter-sequence-clips/v1'] },
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

export function createVideoClipMediaPipelineSpec(): WorkflowPipelineRunSpecV1 {
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
