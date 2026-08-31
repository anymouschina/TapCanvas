import type { Edge, Node } from '@xyflow/react'
import type { AgentExecutionProvenanceDto } from '../api/server'
import { WORKFLOW_ICON_NODE_SIZE } from './workflowNodeGeometry'
import {
  isWorkflowAgentNode,
  readWorkflowAgentExecutionProvenanceHistory,
  readWorkflowPromptExampleSearchObservations,
  type WorkflowPromptExampleSearchObservation,
} from './workflowAgentContext'
import {
  workflowAgentReferenceSourceHandleId,
  workflowAgentReferenceTargetHandleId,
} from './workflowAgentReferencePorts'
import { useRFStore } from './store'

export type RuntimeReferenceKind = 'skill' | 'knowledge'

export type RuntimeReferenceEvidenceState = 'actual_read'

export type RuntimeReferenceAggregateEvidenceState =
  | 'actual_read'
  | 'searched'
  | 'search_failed'
  | 'unrecorded'
  | 'available'

type RuntimeReferenceDescriptor = Readonly<{
  identity: string
  referenceKey: string
  kind: RuntimeReferenceKind
  label: string
  description: string
  summary: string
  physicalExecutionIds: readonly string[]
  evidence: readonly Record<string, unknown>[]
  evidenceState: RuntimeReferenceEvidenceState
}>

export type WorkflowRuntimeReferenceItem = Readonly<{
  identity: string
  referenceKey: string
  name: string
  description: string
  evidenceState: RuntimeReferenceEvidenceState
  physicalExecutionIds: readonly string[]
  evidence: readonly Record<string, unknown>[]
}>

export type WorkflowAgentReferenceProjection = Readonly<{
  nodes: readonly Node[]
  edges: readonly Edge[]
}>

export type WorkflowAgentVisibleGraph = Readonly<{
  nodes: Node[]
  edges: Edge[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stableIdPart(value: string): string {
  return encodeURIComponent(value).split('%').join('_')
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function skillDescriptors(
  provenanceHistory: readonly AgentExecutionProvenanceDto[],
): RuntimeReferenceDescriptor[] {
  const loadedSkills = uniqueStrings(provenanceHistory.flatMap((provenance) => [
    ...(provenance.loadedSkills ?? []),
    ...(provenance.loadedSkillSources ?? []).map((source) => source.skill),
    ...(provenance.loadedSkillResources ?? []).map((source) => source.skill),
  ]))
  return loadedSkills.map((skill) => {
    const physicalExecutionIds = uniqueStrings(provenanceHistory.flatMap((provenance) => {
      const used = provenance.loadedSkills?.includes(skill)
        || provenance.loadedSkillSources?.some((source) => source.skill === skill)
        || provenance.loadedSkillResources?.some((source) => source.skill === skill)
      return used ? [provenance.executionId] : []
    }))
    const sourceEvidence = provenanceHistory.flatMap((provenance) => (
      provenance.loadedSkillSources ?? []
    )).filter((source) => source.skill === skill)
    const resourceEvidence = provenanceHistory.flatMap((provenance) => (
      provenance.loadedSkillResources ?? []
    )).filter((source) => source.skill === skill)
    const evidence = [
      ...sourceEvidence.map((source) => ({
        sourceKind: source.sourceKind,
        source: source.source,
        contentHash: source.contentHash,
        contentChars: source.contentChars,
        ...(source.decisionBasisRole ? { decisionBasisRole: source.decisionBasisRole } : {}),
        ...(source.name ? { name: source.name } : {}),
        ...(source.description ? { description: source.description } : {}),
      })),
      ...resourceEvidence.map((source) => ({
        sourceKind: 'resource',
        source: source.resource,
        ...(source.contentHash ? { contentHash: source.contentHash } : {}),
        ...(typeof source.contentChars === 'number' ? { contentChars: source.contentChars } : {}),
      })),
    ]
    const sourceCount = new Set(evidence.map((item) => `${readString(item.sourceKind)}:${readString(item.source)}`)).size
    const metadataDescription = sourceEvidence
      .map((source) => readString(source.description))
      .find(Boolean) ?? ''
    return {
      identity: skill,
      referenceKey: skill,
      kind: 'skill',
      label: skill,
      description: metadataDescription,
      summary: sourceCount > 0
        ? `实际加载 ${sourceCount} 个 Skill 源文件或章节`
        : '执行证据确认本轮实际加载该 Skill',
      physicalExecutionIds,
      evidence,
      evidenceState: 'actual_read',
    }
  })
}

function knowledgeDescriptors(
  provenanceHistory: readonly AgentExecutionProvenanceDto[],
): RuntimeReferenceDescriptor[] {
  const byCardId = new Map<string, {
    source: NonNullable<AgentExecutionProvenanceDto['loadedKnowledgeSources']>[number]
    physicalExecutionIds: string[]
    evidenceSources: NonNullable<AgentExecutionProvenanceDto['loadedKnowledgeSources']>
  }>()
  for (const provenance of provenanceHistory) {
    for (const source of provenance.loadedKnowledgeSources ?? []) {
      const current = byCardId.get(source.cardId)
      if (current) {
        current.physicalExecutionIds.push(provenance.executionId)
        if (!current.evidenceSources.some((item) => item.contentHash === source.contentHash)) {
          current.evidenceSources.push(source)
        }
      } else {
        byCardId.set(source.cardId, {
          source,
          physicalExecutionIds: [provenance.executionId],
          evidenceSources: [source],
        })
      }
    }
  }
  return uniqueStrings([...byCardId.keys()]).map((cardId) => {
    const item = byCardId.get(cardId)
    if (!item) throw new Error(`Workflow knowledge provenance missing for ${cardId}`)
    return {
      identity: cardId,
      referenceKey: cardId,
      kind: 'knowledge' as const,
      label: item.source.title,
      description: readString(item.source.description),
      summary: [item.source.domain, item.source.facet, `${item.source.contentChars} 字`].filter(Boolean).join(' · '),
      physicalExecutionIds: uniqueStrings(item.physicalExecutionIds),
      evidence: item.evidenceSources.map((source) => ({
        cardId: source.cardId,
        title: source.title,
        ...(source.domain ? { domain: source.domain } : {}),
        ...(source.facet ? { facet: source.facet } : {}),
        sourceUrls: [...source.sourceUrls],
        contentHash: source.contentHash,
        contentChars: source.contentChars,
      })),
      evidenceState: 'actual_read' as const,
    }
  })
}

function referencePosition(
  agentNode: Node,
  kind: RuntimeReferenceKind,
): { x: number; y: number } {
  return {
    x: agentNode.position.x + (kind === 'skill' ? -44 : 44),
    y: agentNode.position.y + 104,
  }
}

function referenceLabel(kind: RuntimeReferenceKind): string {
  return kind === 'skill' ? 'Skills' : '知识库'
}

type PromptExampleSearchSummary = Readonly<{
  attemptCount: number
  successCount: number
  failureCount: number
  candidateCount: number
}>

function summarizePromptExampleSearch(
  observations: readonly WorkflowPromptExampleSearchObservation[],
): PromptExampleSearchSummary {
  const attempted = observations.filter((observation) => observation.attempted)
  const failures = attempted.filter((observation) => (
    observation.status === 'retrieval_failed'
    || observation.status === 'invalid_evidence'
    || observation.status === 'tool_unavailable'
  ))
  return {
    attemptCount: attempted.length,
    successCount: attempted.length - failures.length,
    failureCount: failures.length,
    candidateCount: attempted.reduce((sum, observation) => sum + observation.candidateCount, 0),
  }
}

function referenceSummary(
  kind: RuntimeReferenceKind,
  items: readonly WorkflowRuntimeReferenceItem[],
  search: PromptExampleSearchSummary,
  historicalExecutionObserved: boolean,
): string {
  if (kind === 'knowledge' && search.attemptCount > 0) {
    if (search.failureCount === search.attemptCount) {
      return `${search.attemptCount} 次案例检索均失败 · 本轮未读取正文`
    }
    const failure = search.failureCount > 0 ? ` · ${search.failureCount} 次失败` : ''
    const bodyRead = items.length > 0 ? ` · ${items.length} 项正文已读` : ' · 本轮未读取正文'
    return `${search.attemptCount} 次案例检索 · ${search.candidateCount} 个候选${failure}${bodyRead}`
  }
  if (kind === 'knowledge' && historicalExecutionObserved && items.length === 0) {
    return '历史运行未采集案例检索回执 · 本轮未读取正文'
  }
  if (items.length === 0) return `${referenceLabel(kind)}全库可检索 · 本轮未读取`
  return `${items.length} 项本轮实际读取`
}

function aggregateReferenceNode(input: Readonly<{
  kind: RuntimeReferenceKind
  descriptors: readonly RuntimeReferenceDescriptor[]
  agentNode: Node
  workflowExecutionId: string
  readOnly: boolean
  promptExampleSearchObservations: readonly WorkflowPromptExampleSearchObservation[]
  historicalExecutionObserved: boolean
}>): Node {
  const data = isRecord(input.agentNode.data) ? input.agentNode.data : {}
  const operation = input.kind === 'skill' ? 'skill_reference' : 'knowledge_reference'
  const category = input.kind === 'skill' ? 'skill' : 'tool'
  const nodeId = `${input.agentNode.id}:runtime-reference:${input.kind}`
  const items: WorkflowRuntimeReferenceItem[] = input.descriptors.map((descriptor) => ({
    identity: descriptor.identity,
    referenceKey: descriptor.referenceKey,
    name: descriptor.label,
    description: descriptor.description,
    evidenceState: descriptor.evidenceState,
    physicalExecutionIds: [...descriptor.physicalExecutionIds],
    evidence: [...descriptor.evidence],
  }))
  const actualReadCount = items.filter((item) => item.evidenceState === 'actual_read').length
  const promptExampleSearch = summarizePromptExampleSearch(input.promptExampleSearchObservations)
  const allSearchAttemptsFailed = promptExampleSearch.attemptCount > 0
    && promptExampleSearch.failureCount === promptExampleSearch.attemptCount
  const aggregateEvidenceState: RuntimeReferenceAggregateEvidenceState = actualReadCount > 0
    ? 'actual_read'
    : allSearchAttemptsFailed
      ? 'search_failed'
      : promptExampleSearch.attemptCount > 0
        ? 'searched'
        : input.kind === 'knowledge' && input.historicalExecutionObserved
          ? 'unrecorded'
          : 'available'
  const label = referenceLabel(input.kind)
  const description = referenceSummary(
    input.kind,
    items,
    promptExampleSearch,
    input.historicalExecutionObserved,
  )
  const nodeLabel = items.length > 0
    ? `${label} · 已读 ${items.length}`
    : input.kind === 'knowledge' && allSearchAttemptsFailed
      ? `${label} · 检索异常`
      : input.kind === 'knowledge' && promptExampleSearch.attemptCount > 0
        ? `${label} · 已检索`
        : input.kind === 'knowledge' && input.historicalExecutionObserved
          ? `${label} · 历史未采集`
        : `${label} · 全库`
  return {
    id: nodeId,
    type: 'taskNode',
    position: referencePosition(input.agentNode, input.kind),
    ...(input.agentNode.parentId ? { parentId: input.agentNode.parentId } : {}),
    draggable: false,
    deletable: false,
    selectable: true,
    data: {
      nodeId,
      label: nodeLabel,
      autoLabel: false,
      kind: 'workflowStage',
      adminWorkflow: true,
      readOnly: input.readOnly,
      skipDagRun: true,
      status: 'idle',
      nodeWidth: WORKFLOW_ICON_NODE_SIZE,
      nodeHeight: WORKFLOW_ICON_NODE_SIZE,
      workflowKey: readString(data.workflowKey),
      workflowInstanceId: readString(data.workflowInstanceId),
      workflowNodeId: `agent-${input.kind}-references`,
      workflowNodeKind: operation,
      workflowAtomicSpec: {
        version: 1,
        category,
        operation,
        executorRef: null,
        executionMode: 'once',
        inputPorts: [],
        outputPorts: [],
      },
      workflowInputPorts: [],
      workflowOptionalInputPorts: [],
      workflowOutputPorts: [],
      workflowOperationDescription: description,
      workflowStatus: actualReadCount > 0 || promptExampleSearch.successCount > 0
        ? 'succeeded'
        : allSearchAttemptsFailed
          ? 'partial'
          : input.kind === 'knowledge' && input.historicalExecutionObserved
            ? 'partial'
            : 'idle',
      workflowExecutionId: input.workflowExecutionId,
      workflowRuntimeReference: true,
      workflowRuntimeReferenceAggregate: true,
      workflowRuntimeReferenceKind: input.kind,
      workflowRuntimeReferenceName: label,
      workflowRuntimeReferenceDescription: description,
      workflowRuntimeReferenceCount: items.length,
      workflowRuntimeReferenceActualReadCount: actualReadCount,
      workflowRuntimeReferenceOwnerNodeId: input.agentNode.id,
      workflowRuntimeReferenceItems: items,
      workflowRuntimeReferenceEvidenceState: aggregateEvidenceState,
      workflowRuntimeReferenceSearchAttemptCount: promptExampleSearch.attemptCount,
      workflowRuntimeReferenceSearchSuccessCount: promptExampleSearch.successCount,
      workflowRuntimeReferenceSearchFailureCount: promptExampleSearch.failureCount,
      workflowRuntimeReferenceCandidateCount: promptExampleSearch.candidateCount,
      workflowRuntimeReferenceSearchObservations: input.promptExampleSearchObservations,
    },
  }
}

function referenceEdge(agentNodeId: string, node: Node, kind: RuntimeReferenceKind): Edge {
  const relationKind = kind === 'skill' ? 'agent_skill_reference' : 'agent_knowledge_reference'
  const label = referenceLabel(kind)
  const count = typeof node.data.workflowRuntimeReferenceCount === 'number'
    ? node.data.workflowRuntimeReferenceCount
    : 0
  const actualReadCount = typeof node.data.workflowRuntimeReferenceActualReadCount === 'number'
    ? node.data.workflowRuntimeReferenceActualReadCount
    : 0
  const searchAttemptCount = typeof node.data.workflowRuntimeReferenceSearchAttemptCount === 'number'
    ? node.data.workflowRuntimeReferenceSearchAttemptCount
    : 0
  const searchFailureCount = typeof node.data.workflowRuntimeReferenceSearchFailureCount === 'number'
    ? node.data.workflowRuntimeReferenceSearchFailureCount
    : 0
  const allSearchAttemptsFailed = searchAttemptCount > 0 && searchFailureCount === searchAttemptCount
  const evidenceState = actualReadCount > 0
    ? 'actual_read'
    : allSearchAttemptsFailed
      ? 'search_failed'
      : searchAttemptCount > 0
        ? 'searched'
        : node.data.workflowRuntimeReferenceEvidenceState === 'unrecorded'
          ? 'unrecorded'
          : 'available'
  return {
    id: `e-${relationKind}-${stableIdPart(agentNodeId)}-${stableIdPart(node.id)}`,
    source: node.id,
    target: agentNodeId,
    sourceHandle: workflowAgentReferenceSourceHandleId(kind),
    targetHandle: workflowAgentReferenceTargetHandleId(kind),
    type: 'orth',
    label: `${label} ${count > 0
      ? `${count} 项已读`
      : allSearchAttemptsFailed
        ? '检索异常'
        : searchAttemptCount > 0
          ? '已检索'
          : evidenceState === 'unrecorded'
            ? '历史未采集'
            : '全库可检索'}`,
    data: {
      edgeType: 'reference',
      relationKind,
      executionRole: 'reference_only',
      label,
      referenceCount: count,
      referenceActualReadCount: actualReadCount,
      referenceSearchAttemptCount: searchAttemptCount,
      referenceSearchFailureCount: searchFailureCount,
      referenceEvidenceState: evidenceState,
      referenceState: 'available',
    },
  }
}

export function buildWorkflowAgentReferenceProjection(input: Readonly<{
  agentNode: Node
  workflowExecutionId: string
  outputRefs: unknown
  readOnly: boolean
}>): WorkflowAgentReferenceProjection {
  const provenanceHistory = readWorkflowAgentExecutionProvenanceHistory(input.outputRefs)
  const promptExampleSearchObservations = readWorkflowPromptExampleSearchObservations(input.outputRefs)
  const descriptorsByKind: Readonly<Record<RuntimeReferenceKind, readonly RuntimeReferenceDescriptor[]>> = {
    skill: skillDescriptors(provenanceHistory),
    knowledge: knowledgeDescriptors(provenanceHistory),
  }
  const kinds: readonly RuntimeReferenceKind[] = ['skill', 'knowledge']
  const nodes = kinds.map((kind) => aggregateReferenceNode({
    kind,
    descriptors: descriptorsByKind[kind],
    agentNode: input.agentNode,
    workflowExecutionId: input.workflowExecutionId,
    readOnly: input.readOnly,
    promptExampleSearchObservations: kind === 'knowledge' ? promptExampleSearchObservations : [],
    historicalExecutionObserved: provenanceHistory.length > 0,
  }))
  return {
    nodes,
    edges: nodes.map((node, index) => referenceEdge(
      input.agentNode.id,
      node,
      kinds[index] ?? 'knowledge',
    )),
  }
}

export function isWorkflowAgentReferenceEdge(edge: Edge): boolean {
  if (!isRecord(edge.data) || edge.data.executionRole !== 'reference_only') return false
  return edge.data.relationKind === 'agent_skill_reference'
    || edge.data.relationKind === 'agent_knowledge_reference'
}

/**
 * Builds the complete visible workflow graph in one pass.
 *
 * Skill/knowledge nodes are a derived read model and are intentionally absent
 * from the persisted authoring graph. Any code path that replaces the full
 * authoring graph must call this function before publishing the replacement to
 * the canvas store; otherwise React can render (or keep) an intermediate graph
 * with Agent reference mounts missing.
 */
export function buildWorkflowAgentVisibleGraph(input: Readonly<{
  nodes: readonly Node[]
  edges: readonly Edge[]
  workflowExecutionId: string
  outputRefsByAgentNodeId: ReadonlyMap<string, unknown>
  readOnly: boolean
}>): WorkflowAgentVisibleGraph {
  const selectedById = new Map(input.nodes.map((node) => [node.id, node.selected] as const))
  const authoringNodes = input.nodes.filter((node) => (
    !isRecord(node.data) || node.data.workflowRuntimeReference !== true
  ))
  const authoringEdges = input.edges.filter((edge) => !isWorkflowAgentReferenceEdge(edge))
  const referenceNodes: Node[] = []
  const referenceEdges: Edge[] = []

  for (const agentNode of authoringNodes) {
    if (!isRecord(agentNode.data) || !isWorkflowAgentNode(agentNode.data)) continue
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode,
      workflowExecutionId: input.workflowExecutionId,
      outputRefs: input.outputRefsByAgentNodeId.get(agentNode.id) ?? {},
      readOnly: input.readOnly,
    })
    referenceNodes.push(...projection.nodes.map((node) => ({
      ...node,
      selected: selectedById.get(node.id),
    })))
    referenceEdges.push(...projection.edges)
  }

  return {
    nodes: [...authoringNodes, ...referenceNodes],
    edges: [...authoringEdges, ...referenceEdges],
  }
}

export function applyWorkflowAgentReferenceProjection(input: Readonly<{
  agentNodeId: string
  workflowExecutionId: string
  outputRefs: unknown
}>): void {
  const agentNode = useRFStore.getState().nodes.find((node) => node.id === input.agentNodeId)
  if (!agentNode) return
  const projection = buildWorkflowAgentReferenceProjection({
    agentNode,
    workflowExecutionId: input.workflowExecutionId,
    outputRefs: input.outputRefs,
    readOnly: false,
  })
  const projectedNodeIds = new Set(projection.nodes.map((node) => node.id))
  useRFStore.setState((state) => {
    const retainedNodes = state.nodes.filter((node) => {
      if (!isRecord(node.data)) return true
      return node.data.workflowRuntimeReferenceOwnerNodeId !== input.agentNodeId
        || projectedNodeIds.has(node.id)
    })
    const projectionById = new Map(projection.nodes.map((node) => [node.id, node] as const))
    const updatedNodes = retainedNodes.map((node) => {
      const replacement = projectionById.get(node.id)
      if (!replacement) return node
      projectionById.delete(node.id)
      return { ...replacement, selected: node.selected }
    })
    const retainedEdges = state.edges.filter((edge) => {
      if (!isRecord(edge.data)) return true
      return edge.data.executionRole !== 'reference_only'
        || (edge.data.relationKind !== 'agent_skill_reference'
          && edge.data.relationKind !== 'agent_knowledge_reference')
        || (edge.source !== input.agentNodeId && edge.target !== input.agentNodeId)
    })
    return {
      nodes: [...updatedNodes, ...projectionById.values()],
      edges: [...retainedEdges, ...projection.edges],
    }
  })
}

/**
 * Materializes authoring-time mount points before execution history is
 * available. Runtime provenance later enriches these same stable nodes.
 */
export function applyWorkflowAgentConfigurationProjection(): void {
  useRFStore.setState((state) => buildWorkflowAgentVisibleGraph({
    nodes: state.nodes,
    edges: state.edges,
    workflowExecutionId: 'workflow-configuration',
    outputRefsByAgentNodeId: new Map<string, unknown>(),
    readOnly: false,
  }))
}

export function clearWorkflowAgentReferenceProjection(agentNodeId: string): void {
  useRFStore.setState((state) => ({
    nodes: state.nodes.filter((node) => (
      !isRecord(node.data) || node.data.workflowRuntimeReferenceOwnerNodeId !== agentNodeId
    )),
    edges: state.edges.filter((edge) => (
      !isRecord(edge.data)
      || edge.data.executionRole !== 'reference_only'
      || (edge.data.relationKind !== 'agent_skill_reference'
        && edge.data.relationKind !== 'agent_knowledge_reference')
      || (edge.source !== agentNodeId && edge.target !== agentNodeId)
    )),
  }))
}
