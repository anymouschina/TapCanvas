import type { AgentExecutionProvenanceDto } from '../../api/server'
import type {
  ExecutionKnowledgeReceipt,
  ExecutionKnowledgeSource,
  ExecutionPromptAssembly,
} from './executionGraph.types'

const INCLUDED_PROMPT_SOURCE_KINDS = new Set([
  'project_fact',
  'clip_fact',
  'skill',
  'skill_reference',
  'compiler',
  'asset_binding',
])

function sourceKey(source: Pick<ExecutionKnowledgeSource, 'kind' | 'ref'>): string {
  return `${source.kind}\u0000${source.ref}`
}

function mergeSource(
  sources: Map<string, ExecutionKnowledgeSource>,
  source: ExecutionKnowledgeSource,
): void {
  const key = sourceKey(source)
  const current = sources.get(key)
  if (!current) {
    sources.set(key, source)
    return
  }
  sources.set(key, {
    ...current,
    status: current.status === 'applied' || source.status === 'applied' ? 'applied' : current.status,
    usedBy: Array.from(new Set([...current.usedBy, ...source.usedBy])),
    ...(current.contentHash || source.contentHash ? { contentHash: current.contentHash ?? source.contentHash } : {}),
  })
}

export function buildRuntimeKnowledgeReceipt(input: {
  provenance: AgentExecutionProvenanceDto | null
  promptAssemblies: ExecutionPromptAssembly[]
}): ExecutionKnowledgeReceipt | null {
  const sources = new Map<string, ExecutionKnowledgeSource>()
  const skillNames = input.provenance
    ? Array.from(new Set([...input.provenance.requiredSkills, ...input.provenance.loadedSkills]))
    : []
  const loadedSources = input.provenance?.loadedSkillSources ?? []
  for (const skillName of skillNames) {
    const skillSource = loadedSources.find((source) => source.skill === skillName && source.sourceKind === 'skill')
    mergeSource(sources, {
      id: `root-skill:${skillName}`,
      label: skillName,
      kind: 'skill',
      ref: `skill://${skillName}`,
      status: input.provenance?.loadedSkills.includes(skillName) ? 'applied' : 'pending',
      summary: input.provenance?.loadedSkills.includes(skillName)
        ? skillSource
          ? `已进入小T主代理本轮执行上下文；内容版本 ${skillSource.contentHash.slice(0, 19)}…。`
          : '已进入小T主代理本轮执行上下文；该记录未回传内容哈希。'
        : '主任务要求该 Skill，等待实际加载证据。',
      usedBy: ['小T主代理'],
      ...(skillSource ? { contentHash: skillSource.contentHash } : {}),
    })
  }
  for (const resource of input.provenance?.loadedSkillResources ?? []) {
    mergeSource(sources, {
      id: `root-reference:${resource.skill}:${resource.resource}`,
      label: `${resource.skill} · Reference`,
      kind: 'skill_reference',
      ref: `apps/agents-cli/skills/${resource.skill}/${resource.resource}`,
      status: 'applied',
      summary: resource.contentHash
        ? `由小T主代理通过 Skill 工具成功读取；内容版本 ${resource.contentHash.slice(0, 19)}…。`
        : '由小T主代理通过 Skill 工具成功读取；该历史记录未回传内容哈希。',
      usedBy: ['小T主代理'],
      ...(resource.contentHash ? { contentHash: resource.contentHash } : {}),
    })
  }
  for (const source of loadedSources) {
    if (source.sourceKind === 'skill') continue
    const sourceLabel = source.sourceKind === 'section'
      ? 'Section'
      : source.sourceKind === 'resource'
        ? 'Reference'
        : 'External'
    const sourceRef = source.sourceKind === 'section'
      ? `apps/agents-cli/skills/${source.skill}/SKILL.md#${source.source}`
      : source.sourceKind === 'resource'
        ? `apps/agents-cli/skills/${source.skill}/${source.source}`
        : `external-skill://${source.skill}/${source.source}`
    mergeSource(sources, {
      id: `root-skill-source:${source.skill}:${source.sourceKind}:${source.source}`,
      label: `${source.skill} · ${sourceLabel}`,
      kind: 'skill_reference',
      ref: sourceRef,
      status: 'applied',
      summary: `小T实际读取；内容版本 ${source.contentHash.slice(0, 19)}…。`,
      usedBy: ['小T主代理'],
      contentHash: source.contentHash,
    })
  }
  for (const knowledge of input.provenance?.loadedKnowledgeSources ?? []) {
    const qualifiers = [knowledge.domain, knowledge.facet].filter((value): value is string => Boolean(value))
    mergeSource(sources, {
      id: `root-knowledge:${knowledge.cardId}`,
      label: knowledge.title,
      kind: 'knowledge',
      ref: `knowledge://${knowledge.cardId}`,
      status: 'applied',
      summary: [
        qualifiers.length > 0 ? qualifiers.join(' · ') : '知识库文档',
        `来源 ${knowledge.sourceUrls.length}`,
        `正文 ${knowledge.contentChars} 字符`,
      ].join(' · '),
      usedBy: ['小T主代理'],
      contentHash: knowledge.contentHash,
    })
  }
  for (const assembly of input.promptAssemblies) {
    for (const source of assembly.sources) {
      if (!INCLUDED_PROMPT_SOURCE_KINDS.has(source.kind)) continue
      mergeSource(sources, {
        id: `clip:${assembly.clipIndex}:${source.id}`,
        label: source.label,
        kind: source.kind as ExecutionKnowledgeSource['kind'],
        ref: source.ref,
        status: source.status,
        summary: source.summary,
        usedBy: [`Clip ${assembly.clipIndex} Writer/编译链`],
      })
    }
  }
  const values = [...sources.values()]
  if (values.length === 0) return null
  const referenceCount = values.filter((source) => source.kind === 'skill_reference' && source.status === 'applied').length
  const knowledgeCount = values.filter((source) => source.kind === 'knowledge' && source.status === 'applied').length
  const factCount = values.filter((source) => source.kind === 'project_fact' || source.kind === 'clip_fact').length
  const ruleCount = values.filter((source) => source.kind === 'compiler' || source.kind === 'asset_binding').length
  const state = !input.provenance
    ? 'partial'
    : values.some((source) => (source.kind === 'skill' || source.kind === 'skill_reference') && source.status === 'applied' && !source.contentHash)
      ? 'partial'
    : values.some((source) => source.status === 'unavailable')
      ? 'partial'
      : values.some((source) => source.status === 'pending')
        ? 'pending'
        : 'complete'
  return {
    version: 1,
    state,
    rootExecutionId: input.provenance?.executionId ?? null,
    summary: `Skill ${skillNames.length} · 实读 Reference ${referenceCount} · 知识文档 ${knowledgeCount} · 项目/Clip 事实 ${factCount} · 确定性执行规则 ${ruleCount}`,
    sources: values,
  }
}
