import { describe, expect, it } from 'vitest'

import type { AgentExecutionProvenanceDto } from '../../api/server'
import type { ExecutionPromptAssembly } from './executionGraph.types'
import { buildRuntimeKnowledgeReceipt } from './runtimeKnowledgeEvidence'

const KNOWLEDGE_HASH = `sha256:${'a'.repeat(64)}`
const SKILL_HASH = `sha256:${'b'.repeat(64)}`

const provenance: AgentExecutionProvenanceDto = {
  version: 1,
  executionId: 'execution-1',
  depth: 0,
  model: 'gpt-5.6',
  apiStyle: 'responses',
  requiredSkills: ['tapcanvas-video-workflow'],
  loadedSkills: ['tapcanvas-video-workflow'],
  loadedSkillResources: [{
    skill: 'tapcanvas-video-workflow',
    resource: 'references/video-prompt-contract.md',
    contentHash: KNOWLEDGE_HASH,
    contentChars: 1024,
  }],
  loadedSkillSources: [{
    skill: 'tapcanvas-video-workflow',
    sourceKind: 'skill',
    source: 'SKILL.md',
    contentHash: SKILL_HASH,
    contentChars: 4096,
  }, {
    skill: 'tapcanvas-video-workflow',
    sourceKind: 'resource',
    source: 'references/video-prompt-contract.md',
    contentHash: KNOWLEDGE_HASH,
    contentChars: 1024,
  }],
  startedAt: '2026-08-10T00:00:00.000Z',
}

const assembly: ExecutionPromptAssembly = {
  version: 2,
  artifactKey: 'clip:0',
  clipIndex: 0,
  state: 'complete',
  assemblySummary: 'assembled',
  steps: [],
  sources: [{
    id: 'beat-sheet',
    label: 'BeatSheet',
    kind: 'project_fact',
    ref: 'artifact://beat-sheet',
    status: 'applied',
    summary: '项目事实',
  }],
  contractSnapshot: {
    sourceSpanText: null,
    dialogueScriptJson: '[]',
    temporalContextJson: null,
    sceneStateJson: null,
    characterStatesJson: null,
    characterStateVersionsJson: null,
    startKeyframe: null,
    endKeyframe: null,
    previousExitState: null,
    exitState: null,
    writerOutputJson: null,
  },
  finalPrompt: null,
}

describe('runtime Knowledge receipt', () => {
  it('joins root Skill reads and prompt assembly facts', () => {
    const receipt = buildRuntimeKnowledgeReceipt({ provenance, promptAssemblies: [assembly] })

    expect(receipt).toMatchObject({
      state: 'complete',
      rootExecutionId: 'execution-1',
      sources: expect.arrayContaining([
        expect.objectContaining({ kind: 'skill', ref: 'skill://tapcanvas-video-workflow' }),
        expect.objectContaining({
          kind: 'skill_reference',
          ref: 'apps/agents-cli/skills/tapcanvas-video-workflow/references/video-prompt-contract.md',
          contentHash: KNOWLEDGE_HASH,
        }),
        expect.objectContaining({ kind: 'project_fact', ref: 'artifact://beat-sheet' }),
      ]),
    })
  })

  it('projects actually loaded knowledge documents without exposing their body', () => {
    const receipt = buildRuntimeKnowledgeReceipt({
      provenance: {
        ...provenance,
        executionId: 'execution-knowledge-1',
        loadedKnowledgeSources: [{
          cardId: 'knowledge-card-1',
          title: 'TVC 灯光方法卡',
          domain: '商业广告',
          facet: '灯光',
          sourceUrls: ['https://example.com/source'],
          contentHash: KNOWLEDGE_HASH,
          contentChars: 2048,
        }],
      },
      promptAssemblies: [],
    })

    expect(receipt?.summary).toContain('知识文档 1')
    expect(receipt?.sources).toContainEqual(expect.objectContaining({
      kind: 'knowledge',
      label: 'TVC 灯光方法卡',
      ref: 'knowledge://knowledge-card-1',
      contentHash: KNOWLEDGE_HASH,
      status: 'applied',
    }))
    expect(JSON.stringify(receipt)).not.toContain('知识卡正文')
  })
})
