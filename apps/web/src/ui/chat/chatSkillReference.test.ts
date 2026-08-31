import { describe, expect, it } from 'vitest'
import type { AgentExecutionProvenanceDto, UserContextAssetDto } from '../../api/server'
import {
  buildChatReferenceDocuments,
  resolveChatSkillToolLabel,
  toExternalChatSkillReference,
} from './chatSkillReference'

const purchasedSkill: UserContextAssetDto = {
  id: 'asset-wanwusheng',
  kind: 'skill',
  fileName: 'wanwusheng.md',
  name: '万物生3prompt skill',
  description: 'Seedance prompt 写作',
  logoUrl: null,
  sizeBytes: 128,
  sha256: 'a'.repeat(64),
  marketplaceListing: null,
  sourceMarketplaceProductId: 'product-wanwusheng',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
}

describe('chat Skill references', () => {
  it('maps purchased Skills to reference-only chat identities', () => {
    expect(toExternalChatSkillReference(purchasedSkill)).toMatchObject({
      id: purchasedSkill.id,
      key: `user-skill:${purchasedSkill.id}`,
      name: purchasedSkill.name,
      source: 'marketplace',
      version: purchasedSkill.updatedAt,
      contentHash: purchasedSkill.sha256,
    })
  })

  it('presents a Skill tool call with the actual purchased Skill name', () => {
    const reference = toExternalChatSkillReference(purchasedSkill)
    expect(resolveChatSkillToolLabel({ skill: reference.key }, [reference]))
      .toBe('加载 万物生3prompt skill')
  })

  it('presents a Skill name from a generic remote-tool argument envelope', () => {
    const reference = toExternalChatSkillReference(purchasedSkill)
    expect(resolveChatSkillToolLabel({
      name: 'Skill',
      args: { skill: reference.key, section: '## 工作流' },
    }, [reference])).toBe('加载 万物生3prompt skill')
  })

  it('projects only exact loaded Skill and Knowledge documents into a compact deduplicated list', () => {
    const provenance: AgentExecutionProvenanceDto = {
      version: 1,
      executionId: 'execution-1',
      depth: 0,
      model: 'gpt-5.6-terra',
      apiStyle: 'responses',
      requiredSkills: ['required-but-not-read'],
      loadedSkills: ['tapcanvas-video-workflow'],
      loadedSkillSources: [
        {
          skill: 'tapcanvas-video-workflow',
          sourceKind: 'skill',
          source: 'SKILL.md',
          contentHash: `sha256:${'a'.repeat(64)}`,
          contentChars: 1200,
        },
        {
          skill: 'tapcanvas-video-workflow',
          sourceKind: 'section',
          source: '## 关键帧合同',
          contentHash: `sha256:${'b'.repeat(64)}`,
          contentChars: 480,
        },
        {
          skill: 'tapcanvas-video-workflow',
          sourceKind: 'resource',
          source: 'references/shot-contract.md',
          contentHash: `sha256:${'c'.repeat(64)}`,
          contentChars: 640,
        },
      ],
      loadedSkillResources: [{
        skill: 'tapcanvas-video-workflow',
        resource: 'references/shot-contract.md',
      }],
      loadedKnowledgeSources: [{
        cardId: 'cinematic-lighting',
        title: '电影感布光.md',
        domain: '视听语言演出',
        sourceUrls: [],
        contentHash: `sha256:${'d'.repeat(64)}`,
        contentChars: 900,
      }],
      startedAt: '2026-08-11T00:00:00.000Z',
    }

    expect(buildChatReferenceDocuments(provenance)).toEqual({
      skills: [
        'tapcanvas-video-workflow/SKILL.md',
        'tapcanvas-video-workflow/shot-contract.md',
      ],
      knowledge: ['电影感布光.md'],
    })
  })

  it('does not present required or searched-only sources as citations', () => {
    expect(buildChatReferenceDocuments({
      version: 1,
      executionId: 'execution-2',
      depth: 0,
      model: 'gpt-5.6-terra',
      apiStyle: 'responses',
      requiredSkills: ['tapcanvas-screenwriter'],
      loadedSkills: [],
      startedAt: '2026-08-11T00:00:00.000Z',
    })).toEqual({ skills: [], knowledge: [] })
  })

  it('mounts every distinct successfully loaded source without truncation', () => {
    const loadedKnowledgeSources = Array.from({ length: 40 }, (_, index) => ({
      cardId: `card-${index}`,
      title: `知识文档 ${index}`,
      sourceUrls: [],
      contentHash: `hash-${index}`,
      contentChars: 100 + index,
    }))

    const references = buildChatReferenceDocuments({
      version: 1,
      executionId: 'execution-many-sources',
      depth: 0,
      model: 'test-model',
      apiStyle: 'responses',
      requiredSkills: [],
      loadedSkills: [],
      loadedSkillSources: [],
      loadedKnowledgeSources,
      startedAt: '2026-08-11T00:00:00.000Z',
    })

    expect(references.knowledge).toHaveLength(40)
    expect(references.knowledge[references.knowledge.length - 1]).toBe('知识文档 39')
  })
})
