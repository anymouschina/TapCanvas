import type { VideoWorkflowExecutionScope } from './videoWorkflowExecution'
import type { VideoAtomicEdgeDefinition, VideoAtomicNodeDefinition, VideoWorkflowExecutionVariant } from './videoWorkflowDefinitionTypes'
import { WORKFLOW_PIPELINE_RUN_EXECUTOR_REF } from '@tapcanvas/workflow-kernel-protocol'
import {
  FIRST_VIDEO_DELIVERY_VERIFY_NODE,
  VIDEO_CHAPTER_SEQUENCE_NODE_DEFINITIONS,
  VIDEO_CLIP_SEGMENTATION_NODE_DEFINITIONS,
  VIDEO_PROMPT_ONLY_WORKFLOW_NODES,
  createVideoClipMediaPipelineSpec,
  createVideoClipPlanningPipelineSpec,
  workflowNodeTemplate,
} from './videoWorkflowNodeDefinitions'

const VIDEO_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = [
  workflowNodeTemplate('canvas-source'),
  {
    ...workflowNodeTemplate('delivery-contract'),
    inputPorts: ['canvas-facts'],
    optionalInputPorts: [],
  },
  ...VIDEO_CLIP_SEGMENTATION_NODE_DEFINITIONS,
  ...VIDEO_CHAPTER_SEQUENCE_NODE_DEFINITIONS,
  workflowNodeTemplate('chapter-assets-agent'),
  {
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
      'clip-sequences': ['tapcanvas.chapter-sequence-clips/v1'],
      'chapter-assets': ['tapcanvas.chapter-asset-plan/v3'],
    },
    outputPorts: ['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'],
    outputArtifactTypes: {
      'node-plan': ['tapcanvas.clip-production-node-plan/v1'],
      'prompt-package': ['tapcanvas.prompt-package/v2'],
      'media-items': ['tapcanvas.clip-production-media-items/v1'],
      'prepared-nodes': ['tapcanvas.video-node/v1'],
    },
    description: '逐 Clip 并行调用带 Skill 与知识检索的视频提示词 Agent；全章去重共享图像资产，持久化一 Clip 一视频节点和依赖边并回读。',
    runtimeData: { workflowPipeline: createVideoClipPlanningPipelineSpec() },
  },
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
    description: '每个 Clip 先复用或生成依赖图片并持久化真实 URL，再按本轮选择填充可手动生成的视频节点或提交视频；共享图片按全章稳定身份复用。',
    runtimeData: { workflowPipeline: createVideoClipMediaPipelineSpec() },
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

export const VIDEO_ATOMIC_WORKFLOW_NODES: readonly VideoAtomicNodeDefinition[] = VIDEO_WORKFLOW_NODES

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
  ...VIDEO_WORKFLOW_NODES.filter((definition) => !['clip-media-pipeline', 'clip-production-aggregate', 'concat', 'delivery-verify'].includes(definition.nodeId)),
  FIRST_MEDIA_TAKE_NODE,
  VIDEO_WORKFLOW_NODES.find((definition) => definition.nodeId === 'clip-media-pipeline')!,
  FIRST_VIDEO_DELIVERY_VERIFY_NODE,
]

const VIDEO_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'canvas-source', targetPort: 'trigger' },
  { sourceNodeId: 'canvas-source', sourcePort: 'canvas-facts', targetNodeId: 'delivery-contract', targetPort: 'canvas-facts' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'clip-segmentation-agent', targetPort: 'trigger' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-segmentation-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-segmentation-agent', sourcePort: 'segmentation', targetNodeId: 'clip-segmentation-project', targetPort: 'segmentation' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-segmentation-project', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-segmentation-project', sourcePort: 'clip-segments', targetNodeId: 'chapter-sequence-agent', targetPort: 'clip-segment' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-sequence-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'chapter-sequence-agent', sourcePort: 'chapter-sequence', targetNodeId: 'chapter-sequence-project', targetPort: 'chapter-sequence' },
  { sourceNodeId: 'clip-segmentation-project', sourcePort: 'clip-segments', targetNodeId: 'chapter-sequence-project', targetPort: 'clip-segments' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-sequence-project', targetPort: 'delivery-contract' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'chapter-assets-agent', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-segmentation-project', sourcePort: 'clip-segments', targetNodeId: 'clip-production-pipeline', targetPort: 'source-segments' },
  { sourceNodeId: 'chapter-sequence-project', sourcePort: 'clip-sequences', targetNodeId: 'clip-production-pipeline', targetPort: 'clip-sequences' },
  { sourceNodeId: 'chapter-assets-agent', sourcePort: 'chapter-assets', targetNodeId: 'clip-production-pipeline', targetPort: 'chapter-assets' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-production-pipeline', targetPort: 'delivery-contract' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'prepared-nodes', targetNodeId: 'node-only-verify', targetPort: 'result' },
  { sourceNodeId: 'clip-production-pipeline', sourcePort: 'media-items', targetNodeId: 'clip-media-pipeline', targetPort: 'media-items' },
  { sourceNodeId: 'delivery-contract', sourcePort: 'delivery-contract', targetNodeId: 'clip-media-pipeline', targetPort: 'delivery-contract' },
  { sourceNodeId: 'manual-trigger', sourcePort: 'trigger', targetNodeId: 'clip-media-pipeline', targetPort: 'authorization' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'prompt-package', targetNodeId: 'clip-production-aggregate', targetPort: 'prompt-packages' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'estimate', targetNodeId: 'clip-production-aggregate', targetPort: 'estimates' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'video-assets', targetNodeId: 'clip-production-aggregate', targetPort: 'video-assets' },
  { sourceNodeId: 'clip-media-pipeline', sourcePort: 'prepared-nodes', targetNodeId: 'clip-production-aggregate', targetPort: 'prepared-nodes' },
  { sourceNodeId: 'clip-segmentation-project', sourcePort: 'clip-segments', targetNodeId: 'clip-production-aggregate', targetPort: 'source-segments' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'video-assets', targetNodeId: 'concat', targetPort: 'video-assets' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'estimate', targetNodeId: 'concat', targetPort: 'estimate' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'prompt-package', targetNodeId: 'concat', targetPort: 'prompt-package' },
  { sourceNodeId: 'concat', sourcePort: 'master-video', targetNodeId: 'delivery-verify', targetPort: 'master-video' },
  { sourceNodeId: 'clip-production-aggregate', sourcePort: 'prompt-package', targetNodeId: 'delivery-verify', targetPort: 'prompt-package' },
]

export const VIDEO_ATOMIC_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
	...VIDEO_WORKFLOW_EDGES,
]

export const VIDEO_FIRST_VIDEO_WORKFLOW_EDGES: readonly VideoAtomicEdgeDefinition[] = [
  ...VIDEO_WORKFLOW_EDGES.filter((edge) => (
    !['clip-production-aggregate', 'concat', 'delivery-verify'].includes(edge.targetNodeId)
    && !['clip-production-aggregate', 'concat', 'delivery-verify'].includes(edge.sourceNodeId)
    && !(edge.sourceNodeId === 'clip-production-pipeline' && edge.targetNodeId === 'clip-media-pipeline')
  )),
  { sourceNodeId: 'clip-production-pipeline', sourcePort: 'media-items', targetNodeId: 'first-media-take', targetPort: 'items' },
  { sourceNodeId: 'first-media-take', sourcePort: 'items', targetNodeId: 'clip-media-pipeline', targetPort: 'media-items' },
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
