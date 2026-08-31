import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { useRFStore } from './store'
import {
  applyWorkflowAgentConfigurationProjection,
  buildWorkflowAgentVisibleGraph,
  buildWorkflowAgentReferenceProjection,
  isWorkflowAgentReferenceEdge,
} from './workflowAgentReferenceProjection'
import {
  workflowAgentReferenceSourceHandleId,
  workflowAgentReferenceTargetHandleId,
} from './workflowAgentReferencePorts'

function agentNode(): Node {
  return {
    id: 'agent-node',
    type: 'taskNode',
    position: { x: 400, y: 160 },
    data: {
      kind: 'workflowStage',
      adminWorkflow: true,
      workflowKey: 'agent-workflow',
      workflowInstanceId: 'workflow-instance',
      workflowAtomicSpec: {
        category: 'agent',
        operation: 'agent_task',
        executorRef: 'agents.logical-task/v2',
      },
    },
  }
}

const provenanceBase = {
  version: 1,
  depth: 0,
  model: 'deepseek-v4-flash',
  apiStyle: 'chat',
  requiredSkills: ['tapcanvas-video-workflow'],
  loadedSkills: ['tapcanvas-video-workflow'],
  startedAt: '2026-08-15T00:00:00.000Z',
} as const

describe('workflow Agent reference projection', () => {
  it('projects one aggregate Skills node and one aggregate knowledge node per Agent', () => {
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode: agentNode(),
      workflowExecutionId: 'workflow-execution-1',
      readOnly: false,
      outputRefs: {
        executionProvenanceHistory: [
          {
            ...provenanceBase,
            executionId: 'physical-1',
            loadedSkillSources: [{
              skill: 'tapcanvas-video-workflow',
              name: '一键成片工作流',
              description: '从创作意图到真实视频交付的统一生产路径。',
              sourceKind: 'skill',
              source: 'SKILL.md',
              contentHash: `sha256:${'a'.repeat(64)}`,
              contentChars: 1200,
            }],
            loadedKnowledgeSources: [{
              cardId: 'knowledge-card-1',
              title: '动作镜头节奏',
              description: '高燃动作片的节奏、轴线和打击反馈控制要点。',
              domain: 'anime-action',
              facet: 'pacing',
              sourceUrls: ['https://knowledge.example.com/action-pacing'],
              contentHash: `sha256:${'b'.repeat(64)}`,
              contentChars: 860,
            }],
          },
          {
            ...provenanceBase,
            executionId: 'physical-2',
            loadedSkillResources: [{
              skill: 'tapcanvas-video-workflow',
              resource: 'references/motion.md',
              contentHash: `sha256:${'c'.repeat(64)}`,
              contentChars: 640,
            }],
          },
        ],
        knowledgeCandidates: [{ cardId: 'candidate-only', title: '未实际读取候选' }],
      },
    })

    expect(projection.nodes).toHaveLength(2)
    const skill = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'skill')
    const knowledge = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'knowledge')
    expect(skill?.data).toMatchObject({
      label: 'Skills · 已读 1',
      adminWorkflow: true,
      readOnly: false,
      skipDagRun: true,
      workflowRuntimeReference: true,
      workflowRuntimeReferenceAggregate: true,
      workflowRuntimeReferenceEvidenceState: 'actual_read',
      workflowRuntimeReferenceName: 'Skills',
      workflowRuntimeReferenceCount: 1,
      workflowRuntimeReferenceItems: [{
        identity: 'tapcanvas-video-workflow',
        referenceKey: 'tapcanvas-video-workflow',
        name: 'tapcanvas-video-workflow',
        description: '从创作意图到真实视频交付的统一生产路径。',
        evidenceState: 'actual_read',
        physicalExecutionIds: ['physical-1', 'physical-2'],
      }],
    })
    expect(knowledge?.data).toMatchObject({
      label: '知识库 · 已读 1',
      workflowRuntimeReferenceName: '知识库',
      workflowRuntimeReferenceCount: 1,
      workflowRuntimeReferenceItems: [{
        identity: 'knowledge-card-1',
        referenceKey: 'knowledge-card-1',
        name: '动作镜头节奏',
        description: '高燃动作片的节奏、轴线和打击反馈控制要点。',
        evidenceState: 'actual_read',
      }],
    })
    expect(JSON.stringify(projection.nodes).includes('未实际读取候选')).toBe(false)
    expect(projection.nodes.every((node) => node.draggable === false && node.deletable === false)).toBe(true)
    expect(projection.nodes.every((node) => node.position.y > 160)).toBe(true)
    expect(projection.edges).toHaveLength(2)
    expect(projection.edges.every((edge) => edge.type === 'orth')).toBe(true)
    expect(projection.edges.every(isWorkflowAgentReferenceEdge)).toBe(true)
    expect(projection.edges.every((edge) => edge.data?.executionRole === 'reference_only')).toBe(true)
    expect(projection.edges.every((edge) => edge.data?.referenceState === 'available')).toBe(true)
    expect(projection.edges.every((edge) => edge.target === 'agent-node')).toBe(true)
    expect(projection.edges.every((edge) => edge.source !== 'agent-node')).toBe(true)
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceHandle: workflowAgentReferenceSourceHandleId('skill'),
        targetHandle: workflowAgentReferenceTargetHandleId('skill'),
        data: expect.objectContaining({
          referenceActualReadCount: 1,
          referenceEvidenceState: 'actual_read',
        }),
      }),
      expect.objectContaining({
        sourceHandle: workflowAgentReferenceSourceHandleId('knowledge'),
        targetHandle: workflowAgentReferenceTargetHandleId('knowledge'),
        data: expect.objectContaining({
          referenceActualReadCount: 1,
          referenceEvidenceState: 'actual_read',
        }),
      }),
    ]))
  })

  it('keeps dozens of Skill entries inside one abstract node instead of expanding the canvas', () => {
    const owner = agentNode()
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode: owner,
      workflowExecutionId: 'workflow-execution-many-skills',
      readOnly: false,
      outputRefs: {
        executionProvenanceHistory: [{
          ...provenanceBase,
          executionId: 'physical-many',
          loadedSkills: ['skill-a', 'skill-b', 'skill-c'],
        }],
      },
    })

    const skillNodes = projection.nodes.filter((node) => node.data.workflowRuntimeReferenceKind === 'skill')
    expect(skillNodes).toHaveLength(1)
    expect(skillNodes[0]?.data).toMatchObject({
      label: 'Skills · 已读 3',
      workflowRuntimeReferenceCount: 3,
    })
    expect(skillNodes[0]?.data.workflowRuntimeReferenceItems).toHaveLength(3)
  })

  it('projects prompt-example search attempts separately from successful body reads', () => {
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode: agentNode(),
      workflowExecutionId: 'workflow-execution-search-diagnostics',
      readOnly: true,
      outputRefs: {
        itemRuns: [
          {
            evidence: {
              promptExampleCandidateSearch: {
                version: 1,
                status: 'no_match',
                mediaType: 'video',
                attempted: true,
                remoteAttempted: true,
                candidateCount: 0,
                blocking: false,
                rationale: '同媒体案例检索零命中。',
                toolCallId: 'search-1',
              },
            },
          },
          {
            evidence: {
              promptExampleCandidateSearch: {
                version: 1,
                status: 'retrieval_failed',
                mediaType: 'video',
                attempted: true,
                remoteAttempted: true,
                candidateCount: 0,
                blocking: false,
                rationale: '检索依赖失败。',
                toolCallId: 'search-2',
              },
            },
          },
        ],
      },
    })

    const knowledge = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'knowledge')
    expect(knowledge?.data).toMatchObject({
      label: '知识库 · 已检索',
      workflowRuntimeReferenceDescription: '2 次案例检索 · 0 个候选 · 1 次失败 · 本轮未读取正文',
      workflowRuntimeReferenceEvidenceState: 'searched',
      workflowRuntimeReferenceSearchAttemptCount: 2,
      workflowRuntimeReferenceSearchSuccessCount: 1,
      workflowRuntimeReferenceSearchFailureCount: 1,
      workflowRuntimeReferenceCandidateCount: 0,
      workflowRuntimeReferenceActualReadCount: 0,
    })
    expect(knowledge?.data.workflowRuntimeReferenceSearchObservations).toHaveLength(2)
    expect(projection.edges.find((edge) => edge.data?.relationKind === 'agent_knowledge_reference')?.data)
      .toMatchObject({
        referenceEvidenceState: 'searched',
        referenceSearchAttemptCount: 2,
        referenceSearchFailureCount: 1,
      })
  })

  it('marks the aggregate as anomalous only when every recorded search attempt failed', () => {
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode: agentNode(),
      workflowExecutionId: 'workflow-execution-search-failed',
      readOnly: true,
      outputRefs: {
        promptExampleCandidateSearch: {
          version: 1,
          status: 'retrieval_failed',
          mediaType: 'video',
          attempted: true,
          remoteAttempted: false,
          candidateCount: 0,
          blocking: false,
          rationale: '逻辑任务身份缺失，检索在远端请求前被拒绝。',
          toolCallId: 'search-failed-1',
        },
      },
    })

    const knowledge = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'knowledge')
    expect(knowledge?.data).toMatchObject({
      label: '知识库 · 检索异常',
      workflowRuntimeReferenceDescription: '1 次案例检索均失败 · 本轮未读取正文',
      workflowRuntimeReferenceEvidenceState: 'search_failed',
      workflowRuntimeReferenceSearchAttemptCount: 1,
      workflowRuntimeReferenceSearchSuccessCount: 0,
      workflowRuntimeReferenceSearchFailureCount: 1,
    })
  })

  it('marks historical executions without persisted search receipts as unrecorded', () => {
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode: agentNode(),
      workflowExecutionId: 'workflow-execution-legacy',
      readOnly: true,
      outputRefs: {
        executionProvenance: {
          ...provenanceBase,
          executionId: 'physical-legacy',
        },
      },
    })

    const knowledge = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'knowledge')
    expect(knowledge?.data).toMatchObject({
      label: '知识库 · 历史未采集',
      workflowRuntimeReferenceDescription: '历史运行未采集案例检索回执 · 本轮未读取正文',
      workflowRuntimeReferenceEvidenceState: 'unrecorded',
      workflowRuntimeReferenceSearchAttemptCount: 0,
      workflowRuntimeReferenceActualReadCount: 0,
    })
  })

  it('projects universal catalog access before any execution history exists', () => {
    const firstAgent = agentNode()
    const secondAgent = {
      ...agentNode(),
      id: 'agent-node-2',
      data: {
        ...agentNode().data,
      },
    }
    useRFStore.setState({ nodes: [firstAgent, secondAgent], edges: [] })

    applyWorkflowAgentConfigurationProjection()

    const state = useRFStore.getState()
    const references = state.nodes.filter((node) => node.data.workflowRuntimeReference === true)
    expect(references).toHaveLength(4)
    expect(references.filter((node) => node.data.workflowRuntimeReferenceKind === 'skill'))
      .toHaveLength(2)
    expect(references.filter((node) => node.data.workflowRuntimeReferenceKind === 'knowledge'))
      .toHaveLength(2)
    expect(state.edges).toHaveLength(4)
    expect(state.edges.every((edge) => edge.target === firstAgent.id || edge.target === secondAgent.id))
      .toBe(true)
  })

  it('atomically rebuilds all derived access projections from an authoring-only replacement graph', () => {
    const firstAgent = agentNode()
    const secondAgent = {
      ...agentNode(),
      id: 'agent-node-2',
      position: { x: 800, y: 160 },
    }
    const graphContext = {
      workflowExecutionId: 'workflow-configuration',
      outputRefsByAgentNodeId: new Map<string, unknown>(),
      readOnly: false,
    } as const
    const visibleGraph = buildWorkflowAgentVisibleGraph({
      nodes: [
        {
          id: 'trigger-node',
          type: 'taskNode',
          position: { x: 0, y: 160 },
          data: { kind: 'workflowTrigger', adminWorkflow: true },
        },
        firstAgent,
        secondAgent,
      ],
      edges: [{ id: 'main-edge', source: 'trigger-node', target: firstAgent.id }],
      ...graphContext,
    })

    expect(visibleGraph.nodes).toHaveLength(7)
    expect(visibleGraph.edges).toHaveLength(5)
    expect(visibleGraph.nodes.filter((node) => node.data.workflowRuntimeReference === true))
      .toHaveLength(4)
    expect(visibleGraph.edges.filter((edge) => edge.data?.executionRole === 'reference_only'))
      .toHaveLength(4)
    expect(visibleGraph.edges.find((edge) => edge.id === 'main-edge')).toBeDefined()

    const rebuiltGraph = buildWorkflowAgentVisibleGraph({ ...visibleGraph, ...graphContext })
    expect(rebuiltGraph.nodes).toHaveLength(7)
    expect(rebuiltGraph.edges).toHaveLength(5)
    expect(new Set(rebuiltGraph.nodes.map((node) => node.id)).size).toBe(7)
    expect(new Set(rebuiltGraph.edges.map((edge) => edge.id)).size).toBe(5)
  })

  it('ignores legacy per-node mounts and only projects actual read provenance', () => {
    const owner = agentNode()
    owner.data.workflowRequiredSkills = ['legacy-fixed-skill']
    owner.data.workflowKnowledgeCardIds = ['legacy-fixed-card']
    const projection = buildWorkflowAgentReferenceProjection({
      agentNode: owner,
      workflowExecutionId: 'workflow-execution-2',
      outputRefs: { knowledgeCandidates: [{ cardId: 'candidate-only' }] },
      readOnly: false,
    })

    expect(projection.nodes).toHaveLength(2)
    const skill = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'skill')
    const knowledge = projection.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'knowledge')
    expect(skill?.data).toMatchObject({
      label: 'Skills · 全库',
      workflowRuntimeReferenceEvidenceState: 'available',
      workflowRuntimeReferenceActualReadCount: 0,
      workflowRuntimeReferenceItems: [],
    })
    expect(knowledge?.data).toMatchObject({
      label: '知识库 · 全库',
      workflowRuntimeReferenceEvidenceState: 'available',
      workflowRuntimeReferenceCount: 0,
      workflowRuntimeReferenceItems: [],
    })
    expect(projection.edges.find((edge) => edge.data?.relationKind === 'agent_knowledge_reference')?.data)
      .toMatchObject({ referenceState: 'available', referenceCount: 0 })
    expect(projection.edges.every((edge) => edge.data?.referenceState === 'available')).toBe(true)
    expect(JSON.stringify(projection).includes('legacy-fixed')).toBe(false)
  })
})
