import { describe, expect, it } from 'vitest'
import {
  isWorkflowAgentNode,
  readWorkflowAgentDeclaredContext,
  readWorkflowAgentExecutionProvenance,
  readWorkflowAgentExecutionProvenanceHistory,
} from './workflowAgentContext'

describe('workflow Agent context metadata', () => {
  it('recognizes an Agent from the authoritative atomic category', () => {
    expect(isWorkflowAgentNode({
      workflowAtomicSpec: {
        category: 'agent',
        operation: 'beat_sheet',
        executorRef: 'agents.workflow-node/v1',
      },
    })).toBe(true)
    expect(isWorkflowAgentNode({
      workflowAtomicSpec: {
        category: 'tool',
        operation: 'estimate',
        executorRef: 'tapcanvas.estimate/v1',
      },
    })).toBe(false)
  })

  it('grants universal Skill and knowledge discovery without treating legacy mounts as usage', () => {
    expect(readWorkflowAgentDeclaredContext({
      workflowRequiredSkills: ['tapcanvas-video-workflow', 'tapcanvas-video-workflow'],
      workflowAllowedTools: ['knowledge_search', 'knowledge_read'],
      workflowAtomicSpec: {
        optionalInputPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence', 'input'],
      },
    })).toEqual({
      allowedTools: ['skill_search', 'Skill', 'knowledge_search', 'knowledge_read'],
      optionalContextPorts: ['skills', 'tools', 'knowledge-candidates', 'knowledge-evidence'],
    })
  })

  it('reads only structured execution provenance from node evidence', () => {
    const provenance = readWorkflowAgentExecutionProvenance({
      executionProvenance: {
        version: 1,
        executionId: 'execution-1',
        depth: 0,
        model: 'gpt-5.6',
        apiStyle: 'responses',
        requiredSkills: ['tapcanvas-video-workflow'],
        loadedSkills: ['tapcanvas-video-workflow'],
        loadedKnowledgeSources: [{
          cardId: 'card-1',
          title: '镜头节奏知识卡',
          sourceUrls: ['https://example.com/source'],
          contentHash: `sha256:${'a'.repeat(64)}`,
          contentChars: 512,
        }],
        startedAt: '2026-08-15T00:00:00.000Z',
      },
    })

    expect(provenance).toMatchObject({
      executionId: 'execution-1',
      loadedKnowledgeSources: [{ cardId: 'card-1', title: '镜头节奏知识卡' }],
    })
    expect(readWorkflowAgentExecutionProvenance({ executionProvenance: { version: 1 } })).toBeNull()
  })

  it('keeps every physical execution provenance window and projects the latest one', () => {
    const provenanceHistory = ['physical-1', 'physical-2'].map((executionId) => ({
        version: 1,
        executionId,
        depth: 1,
        model: 'deepseek-v4-flash',
        apiStyle: 'chat',
        requiredSkills: ['tapcanvas-video-workflow'],
        loadedSkills: ['tapcanvas-video-workflow'],
        loadedSkillResources: [],
        loadedSkillSources: [],
        loadedKnowledgeSources: [],
        startedAt: '2026-08-15T00:00:00.000Z',
      }))
    const outputRefs = {
      itemRuns: [{
        itemId: 'clip-001',
        evidence: { executionProvenanceHistory: provenanceHistory },
      }],
    }
    const history = readWorkflowAgentExecutionProvenanceHistory(outputRefs)

    expect(history.map((item) => item.executionId)).toEqual(['physical-1', 'physical-2'])
    expect(readWorkflowAgentExecutionProvenance(outputRefs)?.executionId).toBe('physical-2')
  })
})
