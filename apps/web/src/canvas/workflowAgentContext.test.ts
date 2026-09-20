import { describe, expect, it } from 'vitest'
import {
  isWorkflowAgentNode,
  readWorkflowKnowledgeSearchObservations,
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


it('preserves candidate decisions and successful body-read receipts in canvas evidence', () => {
  const readReceipt = { toolCallId: 'read-1', candidateSetId: 'set-1', tool: 'prompt_example_read', readAt: '2026-09-09T08:00:00.000Z' };
  const retrievalDecisions = [{ version: 1, blocking: false, toolNames: ['prompt_example_read'], toolCallIds: ['read-1'], rationale: 'Use the continuity example', status: 'tool_actions_requested', at: readReceipt.readAt }];
  const result = readWorkflowAgentExecutionProvenance({ executionProvenance: {
    version: 1, executionId: 'run', depth: 1, model: 'model', apiStyle: 'chat', requiredSkills: [], loadedSkills: [], startedAt: readReceipt.readAt,
    retrievalDecisions,
    loadedKnowledgeSources: [{ cardId: 'card', title: 'Example', sourceUrls: [], contentHash: `sha256:${'a'.repeat(64)}`, contentChars: 80, readReceipt }],
  } });
  expect(result?.retrievalDecisions).toEqual(retrievalDecisions);
  expect(result?.loadedKnowledgeSources?.[0]?.readReceipt).toEqual(readReceipt);
});


it('never attaches another candidate set to a search missing its receipt identity', () => {
  const observation = { version: 1, status: 'candidate_found', attempted: true, candidateCount: 1, blocking: false, rationale: 'candidate metadata', domains: ['cinema'], toolCallId: 'search-1' };
  const retrievalCandidateSets = [{ candidateKind: 'domain', candidateSetId: 'other-search', entries: [{ candidateId: 'other-card', rank: 1, score: 0.9 }] }];
  const missing = readWorkflowKnowledgeSearchObservations({ knowledgeCandidateSearch: observation, retrievalCandidateSets });
  expect(missing[0]?.candidateSetId).toBeUndefined();
  expect(missing[0]?.candidates).toBeUndefined();
  const matched = readWorkflowKnowledgeSearchObservations({ knowledgeCandidateSearch: { ...observation, candidateSetId: 'other-search' }, retrievalCandidateSets });
  expect(matched[0]?.candidates?.[0]?.cardId).toBe('other-card');
});
