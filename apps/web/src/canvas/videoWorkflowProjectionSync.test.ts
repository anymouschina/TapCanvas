import { describe, expect, it } from 'vitest'
import {
  VIDEO_ATOMIC_WORKFLOW_NODE_IDS,
  VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION,
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  type VideoAtomicWorkflowSnapshot,
} from '@tapcanvas/video-orchestrator-protocol'
import type { AgentDiagnosticsTraceDto } from '../api/server'
import { useRFStore } from './store'
import {
  findLatestVideoWorkflowSnapshot,
  applyVideoWorkflowSnapshot,
  markVideoWorkflowRequested,
} from './videoWorkflowProjectionSync'

function snapshot(workflowRunId: string, generatedAt: string): VideoAtomicWorkflowSnapshot {
  return {
    protocolVersion: VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION,
    workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    definitionVersion: 2,
    workflowRunId,
    executionScope: 'prompt_only',
    generatedAt,
    latestEventSeq: 2,
    nodes: VIDEO_ATOMIC_WORKFLOW_NODE_IDS.map((atomicNodeId) => ({
      workflowRunId,
      atomicNodeId,
      status: atomicNodeId === 'clip-writer-agent' ? 'succeeded' : 'queued',
      completedUnits: atomicNodeId === 'clip-writer-agent' ? 2 : 0,
      totalUnits: 1,
      inputArtifactIds: [],
      outputArtifactIds: [],
      effectIds: [],
      errorCount: 0,
      errorMessages: [],
      timing: { startedAt: null, updatedAt: null, finishedAt: null, durationMs: null },
      outputRefs: atomicNodeId === 'clip-writer-agent' ? {
        ports: { 'clip-prompts': ['A', 'B'] },
        artifacts: [],
        evidence: { totalItems: 2 },
        itemRuns: [{ itemId: 'clip-0', index: 0, status: 'success', runtimeNodeId: 'clip:0', ports: { 'clip-prompts': { text: 'A' } }, artifacts: [], evidence: {} }],
      } : { ports: {}, artifacts: [], evidence: {}, itemRuns: [] },
      latestEventSeq: 2,
    })),
  }
}

function trace(groupId: string, atomicWorkflow: VideoAtomicWorkflowSnapshot): AgentDiagnosticsTraceDto {
  return {
    id: `trace-${atomicWorkflow.workflowRunId}`,
    scopeType: 'project',
    scopeId: 'project-1',
    taskId: null,
    requestKind: 'agents_bridge',
    inputSummary: '',
    decisionLog: [],
    toolCalls: [{ name: 'tapcanvas_video_orchestrate', input: { groupId }, outputJson: { runId: atomicWorkflow.workflowRunId } }],
    meta: { asyncExecutionRuns: [{ runId: atomicWorkflow.workflowRunId, atomicWorkflow }] },
    resultSummary: null,
    errorCode: null,
    errorDetail: null,
    createdAt: '2026-08-11T08:00:01.000Z',
    status: 'waiting_async',
    sessionKey: null,
    workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    logicalTaskId: null,
    rootTraceId: null,
    parentTraceId: null,
    physicalRunId: null,
    workflowRunId: atomicWorkflow.workflowRunId,
    startedAt: '2026-08-11T08:00:01.000Z',
    updatedAt: atomicWorkflow.generatedAt,
    finishedAt: null,
    nextEventSeq: 1,
  }
}

describe('video workflow canvas projection sync', () => {
  it('selects the latest canonical snapshot for the exact source group', () => {
    const older = snapshot('run-old', '2026-08-11T08:00:02.000Z')
    const latest = snapshot('run-new', '2026-08-11T08:00:05.000Z')
    const unrelated = snapshot('run-other', '2026-08-11T08:00:09.000Z')

    const selected = findLatestVideoWorkflowSnapshot([
      trace('group-a', older),
      trace('group-a', latest),
      trace('group-b', unrelated),
    ], 'group-a', '2026-08-11T08:00:00.000Z')

    expect(selected?.workflowRunId).toBe('run-new')
  })

  it('does not attach an unrelated run when the source group identity is absent', () => {
    const selected = findLatestVideoWorkflowSnapshot(
      [trace('group-b', snapshot('run-other', '2026-08-11T08:00:09.000Z'))],
      'group-a',
      '2026-08-11T08:00:00.000Z',
    )

    expect(selected).toBeNull()
  })

  it('marks both the trigger and stages with one occurrence timestamp', () => {
    useRFStore.setState({
      nodes: [
        { id: 'trigger', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowTrigger', workflowInstanceId: 'wf-1' } },
        { id: 'stage', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage', workflowInstanceId: 'wf-1' } },
        { id: 'other', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage', workflowInstanceId: 'wf-2' } },
      ],
    })

    markVideoWorkflowRequested('wf-1', '2026-08-11T09:00:00.000Z')

    const nodes = useRFStore.getState().nodes
    expect(nodes.find((node) => node.id === 'trigger')?.data.workflowRequestedAt).toBe('2026-08-11T09:00:00.000Z')
    expect(nodes.find((node) => node.id === 'stage')?.data.workflowRequestedAt).toBe('2026-08-11T09:00:00.000Z')
    expect(nodes.find((node) => node.id === 'other')?.data.workflowRequestedAt).toBeUndefined()
  })

  it('projects each canvas operation from its own atomic node facts and outputs', () => {
    useRFStore.setState({
      nodes: [
        { id: 'trigger', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowTrigger', workflowInstanceId: 'wf-1' } },
        { id: 'writer', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage', workflowInstanceId: 'wf-1', workflowNodeId: 'clip-writer-agent', workflowProjectionNodeId: 'clip-contracts' } },
        { id: 'package', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage', workflowInstanceId: 'wf-1', workflowNodeId: 'prompt-package', workflowProjectionNodeId: 'clip-contracts' } },
      ],
    })

    applyVideoWorkflowSnapshot('wf-1', snapshot('run-atomic', '2026-08-11T08:00:05.000Z'))

    const writer = useRFStore.getState().nodes.find((node) => node.id === 'writer')
    const promptPackage = useRFStore.getState().nodes.find((node) => node.id === 'package')
    expect(writer?.data.workflowStatus).toBe('succeeded')
    expect(writer?.data.workflowLocalTestOutput).toEqual({ 'clip-prompts': ['A', 'B'] })
    expect(writer?.data.workflowItemRuns).toHaveLength(1)
    expect(promptPackage?.data.workflowStatus).toBe('queued')
  })
})
