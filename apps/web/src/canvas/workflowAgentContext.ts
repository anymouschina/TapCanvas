import type { AgentExecutionProvenanceDto } from '../api/server'

export const WORKFLOW_AGENT_CONTEXT_PORTS = [
  'skills',
  'tools',
  'knowledge-candidates',
  'knowledge-evidence',
] as const

export type WorkflowAgentContextPort = typeof WORKFLOW_AGENT_CONTEXT_PORTS[number]

export type WorkflowAgentDeclaredContext = Readonly<{
  allowedTools: readonly string[]
  optionalContextPorts: readonly WorkflowAgentContextPort[]
}>

export type WorkflowPromptExampleSearchObservation = Readonly<{
  version: 1
  status:
    | 'not_attempted'
    | 'candidate_found'
    | 'no_match'
    | 'retrieval_failed'
    | 'invalid_evidence'
    | 'tool_unavailable'
  mediaType: 'image' | 'video'
  attempted: boolean
  remoteAttempted: boolean
  candidateCount: number
  blocking: false
  rationale: string
  toolCallId?: string
}>

export const WORKFLOW_AGENT_UNIVERSAL_KNOWLEDGE_TOOLS = [
  'skill_search',
  'Skill',
  'knowledge_search',
  'knowledge_read',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.flatMap((item) => (
    typeof item === 'string' && item.trim() ? [item.trim()] : []
  ))))
}

const PROMPT_EXAMPLE_SEARCH_STATUSES = new Set<WorkflowPromptExampleSearchObservation['status']>([
  'not_attempted',
  'candidate_found',
  'no_match',
  'retrieval_failed',
  'invalid_evidence',
  'tool_unavailable',
])

function parsePromptExampleSearchObservation(value: unknown): WorkflowPromptExampleSearchObservation | null {
  if (!isRecord(value) || value.version !== 1) return null
  const status = typeof value.status === 'string'
    ? value.status as WorkflowPromptExampleSearchObservation['status']
    : null
  if (!status || !PROMPT_EXAMPLE_SEARCH_STATUSES.has(status)) return null
  if (value.mediaType !== 'image' && value.mediaType !== 'video') return null
  if (
    typeof value.attempted !== 'boolean'
    || typeof value.remoteAttempted !== 'boolean'
    || typeof value.candidateCount !== 'number'
    || !Number.isInteger(value.candidateCount)
    || value.candidateCount < 0
    || value.blocking !== false
    || typeof value.rationale !== 'string'
    || !value.rationale.trim()
  ) return null
  const toolCallId = typeof value.toolCallId === 'string' && value.toolCallId.trim()
    ? value.toolCallId.trim()
    : null
  return {
    version: 1,
    status,
    mediaType: value.mediaType,
    attempted: value.attempted,
    remoteAttempted: value.remoteAttempted,
    candidateCount: value.candidateCount,
    blocking: false,
    rationale: value.rationale.trim(),
    ...(toolCallId ? { toolCallId } : {}),
  }
}

function isContextPort(value: string): value is WorkflowAgentContextPort {
  return WORKFLOW_AGENT_CONTEXT_PORTS.some((port) => port === value)
}

export function readWorkflowAgentDeclaredContext(
  data: Record<string, unknown>,
): WorkflowAgentDeclaredContext {
  const atomicSpec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null
  const optionalPorts = readStringArray(
    atomicSpec?.optionalInputPorts ?? data.workflowOptionalInputPorts,
  ).filter(isContextPort)
  return {
    allowedTools: Array.from(new Set([
      ...WORKFLOW_AGENT_UNIVERSAL_KNOWLEDGE_TOOLS,
      ...readStringArray(data.workflowAllowedTools),
    ])),
    optionalContextPorts: optionalPorts,
  }
}

export function isWorkflowAgentNode(data: Record<string, unknown>): boolean {
  const atomicSpec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null
  return atomicSpec?.category === 'agent'
    || atomicSpec?.executorRef === 'agents.logical-task/v2'
    || data.workflowNodeKind === 'agent_task'
    || data.workflowNodeKind === 'beat_sheet'
    || data.workflowNodeKind === 'asset_coverage'
    || data.workflowNodeKind === 'clip_writer'
}

function parseSkillResources(value: unknown): AgentExecutionProvenanceDto['loadedSkillResources'] {
  if (!Array.isArray(value)) return undefined
  const resources = value.flatMap((item) => {
    if (!isRecord(item)) return []
    const skill = typeof item.skill === 'string' ? item.skill.trim() : ''
    const resource = typeof item.resource === 'string' ? item.resource.trim() : ''
    if (!skill || !resource) return []
    return [{
      skill,
      resource,
      ...(typeof item.contentHash === 'string' ? { contentHash: item.contentHash } : {}),
      ...(typeof item.contentChars === 'number' ? { contentChars: item.contentChars } : {}),
    }]
  })
  return resources.length > 0 ? resources : undefined
}

function parseSkillSources(value: unknown): AgentExecutionProvenanceDto['loadedSkillSources'] {
  if (!Array.isArray(value)) return undefined
  const sources: NonNullable<AgentExecutionProvenanceDto['loadedSkillSources']> = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const skill = typeof item.skill === 'string' ? item.skill.trim() : ''
    const source = typeof item.source === 'string' ? item.source.trim() : ''
    const contentHash = typeof item.contentHash === 'string' ? item.contentHash.trim() : ''
    const contentChars = typeof item.contentChars === 'number' ? item.contentChars : null
    const sourceKind = item.sourceKind
    if (
      !skill
      || !source
      || !contentHash
      || contentChars === null
      || (sourceKind !== 'skill' && sourceKind !== 'section' && sourceKind !== 'resource' && sourceKind !== 'external')
    ) continue
    const decisionBasisRole = item.decisionBasisRole === 'professional_method' || item.decisionBasisRole === 'evidence_only'
      ? item.decisionBasisRole
      : null
    sources.push({
      skill,
      ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.trim() } : {}),
      ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim() } : {}),
      sourceKind,
      source,
      contentHash,
      contentChars,
      ...(decisionBasisRole ? { decisionBasisRole } : {}),
    })
  }
  return sources.length > 0 ? sources : undefined
}

function parseKnowledgeSources(value: unknown): AgentExecutionProvenanceDto['loadedKnowledgeSources'] {
  if (!Array.isArray(value)) return undefined
  const sources: NonNullable<AgentExecutionProvenanceDto['loadedKnowledgeSources']> = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const cardId = typeof item.cardId === 'string' ? item.cardId.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const contentHash = typeof item.contentHash === 'string' ? item.contentHash.trim() : ''
    const contentChars = typeof item.contentChars === 'number' ? item.contentChars : null
    if (!cardId || !title || !contentHash || contentChars === null) continue
    sources.push({
      cardId,
      title,
      ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim() } : {}),
      ...(typeof item.domain === 'string' && item.domain.trim() ? { domain: item.domain.trim() } : {}),
      ...(typeof item.facet === 'string' && item.facet.trim() ? { facet: item.facet.trim() } : {}),
      sourceUrls: [...readStringArray(item.sourceUrls)],
      contentHash,
      contentChars,
    })
  }
  return sources.length > 0 ? sources : undefined
}

function parseExecutionProvenance(value: unknown): AgentExecutionProvenanceDto | null {
  if (!isRecord(value) || value.version !== 1) return null
  const executionId = typeof value.executionId === 'string' ? value.executionId.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  const startedAt = typeof value.startedAt === 'string' ? value.startedAt.trim() : ''
  const depth = typeof value.depth === 'number' && Number.isInteger(value.depth) && value.depth >= 0
    ? value.depth
    : null
  if (!executionId || !model || !startedAt || depth === null) return null
  if (value.apiStyle !== 'chat' && value.apiStyle !== 'responses') return null
  const loadedSkillResources = parseSkillResources(value.loadedSkillResources)
  const loadedSkillSources = parseSkillSources(value.loadedSkillSources)
  const loadedKnowledgeSources = parseKnowledgeSources(value.loadedKnowledgeSources)
  return {
    version: 1,
    executionId,
    ...(typeof value.agentId === 'string' && value.agentId.trim() ? { agentId: value.agentId.trim() } : {}),
    ...(typeof value.parentAgentId === 'string' && value.parentAgentId.trim() ? { parentAgentId: value.parentAgentId.trim() } : {}),
    ...(typeof value.sessionId === 'string' && value.sessionId.trim() ? { sessionId: value.sessionId.trim() } : {}),
    depth,
    model,
    apiStyle: value.apiStyle,
    requiredSkills: [...readStringArray(value.requiredSkills)],
    loadedSkills: [...readStringArray(value.loadedSkills)],
    ...(loadedSkillResources ? { loadedSkillResources } : {}),
    ...(loadedSkillSources ? { loadedSkillSources } : {}),
    ...(loadedKnowledgeSources ? { loadedKnowledgeSources } : {}),
    startedAt,
  }
}

export function readWorkflowAgentExecutionProvenanceHistory(
  evidence: unknown,
): AgentExecutionProvenanceDto[] {
  const evidenceRecord = isRecord(evidence) ? evidence : null
  const records = [
    evidenceRecord,
    isRecord(evidenceRecord?.evidence) ? evidenceRecord.evidence : null,
    ...(Array.isArray(evidenceRecord?.itemRuns)
      ? evidenceRecord.itemRuns.flatMap((item) => {
          if (!isRecord(item)) return []
          return [item, isRecord(item.evidence) ? item.evidence : null]
        })
      : []),
  ].filter((record): record is Record<string, unknown> => record !== null)
  const byExecutionId = new Map<string, AgentExecutionProvenanceDto>()
  for (const record of records) {
    const values = Array.isArray(record.executionProvenanceHistory)
      ? record.executionProvenanceHistory
      : record.executionProvenance
        ? [record.executionProvenance]
        : []
    for (const value of values) {
      const provenance = parseExecutionProvenance(value)
      if (provenance) byExecutionId.set(provenance.executionId, provenance)
    }
  }
  return [...byExecutionId.values()]
}

export function readWorkflowAgentExecutionProvenance(
  evidence: unknown,
): AgentExecutionProvenanceDto | null {
  const history = readWorkflowAgentExecutionProvenanceHistory(evidence)
  return history[history.length - 1] ?? null
}

export function readWorkflowPromptExampleSearchObservations(
  evidence: unknown,
): WorkflowPromptExampleSearchObservation[] {
  const evidenceRecord = isRecord(evidence) ? evidence : null
  const records = [
    evidenceRecord,
    isRecord(evidenceRecord?.evidence) ? evidenceRecord.evidence : null,
    ...(Array.isArray(evidenceRecord?.itemRuns)
      ? evidenceRecord.itemRuns.flatMap((item) => {
          if (!isRecord(item)) return []
          return [item, isRecord(item.evidence) ? item.evidence : null]
        })
      : []),
  ].filter((record): record is Record<string, unknown> => record !== null)
  const observations = new Map<string, WorkflowPromptExampleSearchObservation>()
  for (const [index, record] of records.entries()) {
    const observation = parsePromptExampleSearchObservation(record.promptExampleCandidateSearch)
    if (!observation) continue
    const identity = observation.toolCallId
      ?? `${observation.mediaType}:${observation.status}:${observation.candidateCount}:${index}`
    observations.set(identity, observation)
  }
  return [...observations.values()]
}

export function workflowAgentContextPortLabel(port: WorkflowAgentContextPort): string {
  if (port === 'skills') return 'Skill 上游输入'
  if (port === 'tools') return '工具权限'
  if (port === 'knowledge-candidates') return '知识候选集'
  return '知识读取证据'
}

export function workflowAgentToolLabel(tool: string): string {
  if (tool === 'knowledge_search') return '知识库检索'
  if (tool === 'knowledge_read') return '知识文档读取'
  return tool
}
