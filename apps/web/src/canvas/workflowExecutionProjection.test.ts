import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNodeRunDto } from '../api/server'
import * as apiServer from '../api/server'
import {
  applyWorkflowNodeRuns,
  loadLatestWorkflowExecutionProjection,
  loadWorkflowExecutionProjection,
  restoreLatestWorkflowExecutionProjection,
  waitForWorkflowExecutionProjectionMatch,
  workflowExecutionProjectionMatchesCanvas,
} from './workflowExecutionProjection'
import { useRFStore } from './store'

describe('workflow execution node projection', () => {
  beforeEach(() => useRFStore.getState().reset())

  it('projects real typed ports, artifacts, evidence and terminal status onto the exact node', () => {
    useRFStore.setState({
      nodes: [{ id: 'agent', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage' } }],
    })
    const run: WorkflowNodeRunDto = {
      id: 'run-1',
      executionId: 'execution-1',
      nodeId: 'agent',
      status: 'success',
      attempt: 1,
      outputRefs: {
        ports: { result: { text: '完成' } },
        artifacts: [{ type: 'tapcanvas.json/v1', identity: 'task-1', value: { delivered: true } }],
        evidence: { deliveryVerification: { status: 'satisfied' } },
      },
      createdAt: '2026-08-11T10:00:00.000Z',
      startedAt: '2026-08-11T10:00:01.000Z',
      finishedAt: '2026-08-11T10:00:02.000Z',
    }

    applyWorkflowNodeRuns('execution-1', [run])

    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowExecutionId: 'execution-1',
      workflowStatus: 'succeeded',
      workflowLocalTestOutput: { result: { text: '完成' } },
      workflowOutputArtifactIds: ['task-1'],
      workflowOutputArtifacts: [{
        type: 'tapcanvas.json/v1',
        identity: 'task-1',
        value: { delivered: true },
      }],
      workflowExecutionEvidence: { deliveryVerification: { status: 'satisfied' } },
    })
  })

  it('projects per-item history and aggregate progress without mutating the workflow graph', () => {
    useRFStore.setState({
      nodes: [{ id: 'video', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage' } }],
      edges: [],
    })
    const run: WorkflowNodeRunDto = {
      id: 'run-items',
      executionId: 'execution-items',
      nodeId: 'video',
      status: 'success',
      attempt: 1,
      outputRefs: {
        ports: { videos: { protocolVersion: 'workflow.collection/v1', collectionId: 'videos', items: [] } },
        artifacts: [],
        evidence: { completedItems: 2, totalItems: 2 },
        itemRuns: [
          { itemId: 'segment-1', index: 0, status: 'success', runtimeNodeId: 'video::item::segment-1' },
          { itemId: 'segment-2', index: 1, status: 'success', runtimeNodeId: 'video::item::segment-2' },
        ],
      },
      createdAt: '2026-08-11T10:00:00.000Z',
      startedAt: '2026-08-11T10:00:01.000Z',
      finishedAt: '2026-08-11T10:00:02.000Z',
    }

    applyWorkflowNodeRuns('execution-items', [run])

    // 占位节点是 workflowRuntimeReference 投影节点（不写回 flow、不同步服务端），
    // 除它之外画布不应新增任何节点。
    const authoringNodes = useRFStore.getState().nodes.filter((node) => (
      !(node.data && typeof node.data === 'object' && !Array.isArray(node.data))
      || (node.data as Record<string, unknown>).workflowRuntimeReference !== true
    ))
    expect(authoringNodes).toHaveLength(1)
    expect(useRFStore.getState().nodes.find((node) => node.id === 'wf-exec-execution-items')?.data).toMatchObject({
      kind: 'workflowExecution',
      workflowRuntimeReference: true,
      workflowExecutionId: 'execution-items',
      workflowStatus: 'succeeded',
      workflowCompletedUnits: 1,
      workflowTotalUnits: 1,
      workflowErrorCount: 0,
    })
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowCompletedUnits: 2,
      workflowTotalUnits: 2,
      workflowErrorCount: 0,
      workflowItemRuns: [
        { itemId: 'segment-1', status: 'success' },
        { itemId: 'segment-2', status: 'success' },
      ],
    })
  })

  it('uses checkpoint evidence for the real total before every item has settled', () => {
    useRFStore.setState({
      nodes: [{ id: 'agent', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage' } }],
    })
    applyWorkflowNodeRuns('execution-running', [{
      id: 'run-progress',
      executionId: 'execution-running',
      nodeId: 'agent',
      status: 'running',
      attempt: 1,
      outputRefs: {
        ports: {},
        artifacts: [],
        evidence: { completedItems: 2, failedItems: 1, settledItems: 3, totalItems: 19 },
        itemRuns: [
          { itemId: 'segment-1', index: 0, status: 'success', runtimeNodeId: 'agent::item::segment-1' },
          { itemId: 'segment-2', index: 1, status: 'success', runtimeNodeId: 'agent::item::segment-2' },
          { itemId: 'segment-3', index: 2, status: 'failed', runtimeNodeId: 'agent::item::segment-3' },
        ],
      },
      createdAt: '2026-08-11T10:00:00.000Z',
      startedAt: '2026-08-11T10:00:01.000Z',
      finishedAt: null,
    }])

    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowStatus: 'running',
      workflowCompletedUnits: 2,
      workflowTotalUnits: 19,
      workflowErrorCount: 1,
    })
  })

  it('projects a factual provider balance wait without reusing a historical error', () => {
    useRFStore.setState({
      nodes: [{ id: 'agent', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'workflowStage' } }],
    })
    applyWorkflowNodeRuns('execution-balance', [{
      id: 'run-balance',
      executionId: 'execution-balance',
      nodeId: 'agent',
      status: 'waiting_external',
      attempt: 2,
      errorCode: null,
      errorMessage: null,
      failureStage: null,
      outputRefs: {
        evidence: {
          continuationReason: 'provider_balance_required',
          requestTerminal: { status: 'suspended', reason: 'provider_balance_required' },
          deliveryEvidence: {
            recoveryCheckpoint: { reasonCode: 'provider_balance_required' },
          },
        },
        externalCheck: { version: 1, mode: 'poll', notBeforeAt: '2026-08-22T23:20:00.000Z' },
      },
      createdAt: '2026-08-22T21:42:17.547Z',
      startedAt: '2026-08-22T21:42:17.768Z',
      finishedAt: null,
    }])

    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowStatus: 'waiting_external',
      workflowWaitingReasonCode: 'provider_balance_required',
      workflowWaitingReasonLabel: '等待余额恢复',
      workflowErrorDetail: undefined,
    })
  })

  it('restores the newest durable execution after the authoring canvas is reloaded', async () => {
    useRFStore.setState({
      nodes: [
        {
          id: 'trigger',
          type: 'taskNode',
          position: { x: -320, y: 0 },
          data: {
            kind: 'workflowTrigger',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowTriggerSpec: { version: 1, kind: 'manual' },
            workflowStatus: 'running',
          },
        },
        {
          id: 'prompt-agent',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
            workflowStatus: 'failed',
            workflowErrorDetail: '旧画布失败',
          },
        },
      ],
      edges: [{ id: 'trigger-agent', source: 'trigger', target: 'prompt-agent' }],
    })
    vi.spyOn(apiServer, 'listWorkflowExecutions').mockResolvedValueOnce([{
      id: 'execution-latest',
      flowId: 'flow-1',
      flowVersionId: 'version-1',
      ownerId: 'owner-1',
      status: 'success',
      concurrency: 1,
      createdAt: '2026-08-12T04:24:13.000Z',
      finishedAt: '2026-08-12T04:28:37.000Z',
    }])
    vi.spyOn(apiServer, 'listWorkflowNodeRuns').mockResolvedValueOnce([
      {
        id: 'trigger-run-latest',
        executionId: 'execution-latest',
        nodeId: 'trigger',
        status: 'success',
        attempt: 1,
        createdAt: '2026-08-12T04:24:13.000Z',
        finishedAt: '2026-08-12T04:24:14.000Z',
        outputRefs: { executorRef: 'workflow.trigger/v1', ports: { trigger: { occurredAt: '2026-08-12T04:24:13.000Z' } } },
      },
      {
        id: 'node-run-latest',
        executionId: 'execution-latest',
        nodeId: 'prompt-agent',
        status: 'success',
        attempt: 1,
        createdAt: '2026-08-12T04:24:14.000Z',
        finishedAt: '2026-08-12T04:28:36.000Z',
        outputRefs: {
          executorRef: 'agents.logical-task/v2',
          ports: { result: { protocolVersion: 'workflow.collection/v1', collectionId: 'prompts', items: [] } },
          evidence: { completedItems: 29, totalItems: 29 },
          artifacts: [{ type: 'tapcanvas.video-prompt/v1', identity: 'prompt-artifact-1' }],
          itemRuns: Array.from({ length: 29 }, (_, index) => ({
            itemId: `clip-${index + 1}`,
            index,
            runtimeNodeId: `prompt-agent::item::clip-${index + 1}`,
            status: 'success',
          })),
        },
      },
    ])

    await expect(restoreLatestWorkflowExecutionProjection('flow-1')).resolves.toBe('execution-latest')
    expect(apiServer.listWorkflowExecutions).toHaveBeenCalledWith({ flowId: 'flow-1', limit: 1 })
    expect(apiServer.listWorkflowNodeRuns).toHaveBeenCalledWith('execution-latest')
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowExecutionId: 'execution-latest',
      workflowStatus: 'succeeded',
    })
    expect(useRFStore.getState().nodes[1]?.data).toMatchObject({
      workflowExecutionId: 'execution-latest',
      workflowStatus: 'succeeded',
      workflowCompletedUnits: 29,
      workflowTotalUnits: 29,
      workflowErrorCount: 0,
      workflowErrorDetail: undefined,
    })
  })

  it('ignores terminal history when an AI workflow project asks for an active-only entry projection', async () => {
    vi.spyOn(apiServer, 'listWorkflowExecutions').mockResolvedValueOnce([{
      id: 'execution-complete',
      flowId: 'flow-1',
      flowVersionId: 'version-1',
      ownerId: 'owner-1',
      status: 'success',
      concurrency: 1,
      createdAt: '2026-08-12T04:24:13.000Z',
      finishedAt: '2026-08-12T04:28:37.000Z',
    }])
    const nodeRuns = vi.spyOn(apiServer, 'listWorkflowNodeRuns')

    await expect(loadLatestWorkflowExecutionProjection('flow-1', { activeOnly: true })).resolves.toBeNull()
    expect(apiServer.listWorkflowExecutions).toHaveBeenCalledWith({
      flowId: 'flow-1',
      limit: 1,
      activeOnly: true,
    })
    expect(nodeRuns).not.toHaveBeenCalled()
  })

  it('still restores a real running execution in active-only mode', async () => {
    vi.spyOn(apiServer, 'listWorkflowExecutions').mockResolvedValueOnce([
      {
        id: 'execution-complete',
        flowId: 'flow-1',
        flowVersionId: 'version-2',
        ownerId: 'owner-1',
        status: 'success',
        concurrency: 1,
        createdAt: '2026-08-12T05:24:13.000Z',
        finishedAt: '2026-08-12T05:28:37.000Z',
      },
      {
        id: 'execution-running',
        flowId: 'flow-1',
        flowVersionId: 'version-1',
        ownerId: 'owner-1',
        status: 'running',
        concurrency: 1,
        createdAt: '2026-08-12T04:24:13.000Z',
        finishedAt: null,
      },
    ])
    vi.spyOn(apiServer, 'listWorkflowNodeRuns').mockResolvedValueOnce([])

    await expect(loadLatestWorkflowExecutionProjection('flow-1', { activeOnly: true })).resolves.toEqual({
      executionId: 'execution-running',
      runs: [],
    })
    expect(apiServer.listWorkflowNodeRuns).toHaveBeenCalledWith('execution-running')
  })

  it('loads the latest physical member of the logical family pinned by a chapter delivery projection', async () => {
    const runs: WorkflowNodeRunDto[] = [{
      id: 'run-failed',
      executionId: 'execution-recovery',
      nodeId: 'estimate',
      status: 'failed',
      attempt: 3,
      errorMessage: 'missing resolution',
      createdAt: '2026-08-28T01:46:23.000Z',
      finishedAt: '2026-08-28T01:53:07.000Z',
      outputRefs: {},
    }]
    vi.spyOn(apiServer, 'getWorkflowExecutionFamily').mockResolvedValueOnce({
      executionFamilyId: 'execution-pinned',
      rootExecutionId: 'execution-pinned',
      latestExecutionId: 'execution-recovery',
      latestExecutionStatus: 'failed',
      activeExecutionIds: [],
      activeExecutionCount: 0,
      activeExecutionIdsTruncated: false,
      executionCount: 2,
      successfulExecutionCount: 0,
      nodeAttemptCount: 4,
      createdAt: '2026-08-28T01:40:00.000Z',
      updatedAt: '2026-08-28T01:53:07.000Z',
      executions: [],
      nextCursor: null,
    })
    vi.spyOn(apiServer, 'listWorkflowNodeRuns').mockResolvedValueOnce(runs)

    await expect(loadWorkflowExecutionProjection(' execution-pinned ')).resolves.toEqual({
      executionId: 'execution-recovery',
      runs,
    })
    expect(apiServer.getWorkflowExecutionFamily).toHaveBeenCalledWith('execution-pinned', 1)
    expect(apiServer.listWorkflowNodeRuns).toHaveBeenCalledWith('execution-recovery')
  })

  it('does not let an older execution overwrite a newer projected node state', () => {
    useRFStore.setState({
      nodes: [{
        id: 'agent',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'workflowStage',
          workflowExecutionId: 'execution-new',
          workflowExecutionCreatedAt: '2026-08-12T05:00:00.000Z',
          workflowStatus: 'succeeded',
          workflowLocalTestOutput: { result: { text: 'new' } },
        },
      }],
    })

    applyWorkflowNodeRuns('execution-old', [{
      id: 'run-old',
      executionId: 'execution-old',
      nodeId: 'agent',
      status: 'failed',
      attempt: 1,
      errorMessage: 'old failure',
      createdAt: '2026-08-12T04:00:00.000Z',
      finishedAt: '2026-08-12T04:01:00.000Z',
      outputRefs: { ports: { result: { text: 'old' } } },
    }])

    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowExecutionId: 'execution-new',
      workflowExecutionCreatedAt: '2026-08-12T05:00:00.000Z',
      workflowStatus: 'succeeded',
      workflowLocalTestOutput: { result: { text: 'new' } },
    })
  })

  it('clears stale descendant results when the latest execution stops at an upstream node', () => {
    useRFStore.setState({
      nodes: [
        {
          id: 'trigger',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            kind: 'workflowTrigger',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowTriggerSpec: { version: 1, kind: 'manual' },
          },
        },
        {
          id: 'agent',
          type: 'taskNode',
          position: { x: 320, y: 0 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
            workflowExecutionId: 'execution-old',
            workflowExecutionCreatedAt: '2026-08-12T04:00:00.000Z',
            workflowStatus: 'succeeded',
            workflowLocalTestOutput: { result: { text: 'stale' } },
            workflowOutputArtifactIds: ['stale-artifact'],
          },
        },
      ],
      edges: [{ id: 'trigger-agent', source: 'trigger', target: 'agent' }],
    })

    applyWorkflowNodeRuns('execution-prefix', [{
      id: 'trigger-run',
      executionId: 'execution-prefix',
      nodeId: 'trigger',
      status: 'success',
      attempt: 1,
      createdAt: '2026-08-12T05:00:00.000Z',
      finishedAt: '2026-08-12T05:00:01.000Z',
      outputRefs: { executorRef: 'workflow.trigger/v1' },
    }])

    expect(useRFStore.getState().nodes[1]?.data).toMatchObject({
      workflowExecutionId: 'execution-prefix',
      workflowExecutionCreatedAt: '2026-08-12T05:00:00.000Z',
      workflowStatus: 'queued',
      workflowOutputArtifactIds: [],
      workflowItemRuns: [],
      workflowCompletedUnits: 0,
      workflowErrorCount: 0,
    })
    expect(useRFStore.getState().nodes[1]?.data.workflowLocalTestOutput).toBeUndefined()
  })

  it('keeps display-only Skill references out of execution reset and compatibility checks', () => {
    useRFStore.setState({
      nodes: [
        {
          id: 'agent',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
          },
        },
        {
          id: 'agent-skills',
          type: 'taskNode',
          position: { x: 0, y: 160 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowRuntimeReference: true,
            workflowRuntimeReferenceEvidenceState: 'actual_read',
            workflowStatus: 'succeeded',
          },
        },
      ],
      edges: [{
        id: 'skills-agent',
        source: 'agent-skills',
        target: 'agent',
        data: {
          executionRole: 'reference_only',
          relationKind: 'agent_skill_reference',
        },
      }],
    })
    const run: WorkflowNodeRunDto = {
      id: 'agent-run',
      executionId: 'execution-reference-safe',
      nodeId: 'agent',
      status: 'running',
      attempt: 1,
      createdAt: '2026-08-15T02:00:00.000Z',
      outputRefs: { executorRef: 'agents.logical-task/v2' },
    }

    expect(workflowExecutionProjectionMatchesCanvas([run])).toBe(true)
    applyWorkflowNodeRuns('execution-reference-safe', [run])
    expect(useRFStore.getState().nodes.find((node) => node.id === 'agent-skills')?.data)
      .toMatchObject({
        workflowRuntimeReferenceEvidenceState: 'actual_read',
        workflowStatus: 'succeeded',
      })
  })

  it('waits for Studio canvas hydration before deciding whether an execution is compatible', async () => {
    const runs: WorkflowNodeRunDto[] = [{
      id: 'trigger-run',
      executionId: 'execution-hydration-race',
      nodeId: 'trigger',
      status: 'success',
      attempt: 1,
      createdAt: '2026-08-15T00:00:00.000Z',
      outputRefs: { executorRef: 'workflow.trigger/v1' },
    }, {
      id: 'agent-run',
      executionId: 'execution-hydration-race',
      nodeId: 'agent',
      status: 'success',
      attempt: 1,
      createdAt: '2026-08-15T00:00:01.000Z',
      outputRefs: { executorRef: 'agents.logical-task/v2' },
    }]
    useRFStore.setState({
      nodes: [{
        id: 'trigger',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'workflowTrigger',
          adminWorkflow: true,
          workflowInstanceId: 'workflow-1',
          workflowTriggerSpec: { version: 1, kind: 'manual' },
        },
      }],
      edges: [],
    })

    const match = waitForWorkflowExecutionProjectionMatch(runs, 1_000)
    useRFStore.setState({
      nodes: [...useRFStore.getState().nodes, {
        id: 'agent',
        type: 'taskNode',
        position: { x: 320, y: 0 },
        data: {
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowInstanceId: 'workflow-1',
          workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
        },
      }],
      edges: [{ id: 'trigger-agent', source: 'trigger', target: 'agent' }],
    })

    await expect(match).resolves.toBe(true)
  })

  it('rejects an old full execution after a new required dependency is inserted', () => {
    useRFStore.setState({
      nodes: [
        {
          id: 'prompt-agent',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowAtomicSpec: { executorRef: 'agents.logical-task/v2' },
          },
        },
        {
          id: 'video',
          type: 'taskNode',
          position: { x: 320, y: 0 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowAtomicSpec: { executorRef: 'tapcanvas.video.generate/v1' },
          },
        },
        {
          id: 'delivery',
          type: 'taskNode',
          position: { x: 640, y: 0 },
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            workflowAtomicSpec: { executorRef: 'agents.delivery.verify/v2' },
          },
        },
      ],
      edges: [
        { id: 'prompt-video', source: 'prompt-agent', target: 'video' },
        { id: 'video-delivery', source: 'video', target: 'delivery' },
      ],
    })
    const oldRuns: WorkflowNodeRunDto[] = [
      {
        id: 'prompt-run',
        executionId: 'old-execution',
        nodeId: 'prompt-agent',
        status: 'success',
        attempt: 1,
        createdAt: '2026-08-12T04:24:14.000Z',
        outputRefs: { executorRef: 'agents.logical-task/v2' },
      },
      {
        id: 'delivery-run',
        executionId: 'old-execution',
        nodeId: 'delivery',
        status: 'success',
        attempt: 1,
        createdAt: '2026-08-12T04:24:15.000Z',
        outputRefs: { executorRef: 'agents.delivery.verify/v2' },
      },
    ]

    expect(workflowExecutionProjectionMatchesCanvas(oldRuns)).toBe(false)
    expect(workflowExecutionProjectionMatchesCanvas([oldRuns[0]!])).toBe(true)
  })

  it('creates a single execution placeholder node for a triggered run without template nodes', () => {
    // 小T 触发场景：画布可能没有任何 workflowStage/trigger 模板节点，只有普通节点。
    useRFStore.setState({
      nodes: [{ id: 'plain', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'text' } }],
      edges: [],
    })

    applyWorkflowNodeRuns('execution-xt-triggered', [{
      id: 'run-1',
      executionId: 'execution-xt-triggered',
      nodeId: 'beat-sheet-agent',
      status: 'running',
      attempt: 1,
      createdAt: '2026-08-16T00:00:00.000Z',
      startedAt: '2026-08-16T00:00:00.000Z',
      outputRefs: { executorRef: 'agents.logical-task/v2' },
    }, {
      id: 'run-2',
      executionId: 'execution-xt-triggered',
      nodeId: 'beat-sheet-format',
      status: 'queued',
      attempt: 1,
      createdAt: '2026-08-16T00:00:01.000Z',
      outputRefs: { executorRef: 'workflow.transform/v1' },
    }])

    const placeholder = useRFStore.getState().nodes.find((node) => node.id === 'wf-exec-execution-xt-triggered')
    expect(placeholder).toBeDefined()
    expect(placeholder?.data).toMatchObject({
      kind: 'workflowExecution',
      workflowRuntimeReference: true,
      workflowExecutionId: 'execution-xt-triggered',
      workflowStatus: 'running',
      workflowCompletedUnits: 0,
      workflowTotalUnits: 2,
      workflowErrorCount: 0,
    })
    expect(placeholder?.type).toBe('workflowExecutionNode')
    // 模板节点不被投影（画布没有对应节点），普通节点保持原样。
    expect(useRFStore.getState().nodes.find((node) => node.id === 'plain')?.data).toMatchObject({ kind: 'text' })
  })

  it('reuses the durable admission node instead of creating a runtime duplicate', () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-execution-status',
        type: 'workflowExecutionNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'workflowExecution',
          managedProjection: 'workflow_execution',
          workflowRuntimeReference: false,
          workflowExecutionId: 'execution-durable',
          workflowExecutionCreatedAt: '2026-08-23T00:00:00.000Z',
          workflowStatus: 'queued',
        },
      }],
      edges: [],
    })

    applyWorkflowNodeRuns('execution-durable', [{
      id: 'run-durable',
      executionId: 'execution-durable',
      nodeId: 'beat-sheet-agent',
      status: 'running',
      attempt: 1,
      createdAt: '2026-08-23T00:00:00.000Z',
      outputRefs: {},
    }])

    expect(useRFStore.getState().nodes).toHaveLength(1)
    expect(useRFStore.getState().nodes[0]).toMatchObject({
      id: 'workflow-execution-status',
      data: {
        workflowRuntimeReference: false,
        workflowExecutionId: 'execution-durable',
        workflowStatus: 'running',
      },
    })
  })

  it('advances the durable admission node to a newer recovery family member', () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-execution-status',
        type: 'workflowExecutionNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'workflowExecution',
          managedProjection: 'workflow_execution',
          workflowRuntimeReference: false,
          workflowExecutionId: 'execution-root',
          workflowExecutionCreatedAt: '2026-08-23T00:00:00.000Z',
          workflowStatus: 'cancelled',
        },
      }],
      edges: [],
    })

    applyWorkflowNodeRuns('execution-recovery', [{
      id: 'run-recovery',
      executionId: 'execution-recovery',
      nodeId: 'beat-sheet-agent',
      status: 'running',
      attempt: 1,
      createdAt: '2026-08-23T00:05:00.000Z',
      outputRefs: {},
    }])

    expect(useRFStore.getState().nodes).toHaveLength(1)
    expect(useRFStore.getState().nodes[0]).toMatchObject({
      id: 'workflow-execution-status',
      data: {
        workflowExecutionId: 'execution-recovery',
        workflowExecutionCreatedAt: '2026-08-23T00:05:00.000Z',
        workflowStatus: 'running',
      },
    })
  })

  it('turns the execution placeholder green on full success and red on any failure', () => {
    useRFStore.setState({ nodes: [], edges: [] })

    applyWorkflowNodeRuns('execution-xt-ok', [
      { id: 'r1', executionId: 'execution-xt-ok', nodeId: 'a', status: 'success', attempt: 1, createdAt: '2026-08-16T01:00:00.000Z', finishedAt: '2026-08-16T01:00:01.000Z', outputRefs: {} },
      { id: 'r2', executionId: 'execution-xt-ok', nodeId: 'b', status: 'success', attempt: 1, createdAt: '2026-08-16T01:00:01.000Z', finishedAt: '2026-08-16T01:00:02.000Z', outputRefs: {} },
    ])
    expect(useRFStore.getState().nodes.find((node) => node.id === 'wf-exec-execution-xt-ok')?.data)
      .toMatchObject({ workflowStatus: 'succeeded', workflowCompletedUnits: 2, workflowTotalUnits: 2 })

    applyWorkflowNodeRuns('execution-xt-fail', [
      { id: 'r1', executionId: 'execution-xt-fail', nodeId: 'a', status: 'success', attempt: 1, createdAt: '2026-08-16T02:00:00.000Z', finishedAt: '2026-08-16T02:00:01.000Z', outputRefs: {} },
      { id: 'r2', executionId: 'execution-xt-fail', nodeId: 'b', status: 'failed', attempt: 2, errorMessage: 'boom', createdAt: '2026-08-16T02:00:01.000Z', finishedAt: '2026-08-16T02:00:03.000Z', outputRefs: {} },
    ])
    expect(useRFStore.getState().nodes.find((node) => node.id === 'wf-exec-execution-xt-fail')?.data)
      .toMatchObject({ workflowStatus: 'failed', workflowCompletedUnits: 1, workflowTotalUnits: 2, workflowErrorCount: 1 })
  })

  it('keeps only the newest execution placeholder and rejects an older execution later', () => {
    useRFStore.setState({ nodes: [], edges: [] })

    applyWorkflowNodeRuns('execution-old', [{
      id: 'r-old', executionId: 'execution-old', nodeId: 'a', status: 'running', attempt: 1,
      createdAt: '2026-08-16T03:00:00.000Z', startedAt: '2026-08-16T03:00:00.000Z', outputRefs: {},
    }])
    expect(useRFStore.getState().nodes.some((node) => node.id === 'wf-exec-execution-old')).toBe(true)

    applyWorkflowNodeRuns('execution-new', [{
      id: 'r-new', executionId: 'execution-new', nodeId: 'a', status: 'running', attempt: 1,
      createdAt: '2026-08-16T04:00:00.000Z', startedAt: '2026-08-16T04:00:00.000Z', outputRefs: {},
    }])
    expect(useRFStore.getState().nodes.some((node) => node.id === 'wf-exec-execution-new')).toBe(true)
    expect(useRFStore.getState().nodes.some((node) => node.id === 'wf-exec-execution-old')).toBe(false)

    // 乱序：更旧的执行事件晚到，不得复活旧占位或顶掉新占位。
    applyWorkflowNodeRuns('execution-old', [{
      id: 'r-old-late', executionId: 'execution-old', nodeId: 'a', status: 'failed', attempt: 2,
      errorMessage: 'late failure', createdAt: '2026-08-16T03:00:00.000Z',
      startedAt: '2026-08-16T03:00:00.000Z', finishedAt: '2026-08-16T03:00:05.000Z', outputRefs: {},
    }])
    expect(useRFStore.getState().nodes.some((node) => node.id === 'wf-exec-execution-new')).toBe(true)
    expect(useRFStore.getState().nodes.some((node) => node.id === 'wf-exec-execution-old')).toBe(false)
  })

  it('restores the execution placeholder on reload even without matching template nodes', async () => {
    useRFStore.setState({ nodes: [], edges: [] })
    vi.spyOn(apiServer, 'listWorkflowExecutions').mockResolvedValueOnce([{
      id: 'execution-xt-latest',
      flowId: 'flow-1',
      flowVersionId: 'version-1',
      ownerId: 'owner-1',
      status: 'running',
      concurrency: 1,
      createdAt: '2026-08-16T05:00:00.000Z',
      startedAt: '2026-08-16T05:00:00.000Z',
    }])
    vi.spyOn(apiServer, 'listWorkflowNodeRuns').mockResolvedValueOnce([
      {
        id: 'trigger-run',
        executionId: 'execution-xt-latest',
        nodeId: 'trigger',
        status: 'success',
        attempt: 1,
        createdAt: '2026-08-16T05:00:00.000Z',
        finishedAt: '2026-08-16T05:00:01.000Z',
        outputRefs: { executorRef: 'workflow.trigger/v1' },
      },
      {
        id: 'agent-run',
        executionId: 'execution-xt-latest',
        nodeId: 'beat-sheet-agent',
        status: 'running',
        attempt: 1,
        createdAt: '2026-08-16T05:00:01.000Z',
        startedAt: '2026-08-16T05:00:01.000Z',
        outputRefs: { executorRef: 'agents.logical-task/v2' },
      },
    ])

    await expect(restoreLatestWorkflowExecutionProjection('flow-1')).resolves.toBe('execution-xt-latest')
    expect(useRFStore.getState().nodes.find((node) => node.id === 'wf-exec-execution-xt-latest')?.data)
      .toMatchObject({
        workflowExecutionId: 'execution-xt-latest',
        workflowStatus: 'running',
        workflowTotalUnits: 2,
      })
  })
})
