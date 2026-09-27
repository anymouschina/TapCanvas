import type { Edge, Node } from '@xyflow/react'
import type { VideoAtomicWorkflowNodeId } from '@tapcanvas/video-orchestrator-protocol'
import type { WorkflowAtomicNodeCategory, WorkflowNodeExecutionMode } from '@tapcanvas/workflow-kernel-protocol'

export type VideoWorkflowExecutionVariant = 'full_video' | 'first_video'
export type VideoWorkflowVariantNodeId =
  | 'video-execution-choice'
  | 'video-node-prepare'
export type VideoLegacyWorkflowNodeId =
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
export type VideoInlinePipelineStepId =
  | 'chapter-sequence-agent'
  | 'chapter-sequence-project'
  | 'clip-production-agent'
  | 'clip-production-collect'
  | 'clip-production-nodes-materialize'
  | 'clip-production-media-project'
  | 'clip-production-assets-project'
  | 'clip-asset-image-generate'
  | 'clip-production-project'
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
export type VideoWorkflowNodeId = VideoAtomicWorkflowNodeId | VideoWorkflowVariantNodeId | VideoLegacyWorkflowNodeId | VideoInlinePipelineStepId

export type VideoAtomicNodeDefinitionBase = Readonly<{
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

export type VideoAtomicNodeDefinition = VideoAtomicAgentNodeDefinition | VideoAtomicNonAgentNodeDefinition

export type VideoAtomicEdgeDefinition = Readonly<{
  sourceNodeId: 'manual-trigger' | VideoWorkflowNodeId
  sourcePort: string
  targetNodeId: VideoWorkflowNodeId
  targetPort: string
}>

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

