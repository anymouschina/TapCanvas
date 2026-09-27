import type { Edge, Node } from '@xyflow/react'
import {
  VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
} from '@tapcanvas/video-orchestrator-protocol'
import {
  ADMIN_WORKFLOW_PERMISSION,
  createManualWorkflowTriggerSpec,
  parseWorkflowPipelineRunSpec,
  type WorkflowPipelineRunSpecV1,
} from '@tapcanvas/workflow-kernel-protocol'
import { workflowPortHandleId } from './workflowCanvasPorts'
import { COLUMN_COUNT, COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP, VIDEO_WORKFLOW_CAPABILITY_DESCRIPTION, VIDEO_WORKFLOW_EXECUTION_CONCURRENCY, VIDEO_WORKFLOW_MAX_CLIPS_MAX, VIDEO_WORKFLOW_MAX_CLIPS_MIN } from './videoWorkflowDefinitionConstants'
import type { VideoWorkflowExecutionScope } from './videoWorkflowExecution'
import type { VideoAtomicNodeDefinition, VideoAtomicEdgeDefinition, VideoWorkflowCanvasDefinitionPatch, VideoWorkflowExistingEdge, VideoWorkflowExistingNode, VideoWorkflowExecutionVariant } from './videoWorkflowDefinitionTypes'
import { assertWorkflowDefinitionTopology, workflowDefinitions, workflowEdges } from './videoWorkflowGraphDefinition'
import { atomicSpec, videoNodeRuntimeData } from './videoWorkflowAtomicRuntime'

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

const INLINE_MEDIA_CONFIGURATION_FIELDS = [
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

function inheritInlinePipelineMediaConfiguration(
  value: unknown,
  existingNodes: readonly VideoWorkflowExistingNode[] | undefined,
): WorkflowPipelineRunSpecV1 {
  const spec = parseWorkflowPipelineRunSpec(value)
  if (!existingNodes?.length) return spec
  const priorPipelineSteps = existingNodes.flatMap((node) => {
    if (node.data?.workflowPipeline === undefined) return []
    if (node.data.workflowNodeId !== 'clip-production-pipeline' && node.data.workflowNodeId !== 'clip-media-pipeline') return []
    return parseWorkflowPipelineRunSpec(node.data.workflowPipeline).steps
  })
  const steps = spec.steps.map((step) => {
    const priorStep = priorPipelineSteps.find((candidate) => candidate.stepId === step.stepId)
    const priorFlatNode = existingNodes.find((node) => node.data?.workflowNodeId === step.stepId)
    const priorData = priorStep?.node.data ?? priorFlatNode?.data
    if (!priorData) return step
    const inherited = Object.fromEntries(INLINE_MEDIA_CONFIGURATION_FIELDS.flatMap((field) => {
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
    if (definition.nodeId !== 'clip-media-pipeline') return definition
    return {
      ...definition,
      runtimeData: {
        ...definition.runtimeData,
        workflowPipeline: inheritInlinePipelineMediaConfiguration(definition.runtimeData?.workflowPipeline, input.existingNodes),
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
        workflowCapabilityDescription: VIDEO_WORKFLOW_CAPABILITY_DESCRIPTION,
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

