import type { AgentDiagnosticAssessmentV1 } from '@tapcanvas/agent-observability'

export type ExecutionGraphNodeKind =
  | 'entry'
  | 'context'
  | 'decision'
  | 'skill'
  | 'domain'
  | 'learning'
  | 'plan'
  | 'turn'
  | 'tool'
  | 'subagent'
  | 'verification'
  | 'result'
  | 'branch'

export type ExecutionGraphNodeStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'warning'
  | 'inactive'
  | 'unavailable'
  | 'info'

export type ExecutionGraphDetail = {
  label: string
  value: string
}

export type ExecutionToolIssue = {
  path: string
  keyword: string
  message: string
}

export type ExecutionToolInvocationStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'blocked'
  | 'unknown'

export type ExecutionToolInvocation = {
  toolCallId: string
  toolName: string
  transportToolName: string
  operation: string
  status: ExecutionToolInvocationStatus
  startedAt: string
  finishedAt: string
  durationMs: number | null
  input: string
  output: string
  errorCode: string
  errorMessage: string
  issues: ExecutionToolIssue[]
}

export type ExecutionRoleActivity = {
  agentId: string
  roleName: string
  status: string
  summary: string
  occurredAt: string
}

export type ExecutionGraphDiagnostics = {
  taskStatus: ExecutionGraphNodeStatus
  conclusion: string
  invocations: ExecutionToolInvocation[]
  roles: ExecutionRoleActivity[]
  warnings: string[]
  errors: string[]
}

export type ExecutionTiming = {
  startedAt: string
  updatedAt: string
  finishedAt: string
  elapsedMs: number | null
  live: boolean
}

export type ExecutionPromptAssemblySource = {
  id: string
  label: string
  kind: 'user_contract' | 'generation_contract' | 'project_fact' | 'clip_fact' | 'skill' | 'skill_reference' | 'writer_output' | 'compiler' | 'asset_binding'
  ref: string
  status: 'applied' | 'not_used' | 'pending' | 'unavailable'
  summary: string
}

export type ExecutionPromptAssemblyStep = {
  id: string
  order: number
  title: string
  explanation: string
  sourceIds: string[]
}

export type ExecutionPromptAssembly = {
  version: 2
  artifactKey: string
  clipIndex: number
  state: 'complete' | 'partial' | 'pending'
  assemblySummary: string
  steps: ExecutionPromptAssemblyStep[]
  sources: ExecutionPromptAssemblySource[]
  contractSnapshot: {
    sourceSpanText: string | null
    dialogueScriptJson: string
    temporalContextJson: string | null
    sceneStateJson: string | null
    characterStatesJson: string | null
    characterStateVersionsJson: string | null
    startKeyframe: string | null
    endKeyframe: string | null
    previousExitState: string | null
    exitState: string | null
    writerOutputJson: string | null
  }
  finalPrompt: {
    label: string
    characterCount: number
    text: string
    hash: string | null
  } | null
}

export type ExecutionKnowledgeSource = {
  id: string
  label: string
  kind: 'skill' | 'skill_reference' | 'knowledge' | 'project_fact' | 'clip_fact' | 'compiler' | 'asset_binding'
  ref: string
  status: 'applied' | 'not_used' | 'pending' | 'unavailable'
  summary: string
  usedBy: string[]
  contentHash?: string
}

export type ExecutionKnowledgeReceipt = {
  version: 1
  state: 'complete' | 'partial' | 'pending'
  rootExecutionId: string | null
  summary: string
  sources: ExecutionKnowledgeSource[]
}

export type ExecutionGraphNode = {
  id: string
  layer: number
  lane: -1 | 0 | 1
  kind: ExecutionGraphNodeKind
  status: ExecutionGraphNodeStatus
  title: string
  summary: string
  primaryItems: string[]
  badges: string[]
  details: ExecutionGraphDetail[]
  timing?: ExecutionTiming
  diagnostics?: ExecutionGraphDiagnostics
  promptAssemblies?: ExecutionPromptAssembly[]
}

export type ExecutionGraphEdge = {
  id: string
  source: string
  target: string
  label: string
  active: boolean
  relation: 'main' | 'fork' | 'return' | 'inactive'
}

export type ExecutionGraph = {
  id: string
  executionTraceId: string | null
  title: string
  status: ExecutionGraphNodeStatus
  provenanceState: 'complete' | 'partial' | 'legacy_unavailable' | 'live_pending'
  nodes: ExecutionGraphNode[]
  edges: ExecutionGraphEdge[]
  knowledgeSourceCount: number
  skillCount: number
  activePathNodeCount: number
  layout: 'bounded_workflow' | 'legacy_timeline'
  diagnosis: AgentDiagnosticAssessmentV1
  timing?: ExecutionTiming
  knowledgeReceipt?: ExecutionKnowledgeReceipt
}
