import { describe, expect, it } from 'vitest'

import { buildKnowledgeTraceEvidence } from './knowledgeTraceEvidence'

describe('buildKnowledgeTraceEvidence', () => {
  it('shows multi-view vector recall diagnostics separately from selected-card evidence', () => {
    const evidence = buildKnowledgeTraceEvidence('knowledge_search', { query: '动作连续性' }, {
      candidateSetId: 'domain-set-1',
      retrievalMode: 'vector',
      count: 2,
      rawUserRequestIncluded: true,
	  retrievalSandbox: {
		protocolVersion: 'retrieval-sandbox-receipt/v1',
		availableCandidateCount: 9,
		returnedCandidateCount: 2,
		bodyAccess: 'candidate_set_required',
		blocking: false,
	  },
      diagnostics: {
        queryViews: 3,
        requestedQueryViews: 4,
        omittedQueryViews: 1,
        vectorSearches: 3,
        vectorHits: 7,
        vectorCandidates: 2,
        indexedCards: 281,
        embeddingModel: 'text-embedding-v4',
      },
      results: [{
        id: 'action-continuity',
        title: '动作连续性',
        score: 0.87,
        vectorScore: 0.91,
        vectorRank: 1,
        sources: ['vector'],
        matchedQueryIds: ['user_request', 'must:no-axis-crossing'],
      }],
    })

    expect(evidence.primaryItems).toContain('检索视角 · 3')
    expect(evidence.primaryItems).toContain('视角预算省略 · 1')
    expect(evidence.primaryItems).toContain('视角命中 · 7')
    expect(evidence.primaryItems).toContain('向量候选 · 2')
	expect(evidence.primaryItems).toContain('检索沙盒 · 返回 2 / 初排 9')
	expect(evidence.primaryItems).toContain('正文边界 · 选中后精确读取')
    expect(evidence.details.some((detail) => detail.value.includes('must:no-axis-crossing'))).toBe(true)
  })
})
