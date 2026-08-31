import { describe, expect, it } from 'vitest'
import {
  ADMIN_WORKFLOW_PERMISSION,
  createManualWorkflowTriggerSpec,
  createScheduleWorkflowTriggerSpec,
  parseWorkflowTriggerSpec,
  parseWorkflowKnowledgeCandidateSetV1,
  preserveAdminWorkflowGraphForNonAdmin,
  projectWorkflowGraphForViewer,
  projectWorkflowGraphPatchForViewer,
  WORKFLOW_CONCURRENCY_MAX,
  WORKFLOW_CONCURRENCY_MIN,
} from '@tapcanvas/workflow-kernel-protocol'

describe('workflow kernel trigger protocol', () => {
  it('shares one bounded workflow and item concurrency contract across editor and runtime', () => {
    expect({ min: WORKFLOW_CONCURRENCY_MIN, max: WORKFLOW_CONCURRENCY_MAX }).toEqual({ min: 1, max: 16 })
  })

  it('keeps every new workflow capability administrator-only', () => {
    expect(ADMIN_WORKFLOW_PERMISSION).toEqual({
      visibilityRoles: ['admin'],
      editRoles: ['admin'],
      runRoles: ['admin'],
    })
  })

  it('validates durable knowledge candidates as an exact typed workflow artifact', () => {
    const artifact = {
      protocolVersion: 'workflow.knowledge-candidates/v1',
      candidateSetId: 'domain_123',
      requestHash: 'hash-1',
      createdAt: '2026-08-13T00:00:00.000Z',
      retrievalMode: 'vector',
      abstained: false,
      diagnostics: {
        vectorCandidates: 1,
        indexedCards: 289,
        availableCards: 289,
        embeddingModel: 'embedding-model',
      },
      candidates: [{
        cardId: 'card-1',
        sourceRoot: 'builtin:agents-cli/knowledge',
        domain: '导演',
        facet: null,
        title: '镜头设计',
        roleScope: ['director'],
        keywords: ['景别'],
        sourceUrls: [],
        bodyPreview: '镜头设计预览',
        rank: 1,
        score: 0.9,
        vectorScore: 0.9,
        vectorRank: 1,
        matchedQueryIds: ['raw-user-request'],
      }],
    }
    expect(parseWorkflowKnowledgeCandidateSetV1(artifact)).toEqual(artifact)
    expect(() => parseWorkflowKnowledgeCandidateSetV1({
      ...artifact,
      candidates: [{ ...artifact.candidates[0], rank: 2 }],
    })).toThrow('ranks must match result order')
  })

  it('parses a manual trigger without browser-owned scheduling state', () => {
    expect(parseWorkflowTriggerSpec(createManualWorkflowTriggerSpec())).toEqual({
      success: true,
      data: { version: 1, kind: 'manual' },
    })
  })

  it('requires explicit schedule identity, timezone and misfire behavior', () => {
    expect(parseWorkflowTriggerSpec({
      version: 1,
      kind: 'schedule',
      scheduleId: 'daily-video-publish',
      cron: '0 9 * * *',
      timezone: 'Asia/Taipei',
      enabled: true,
      misfirePolicy: 'run_once',
      maxCatchUpRuns: 1,
    })).toMatchObject({
      success: true,
      data: {
        kind: 'schedule',
        scheduleId: 'daily-video-publish',
        timezone: 'Asia/Taipei',
        misfirePolicy: 'run_once',
      },
    })
    expect(parseWorkflowTriggerSpec({
      version: 1,
      kind: 'schedule',
      scheduleId: 'daily-video-publish',
      cron: '0 9 * * *',
      enabled: true,
      misfirePolicy: 'skip',
      maxCatchUpRuns: 0,
    })).toMatchObject({ success: false })
  })

  it('keeps the misfire policy and catch-up count semantically identical', () => {
    expect(parseWorkflowTriggerSpec({
      version: 1,
      kind: 'schedule',
      scheduleId: 'daily-video',
      cron: '0 9 * * *',
      timezone: 'Asia/Taipei',
      enabled: true,
      misfirePolicy: 'skip',
      maxCatchUpRuns: 1,
    })).toMatchObject({ success: false })
    expect(() => createScheduleWorkflowTriggerSpec({
      scheduleId: 'daily-video',
      cron: '0 9 * * *',
      timezone: 'Asia/Taipei',
      misfirePolicy: 'run_once',
      maxCatchUpRuns: 2,
    })).toThrow('run_once requires maxCatchUpRuns=1')
  })

  it('stores webhook credentials by secret reference instead of embedding a token', () => {
    expect(parseWorkflowTriggerSpec({
      version: 1,
      kind: 'webhook',
      webhookId: 'publish-hook',
      secretRef: 'env://WORKFLOW_PUBLISH_HOOK_SECRET',
    })).toMatchObject({
      success: true,
      data: { kind: 'webhook', secretRef: 'env://WORKFLOW_PUBLISH_HOOK_SECRET' },
    })
  })

  it('projects protected nodes away and preserves them across a non-admin save', () => {
    const existing = {
      title: 'shared flow',
      nodes: [
        { id: 'source', data: { label: 'source' } },
        { id: 'admin-trigger', data: { kind: 'workflowTrigger', adminWorkflow: true } },
        { id: 'admin-stage', data: { workflowPermission: ADMIN_WORKFLOW_PERMISSION } },
      ],
      edges: [
        { id: 'admin-edge', source: 'admin-trigger', target: 'admin-stage' },
      ],
    }
    expect(projectWorkflowGraphForViewer(existing, false)).toEqual({
      title: 'shared flow',
      nodes: [{ id: 'source', data: { label: 'source' } }],
      edges: [],
    })

    const preserved = preserveAdminWorkflowGraphForNonAdmin({
      existing,
      incoming: {
        title: 'member edit',
        nodes: [
          { id: 'source', data: { label: 'edited source' } },
          { id: 'forged', data: { kind: 'workflowStage' } },
        ],
        edges: [{ id: 'forged-edge', source: 'source', target: 'forged' }],
      },
    })
    expect(preserved).toEqual({
      title: 'member edit',
      nodes: [
        { id: 'source', data: { label: 'edited source' } },
        { id: 'admin-trigger', data: { kind: 'workflowTrigger', adminWorkflow: true } },
        { id: 'admin-stage', data: { workflowPermission: ADMIN_WORKFLOW_PERMISSION } },
      ],
      edges: [{ id: 'admin-edge', source: 'admin-trigger', target: 'admin-stage' }],
    })
  })

  it('removes protected node payloads from realtime graph patches', () => {
    expect(projectWorkflowGraphPatchForViewer({
      revision: 7,
      upsertNodes: [
        { id: 'source', data: { kind: 'text' } },
        { id: 'trigger', data: { kind: 'workflowTrigger', adminWorkflow: true } },
      ],
      upsertEdges: [
        { id: 'hidden-edge', source: 'trigger', target: 'source' },
        { id: 'visible-edge', source: 'source', target: 'other' },
      ],
    }, false)).toEqual({
      revision: 7,
      upsertNodes: [{ id: 'source', data: { kind: 'text' } }],
      upsertEdges: [{ id: 'visible-edge', source: 'source', target: 'other' }],
    })
  })
})
