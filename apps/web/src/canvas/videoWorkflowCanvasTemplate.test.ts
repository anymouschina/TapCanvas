import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Node } from '@xyflow/react'
import { chapterSequenceSchema } from '../../../../packages/schemas/chapter-sequence/index.mjs'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
  VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS,
  VIDEO_WORKFLOW_EXECUTION_CONCURRENCY,
  VIDEO_WORKFLOW_SMALL_AUTHOR_MAX_OUTPUT_TOKENS,
  VIDEO_WORKFLOW_CHAPTER_ASSET_PART_CONCURRENCY,
  VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY,
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

const authoredSequenceSchema = chapterSequenceSchema as Readonly<{
  properties: Readonly<{
    clips: Readonly<{ items: Readonly<{ properties: Readonly<Record<string, unknown>> }> }>
  }>
  required: readonly string[]
}>

describe('one-click film workflow v135 template', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'workflow-test-id' })
    useRFStoreReset()
  })

  it('plans every Clip and lands the whole chapter on the canvas before any media stage', () => {
    const ids = VIDEO_ATOMIC_WORKFLOW_NODES.map((node) => node.nodeId)
    const byId = new Map(VIDEO_ATOMIC_WORKFLOW_NODES.map((node) => [node.nodeId, node]))
    const parents = (nodeId: string) => VIDEO_ATOMIC_WORKFLOW_EDGES
      .filter((edge) => edge.targetNodeId === nodeId)
      .map((edge) => edge.sourceNodeId)

    expect(VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION).toBe(135)
    expect(VIDEO_WORKFLOW_DEFAULT_MAX_CLIPS).toBe(80)
    expect(ids).toEqual([
      'canvas-source', 'delivery-contract', 'chapter-sequence-agent', 'chapter-sequence-project', 'chapter-assets-agent',
      'chapter-asset-preview', 'clip-production-pipeline', 'clip-media-pipeline', 'node-only-verify', 'clip-production-aggregate',
      'concat', 'delivery-verify',
    ])
    expect(VIDEO_ATOMIC_WORKFLOW_EDGES).toHaveLength(28)
    // Canvas-first: asset cards and images start right after the chapter asset plan,
    // in parallel with (not upstream of) per-Clip authoring.
    expect(parents('chapter-asset-preview').sort()).toEqual(['chapter-assets-agent', 'delivery-contract'])
    expect(parents('clip-production-pipeline')).not.toContain('chapter-asset-preview')
    expect(byId.get('chapter-sequence-agent')).toMatchObject({
      executionMode: 'once',
      inputPorts: ['trigger', 'delivery-contract'],
      outputArtifactTypes: { 'chapter-sequence': ['tapcanvas.chapter-sequence/v4'] },
    })
    expect(parents('chapter-sequence-agent')).toEqual(['manual-trigger', 'delivery-contract'])
    expect(byId.get('chapter-sequence-project')).toMatchObject({
      executorRef: 'video.chapter-sequence.project/v2',
      executionMode: 'once',
      inputPorts: ['chapter-sequence', 'delivery-contract'],
      outputArtifactTypes: {
        'chapter-sequence': ['tapcanvas.chapter-sequence-bound/v2'],
        'clip-sequences': ['tapcanvas.chapter-sequence-clips/v2'],
        'clip-segments': ['tapcanvas.clip-source-segments/v1'],
      },
    })
    expect(parents('chapter-sequence-project')).toEqual(['chapter-sequence-agent', 'delivery-contract'])
    expect(byId.get('chapter-assets-agent')).toMatchObject({
      inputPorts: ['delivery-contract', 'chapter-sequence'],
      inputArtifactTypes: { 'chapter-sequence': ['tapcanvas.chapter-sequence-bound/v2'] },
    })
    expect(parents('chapter-assets-agent')).toEqual(['delivery-contract', 'chapter-sequence-project'])
    // Canvas-first barrier: one planning node authors every Clip and persists the
    // whole chapter's nodes; it has no media authorization, so it cannot submit media.
    expect(byId.get('clip-production-pipeline')).toMatchObject({
      executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
      executionMode: 'once',
      inputPorts: ['delivery-contract', 'source-segments', 'clip-sequences', 'chapter-assets'],
      outputPorts: ['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'],
    })
    expect(parents('clip-production-pipeline')).toEqual([
      'chapter-sequence-project', 'chapter-sequence-project', 'chapter-assets-agent', 'delivery-contract',
    ])
    // Media starts only from the planning node's whole-chapter media items.
    expect(byId.get('clip-media-pipeline')).toMatchObject({
      executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
      executionMode: 'each',
      inputPorts: ['authorization', 'delivery-contract', 'media-items'],
    })
    expect(parents('clip-media-pipeline')).toEqual(['clip-production-pipeline', 'delivery-contract', 'manual-trigger'])
    expect(VIDEO_ATOMIC_WORKFLOW_EDGES.find((edge) => edge.targetNodeId === 'clip-media-pipeline' && edge.targetPort === 'media-items'))
      .toEqual({ sourceNodeId: 'clip-production-pipeline', sourcePort: 'media-items', targetNodeId: 'clip-media-pipeline', targetPort: 'media-items' })
    // 章节资产是一条「大纲 → 逐项并行作者 → 汇总」流水线；作者数据在步骤上，顶层节点不再是单个作者。
    // 补丁把旧作者的契约显式清为 undefined，不会残留在流水线节点上。
    expect(runtimeData('chapter-assets-agent').workflowAgentJsonObjectContract).toBeUndefined()
    expect(runtimeData('chapter-assets-agent')).toHaveProperty('workflowPipeline')
    expect(parents('node-only-verify')).toEqual(['clip-production-aggregate'])
    expect(parents('clip-production-aggregate')).toEqual([
      'clip-media-pipeline', 'clip-media-pipeline', 'clip-media-pipeline', 'clip-media-pipeline', 'chapter-sequence-project',
    ])
    expect(ids.some((id) => id.startsWith('opening-'))).toBe(false)
    expect(ids).not.toContain('clip-production-agent')
    expect(ids).not.toContain('video-submit')
  })

  it('authors the full story timeline before projecting physical windows and per-Clip media packets', () => {
    const author = runtimeData('chapter-sequence-agent')
    expect(author.workflowAtomicSpec).toMatchObject({ executionMode: 'once' })
    expect(author.workflowAgentFailurePolicy).toBe('single_submission')
    expect(author.workflowAgentExecutionPolicy).toBe('multi_inference')
    expect(author.workflowAgentToolPolicy).toBe('scoped')
    expect(author.workflowKnowledgeRetrieval).toBe(true)
    expect(author.workflowRequiredSkills).toEqual(['tapcanvas-screenwriter', 'tapcanvas-video-authoring-stages'])
    expect(author.workflowAgentOutputArtifactType).toBe('tapcanvas.chapter-sequence/v4')
    expect(authoredSequenceSchema.required).toEqual([
      'protocolVersion', 'wholeFilmIntent', 'totalDurationSeconds', 'storyEvents', 'speechEvents', 'boundaries', 'clips',
    ])
    expect(Object.keys(authoredSequenceSchema.properties.clips.items.properties)).toEqual([
      'clipId', 'durationSeconds', 'storyEventIds', 'speechEventIds', 'startBoundaryId', 'endBoundaryId',
    ])

    const spec = planningPipelineSpec()
    expect(spec.inputs.find((input) => input.portId === 'source-segments')?.mode).toBe('collection')
    expect(spec.inputs.find((input) => input.portId === 'clip-sequences')?.mode).toBe('collection')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-agent' && binding.to.portId === 'clip-segment')?.mode).toBe('collection')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-agent' && binding.to.portId === 'clip-sequence')?.mode).toBe('collection')
    const clipWriter = spec.steps.find((step) => step.stepId === 'clip-production-agent')?.node.data
    expect(clipWriter?.workflowRequiredSkills).toEqual(['tapcanvas-video-prompt-writer', 'tapcanvas-video-authoring-stages'])
    expect(clipWriter?.workflowPromptExampleMediaType).toBe('video')
    expect(clipWriter?.workflowKnowledgeRetrieval).toBe(true)
    expect(clipWriter?.workflowAgentFailurePolicy).toBe('single_submission')
    expect(clipWriter?.workflowAgentExecutionPolicy).toBe('multi_inference')
    expect(clipWriter?.workflowSkillRetrieval).not.toBe(false)
    expect(clipWriter?.workflowAtomicSpec).toMatchObject({ executionMode: 'each', itemConcurrency: VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY })
    expect(String(clipWriter?.workflowInstruction)).toContain('clip-sequence.wholeFilmIntent')
    expect(String(clipWriter?.workflowInstruction)).toContain('没有单镜时长')
    expect(String(clipWriter?.workflowInstruction)).toContain('speechEventIds')
    expect(String(clipWriter?.workflowInstruction)).toContain('sourceSlices/sourceRanges 仅用于回溯原文')
    expect(String(clipWriter?.workflowInstruction)).toContain('内部节奏交给视频模型适配')
    expect(String(clipWriter?.workflowInstruction)).not.toContain('下一段来源才发生的决定与动作不提前拍出')
    const authorContract = clipWriter?.workflowAgentJsonObjectContract as Record<string, unknown>
    const jsonSchema = authorContract.jsonSchema as { properties: { videoInputMode: { enum: string[] } } }
    expect(authorContract.allowedFields).toEqual(Object.keys(jsonSchema.properties))
    expect(jsonSchema.properties.videoInputMode.enum).toEqual(['image_to_video', 'reference_to_video', 'text_to_video'])
    expect(String(clipWriter?.workflowInstruction)).toContain('依据供应商能力')
    expect(String(clipWriter?.workflowInstruction)).toContain('imageSource')
  })

  it('declares explicit scalar and collection adapters, branch outputs, and the aggregate contract', () => {
    const spec = planningPipelineSpec()
    expect(spec.inputs.find((input) => input.portId === 'source-segments')?.mode).toBe('collection')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-agent' && binding.to.portId === 'clip-segment')?.mode).toBe('collection')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-agent' && binding.to.portId === 'chapter-assets')?.mode).toBe('value')
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-collect' && binding.to.portId === 'clip-segments')?.mode).toBe('collection')
    expect(spec.inputs.find((input) => input.portId === 'clip-sequences')?.mode).toBe('collection')
    // Planning ends at node materialization: no image or video step may run before
    // every Clip node is on the canvas.
    expect(spec.steps.map((step) => step.stepId)).toEqual([
      'clip-production-agent', 'clip-production-collect', 'clip-production-nodes-materialize',
    ])
    expect(spec.outputs.map((output) => output.portId)).toEqual(['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'])
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-nodes-materialize' && binding.to.portId === 'clip-production'))
      .toMatchObject({ from: { kind: 'step', stepId: 'clip-production-collect', portId: 'clip-production' }, mode: 'collection' })
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-nodes-materialize' && binding.to.portId === 'asset-intents')?.from)
      .toEqual({ kind: 'step', stepId: 'clip-production-collect', portId: 'asset-intents' })
    expect(spec.bindings.find((binding) => binding.to.stepId === 'clip-production-nodes-materialize' && binding.to.portId === 'delivery-contract')?.mode)
      .toBe('value')
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
      executionMode: 'once',
    })
    for (const variant of ['full_video', 'first_video'] as const) {
      expect(runtimeData('clip-media-pipeline', variant).workflowAtomicSpec).toMatchObject({
        executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
        executionMode: 'each',
        itemConcurrency: VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY,
      })
    }
    const previewSpec = parseWorkflowPipelineRunSpec(runtimeData('chapter-asset-preview').workflowPipeline)
    expect(previewSpec.steps.map((step) => step.stepId)).toEqual(['chapter-asset-preview-project', 'chapter-asset-preview-generate'])
    expect(previewSpec.steps[0]?.node.data.workflowAtomicSpec).toMatchObject({ executorRef: 'video.chapter-assets.preview/v1', executionMode: 'once' })
    expect(previewSpec.steps[1]?.node.data.workflowAtomicSpec).toMatchObject({
      executorRef: 'tapcanvas.image.generate/v1', executionMode: 'each', itemConcurrency: VIDEO_WORKFLOW_CLIP_PIPELINE_CONCURRENCY,
    })
    expect(previewSpec.bindings.find((binding) => binding.to.stepId === 'chapter-asset-preview-generate')?.mode).toBe('collection')

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
        'clip-production': ['tapcanvas.clip-production-packets/v2'],
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
    expect(result.nodeIds).toHaveLength(13)
    expect(workflowNodes).toHaveLength(13)
    expect(state.edges).toHaveLength(28)
    expect(workflowNodes.every((node) => (
      (node.data as Record<string, unknown>).workflowCanvasDefinitionVersion === 135
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
    expect(triggerData.workflowCapabilityDescription).toContain('单个全章作者')
    expect(triggerData.workflowCapabilityDescription).toContain('知识案例')
    expect(triggerData.workflowCapabilityDescription).toContain('真实图片 URL')
  })

  it('hard-cuts persisted old nodes and verifies the canonical v135 fingerprint', () => {
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
    expect(patch.createEdges).toHaveLength(28)
    expect(patch.patchNodeData.some((node) => node.id.endsWith(':clip-production-agent'))).toBe(false)
  })

  it('uses the same full chapter plan and Clip node readback before first-video media selection', () => {
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', executionVariant: 'first_video', existingEdges: [],
    })
    const nodeIds = patch.patchNodeData.map((node) => node.id.split(':').slice(-1)[0])
    expect(nodeIds).toEqual(expect.arrayContaining([
      'chapter-sequence-agent', 'chapter-sequence-project', 'clip-production-pipeline', 'first-media-take',
      'clip-media-pipeline', 'node-only-verify', 'delivery-verify',
    ]))
    expect(nodeIds.some((id) => id?.startsWith('launch-') || id?.startsWith('opening-'))).toBe(false)
    const firstPlanningNode = patch.patchNodeData.find((node) => node.id.endsWith(':clip-production-pipeline'))
    expect(firstPlanningNode?.data.workflowAtomicSpec).toMatchObject({ executionMode: 'once' })
    const firstPlanning = parseWorkflowPipelineRunSpec(firstPlanningNode?.data.workflowPipeline)
    expect(firstPlanning.steps.map((step) => step.stepId)).toEqual([
      'clip-production-agent', 'clip-production-collect', 'clip-production-nodes-materialize',
    ])
    expect(firstPlanning.inputs.find((input) => input.portId === 'source-segments')?.mode).toBe('collection')
    expect(firstPlanning.outputs.map((output) => output.portId)).toEqual([
      'node-plan', 'prompt-package', 'media-items', 'prepared-nodes',
    ])
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

  it('gives chapter asset previews the Clip image step configuration so both submit one contract', () => {
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', existingEdges: [],
      existingNodes: [{ id: 'workflow-contract-fixture:clip-asset-image-generate', data: {
        workflowNodeId: 'clip-asset-image-generate', workflowImageModelKey: 'user-image', workflowImageQuality: 'high',
      } }],
    })
    const preview = patch.patchNodeData.find((node) => node.id.endsWith(':chapter-asset-preview'))
    const spec = parseWorkflowPipelineRunSpec(preview?.data.workflowPipeline)
    expect(spec.steps.find((step) => step.stepId === 'chapter-asset-preview-generate')?.node.data).toMatchObject({
      workflowImageModelKey: 'user-image', workflowImageQuality: 'high',
    })
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
    const pipeline = patch.patchNodeData.find((node) => node.id.endsWith(':clip-media-pipeline'))
    const spec = parseWorkflowPipelineRunSpec(pipeline?.data.workflowPipeline)
    expect(spec.steps.find((step) => step.stepId === 'cost-estimate')?.node.data).toMatchObject({
      workflowVideoModelKey: 'user-selected-video', workflowVideoResolution: '720p',
    })
    expect(spec.steps.find((step) => step.stepId === 'clip-asset-image-generate')?.node.data).toMatchObject({
      workflowImageModelKey: 'user-selected-image',
    })
  })

  it('preserves an explicitly selected inline author model when refreshing the definition', () => {
    const prior = parseWorkflowPipelineRunSpec(runtimeData('clip-production-pipeline').workflowPipeline)
    const priorStages: readonly Node[] = [{
      id: 'custom-pipeline', type: 'taskNode', position: { x: 0, y: 0 },
      data: {
        workflowNodeId: 'custom-pipeline',
        workflowPipeline: {
          ...prior,
          steps: prior.steps.map((step) => step.stepId === 'clip-production-agent' ? {
            ...step,
            node: { ...step.node, data: {
              ...step.node.data,
              workflowAgentModelKey: 'user-selected-author',
              workflowAgentModelSelection: 'user-selected-provider',
              workflowInstruction: 'obsolete instruction',
            } },
          } : step),
        },
      },
    }]
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', existingNodes: priorStages, existingEdges: [],
    })
    const pipeline = patch.patchNodeData.find((node) => node.id.endsWith(':clip-production-pipeline'))
    const author = parseWorkflowPipelineRunSpec(pipeline?.data.workflowPipeline).steps
      .find((step) => step.stepId === 'clip-production-agent')?.node.data
    expect(author).toMatchObject({
      workflowAgentModelKey: 'user-selected-author',
      workflowAgentModelSelection: 'user-selected-provider',
    })
    expect(author?.workflowInstruction).not.toBe('obsolete instruction')
  })

  it('repairs only missing default outer connections', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const originalEdges = useRFStore.getState().edges
    useRFStore.setState({ edges: originalEdges.slice(1) })
    expect(restoreVideoWorkflowDefaultConnections(result.workflowInstanceId)).toBe(1)
    expect(useRFStore.getState().edges).toHaveLength(28)
    expect(restoreVideoWorkflowDefaultConnections(result.workflowInstanceId)).toBe(0)
  })

  it('章节资产流水线：先大纲，再逐项并行作者，最后汇总成完整 chapter-asset-plan/v3', () => {
    const spec = parseWorkflowPipelineRunSpec(runtimeData('chapter-assets-agent').workflowPipeline)
    const step = (id: string) => spec.steps.find((candidate) => candidate.stepId === id)?.node.data as Record<string, unknown>
    expect(spec.steps.map((candidate) => candidate.stepId)).toEqual([
      'chapter-assets-outline-agent', 'chapter-assets-seeds', 'chapter-assets-part-agent', 'chapter-assets-collect',
    ])
    expect(spec.inputs.map((input) => input.portId)).toEqual(['delivery-contract', 'chapter-sequence'])
    expect(spec.outputs).toEqual([
      { portId: 'chapter-assets', from: { stepId: 'chapter-assets-collect', portId: 'chapter-assets' }, mode: 'value' },
    ])
    // 大纲必须看到章节序列：没有它规划器会过度规划（实测 9→14~18 个对象）。
    expect(spec.bindings).toContainEqual({ from: { kind: 'input', portId: 'chapter-sequence' }, to: { stepId: 'chapter-assets-outline-agent', portId: 'chapter-sequence' }, mode: 'value' })
    // 种子集合驱动逐项作者（collection 绑定），汇总同时拿到作者结果与种子。
    expect(spec.bindings).toContainEqual({ from: { kind: 'step', stepId: 'chapter-assets-seeds', portId: 'asset-seeds' }, to: { stepId: 'chapter-assets-part-agent', portId: 'asset-seed' }, mode: 'collection' })
    expect(spec.bindings).toContainEqual({ from: { kind: 'step', stepId: 'chapter-assets-part-agent', portId: 'asset-parts' }, to: { stepId: 'chapter-assets-collect', portId: 'asset-parts' }, mode: 'collection' })
    expect(spec.bindings).toContainEqual({ from: { kind: 'step', stepId: 'chapter-assets-seeds', portId: 'asset-seeds' }, to: { stepId: 'chapter-assets-collect', portId: 'asset-seeds' }, mode: 'collection' })
    expect(step('chapter-assets-part-agent')).toMatchObject({
      workflowNodeKind: 'chapter_asset_part_authoring',
      workflowAgentOutputArtifactType: 'tapcanvas.chapter-asset-part/v1',
      workflowAgentFailurePolicy: 'single_submission',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'scoped',
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_SMALL_AUTHOR_MAX_OUTPUT_TOKENS,
      workflowAtomicSpec: expect.objectContaining({ executionMode: 'each', itemConcurrency: VIDEO_WORKFLOW_CHAPTER_ASSET_PART_CONCURRENCY }),
    })
    expect(step('chapter-assets-outline-agent')).toMatchObject({
      workflowAgentOutputArtifactType: 'tapcanvas.chapter-asset-outline/v2',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_SMALL_AUTHOR_MAX_OUTPUT_TOKENS,
    })
    expect(step('chapter-assets-seeds')).toMatchObject({ workflowNodeKind: 'chapter_asset_seeds' })
    expect(step('chapter-assets-collect')).toMatchObject({ workflowNodeKind: 'chapter_asset_collect' })
  })

})

// 防退化：作者节点的产物类型改版（如 chapter-asset-outline v1→v2）时，若 Skill 的 artifact-preload 没跟上，
// 作者只拿到 Skill 骨架、读不到资产职责，产出会静默退化。这里要求每个作者节点的产物类型都被它所需的某个 Skill 预载。
describe('author nodes receive their Skill guidance', () => {
  function skillPreloadedArtifacts(skillId: string): Set<string> {
    const text = readFileSync(resolve(process.cwd(), '../agents-cli/skills', skillId, 'SKILL.md'), 'utf8')
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    const preload = frontmatter.split('\n  artifact-preload:\n')[1] ?? ''
    return new Set([...preload.matchAll(/^ {4}([^\s:][^:]*):\s*$/gm)].map((match) => match[1]!))
  }

  function agentSteps(data: Record<string, unknown>, path: string): Array<{ path: string; data: Record<string, unknown> }> {
    const own = typeof data.workflowAgentOutputArtifactType === 'string' ? [{ path, data }] : []
    if (data.workflowPipeline === undefined) return own
    return [...own, ...parseWorkflowPipelineRunSpec(data.workflowPipeline).steps
      .flatMap((step) => agentSteps(step.node.data as Record<string, unknown>, `${path}/${step.stepId}`))]
  }

  it('every author artifact type is declared in artifact-preload of one of its required Skills', () => {
    const patch = buildVideoWorkflowCanvasDefinitionPatch({
      workflowInstanceId: 'workflow-contract-fixture', workflowGroupId: 'workflow-contract-group',
      executionScope: 'media_delivery', executionVariant: 'full_video', existingEdges: [],
    })
    const authors = patch.patchNodeData.flatMap((node) => agentSteps(node.data, node.id.split(':').at(-1)!))
    expect(authors.map((author) => author.path)).toContain('chapter-assets-agent/chapter-assets-outline-agent')
    const missing = authors.flatMap(({ path, data }) => {
      const skills = Array.isArray(data.workflowRequiredSkills) ? data.workflowRequiredSkills as string[] : []
      const artifactType = data.workflowAgentOutputArtifactType as string
      return skills.some((skill) => skillPreloadedArtifacts(skill).has(artifactType)) ? [] : [`${path}: ${artifactType} (${skills.join(', ') || 'no skills'})`]
    })
    expect(missing).toEqual([])
  })
})

function useRFStoreReset(): void {
  useRFStore.getState().reset()
  useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
}

function runtimeData(nodeId: string, executionVariant: 'full_video' | 'first_video' = 'full_video'): Record<string, unknown> {
  const result = buildVideoWorkflowCanvasDefinitionPatch({
    workflowInstanceId: 'workflow-contract-fixture',
    workflowGroupId: 'workflow-contract-group',
    executionScope: 'media_delivery',
    executionVariant,
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
