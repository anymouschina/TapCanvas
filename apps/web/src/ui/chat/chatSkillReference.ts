import type { AgentExecutionProvenanceDto, AgentSkillDto, UserContextAssetDto } from '../../api/server'

export type ChatSkillReferenceSource = 'system' | 'user' | 'marketplace'

export type ChatSkillReference = {
  id: string
  key: string
  name: string
  description: string | null
  logoUrl: string | null
  category: string
  source: ChatSkillReferenceSource
  version: string
  contentHash: string | null
}

export function toSystemChatSkillReference(skill: AgentSkillDto): ChatSkillReference {
  return {
    id: skill.id,
    key: skill.key,
    name: skill.name || skill.key,
    description: skill.description ?? null,
    logoUrl: skill.logoUrl,
    category: skill.category,
    source: 'system',
    version: skill.updatedAt,
    contentHash: null,
  }
}

export function toExternalChatSkillReference(skill: UserContextAssetDto): ChatSkillReference {
  const source: ChatSkillReferenceSource = skill.sourceMarketplaceProductId
    ? 'marketplace'
    : 'user'
  return {
    id: skill.id,
    key: `user-skill:${skill.id}`,
    name: skill.name || skill.fileName,
    description: skill.description,
    logoUrl: skill.logoUrl,
    category: source === 'marketplace' ? '已购技能' : '个人技能',
    source,
    version: skill.updatedAt,
    contentHash: skill.sha256,
  }
}

export function resolveChatSkillToolLabel(
  toolInput: unknown,
  availableSkills: readonly ChatSkillReference[],
): string | null {
  const input = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)
    ? toolInput as Record<string, unknown>
    : null
  const nestedArgs = input?.args && typeof input.args === 'object' && !Array.isArray(input.args)
    ? input.args as Record<string, unknown>
    : null
  const identity = typeof input?.skill === 'string'
    ? input.skill.trim()
    : typeof nestedArgs?.skill === 'string'
      ? nestedArgs.skill.trim()
      : ''
  if (!identity) return null
  const selected = availableSkills.find(
    (skill) => skill.id === identity || skill.key === identity || skill.name === identity,
  )
  return `加载 ${selected?.name || identity}`
}

function readDocumentName(path: string): string {
  const segments = path.split(/[\\/]/u).map((segment) => segment.trim()).filter(Boolean)
  return segments[segments.length - 1] ?? path.trim()
}

/**
 * Projects only exact, successfully loaded Skill/Knowledge provenance into the
 * compact document names shown below an assistant reply. Required or merely
 * searched candidates are intentionally excluded.
 */
export type ChatReferenceDocuments = {
  skills: string[]
  knowledge: string[]
}

export function buildChatReferenceDocuments(
  provenance: AgentExecutionProvenanceDto | null | undefined,
): ChatReferenceDocuments {
  if (!provenance) return { skills: [], knowledge: [] }
  const skillDocuments: string[] = []
  const knowledgeDocuments: string[] = []
  const seenSkills = new Set<string>()
  const seenKnowledge = new Set<string>()
  const append = (target: string[], seen: Set<string>, value: string): void => {
    const name = value.trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    target.push(name)
  }

  for (const source of provenance.loadedSkillSources ?? []) {
    if (source.sourceKind === 'skill' || source.sourceKind === 'section') {
      append(skillDocuments, seenSkills, `${source.skill}/SKILL.md`)
      continue
    }
    if (source.sourceKind === 'resource') {
      append(skillDocuments, seenSkills, `${source.skill}/${readDocumentName(source.source)}`)
      continue
    }
    append(skillDocuments, seenSkills, source.skill)
  }
  for (const resource of provenance.loadedSkillResources ?? []) {
    append(skillDocuments, seenSkills, `${resource.skill}/${readDocumentName(resource.resource)}`)
  }
  for (const source of provenance.loadedKnowledgeSources ?? []) {
    append(knowledgeDocuments, seenKnowledge, source.title)
  }
  return {
    skills: skillDocuments,
    knowledge: knowledgeDocuments,
  }
}
