import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Node } from '@xyflow/react'
import { chapterClipSegmentationSchema } from '../../../../packages/schemas/video-clip-segmentation/index.mjs'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
  VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS,
  VIDEO_WORKFLOW_EXECUTION_CONCURRENCY,
  VIDEO_ATOMIC_WORKFLOW_NODES,
  VIDEO_ATOMIC_WORKFLOW_EDGES,
  buildVideoWorkflowCanvasDefinitionPatch,
  createVideoWorkflowCanvasTemplate,
  restoreVideoWorkflowDefaultConnections,
} from './videoWorkflowCanvasTemplate'
import {
  parseWorkflowPipelineRunSpec,
  resolveWorkflowExecutorPortArtifactContract,
  WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
} from '@tapcanvas/workflow-kernel-protocol'

function canonicalDefinitionFingerprint(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!candidate || typeof candidate !== 'object') {
      return typeof candidate === 'string'
        ? candidate
            .split('workflow-contract-fixture').join('<workflow-instance>')
            .split('workflow-contract-group').join('<workflow-group>')
        : candidate
    }
    const record = candidate as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().flatMap((key) => (
      key === 'workflowCanvasDefinitionFingerprint'
        ? []
        : [[key, normalize(record[key])] as const]
    )))
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')}`
}

const sourceGroup: Node = {
  id: 'source-group',
  type: 'groupNode',
  position: { x: 100, y: 200 },
  selected: true,
  style: { width: 500, height: 360 },
  data: { label: '来源素材' },
}

const segmentationSchema = chapterClipSegmentationSchema as Readonly<{
  properties: Readonly<{ clips: Readonly<{ maxItems: number }> }>
}>

describe('one-click film workflow v114 template', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'workflow-test-id' })
    useRFStoreReset()
  })

  it('persists the complete Clip node graph before entering per-Clip media production', () => {
    const ids = VIDEO_ATOMIC_WORKFLOW_NODES.map((node) => node.nodeId)
    const byId = new Map(VIDEO_ATOMIC_WORKFLOW_NODES.map((node) => [node.nodeId, node]))
    const parents = (nodeId: string) => VIDEO_ATOMIC_WORKFLOW_EDGES
      .filter((edge) => edge.targetNodeId === nodeId)
      .map((edge) => edge.sourceNodeId)

    expect(VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION).toBe(114)
    expect(VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS).toBe(80)
    expect(ids).toEqual([
      'canvas-source', 'delivery-contract', 'clip-segmentation-agent', 'clip-segmentation-project',
      'chapter-sequence-agent', 'chapter-sequence-project', 'chapter-assets-agent',
      'clip-production-pipeline', 'node-only-verify',
      'clip-media-pipeline', 'clip-production-aggregate', 'concat', 'delivery-verify',
    ])
    expect(VIDEO_ATOMIC_WORKFLOW_EDGES).toHaveLength(30)
    expect(byId.get('clip-production-pipeline')).toMatchObject({
      executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
      executionMode: 'once',
      inputPorts: ['delivery-contract', 'source-segments', 'clip-sequences', 'chapter-assets'],
      outputPorts: ['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'],
    })
    expect(parents('clip-production-pipeline')).toEqual([
      'clip-segmentation-project', 'chapter-sequence-project', 'chapter-assets-agent', 'delivery-contract',
    ])
    expect(runtimeData('chapter-assets-agent')).toMatchObject({
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
      workflowAgentFailurePolicy: 'repair_with_correction',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'none',
    })
    expect(byId.get('clip-media-pipeline')).toMatchObject({
      executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
      executionMode: 'each',
      inputPorts: ['authorization', 'delivery-contract', 'media-items'],
      outputPorts: ['prompt-package', 'estimate', 'video-assets', 'prepared-nodes'],
      selectiveOutputPorts: ['video-assets', 'prepared-nodes'],
    })
    expect(parents('clip-media-pipeline')).toEqual(['clip-production-pipeline', 'delivery-contract', 'manual-trigger'])
    expect(parents('node-only-verify')).toEqual(['clip-production-aggregate'])
    expect(parents('clip-production-aggregate')).toEqual([
      'clip-media-pipeline', 'clip-media-pipeline', 'clip-media-pipeline', 'clip-media-pipeline', 'clip-segmentation-project',
    ])
    expect(ids.some((id) => id.startsWith('opening-'))).toBe(false)
    expect(ids).not.toContain('clip-production-agent')
    expect(ids).not.toContain('video-submit')
  })

  it('keeps source segmentation structural and creative quality inside the frozen per-Clip writer', () => {
    expect(segmentationSchema.properties.clips.maxItems).toBe(80)
    const segmentation = runtimeData('clip-segmentation-agent')
    expect(segmentation.workflowRequiredSkills).toEqual([])
    expect(segmentation.workflowKnowledgeRetrieval).toBe(false)
    expect(segmentation.workflowSkillRetrieval).toBe(false)
    expect(segmentation.workflowExecutionInspection).toBe(false)
    expect(segmentation.workflowAgentStructuredOutputTokenBudget).toBe(65_536)
    expect(segmentation.workflowAgentProjectContextPromptMode).toBe('identity_only')
    expect(segmentation.workflowAgentPromptMode).toBe('compact_structured')
    expect(segmentation.workflowAgentFailurePolicy).toBe('repair_with_correction')
    expect(segmentation.workflowAgentExecutionPolicy).toBe('multi_inference')
    expect(segmentation.workflowAgentToolPolicy).toBe('none')
    expect(String(segmentation.workflowInstruction)).toContain('UTF-16')
    expect(String(segmentation.workflowInstruction)).toContain('不做视觉设计、资产规划或视频提示词')

    const spec = planningPipelineSpec()
    const author = spec.steps.find((step) => step.stepId === 'clip-production-agent')?.node.data
    expect(author?.workflowRequiredSkills).toEqual(['tapcanvas-video-prompt-writer', 'tapcanvas-dialogue-drama', 'tapcanvas-video-authoring-stages'])
    expect(author?.workflowPromptExampleMediaType).toBe('video')
    expect(author?.workflowKnowledgeRetrieval).toBe(true)
    expect(author?.workflowAgentFailurePolicy).toBe('repair_with_correction')
    expect(author?.workflowAgentExecutionPolicy).toBe('multi_inference')
    expect(author?.workflowSkillRetrieval).not.toBe(false)
    expect(String(author?.workflowInstruction)).toContain('检索失败')
    expect(author?.workflowAtomicSpec).toMatchObject({ executionMode: 'each', itemConcurrency: 16 })
    const authorContract = author?.workflowAgentJsonObjectContract as Record<string, unknown>
    const jsonSchema = authorContract.jsonSchema as { properties: { videoInputMode: { enum: string[] } } }
    expect(authorContract.allowedFields).toEqual(Object.keys(jsonSchema.properties))
    expect(jsonSchema.properties.videoInputMode.enum).toEqual(['image_to_video', 'reference_to_video', 'text_to_video'])
    expect(String(author?.workflowInstruction)).toContain('依据供应商能力')
    expect(String(author?.workflowInstruction)).toContain('imageSource')
  })

  it('declares explicit scalar and collection adapters, branch outputs, and the aggregate contract', () => {
    const spec = planningPipelineSpec()
    expect(spec.inputs.find((input) => input.portId === 'source-segments')).toEqual({
      portId: 'source-segments',
      mode: 'collection',
      artifactTypes: ['tapcanvas.clip-source-segments/v1'],
    })
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-agent' && binding.to.portId === 'clip-segment')?.mode).toBe('collection')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-agent' && binding.to.portId === 'chapter-assets')?.mode).toBe('value')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-collect' && binding.to.portId === 'clip-segments')?.mode).toBe('collection')
    expect(spec.steps.map((step) => step.stepId)).toEqual(['clip-production-agent', 'clip-production-collect', 'clip-production-nodes-materialize'])
    expect(spec.outputs.map((output) => output.portId)).toEqual(['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'])
    const mediaSpec = mediaPipelineSpec()
    expect(mediaSpec.inputs.find((input) => input.portId === 'media-items')?.itemArtifactTypes).toEqual(['tapcanvas.clip-production-media-item/v1'])
    expect(mediaSpec.steps.map((step) => step.stepId)).toEqual([
      'clip-production-media-project', 'clip-asset-image-generate', 'clip-production-project',
      'voice-materialize', 'cost-estimate', 'production-handoff', 'video-execution-choice', 'video-node-prepare', 'video-submit', 'video-results',
    ])
    expect(mediaSpec.bindings.find((binding) => binding.to.stepId === 'clip-production-media-project')?.mode).toBe('value')
    for (const [stepId, portId] of [
      ['cost-estimate', 'prompt-package'],
      ['production-handoff', 'prompt-package'],
      ['production-handoff', 'estimate'],
      ['production-handoff', 'voice-manifest'],
    ]) {
      expect(mediaSpec.bindings.find((binding) => binding.to.stepId === stepId && binding.to.portId === portId)?.mode).toBe('value')
    }
    expect(mediaSpec.bindings.find((binding) => binding.to.stepId === 'video-submit' && binding.to.portId === 'authorization')?.from).toEqual({ kind: 'step', stepId: 'video-execution-choice', portId: 'unmatched' })
    expect(mediaSpec.outputs.map((output) => output.portId)).toEqual(['prompt-package', 'estimate', 'video-assets', 'prepared-nodes'])
    expect(runtimeData('clip-production-pipeline').workflowAtomicSpec).toMatchObject({
      executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
    })
    expect(runtimeData('clip-media-pipeline').workflowAtomicSpec).toMatchObject({
      executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
      itemConcurrency: 1,
    })

    const aggregate = VIDEO_ATOMIC_WORKFLOW_NODES.find((node) => node.nodeId === 'clip-production-aggregate')
    expect(aggregate).toMatchObject({
      executorRef: 'video.clip-production.aggregate/v1',
      executionMode: 'collect',
      inputPorts: ['source-segments', 'prompt-packages', 'estimates', 'video-assets', 'prepared-nodes'],
      optionalInputPorts: ['video-assets', 'prepared-nodes'],
      selectiveOutputPorts: ['video-assets', 'prepared-nodes'],
    })
    expect(resolveWorkflowExecutorPortArtifactContract('video.clip-production.aggregate/v1')).toMatchObject({
      inputArtifactTypes: {
        'source-segments': ['tapcanvas.clip-source-segments/v1'],
        'prompt-packages': ['tapcanvas.prompt-package/v2'],
        estimates: ['tapcanvas.video-estimate/v1'],
        'video-assets': ['tapcanvas.video-clips/v1'],
        'prepared-nodes': ['tapcanvas.video-node/v1'],
      },
      outputArtifactTypes: {
        'prompt-package': ['tapcanvas.prompt-package/v2'],
        estimate: ['tapcanvas.video-estimate/v1'],
        'video-assets': ['tapcanvas.video-clips/v1'],
        'prepared-nodes': ['tapcanvas.video-node/v1'],
      },
    })
    expect(resolveWorkflowExecutorPortArtifactContract('video.clip-production.nodes.materialize/v1')).toMatchObject({
      inputArtifactTypes: {
        'clip-production': ['tapcanvas.clip-production-packets/v1'],
        'asset-intents': ['tapcanvas.clip-production-asset-intents/v1'],
        'delivery-contract': ['tapcanvas.delivery-contract/v2'],
      },
      outputArtifactTypes: {
        'node-plan': ['tapcanvas.clip-production-node-plan/v1'],
        'media-items': ['tapcanvas.clip-production-media-items/v1'],
        'prepared-nodes': ['tapcanvas.video-node/v1'],
      },
    })
  })

  it('creates all frozen node data and exports a canonical patch fingerprint', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const state = useRFStore.getState()
    const workflowNodes = state.nodes.filter((node) => (
      (node.data as Record<string, unknown>).workflowInstanceId === result.workflowInstanceId
      && node.type === 'taskNode'
    ))
    expect(result.nodeIds).toHaveLength(14)
    expect(workflowNodes).toHaveLength(14)
    expect(state.edges).toHaveLength(30)
    expect(workflowNodes.every((node) => (
      (node.data as Record<string, unknown>).workflowCanvasDefinitionVersion === 114
      && (node.data as Record<string, unknown>).workflowCanvasDefinitionFingerprint === VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT
      && (node.data as Record<string, unknown>).adminWorkflow === true
    ))).toBe(true)
    const chapterSequenceData = workflowNodes.find((node) => node.id.endsWith(':chapter-sequence-agent'))?.data as Record<string, unknown>
    expect(chapterSequenceData.workflowAgentDeliveryRequirement).toEqual(expect.any(String))
    const pipelineData = workflowNodes.find((node) => node.id.endsWith(':clip-production-pipeline'))?.data as Record<string, unknown>
    expect(parseWorkflowPipelineRunSpec(pipelineData.workflowPipeline).steps).toHaveLength(3)
    const mediaData = workflowNodes.find((node) => node.id.endsWith(':clip-media-pipeline'))?.data as Record<string, unknown>
    expect(parseWorkflowPipelineRunSpec(mediaData.workflowPipeline).steps).toHaveLength(10)
    const triggerData = workflowNodes.find((node) => node.id.endsWith(':manual-trigger'))?.data as Record<string, unknown>
    expect(triggerData.workflowCapabilityDescription).toContain('一 Clip 一视频节点')
    expect(triggerData.workflowCapabilityDescription).toContain('知识案例')
    expect(triggerData.workflowCapabilityDescription).toContain('真实图片 URL')
  })

  it('hard-cuts persisted old nodes and verifies the canonical v114 fingerprint', () => {
    const oldNodes: readonly Node[] = [
      { id: 'workflow-contract-fixture:opening-frame-agent', type: 'taskNode', position: { x: 0, y: 0 }, parentId: 'workflow-contract-group', data: {} },
      { id: 'workflow-contract-fixture:clip-production-agent', type: 'taskNode', position: { x: 0, y: 0 }, parentId: 'workflow-contract-group', data: {} },
    ]
    const patchInput = {
      workflowInstanceId: 'workflow-contract-fixture',
      workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery',
      executionVariant: 'full_video',
      existingNodes: oldNodes,
    } as const
    const patch = buildVideoWorkflowCanvasDefinitionPatch({ ...patchInput, existingEdges: [] })
    expect(canonicalDefinitionFingerprint(patch)).toBe(VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT)
    expect(patch.deleteNodeIds).toEqual(expect.arrayContaining(oldNodes.map((node) => node.id)))
    expect(patch.createEdges).toHaveLength(30)
    expect(patch.patchNodeData.some((node) => node.id.endsWith(':clip-production-agent'))).toBe(false)
  })

  it('uses the same full Clip planning and node readback before the first-video media selection', () => {
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', executionVariant: 'first_video', existingEdges: [],
    })
    const nodeIds = patch.patchNodeData.map((node) => node.id.split(':').slice(-1)[0])
    expect(nodeIds).toEqual(expect.arrayContaining([
      'clip-segmentation-agent', 'clip-production-pipeline', 'first-media-take',
      'clip-media-pipeline', 'node-only-verify', 'delivery-verify',
    ]))
    expect(nodeIds.some((id) => id?.startsWith('launch-') || id?.startsWith('opening-'))).toBe(false)
    expect(patch.createEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'workflow-contract-fixture:clip-production-pipeline', target: 'workflow-contract-fixture:first-media-take', targetHandle: expect.stringContaining('items') }),
      expect.objectContaining({ source: 'workflow-contract-fixture:first-media-take', target: 'workflow-contract-fixture:clip-media-pipeline', sourceHandle: expect.stringContaining('items') }),
    ]))
    const take = patch.patchNodeData.find((node) => node.id.endsWith(':first-media-take'))
    expect(take?.data.workflowInputPorts).toEqual(['items'])
    expect(take?.data.workflowOutputPorts).toEqual(['items'])
    expect(patch.createEdges.some((edge) => edge.source.endsWith(':clip-production-pipeline') && edge.target.endsWith(':clip-media-pipeline'))).toBe(false)
  })

  it('requires image production before choosing node preparation or supplier submission', () => {
    const media = mediaPipelineSpec()
    const bindingFrom = (stepId: string, portId: string) => media.bindings.find((binding) => (
      binding.to.stepId === stepId && binding.to.portId === portId
    ))?.from
    expect(bindingFrom('video-execution-choice', 'value')).toEqual({ kind: 'input', portId: 'authorization' })
    expect(bindingFrom('video-execution-choice', 'production-plan')).toEqual({ kind: 'step', stepId: 'production-handoff', portId: 'production-plan' })
    expect(bindingFrom('video-node-prepare', 'authorization')).toEqual({ kind: 'step', stepId: 'video-execution-choice', portId: 'matched' })
    expect(bindingFrom('video-submit', 'authorization')).toEqual({ kind: 'step', stepId: 'video-execution-choice', portId: 'unmatched' })
    expect(bindingFrom('production-handoff', 'asset-bindings')).toEqual({ kind: 'step', stepId: 'clip-asset-image-generate', portId: 'asset-bindings' })
    expect(media.outputs.find((output) => output.portId === 'prepared-nodes')?.from).toEqual({ stepId: 'video-node-prepare', portId: 'prepared-nodes' })
    expect(runtimeData('node-only-verify').workflowDeliveryRequiredFacts).toEqual(['persisted', 'promptPersisted', 'dependenciesReady'])
    expect(VIDEO_ATOMIC_WORKFLOW_EDGES.some((edge) => edge.sourceNodeId === 'clip-production-pipeline' && edge.targetNodeId === 'node-only-verify')).toBe(false)
  })

  it('verifies only selected first-Clip ready nodes and has no dangling first-video edges', () => {
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', executionVariant: 'first_video', existingEdges: [],
    })
    const nodeIds = new Set(patch.patchNodeData.map((node) => node.id))
    for (const edge of patch.createEdges) {
      expect(nodeIds.has(edge.source)).toBe(true)
      expect(nodeIds.has(edge.target)).toBe(true)
    }
    expect(patch.createEdges.filter((edge) => edge.target.endsWith(':node-only-verify'))).toEqual([
      expect.objectContaining({ source: 'workflow-contract-fixture:clip-media-pipeline', sourceHandle: expect.stringContaining('prepared-nodes') }),
    ])
  })

  it('preserves explicit image and video model selection inside the media pipeline', () => {
    const priorStages: readonly Node[] = [
      { id: 'workflow-contract-fixture:cost-estimate', type: 'taskNode', position: { x: 0, y: 0 },
        data: { workflowNodeId: 'cost-estimate', workflowVideoModelKey: 'user-selected-video', workflowVideoResolution: '720p' } },
      { id: 'workflow-contract-fixture:clip-asset-image-generate', type: 'taskNode', position: { x: 0, y: 0 },
        data: { workflowNodeId: 'clip-asset-image-generate', workflowImageModelKey: 'user-selected-image' } },
    ]
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', existingNodes: priorStages, existingEdges: [],
    })
    const media = patch.patchNodeData.find((node) => node.id.endsWith(':clip-media-pipeline'))
    const spec = parseWorkflowPipelineRunSpec(media?.data.workflowPipeline)
    expect(spec.steps.find((step) => step.stepId === 'cost-estimate')?.node.data).toMatchObject({
      workflowVideoModelKey: 'user-selected-video', workflowVideoResolution: '720p',
    })
    expect(spec.steps.find((step) => step.stepId === 'clip-asset-image-generate')?.node.data).toMatchObject({
      workflowImageModelKey: 'user-selected-image',
    })
  })

  it('repairs only missing default outer connections', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const originalEdges = useRFStore.getState().edges
    useRFStore.setState({ edges: originalEdges.slice(1) })
    expect(restoreVideoWorkflowDefaultConnections(result.workflowInstanceId)).toBe(1)
    expect(useRFStore.getState().edges).toHaveLength(30)
    expect(restoreVideoWorkflowDefaultConnections(result.workflowInstanceId)).toBe(0)
  })
})

function useRFStoreReset(): void {
  useRFStore.getState().reset()
  useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
}

function runtimeData(nodeId: string): Record<string, unknown> {
  const result = buildVideoWorkflowCanvasDefinitionPatch({
    workflowInstanceId: 'workflow-contract-fixture',
    workflowGroupId: 'workflow-contract-group',
    executionScope: 'media_delivery',
    existingEdges: [],
  })
  const node = result.patchNodeData.find((candidate) => candidate.id.endsWith(`:${nodeId}`))
  if (!node) throw new Error(`Missing runtime node ${nodeId}`)
  return node.data
}

function planningPipelineSpec(): ReturnType<typeof parseWorkflowPipelineRunSpec> {
  return parseWorkflowPipelineRunSpec(runtimeData('clip-production-pipeline').workflowPipeline)
}

function mediaPipelineSpec(): ReturnType<typeof parseWorkflowPipelineRunSpec> {
  return parseWorkflowPipelineRunSpec(runtimeData('clip-media-pipeline').workflowPipeline)
}
