import type { AgentDiagnosticsTraceDto, AgentExecutionProvenanceDto } from '../../api/server'
import type { LiveChatRunRecord } from '../chat/liveChatRunStore'
import type {
  ExecutionGraph,
  ExecutionGraphDetail,
  ExecutionGraphEdge,
  ExecutionGraphNode,
  ExecutionGraphNodeKind,
  ExecutionGraphNodeStatus,
} from './executionGraph.types'
import { buildLiveToolDiagnostics, buildToolInvocations } from './executionToolDiagnostics'
import { buildHistoricalExecutionDiagnosis, buildLiveExecutionDiagnosis } from './executionDiagnosis'
import { createExecutionTiming, timingFromTimestamps } from './executionTiming'
import { buildKnowledgeTraceEvidence } from './knowledgeTraceEvidence'
import { readPromptAssembly } from './promptAssemblyEvidence'
import { buildRuntimeKnowledgeReceipt } from './runtimeKnowledgeEvidence'
import {
  VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  type VideoProductionWorkflowNodeStatus,
} from '@tapcanvas/video-orchestrator-protocol'

type GraphBuilder = {
  nodes: ExecutionGraphNode[]
  edges: ExecutionGraphEdge[]
  layer: number
  previousId: string | null
}

type ExecutionGraphProjection = Omit<ExecutionGraph, 'diagnosis'>

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isLoadedSkillResource(value: unknown): value is NonNullable<AgentExecutionProvenanceDto['loadedSkillResources']>[number] {
  const resource = readRecord(value)
  return Boolean(
    resource &&
    typeof resource.skill === 'string' &&
    typeof resource.resource === 'string' &&
    (resource.contentHash === undefined || (typeof resource.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(resource.contentHash))) &&
    (resource.contentChars === undefined || (typeof resource.contentChars === 'number' && Number.isInteger(resource.contentChars) && resource.contentChars >= 0)),
  )
}

function isLoadedSkillSource(value: unknown): value is NonNullable<AgentExecutionProvenanceDto['loadedSkillSources']>[number] {
  const source = readRecord(value)
  return Boolean(
    source &&
    typeof source.skill === 'string' &&
    (source.sourceKind === 'skill' || source.sourceKind === 'section' || source.sourceKind === 'resource' || source.sourceKind === 'external') &&
    typeof source.source === 'string' &&
    typeof source.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(source.contentHash) &&
    typeof source.contentChars === 'number' && Number.isInteger(source.contentChars) && source.contentChars >= 0,
  )
}

function stableStringify(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compact(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function detailsFromRecord(record: Record<string, unknown> | null): ExecutionGraphDetail[] {
  if (!record) return []
  return Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => ({ label, value: stableStringify(value) }))
}

function toolCapabilityKind(name: string): 'skill' | 'knowledge' | 'learning' | 'tool' {
  if (name === 'Skill') return 'skill'
  if (name === 'knowledge_search' || name === 'knowledge_read') return 'knowledge'
  if (name === 'creative_learning_record' || name === 'creative_learning_query' || name === 'creative_learning_review') return 'learning'
  return 'tool'
}

function toolCapabilityLabel(name: string, input: Record<string, unknown> | null): string {
  if (name === 'Skill') return readString(input, 'skill') || 'unknown skill'
  if (name === 'knowledge_search') return readString(input, 'query') || 'knowledge query'
  if (name === 'knowledge_read') return readString(input, 'cardId') || 'knowledge card'
  if (name === 'creative_learning_record') return readString(input, 'claim') || 'record candidate'
  if (name === 'creative_learning_query') return readString(input, 'runId') || readString(input, 'birthStage') || 'query candidates'
  if (name === 'creative_learning_review') return readString(input, 'decision') || 'review candidates'
  if (name === 'tapcanvas_call_tool') return readString(input, 'name') || name
  return name
}

function creativeLearningItems(
  name: string,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): string[] {
  if (name === 'creative_learning_record') {
    return [
      readString(input, 'runId') ? `runId · ${readString(input, 'runId')}` : '',
      readString(input, 'birthStage') ? `出生阶段 · ${readString(input, 'birthStage')}` : '',
      readString(output, 'id') ? `candidateId · ${readString(output, 'id')}` : '',
      readString(output, 'status') ? `记录状态 · ${readString(output, 'status')}` : '',
      readNumber(output, 'evidenceCount') !== null ? `证据数 · ${readNumber(output, 'evidenceCount')}` : '',
      readNumber(output, 'evidenceToolCallCount') !== null ? `取证调用 · ${readNumber(output, 'evidenceToolCallCount')}` : '',
    ].filter(Boolean)
  }
  if (name === 'creative_learning_query') {
    const outcomes = Array.isArray(output?.outcomes)
      ? output.outcomes.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
      : []
    return [
      readString(input, 'runId') ? `runId · ${readString(input, 'runId')}` : '',
      readString(input, 'birthStage') ? `出生阶段 · ${readString(input, 'birthStage')}` : '',
      readString(input, 'status') ? `有效状态 · ${readString(input, 'status')}` : '',
      readNumber(output, 'count') !== null ? `候选数 · ${readNumber(output, 'count')}` : '',
      readNumber(output, 'outcomeCount') !== null ? `本次效果记录 · ${readNumber(output, 'outcomeCount')}` : '',
      readNumber(output, 'totalOutcomeCount') !== null ? `全部效果记录 · ${readNumber(output, 'totalOutcomeCount')}` : '',
      ...outcomes.map((outcome) => [
        readString(outcome, 'id') || 'unknown',
        readString(outcome, 'runId') || 'unknown-run',
        readString(outcome, 'verdict') || 'unknown-verdict',
      ].join(' · ')),
    ].filter(Boolean)
  }
  if (name === 'creative_learning_review') {
    return [
      readString(input, 'decision') ? `评审决定 · ${readString(input, 'decision')}` : '',
      Array.isArray(input?.candidateIds) ? `候选数 · ${input.candidateIds.length}` : '',
      readString(output, 'reviewId') ? `reviewId · ${readString(output, 'reviewId')}` : '',
    ].filter(Boolean)
  }
  return []
}

function addNode(
  graph: GraphBuilder,
  input: Omit<ExecutionGraphNode, 'layer' | 'lane' | 'primaryItems'> & {
    lane?: -1 | 0 | 1
    primaryItems?: string[]
    edgeLabel?: string
    activeEdge?: boolean
  },
): ExecutionGraphNode {
  const node: ExecutionGraphNode = {
    id: input.id,
    layer: graph.layer,
    lane: input.lane ?? 0,
    kind: input.kind,
    status: input.status,
    title: input.title,
    summary: input.summary,
    primaryItems: input.primaryItems ?? [],
    badges: input.badges,
    details: input.details,
  }
  graph.nodes.push(node)
  if (graph.previousId) {
    graph.edges.push({
      id: `${graph.previousId}-${node.id}`,
      source: graph.previousId,
      target: node.id,
      label: input.edgeLabel ?? '',
      active: input.activeEdge !== false,
      relation: input.activeEdge === false ? 'inactive' : 'main',
    })
  }
  graph.previousId = node.id
  graph.layer += 1
  return node
}

function addInactiveBranch(
  graph: GraphBuilder,
  decision: ExecutionGraphNode,
  input: { id: string; title: string; summary: string; edgeLabel: string },
): void {
  graph.nodes.push({
    id: input.id,
    layer: decision.layer + 1,
    lane: 1,
    kind: 'branch',
    status: 'inactive',
    title: input.title,
    summary: input.summary,
    primaryItems: [],
    badges: ['未执行'],
    details: [{ label: 'state', value: 'not_traversed' }],
  })
  graph.edges.push({
    id: `${decision.id}-${input.id}`,
    source: decision.id,
    target: input.id,
    label: input.edgeLabel,
    active: false,
    relation: 'inactive',
  })
}

function addDetachedNode(
  graph: GraphBuilder,
  input: Omit<ExecutionGraphNode, 'layer' | 'primaryItems'> & { primaryItems?: string[] },
): ExecutionGraphNode {
  const node: ExecutionGraphNode = {
    ...input,
    primaryItems: input.primaryItems ?? [],
    layer: graph.layer,
  }
  graph.nodes.push(node)
  return node
}

function addDirectEdge(
  graph: GraphBuilder,
  input: ExecutionGraphEdge,
): void {
  graph.edges.push(input)
}

function addBranchMerge(
  graph: GraphBuilder,
  input: {
    id: string
    title: string
    summary: string
    status: ExecutionGraphNodeStatus
    badges: string[]
    details: ExecutionGraphDetail[]
    branches: Array<{
      node: Omit<ExecutionGraphNode, 'layer' | 'primaryItems'> & { primaryItems?: string[] }
      forkLabel: string
      returnLabel: string
    }>
  },
): ExecutionGraphNode {
  const forkId = graph.previousId
  if (!forkId) throw new Error(`execution graph branch ${input.id} requires a main-process fork node`)
  const branchNodes = input.branches.map((branch) => addDetachedNode(graph, branch.node))
  for (const [index, branchNode] of branchNodes.entries()) {
    const branch = input.branches[index]
    if (!branch) continue
    addDirectEdge(graph, {
      id: `${forkId}-${branchNode.id}`,
      source: forkId,
      target: branchNode.id,
      label: branch.forkLabel,
      active: branchNode.status !== 'inactive',
      relation: branchNode.status === 'inactive' ? 'inactive' : 'fork',
    })
  }
  graph.layer += 1
  const mergeNode = addDetachedNode(graph, {
    id: input.id,
    lane: 0,
    kind: 'context',
    status: input.status,
    title: input.title,
    summary: input.summary,
    badges: input.badges,
    details: input.details,
  })
  for (const [index, branchNode] of branchNodes.entries()) {
    const branch = input.branches[index]
    if (!branch) continue
    addDirectEdge(graph, {
      id: `${branchNode.id}-${mergeNode.id}`,
      source: branchNode.id,
      target: mergeNode.id,
      label: branch.returnLabel,
      active: branchNode.status !== 'inactive',
      relation: branchNode.status === 'inactive' ? 'inactive' : 'return',
    })
  }
  graph.previousId = mergeNode.id
  graph.layer += 1
  return mergeNode
}

function normalizeProvenance(value: unknown): AgentExecutionProvenanceDto | null {
  const record = readRecord(value)
  if (
    record?.version !== 1 ||
    typeof record.executionId !== 'string' || !record.executionId.trim() ||
    !isOptionalString(record.agentId) ||
    !isOptionalString(record.parentAgentId) ||
    !isOptionalString(record.sessionId) ||
    typeof record.depth !== 'number' || !Number.isFinite(record.depth) ||
    typeof record.model !== 'string' || !record.model.trim() ||
    (record.apiStyle !== 'chat' && record.apiStyle !== 'responses') ||
    !isStringArray(record.requiredSkills) ||
    !isStringArray(record.loadedSkills) ||
    !(record.loadedSkillResources === undefined || (
      Array.isArray(record.loadedSkillResources) && record.loadedSkillResources.every(isLoadedSkillResource)
    )) ||
    !(record.loadedSkillSources === undefined || (
      Array.isArray(record.loadedSkillSources) && record.loadedSkillSources.every(isLoadedSkillSource)
    )) ||
    typeof record.startedAt !== 'string' || !record.startedAt.trim()
  ) return null
  return record as AgentExecutionProvenanceDto
}

export function readTraceExecutionProvenance(trace: AgentDiagnosticsTraceDto): AgentExecutionProvenanceDto | null {
  const meta = readRecord(trace.meta)
  const direct = normalizeProvenance(meta?.executionProvenance)
  if (direct) return direct
  const agentsRuntime = readRecord(meta?.agentsRuntime)
  const runtimeDirect = normalizeProvenance(agentsRuntime?.executionProvenance)
  if (runtimeDirect) return runtimeDirect
  const responseTrace = readRecord(meta?.responseTrace)
  const responseRuntime = readRecord(responseTrace?.runtime)
  return normalizeProvenance(responseRuntime?.executionProvenance)
}

function statusFromTool(record: Record<string, unknown>): ExecutionGraphNodeStatus {
  const status = readString(record, 'status')
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed' || status === 'denied' || status === 'blocked') return 'failed'
  if (status === 'started' || status === 'running') return 'running'
  return 'info'
}

function dependencyState(
  provenance: AgentExecutionProvenanceDto | null,
  state: 'historical' | 'live_pending',
): ExecutionGraphNodeStatus {
  if (provenance) return 'succeeded'
  return state === 'live_pending' ? 'running' : 'unavailable'
}

function addDependencyBranches(
  graph: GraphBuilder,
  provenance: AgentExecutionProvenanceDto | null,
  state: 'historical' | 'live_pending',
  fallbackSkillName = '',
  factualSkillNames: string[] = [],
): void {
  const skills = provenance
    ? Array.from(new Set([...provenance.requiredSkills, ...provenance.loadedSkills]))
    : Array.from(new Set([
        ...factualSkillNames.map((name) => name.trim()).filter(Boolean),
        ...(fallbackSkillName.trim() ? [fallbackSkillName.trim()] : []),
      ]))
  const skillResources = provenance?.loadedSkillResources ?? []
  const pending = state === 'live_pending' && !provenance
  const historicalSkillEvidence = state === 'historical' && !provenance && skills.length > 0
  const unavailableLabel = pending ? '等待结构化证据' : '历史不可追溯'
  const knowledgeStatus: ExecutionGraphNodeStatus = provenance
    ? skillResources.length > 0 ? 'succeeded' : 'info'
    : dependencyState(provenance, state)

  addBranchMerge(graph, {
    id: 'context-ready',
    title: '小T 上下文就绪',
    summary: provenance
      ? 'Skill 与运行时 Knowledge 来源已回到小T主进程'
      : pending
        ? '等待 Skill 与运行时 Knowledge 来源回传'
        : historicalSkillEvidence
          ? 'Skill 有结构化运行事实，引用来源与执行身份缺少完整 provenance'
          : '缺少历史 provenance，主进程仅展示可证实事实',
    status: provenance ? 'succeeded' : historicalSkillEvidence ? 'warning' : dependencyState(provenance, state),
    badges: [provenance ? 'evidence_ready' : historicalSkillEvidence ? 'partial_evidence' : pending ? 'live_pending' : 'legacy_unavailable'],
    details: provenance
      ? [
          { label: 'model', value: provenance.model },
          { label: 'apiStyle', value: provenance.apiStyle },
          { label: 'executionId', value: provenance.executionId },
          { label: 'agent / parent', value: `${provenance.agentId ?? 'root'} / ${provenance.parentAgentId ?? 'none'}` },
        ]
      : [{ label: 'provenance', value: historicalSkillEvidence ? 'partial_runtime_evidence' : pending ? 'live_pending' : 'legacy_unavailable' }],
    branches: [
      {
        node: {
          id: 'skill-dependency',
          lane: -1,
          kind: 'skill',
          status: provenance || historicalSkillEvidence
            ? 'succeeded'
            : skills.length > 0 ? 'running' : dependencyState(provenance, state),
          title: skills.length > 0
            ? `Skill · ${skills.join(' · ')}`
            : `Skill · ${unavailableLabel}`,
          summary: provenance
            ? `${skills.length} 个 Skill 有运行时装配证据`
            : skills.length > 0
              ? historicalSkillEvidence
                ? `${skills.length} 个 Skill 有历史 runtime/成功调用事实，缺少执行哈希`
                : '已收到本轮显式 Skill，等待最终 provenance'
              : unavailableLabel,
          primaryItems: skills.length > 0 ? skills : [unavailableLabel],
          badges: provenance ? ['已加载'] : historicalSkillEvidence ? ['历史运行事实'] : [pending ? '等待回传' : '无证据'],
          details: provenance
            ? [
                { label: 'requiredSkills', value: provenance.requiredSkills.join('\n') || 'none' },
                { label: 'loadedSkills', value: provenance.loadedSkills.join('\n') || 'none' },
              ]
            : [{ label: 'source', value: historicalSkillEvidence ? 'agentsRuntime.loadedSkills / succeeded Skill calls' : skills.length > 0 ? 'explicit live run skillName' : unavailableLabel }],
        },
        forkLabel: '加载 Skill',
        returnLabel: provenance ? 'Skill 已加载' : 'Skill 状态回传',
      },
      {
        node: {
          id: 'knowledge-dependency',
          lane: 1,
          kind: 'domain',
          status: knowledgeStatus,
          title: skillResources.length > 0
            ? `Knowledge 引用 · ${skillResources.length}`
            : `Knowledge 引用 · ${provenance ? '本轮未读取额外文档' : unavailableLabel}`,
          summary: provenance
            ? skillResources.length > 0
              ? `${skillResources.length} 个 Skill 文档引用有精确运行证据`
              : '本轮只加载了 Skill 入口，没有读取额外参考文档'
            : unavailableLabel,
          primaryItems: skillResources.length > 0
            ? skillResources.map((resource) => `${resource.skill} / ${resource.resource}${resource.contentHash ? ` · ${resource.contentHash.slice(0, 19)}…` : ' · hash unavailable'}`)
            : [provenance ? '无额外文档读取' : unavailableLabel],
          badges: provenance
            ? [skillResources.length > 0 ? '引用已记录' : '无额外引用']
            : [pending ? '等待回传' : '无证据'],
          details: provenance
            ? [
                { label: 'executionId', value: provenance.executionId },
                { label: 'loadedSkillResources', value: skillResources.length > 0
                  ? skillResources.map((resource) => [
                      `apps/agents-cli/skills/${resource.skill}/${resource.resource}`,
                      `contentHash=${resource.contentHash ?? 'unavailable'}`,
                      `contentChars=${resource.contentChars ?? 'unavailable'}`,
                    ].join(' · ')).join('\n')
                  : 'none' },
              ]
            : [{ label: 'source', value: unavailableLabel }],
        },
        forkLabel: '读取 Skill 引用',
        returnLabel: provenance ? '引用证据已回传' : 'Knowledge 状态回传',
      },
    ],
  })
}

function readHistoricalSkillEvidence(
  meta: Record<string, unknown>,
  toolCalls: Array<Record<string, unknown>>,
): string[] {
  const runtime = readRecord(meta.agentsRuntime)
  const requestContext = readRecord(meta.requestContext)
  const names = new Set([
    ...readStringArray(runtime, 'loadedSkills'),
    ...readStringArray(requestContext, 'loadedSkills'),
  ])
  toolCalls.forEach((call) => {
    if (readString(call, 'name') !== 'Skill' || readString(call, 'status') !== 'succeeded') return
    const skillName = readString(readRecord(call.input), 'skill')
    if (skillName) names.add(skillName)
  })
  return [...names]
}

function addSubagentBranch(
  graph: GraphBuilder,
  input: {
    id: string
    role: string
    roleName?: string
    status: ExecutionGraphNodeStatus
    summary: string
    details: ExecutionGraphDetail[]
    primaryItems?: string[]
  },
): void {
  const displayRole = input.roleName?.trim() || input.role.trim()
  const isTerminal = input.status === 'succeeded' || input.status === 'failed'
  addBranchMerge(graph, {
    id: `${input.id}-return`,
    title: isTerminal ? '小T 接收角色结果' : '小T 接收角色状态',
    summary: isTerminal
      ? `${displayRole} 的执行结果已回到小T主进程`
      : `${displayRole} 的实时状态已回到小T主进程`,
    status: input.status,
    badges: ['角色回传'],
    details: [{ label: 'role', value: input.role }, ...input.details],
    branches: [{
      node: {
        id: input.id,
        lane: 1,
        kind: 'subagent',
        status: input.status,
        title: `角色 · ${displayRole}`,
        summary: input.summary,
        primaryItems: [displayRole, ...(input.primaryItems ?? [])],
        badges: [input.role],
        details: input.details,
      },
      forkLabel: `调用 ${displayRole}`,
      returnLabel: input.status === 'failed'
        ? '失败事实回传'
        : input.status === 'succeeded'
          ? '角色结果回传'
          : '角色状态回传',
    }],
  })
}

function semanticIntentNode(graph: GraphBuilder, meta: Record<string, unknown>): void {
  const semanticIntent = readRecord(meta.semanticExecutionIntent)
  if (!semanticIntent) return
  const requiresExecution = readBoolean(semanticIntent, 'requiresExecutionDelivery') === true
  const decision = addNode(graph, {
    id: 'semantic-intent',
    kind: 'decision',
    status: 'succeeded',
    title: '语义交付匹配',
    summary: readString(semanticIntent, 'taskKind') || '已形成结构化语义结论',
    badges: [requiresExecution ? 'execute' : 'answer'],
    details: detailsFromRecord(semanticIntent),
  })
  const actual = addNode(graph, {
    id: 'semantic-route',
    kind: 'plan',
    status: 'succeeded',
    title: requiresExecution ? '进入执行路径' : '进入回答路径',
    summary: requiresExecution ? 'requiresExecutionDelivery = true' : 'requiresExecutionDelivery = false',
    badges: [requiresExecution ? 'IF' : 'ELSE'],
    details: [{ label: 'matchedBranch', value: requiresExecution ? 'execute' : 'answer' }],
    edgeLabel: requiresExecution ? 'if execute' : 'else answer',
  })
  addInactiveBranch(graph, decision, {
    id: 'semantic-inactive-branch',
    title: requiresExecution ? '回答分支' : '执行分支',
    summary: '本轮未走该分支',
    edgeLabel: requiresExecution ? 'else answer' : 'if execute',
  })
  graph.previousId = actual.id
}

function asyncArtifactStatus(status: string): ExecutionGraphNodeStatus {
  if (status === 'ready') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'pending') return 'running'
  if (status === 'stale') return 'warning'
  return 'unavailable'
}

function productionRunStatus(run: Record<string, unknown>): ExecutionGraphNodeStatus {
  if (readString(run, 'errorMessage') || readString(run, 'authoringState') === 'authoring_failed') return 'failed'
  if (readString(run, 'completedAt') || readString(run, 'state') === 'completed') return 'succeeded'
  return 'running'
}

function boundedWorkflowNodeStatus(status: VideoProductionWorkflowNodeStatus): ExecutionGraphNodeStatus {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'running') return 'running'
  if (status === 'waiting_external' || status === 'partial') return 'warning'
  return 'inactive'
}

function buildBoundedProductionGraph(
  trace: AgentDiagnosticsTraceDto,
  meta: Record<string, unknown>,
  observedAtMs: number,
): ExecutionGraphProjection | null {
  const runs = Array.isArray(meta.asyncExecutionRuns)
    ? meta.asyncExecutionRuns.map(readRecord).filter((run): run is Record<string, unknown> => Boolean(run))
    : []
  const run = runs.find((candidate) => {
    const workflow = readRecord(candidate.workflow)
    return readString(workflow, 'workflowKey') === VIDEO_PRODUCTION_WORKFLOW_KEY
  })
  if (!run) return null
  const workflow = readRecord(run.workflow)
  if (!workflow) return null
  const artifacts = Array.isArray(run.artifacts)
    ? run.artifacts.map(readRecord).filter((artifact): artifact is Record<string, unknown> => Boolean(artifact))
    : []
  const promptAssemblies = artifacts
    .map((artifact) => readPromptAssembly(artifact.promptAssembly))
    .filter((assembly): assembly is NonNullable<ReturnType<typeof readPromptAssembly>> => Boolean(assembly))
    .sort((left, right) => left.clipIndex - right.clipIndex)
  const knowledgeReceipt = buildRuntimeKnowledgeReceipt({
    provenance: readTraceExecutionProvenance(trace),
    promptAssemblies,
  })
  const projections = Array.isArray(workflow.nodes)
    ? workflow.nodes.map(readRecord).filter((node): node is Record<string, unknown> => Boolean(node))
    : []
  const projectionById = new Map(projections.map((projection) => [readString(projection, 'workflowNodeId'), projection]))
  const workflowRunId = readString(workflow, 'workflowRunId') || readString(run, 'runId')
  const latestEventSeq = readNumber(workflow, 'latestEventSeq') ?? 0
  const nodes: ExecutionGraphNode[] = VIDEO_PRODUCTION_WORKFLOW_DEFINITION.nodes.map((definition, index) => {
    const projection = projectionById.get(definition.nodeId) ?? null
    const rawStatus = readString(projection, 'status') as VideoProductionWorkflowNodeStatus
    const totalUnits = readNumber(projection, 'totalUnits')
    const completedUnits = readNumber(projection, 'completedUnits') ?? 0
    const effectIds = readStringArray(projection, 'effectIds')
    const outputArtifactIds = readStringArray(projection, 'outputArtifactIds')
    const inputArtifactIds = readStringArray(projection, 'inputArtifactIds')
    const errorCount = readNumber(projection, 'errorCount') ?? 0
    const timing = readRecord(projection?.timing)
    const nodeTiming = createExecutionTiming({
      startedAt: readString(timing, 'startedAt'),
      updatedAt: readString(timing, 'updatedAt'),
      finishedAt: readString(timing, 'finishedAt'),
      live: rawStatus === 'running' || rawStatus === 'waiting_external' || rawStatus === 'partial',
      observedAtMs,
    })
    return {
      id: definition.nodeId,
      layer: index,
      lane: 0,
      kind: definition.kind === 'contract'
        ? 'entry'
        : definition.kind === 'delivery'
          ? 'verification'
          : definition.kind === 'authoring'
            ? 'subagent'
            : definition.kind === 'media'
              ? 'tool'
              : 'plan',
      status: boundedWorkflowNodeStatus(rawStatus || 'queued'),
      title: definition.label,
      summary: totalUnits === null
        ? `${completedUnits} 项事实已完成`
        : `${completedUnits}/${totalUnits} 项事实已完成`,
      primaryItems: [
        `产物 ${outputArtifactIds.length}`,
        `副作用 ${effectIds.length}`,
        `错误 ${errorCount}`,
        ...(definition.nodeId === 'clip-contracts' && promptAssemblies.length > 0
          ? [`提示词 ${promptAssemblies.length}`]
          : []),
      ],
      badges: [rawStatus || 'queued'],
      timing: nodeTiming,
      ...(definition.nodeId === 'clip-contracts' && promptAssemblies.length > 0
        ? { promptAssemblies }
        : {}),
      details: [
        { label: 'workflowRunId', value: workflowRunId },
        { label: 'workflowNodeId', value: definition.nodeId },
        { label: 'status', value: rawStatus || 'queued' },
        { label: 'progress', value: totalUnits === null ? String(completedUnits) : `${completedUnits}/${totalUnits}` },
        { label: 'inputArtifacts', value: inputArtifactIds.length ? inputArtifactIds.join('\n') : '无' },
        { label: 'outputArtifacts', value: outputArtifactIds.length ? outputArtifactIds.join('\n') : '无' },
        { label: 'effects', value: effectIds.length ? effectIds.join('\n') : '无' },
        { label: 'errorCount', value: String(errorCount) },
        { label: 'startedAt', value: nodeTiming?.startedAt || '尚未开始' },
        { label: 'updatedAt', value: nodeTiming?.updatedAt || '尚无进度' },
        { label: 'finishedAt', value: nodeTiming?.finishedAt || '尚未结束' },
        { label: 'durationMs', value: nodeTiming?.elapsedMs === null || nodeTiming?.elapsedMs === undefined ? '尚未记录' : String(nodeTiming.elapsedMs) },
        { label: 'latestEventSeq', value: String(readNumber(projection, 'latestEventSeq') ?? 0) },
      ],
    }
  })
  const edges: ExecutionGraphEdge[] = VIDEO_PRODUCTION_WORKFLOW_DEFINITION.edges.map((edge) => ({
    id: edge.edgeId,
    source: edge.source,
    target: edge.target,
    label: '',
    active: boundedWorkflowNodeStatus(readString(projectionById.get(edge.target) ?? null, 'status') as VideoProductionWorkflowNodeStatus) !== 'inactive',
    relation: 'main',
  }))
  const statuses = nodes.map((node) => node.status)
  const status: ExecutionGraphNodeStatus = statuses.includes('failed')
    ? 'failed'
    : statuses.includes('running') || statuses.includes('warning')
      ? 'running'
      : statuses.every((nodeStatus) => nodeStatus === 'succeeded')
        ? 'succeeded'
        : 'info'
  return {
    id: workflowRunId || trace.id,
    executionTraceId: trace.id,
    title: `一键成片 · ${workflowRunId || trace.requestKind}`,
    status,
    provenanceState: 'complete',
    nodes,
    edges,
    knowledgeSourceCount: knowledgeReceipt?.sources.length ?? 0,
    skillCount: knowledgeReceipt?.sources.filter((source) => source.kind === 'skill').length ?? 0,
    activePathNodeCount: nodes.filter((node) => node.status !== 'inactive').length,
    layout: 'bounded_workflow',
    ...(knowledgeReceipt ? { knowledgeReceipt } : {}),
    timing: createExecutionTiming({
      startedAt: readString(run, 'createdAt'),
      updatedAt: readString(run, 'updatedAt'),
      finishedAt: readString(run, 'completedAt'),
      live: status === 'running',
      observedAtMs,
    }),
  }
}

function addAsyncExecutionRuns(graph: GraphBuilder, meta: Record<string, unknown>): void {
  const runs = Array.isArray(meta.asyncExecutionRuns) ? meta.asyncExecutionRuns : []
  runs.forEach((value, runIndex) => {
    const run = readRecord(value)
    if (!run) return
    const artifacts = Array.isArray(run.artifacts)
      ? run.artifacts.map(readRecord).filter((artifact): artifact is Record<string, unknown> => Boolean(artifact))
      : []
    const writers = artifacts.filter((artifact) => {
      const key = readString(artifact, 'artifactKey')
      return key.startsWith('clip:') && Boolean(readString(artifact, 'agentId') || readRecord(artifact.executionProvenance))
    })
    if (writers.length > 0) {
      const allReady = writers.every((artifact) => readString(artifact, 'status') === 'ready')
      const anyFailed = writers.some((artifact) => readString(artifact, 'status') === 'failed')
      addBranchMerge(graph, {
        id: `async-writer-join-${runIndex}`,
        title: 'Writer 汇合门禁',
        summary: `${writers.filter((artifact) => readString(artifact, 'status') === 'ready').length}/${writers.length} writer ready`,
        status: anyFailed ? 'failed' : allReady ? 'succeeded' : 'running',
        badges: [readString(run, 'authoringState') || 'authoring'],
        details: [
          { label: 'runId', value: readString(run, 'runId') },
          { label: 'authoringState', value: readString(run, 'authoringState') || 'unavailable' },
        ],
        branches: writers.map((artifact, index) => {
          const provenance = readRecord(artifact.executionProvenance)
          const dramaticCoverage = readRecord(artifact.dramaticCoverage)
          const artifactKey = readString(artifact, 'artifactKey')
          return {
            node: {
              id: `async-writer-${runIndex}-${index}`,
              lane: index % 2 === 0 ? -1 : 1,
              kind: 'subagent',
              status: asyncArtifactStatus(readString(artifact, 'status')),
              title: `video-prompt-writer · ${artifactKey}`,
              summary: readString(artifact, 'error') || `持久化状态：${readString(artifact, 'status') || 'unknown'}`,
              badges: [readString(artifact, 'status') || 'unknown'],
              details: [
                { label: 'artifactKey', value: artifactKey },
                { label: 'clipIndex', value: String(readNumber(artifact, 'clipIndex') ?? 'unavailable') },
                { label: 'sourceHash', value: readString(artifact, 'sourceHash') || 'unavailable' },
                { label: 'outputHash', value: readString(artifact, 'outputHash') || 'unavailable' },
                {
                  label: 'dramaticCoverage',
                  value: dramaticCoverage ? JSON.stringify(dramaticCoverage) : 'unavailable',
                },
                { label: 'agentId', value: readString(artifact, 'agentId') || readString(provenance, 'agentId') || 'unavailable' },
                { label: 'executionId', value: readString(provenance, 'executionId') || 'unavailable' },
                { label: 'model', value: readString(provenance, 'model') || 'unavailable' },
                { label: 'startedAt', value: readString(provenance, 'startedAt') || readString(artifact, 'dispatchedAt') || 'unavailable' },
                { label: 'finishedAt', value: readString(artifact, 'updatedAt') || 'unavailable' },
              ],
              primaryItems: [
                `agentId · ${readString(artifact, 'agentId') || readString(provenance, 'agentId') || 'unavailable'}`,
                `executionId · ${readString(provenance, 'executionId') || 'unavailable'}`,
                `sourceHash · ${readString(artifact, 'sourceHash') || 'unavailable'}`,
                `outputHash · ${readString(artifact, 'outputHash') || 'unavailable'}`,
                `戏剧承载 · ${dramaticCoverage ? '逐镜可追溯' : 'unavailable'}`,
              ],
            },
            forkLabel: artifactKey,
            returnLabel: readString(artifact, 'status') || 'unknown',
          }
        }),
      })
    }
    const status = productionRunStatus(run)
    addNode(graph, {
      id: `async-production-${runIndex}`,
      kind: 'result',
      status,
      title: '异步生产 Run',
      summary: status === 'succeeded'
        ? '生产已完成'
        : status === 'failed'
          ? readString(run, 'errorMessage') || '生产失败'
          : `${readNumber(run, 'clipsDone') ?? 0}/${readNumber(run, 'totalClips') ?? 0} clips completed`,
      badges: [readString(run, 'state') || 'unknown', readString(run, 'authoringState') || 'authoring unavailable'],
      details: detailsFromRecord(run),
    })
  })
}

export function buildTraceExecutionGraph(trace: AgentDiagnosticsTraceDto, observedAtMs = Date.now()): ExecutionGraph {
  const meta = readRecord(trace.meta) ?? {}
  const boundedProductionGraph = buildBoundedProductionGraph(trace, meta, observedAtMs)
  if (boundedProductionGraph) {
    return {
      ...boundedProductionGraph,
      diagnosis: buildHistoricalExecutionDiagnosis(trace, boundedProductionGraph),
    }
  }
  const provenance = readTraceExecutionProvenance(trace)
  const responseTrace = readRecord(meta.responseTrace)
  const requestContext = readRecord(meta.requestContext)
  const turns = Array.isArray(responseTrace?.turns) ? responseTrace.turns : []
  const toolCalls = Array.isArray(trace.toolCalls) ? trace.toolCalls : []
  const historicalSkillEvidence = provenance ? [] : readHistoricalSkillEvidence(meta, toolCalls)
  const expectedDelivery = readRecord(meta.expectedDelivery)
  const deliveryVerification = readRecord(meta.deliveryVerification)
  const turnVerdict = readRecord(meta.turnVerdict)
  const terminal = readRecord(meta.requestTerminal)
  const asyncRuns = Array.isArray(meta.asyncExecutionRuns)
    ? meta.asyncExecutionRuns.map(readRecord).filter((run): run is Record<string, unknown> => Boolean(run))
    : []
  const asyncStatuses = asyncRuns.map(productionRunStatus)
  const effectiveAsyncStatus = asyncStatuses.some((status) => status === 'failed')
    ? 'failed'
    : asyncStatuses.some((status) => status === 'running')
      ? 'accepted_async'
      : asyncStatuses.length > 0 && asyncStatuses.every((status) => status === 'succeeded')
        ? 'succeeded'
        : ''
  const finalStatus = effectiveAsyncStatus || readString(terminal, 'status') || readString(turnVerdict, 'status')
  const finalReason = effectiveAsyncStatus === 'accepted_async'
    ? 'async_execution_accepted_not_completed'
    : effectiveAsyncStatus === 'failed'
      ? 'async_execution_failed'
      : effectiveAsyncStatus === 'succeeded'
      ? 'async_execution_completed'
      : readString(terminal, 'reason') || readString(turnVerdict, 'status')
  const resultStatus: ExecutionGraphNodeStatus = finalStatus === 'succeeded' || finalStatus === 'satisfied'
    ? 'succeeded'
    : finalStatus === 'needs_input' || finalStatus === 'suspended' || finalStatus === 'accepted_async'
      ? 'warning'
      : finalStatus === 'failed'
        ? 'failed'
        : trace.status === 'running' || trace.status === 'waiting_async'
          ? 'running'
          : 'unavailable'
  const failedToolCount = toolCalls.filter((call) => statusFromTool(call) === 'failed').length
  const requestedAgentTypes = Array.from(new Set(toolCalls
    .map((call) => readString(call, 'requestedAgentType'))
    .filter(Boolean)))
  const toolItems = toolCalls.slice(-5).map((call) => {
    const name = readString(call, 'name') || 'tool'
    const input = readRecord(call.input) ?? readRecord(call.inputJson) ?? readRecord(call.args)
    return `${readString(call, 'status') || 'unknown'} · ${toolCapabilityLabel(name, input)}`
  })
  const artifacts = asyncRuns.flatMap((run) => Array.isArray(run.artifacts) ? run.artifacts : [])
  const verificationStatus = readString(deliveryVerification, 'status')
  const verificationNodeStatus: ExecutionGraphNodeStatus = verificationStatus === 'satisfied'
    ? 'succeeded'
    : verificationStatus === 'unsatisfied'
      ? finalStatus === 'failed'
        ? 'failed'
        : 'warning'
      : deliveryVerification
        ? 'info'
      : readBoolean(expectedDelivery, 'active') === false
        ? 'info'
        : 'unavailable'

  const nodes: ExecutionGraphNode[] = [
    {
      id: 'history-request', layer: 0, lane: 0, kind: 'entry',
      status: trace.errorCode || trace.errorDetail ? 'failed' : 'succeeded',
      title: '请求受理', summary: compact(trace.inputSummary) || trace.requestKind,
      primaryItems: [trace.requestKind, `${trace.scopeType}:${trace.scopeId}`],
      badges: [trace.scopeType],
      details: [
        { label: 'traceId', value: trace.id },
        { label: 'taskId', value: trace.taskId || '无' },
        { label: 'createdAt', value: trace.createdAt },
        { label: 'inputSummary', value: trace.inputSummary },
      ],
    },
    {
      id: 'history-context', layer: 1, lane: 0, kind: 'context',
      status: requestContext || provenance ? 'succeeded' : 'unavailable',
      title: '真实上下文',
      summary: provenance ? '结构化 provenance 完整' : historicalSkillEvidence.length > 0 ? '仅保留历史 Skill 事实' : '历史上下文不可追溯',
      primaryItems: provenance
        ? [`skills ${new Set([...provenance.requiredSkills, ...provenance.loadedSkills]).size}`, `references ${(provenance.loadedSkillResources ?? []).length}`]
        : [`skills ${historicalSkillEvidence.length}`, 'references 0'],
      badges: [provenance ? 'complete' : historicalSkillEvidence.length > 0 ? 'partial' : 'unavailable'],
      details: [
        { label: 'requestContext', value: stableStringify(requestContext ?? '历史不可追溯') },
        { label: 'executionProvenance', value: stableStringify(provenance ?? '历史不可追溯') },
        { label: 'historicalSkills', value: historicalSkillEvidence.join('\n') || '无' },
      ],
    },
    {
      id: 'history-plan', layer: 2, lane: 0, kind: 'plan',
      status: turns.length > 0 || readRecord(meta.semanticExecutionIntent) ? 'succeeded' : 'unavailable',
      title: 'Agent 规划', summary: `${turns.length} 个 Agent turn 已聚合`,
      primaryItems: turns.slice(-3).map((value, index) => {
        const turn = readRecord(value)
        return compact(readString(turn, 'textPreview')) || `Turn ${readNumber(turn, 'turn') ?? Math.max(1, turns.length - 2 + index)}`
      }),
      badges: [`turns ${turns.length}`],
      details: [
        { label: 'semanticExecutionIntent', value: stableStringify(readRecord(meta.semanticExecutionIntent) ?? '未记录') },
        { label: 'turns', value: stableStringify(turns) },
      ],
    },
    {
      id: 'history-execution', layer: 3, lane: 0, kind: 'tool',
      status: failedToolCount > 0 ? 'failed' : toolCalls.length > 0 ? 'succeeded' : 'info',
      title: '动作执行', summary: `${toolCalls.length} 次工具调用 · ${requestedAgentTypes.length} 类委派`,
      primaryItems: toolItems,
      badges: [`tools ${toolCalls.length}`, `failed ${failedToolCount}`],
      details: [
        { label: 'requestedAgentTypes', value: requestedAgentTypes.join('\n') || '无' },
        { label: 'toolCalls', value: stableStringify(toolCalls) },
      ],
    },
    {
      id: 'history-evidence', layer: 4, lane: 0, kind: 'verification',
      status: effectiveAsyncStatus === 'failed'
        ? 'failed'
        : effectiveAsyncStatus === 'accepted_async'
          ? 'warning'
          : asyncRuns.length > 0 || toolCalls.length > 0
            ? 'succeeded'
            : 'unavailable',
      title: '事实收证', summary: `${asyncRuns.length} 个异步 run · ${artifacts.length} 项资产事实`,
      primaryItems: asyncRuns.slice(-3).map((run) => `${readString(run, 'state') || 'unknown'} · ${readString(run, 'runId') || 'runId unavailable'}`),
      badges: [`runs ${asyncRuns.length}`, `artifacts ${artifacts.length}`],
      details: [{ label: 'asyncExecutionRuns', value: stableStringify(asyncRuns) }],
    },
    {
      id: 'history-verification', layer: 5, lane: 0, kind: 'verification',
      status: verificationNodeStatus,
      title: '交付验收', summary: readString(deliveryVerification, 'summary') || verificationStatus || '历史验收证据不可用',
      primaryItems: [readString(expectedDelivery, 'kind'), verificationStatus].filter(Boolean),
      badges: [verificationStatus || (readBoolean(expectedDelivery, 'active') === false ? 'not_applicable' : 'unavailable')],
      details: [
        { label: 'expectedDelivery', value: stableStringify(expectedDelivery ?? '未记录') },
        { label: 'deliveryVerification', value: stableStringify(deliveryVerification ?? '未记录') },
      ],
    },
    {
      id: 'history-result', layer: 6, lane: 0, kind: 'result', status: resultStatus,
      title: '终态交付', summary: finalReason || trace.resultSummary || '终态未记录',
      primaryItems: trace.resultSummary ? [compact(trace.resultSummary)] : [],
      badges: [finalStatus || 'unavailable'],
      details: [
        { label: 'turnVerdict', value: stableStringify(turnVerdict ?? '未记录') },
        { label: 'requestTerminal', value: stableStringify(terminal ?? '未记录') },
        { label: 'resultSummary', value: trace.resultSummary || '无' },
        { label: 'errorCode', value: trace.errorCode || '无' },
        { label: 'errorDetail', value: trace.errorDetail || '无' },
      ],
    },
  ]
  const edges: ExecutionGraphEdge[] = nodes.slice(1).map((node, index) => ({
    id: `history-edge-${index}`,
    source: nodes[index].id,
    target: node.id,
    label: '',
    active: node.status !== 'inactive',
    relation: 'main',
  }))

  const knowledgeReceipt = buildRuntimeKnowledgeReceipt({ provenance, promptAssemblies: [] })
  const skills = provenance
    ? new Set([...provenance.requiredSkills, ...provenance.loadedSkills])
    : new Set(historicalSkillEvidence)
  const graph: ExecutionGraphProjection = {
    id: trace.id,
    executionTraceId: trace.id,
    title: trace.requestKind,
    status: resultStatus,
    provenanceState: provenance ? 'complete' : historicalSkillEvidence.length > 0 ? 'partial' : 'legacy_unavailable',
    nodes,
    edges,
    knowledgeSourceCount: knowledgeReceipt?.sources.length ?? 0,
    skillCount: skills.size,
    activePathNodeCount: nodes.filter((node) => node.status !== 'inactive').length,
    layout: 'bounded_workflow',
    ...(knowledgeReceipt ? { knowledgeReceipt } : {}),
    timing: createExecutionTiming({
      startedAt: provenance?.startedAt || trace.createdAt,
      updatedAt: trace.createdAt,
      finishedAt: trace.createdAt,
      live: false,
      observedAtMs,
    }),
  }
  return {
    ...graph,
    diagnosis: buildHistoricalExecutionDiagnosis(trace, graph),
  }
}

const LIVE_EXECUTION_STAGES = [
  { id: 'live-request', kind: 'entry' as const, title: '请求受理' },
  { id: 'live-context', kind: 'context' as const, title: '真实上下文' },
  { id: 'live-plan', kind: 'plan' as const, title: 'Agent 规划' },
  { id: 'live-execution', kind: 'tool' as const, title: '动作执行' },
  { id: 'live-evidence', kind: 'verification' as const, title: '事实收证' },
  { id: 'live-verification', kind: 'verification' as const, title: '交付验收' },
  { id: 'live-result', kind: 'result' as const, title: '终态交付' },
] as const

function liveRunStatus(run: LiveChatRunRecord): ExecutionGraphNodeStatus {
  if (run.status === 'active') return 'running'
  if (run.status === 'succeeded') return 'succeeded'
  if (run.status === 'cancelled') return 'cancelled'
  if (run.status === 'waiting_input' || run.status === 'waiting_external') return 'warning'
  return 'failed'
}

function latestLiveLogLines(run: LiveChatRunRecord, event: string, limit = 8): string[] {
  return run.logs
    .filter((log) => log.event === event)
    .slice(-limit)
    .map((log) => `${new Date(log.at).toLocaleTimeString('zh-CN')} · ${log.title}${log.reason ? ` · ${log.reason}` : ''}`)
}

export function buildLiveExecutionGraph(run: LiveChatRunRecord, observedAtMs = Date.now()): ExecutionGraph {
  const terminalStatus = liveRunStatus(run)
  const terminal = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled'
  const toolLogs = run.logs.filter((log) => log.toolActivity)
  const roleLogs = run.logs.filter((log) => log.roleActivity)
  const failureLogs = run.logs.filter((log) => log.tone === 'error' || log.event === 'error')
  const warningLogs = run.logs.filter((log) => log.tone === 'warn')
  const toolInvocations = buildToolInvocations(run.logs)
  const executionTiming = roleLogs.length > 0
    ? timingFromTimestamps([
        ...toolInvocations.flatMap((invocation) => [invocation.startedAt, invocation.finishedAt]),
        ...roleLogs.map((log) => log.roleActivity?.at),
      ], {
        live: !terminal,
        observedAtMs,
      })
    : timingFromTimestamps(
        toolInvocations.flatMap((invocation) => [invocation.startedAt, invocation.finishedAt]),
        { live: !terminal && toolInvocations.length > 0, observedAtMs },
      )
  const planLogTimes = run.logs
    .filter((log) => log.event === 'thinking' || log.event === 'todo_list')
    .map((log) => log.at)
  const planningTiming = timingFromTimestamps(planLogTimes, {
    live: !terminal && toolInvocations.length === 0,
    observedAtMs,
  })
  const firstObservedLogAt = run.logs.length > 0 ? Math.min(...run.logs.map((log) => log.at)) : run.startedAt
  const activeToolCount = toolInvocations.filter((invocation) => invocation.status === 'running').length
  const failedToolCount = toolInvocations.filter((invocation) => (
    invocation.status === 'failed' || invocation.status === 'blocked' || invocation.status === 'denied'
  )).length
  const asyncArtifacts = run.asyncArtifacts ?? []
  const settledArtifacts = asyncArtifacts.filter((artifact) => artifact.status === 'succeeded')
  const acceptedArtifacts = asyncArtifacts.filter((artifact) => artifact.status !== 'failed')
  const hasActionIssue = failedToolCount > 0 || failureLogs.length > 0 || warningLogs.length > 0
  const actionStatus: ExecutionGraphNodeStatus = terminal && terminalStatus === 'failed'
    ? 'failed'
    : hasActionIssue
      ? 'warning'
      : terminal
        ? toolInvocations.length > 0 || roleLogs.length > 0 ? 'succeeded' : 'info'
        : toolLogs.length > 0 || roleLogs.length > 0
          ? 'running'
          : 'inactive'
  const evidenceStatus: ExecutionGraphNodeStatus = terminal
    ? terminalStatus
    : acceptedArtifacts.length > 0 || run.assetCount > 0
      ? 'warning'
      : 'inactive'
  const nodes: ExecutionGraphNode[] = LIVE_EXECUTION_STAGES.map((stage, index) => {
    if (stage.id === 'live-request') {
      return {
        ...stage,
        layer: index,
        lane: 0,
        status: 'succeeded',
        summary: compact(run.displayText || run.requestText) || '请求已进入 agents-cli',
        primaryItems: [`日志 ${run.logs.length}`, run.workflowKey ? `workflow · ${run.workflowKey}` : '通用 agent run'],
        badges: ['accepted'],
        timing: createExecutionTiming({
          startedAt: run.startedAt,
          updatedAt: firstObservedLogAt,
          finishedAt: firstObservedLogAt,
          live: false,
          observedAtMs,
        }),
        details: [
          { label: 'runId', value: run.runId },
          { label: 'requestId', value: run.requestId || 'pending' },
          { label: 'sessionId', value: run.sessionId || 'pending' },
          { label: 'workflowKey', value: run.workflowKey || '未声明结构化工作流' },
        ],
      }
    }
    if (stage.id === 'live-context') {
      return {
        ...stage,
        layer: index,
        lane: 0,
        status: run.executionProvenance ? 'succeeded' : terminal ? 'unavailable' : 'running',
        summary: run.executionProvenance ? '执行 provenance 已回传' : '等待结构化上下文 provenance',
        primaryItems: [run.projectName || run.projectId || '无项目作用域', run.flowId || '无画布作用域'],
        badges: [run.executionProvenance ? 'evidence_ready' : 'live_pending'],
        details: [
          { label: 'projectId', value: run.projectId || 'none' },
          { label: 'flowId', value: run.flowId || 'none' },
          { label: 'sessionKey', value: run.sessionKey || 'none' },
          { label: 'provenance', value: run.executionProvenance ? 'complete' : 'pending' },
        ],
      }
    }
    if (stage.id === 'live-plan') {
      const planningLines = latestLiveLogLines(run, 'thinking')
      return {
        ...stage,
        layer: index,
        lane: 0,
        status: terminal ? terminalStatus : 'running',
        summary: run.todoItems.length > 0 ? `${run.todoItems.filter((item) => item.completed).length}/${run.todoItems.length} Todo 完成` : 'Agent 正在依据合同规划',
        primaryItems: run.todoItems.slice(0, 3).map((item) => `${item.status} · ${item.text}`),
        badges: [`todo ${run.todoItems.length}`],
        timing: planningTiming,
        details: [
          { label: 'todo', value: run.todoItems.map((item) => `[${item.status}] ${item.text}`).join('\n') || '无 Todo 事件' },
          { label: 'recentThinking', value: planningLines.join('\n') || '无 thinking 事件' },
        ],
      }
    }
    if (stage.id === 'live-execution') {
      const latestTools = latestLiveLogLines(run, 'tool')
      const latestRoles = latestLiveLogLines(run, 'agent_role')
      return {
        ...stage,
        layer: index,
        lane: 0,
        status: actionStatus,
        summary: `${toolInvocations.length} 次调用 · ${failedToolCount} 次局部失败 · ${activeToolCount} 次执行中`,
        primaryItems: [...latestTools.slice(-2), ...latestRoles.slice(-1)],
        badges: [`调用 ${toolInvocations.length}`, `失败 ${failedToolCount}`, `委派 ${roleLogs.length}`],
        timing: executionTiming,
        details: [
          { label: '工具调用', value: `${toolInvocations.length} 次` },
          { label: '局部失败', value: `${failedToolCount} 次` },
          { label: '仍在执行', value: `${activeToolCount} 次` },
          { label: '子 Agent 委派', value: roleLogs.length > 0 ? `${roleLogs.length} 条事件` : '本节点未委派子 Agent' },
          { label: '警告记录', value: `${warningLogs.length} 条` },
          { label: '错误记录', value: `${failureLogs.length} 条` },
        ],
        diagnostics: buildLiveToolDiagnostics(run, terminalStatus, actionStatus),
      }
    }
    if (stage.id === 'live-evidence') {
      return {
        ...stage,
        layer: index,
        lane: 0,
        status: evidenceStatus,
        summary: `${settledArtifacts.length}/${asyncArtifacts.length} 异步资产已物化 · 响应资产 ${run.assetCount}`,
        primaryItems: asyncArtifacts.slice(0, 3).map((artifact) => `${artifact.assetType} · ${artifact.status}`),
        badges: [`artifacts ${Math.max(run.assetCount, asyncArtifacts.length)}`],
        details: [
          { label: 'acceptedArtifacts', value: String(acceptedArtifacts.length) },
          { label: 'settledArtifacts', value: String(settledArtifacts.length) },
          { label: 'assetNodes', value: asyncArtifacts.map((artifact) => `${artifact.nodeId} · ${artifact.status}`).join('\n') || '尚无结构化资产证据' },
        ],
      }
    }
    if (stage.id === 'live-verification') {
      return {
        ...stage,
        layer: index,
        lane: 0,
        status: terminal ? terminalStatus : 'inactive',
        summary: terminal ? `requestTerminal · ${run.doneReason || run.status}` : '等待 expectedDelivery → evidence → verification',
        primaryItems: terminal ? [run.doneReason || run.status] : [],
        badges: [terminal ? run.status : 'pending'],
        details: [
          { label: 'status', value: run.status },
          { label: 'doneReason', value: run.doneReason || '尚未产生' },
          { label: 'errorMessage', value: run.errorMessage || '无' },
        ],
      }
    }
    return {
      ...stage,
      layer: index,
      lane: 0,
      status: terminal ? terminalStatus : 'inactive',
      summary: terminal ? compact(run.assistantPreview) || run.status : '真实终态尚未形成',
      primaryItems: run.assetCount > 0 ? [`交付资产 ${run.assetCount}`] : [],
      badges: [terminal ? run.status : 'pending'],
      details: [
        { label: 'assistantPreview', value: run.assistantPreview || '尚无终态正文' },
        { label: 'finishedAt', value: run.finishedAt ? new Date(run.finishedAt).toISOString() : '尚未完成' },
      ],
    }
  })
  const edges: ExecutionGraphEdge[] = LIVE_EXECUTION_STAGES.slice(1).map((stage, index) => ({
    id: `live-edge-${index}`,
    source: LIVE_EXECUTION_STAGES[index].id,
    target: stage.id,
    label: '',
    active: nodes[index + 1]?.status !== 'inactive',
    relation: 'main',
  }))
  const skills = run.executionProvenance
    ? new Set([...run.executionProvenance.requiredSkills, ...run.executionProvenance.loadedSkills])
    : new Set(run.skillName ? [run.skillName] : [])
  const knowledgeReceipt = buildRuntimeKnowledgeReceipt({
    provenance: run.executionProvenance,
    promptAssemblies: [],
  })
  const graph: ExecutionGraphProjection = {
    id: run.runId,
    executionTraceId: run.requestId || null,
    title: run.workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY
      ? `一键成片 · ${run.displayText || run.requestText || '实时运行'}`
      : run.displayText || run.requestText || '实时 AI 对话',
    status: terminalStatus,
    provenanceState: run.executionProvenance
      ? 'complete'
      : run.status === 'active'
        ? 'live_pending'
        : 'legacy_unavailable',
    nodes,
    edges,
    knowledgeSourceCount: knowledgeReceipt?.sources.length ?? 0,
    skillCount: skills.size,
    activePathNodeCount: nodes.filter((node) => node.status !== 'inactive').length,
    layout: 'bounded_workflow',
    ...(knowledgeReceipt ? { knowledgeReceipt } : {}),
    timing: createExecutionTiming({
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      live: run.status === 'active',
      observedAtMs,
    }),
  }
  return {
    ...graph,
    diagnosis: buildLiveExecutionDiagnosis(run, graph),
  }
}
