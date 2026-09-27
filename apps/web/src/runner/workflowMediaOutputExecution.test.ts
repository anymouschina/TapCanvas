import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowExecutionDto, WorkflowExecutionFamilyDto, WorkflowNodeRunDto } from '../api/server'
import { resolveWorkflowMediaOutputSlot } from '../canvas/workflowMediaAttemptProjection'
import {
  planWorkflowMediaOutputRetry,
  resumeWorkflowMediaOutput,
  resumeWorkflowMediaOutputs,
  WorkflowMediaExecutionStillActiveError,
} from './workflowMediaOutputExecution'

const mocks = vi.hoisted(() => ({
  getFamily: vi.fn(),
  getExecution: vi.fn(),
  listRuns: vi.fn(),
  resume: vi.fn(),
}))

vi.mock('../api/server', () => ({
  getWorkflowExecutionFamily: mocks.getFamily,
  getWorkflowExecution: mocks.getExecution,
  listWorkflowNodeRuns: mocks.listRuns,
  resumeWorkflowExecution: mocks.resume,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function mediaNode(id: string, kind: 'image' | 'video', runtimeNodeId: string) {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: {
      kind,
      status: 'failed',
      workflowExecutionId: 'execution-1',
      workflowExecutionFamilyId: 'family-1',
      workflowRuntimeNodeId: runtimeNodeId,
      workflowEffectId: `${runtimeNodeId}:effect`,
    },
  } as const
}

function failedRun(outputRefs: unknown): WorkflowNodeRunDto {
  return {
    id: 'run-images',
    executionId: 'execution-1',
    nodeId: 'images',
    status: 'failed',
    attempt: 1,
    createdAt: '2026-09-23T00:00:00.000Z',
    outputRefs,
  }
}

describe('workflow media retry planning', () => {
  it('maps a canvas item runtime to its failed collection parent and retries only that exact receipt', () => {
    const source = mediaNode('canvas-cover', 'image', 'images::item::cover')
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = failedRun({
      protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
      executionMode: 'each', ports: {}, artifacts: [], evidence: {},
      itemRuns: [
        {
          itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
          evidence: { canvasNodeId: 'canvas-cover', taskId: 'task-cover-failed', providerStatus: 'failed' }, artifacts: [],
        },
        {
          itemId: 'portrait', index: 1, runtimeNodeId: 'images::item::portrait', status: 'success',
          evidence: { canvasNodeId: 'canvas-portrait', taskId: 'task-portrait' },
          artifacts: [{ type: 'tapcanvas.image/v1', value: 'https://assets.example/portrait.png' }],
        },
      ],
    })

    expect(planWorkflowMediaOutputRetry({ slot: slot!, run })).toEqual({
      nodeId: 'images',
      mediaRetries: [{ nodeId: 'images', itemId: 'cover', taskId: 'task-cover-failed' }],
    })
  })

  it('allows a video retry with null task identity only when the item has an exact failed canvas receipt', () => {
    const source = mediaNode('canvas-video', 'video', 'video::item::clip')
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = failedRun({
      protocolVersion: '1', executorRef: 'tapcanvas.video.generate/v1', nodeId: 'images',
      executionMode: 'each', ports: {}, artifacts: [], evidence: {},
      itemRuns: [{
        itemId: 'clip', index: 0, runtimeNodeId: 'video::item::clip', status: 'failed',
        evidence: { canvasNodeId: 'canvas-video', taskId: null, workflowSubmissionState: 'rejected_pre_upstream' }, artifacts: [],
      }],
    })
    expect(planWorkflowMediaOutputRetry({ slot: slot!, run }).mediaRetries).toEqual([
      { nodeId: 'images', itemId: 'clip', taskId: null },
    ])
  })

  it('allows a taskless image retry only with exact pre-upstream rejection and stable workflow task identity', () => {
    const source = {
      ...mediaNode('canvas-image-unsubmitted', 'image', 'images::item::cover'),
      data: {
        ...mediaNode('canvas-image-unsubmitted', 'image', 'images::item::cover').data,
        workflowTaskId: 'task_workflow_cover_stable',
        workflowSubmissionState: 'rejected_pre_upstream',
      },
    }
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = failedRun({
      protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
      executionMode: 'each', ports: {}, artifacts: [], evidence: {},
      itemRuns: [{
        itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
        evidence: {
          canvasNodeId: 'canvas-image-unsubmitted',
          taskId: null,
          workflowTaskId: 'task_workflow_cover_stable',
          workflowSubmissionState: 'rejected_pre_upstream',
          providerStatus: 'failed',
        },
        artifacts: [], ports: {},
      }],
    })
    expect(planWorkflowMediaOutputRetry({ slot: slot!, run }).mediaRetries).toEqual([
      { nodeId: 'images', itemId: 'cover', taskId: null },
    ])

    const unstableRun = failedRun({
      protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
      executionMode: 'each', ports: {}, artifacts: [], evidence: {},
      itemRuns: [{
        itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
        evidence: {
          canvasNodeId: 'canvas-image-unsubmitted',
          taskId: null,
          workflowSubmissionState: 'rejected_pre_upstream',
          providerStatus: 'failed',
        },
        artifacts: [], ports: {},
      }],
    })
    expect(() => planWorkflowMediaOutputRetry({ slot: slot!, run: unstableRun })).toThrow(/没有找到/u)
  })

  it('binds an executionMode=once image retry to its exact canvas receipt', () => {
    const source = mediaNode('canvas-image-once', 'image', 'image-once')
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = {
      ...failedRun({
        protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images-once',
        executionMode: 'once', ports: {}, artifacts: [],
        evidence: { canvasNodeId: 'canvas-image-once', taskId: 'task-image-once', providerStatus: 'failed' },
      }),
      nodeId: 'images-once',
    }

    expect(planWorkflowMediaOutputRetry({ slot: slot!, run })).toEqual({
      nodeId: 'images-once',
      mediaRetries: [{ nodeId: 'images-once', itemId: null, taskId: 'task-image-once' }],
    })
  })

  it('permits a taskless single video retry only for a confirmed pre-upstream rejection', () => {
    const source = {
      ...mediaNode('canvas-video-once', 'video', 'video-once'),
      data: {
        ...mediaNode('canvas-video-once', 'video', 'video-once').data,
        workflowSubmissionState: 'rejected_pre_upstream',
      },
    }
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = {
      ...failedRun({
        protocolVersion: '1', executorRef: 'tapcanvas.video.generate/v1', nodeId: 'video-once',
        executionMode: 'once', ports: {}, artifacts: [],
        evidence: { canvasNodeId: 'canvas-video-once', taskId: null, workflowSubmissionState: 'rejected_pre_upstream' },
      }),
      nodeId: 'video-once',
    }
    expect(planWorkflowMediaOutputRetry({ slot: slot!, run }).mediaRetries).toEqual([
      { nodeId: 'video-once', itemId: null, taskId: null },
    ])

    const uncertainSlot = resolveWorkflowMediaOutputSlot([
      { ...source, data: { ...source.data, workflowSubmissionState: 'submitting' } },
    ], source.id)
    expect(uncertainSlot).not.toBeNull()
    expect(() => planWorkflowMediaOutputRetry({ slot: uncertainSlot!, run })).toThrow(/没有找到/u)
  })

  it('refuses stale or ambiguous canvas receipt mapping and nonfailed runs', () => {
    const source = mediaNode('canvas-cover', 'image', 'images::item::cover')
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const staleRun = failedRun({
      protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
      executionMode: 'each', ports: {}, artifacts: [], evidence: {},
      itemRuns: [{
        itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
        evidence: { canvasNodeId: 'another-canvas-node', taskId: 'old-task' }, artifacts: [],
      }],
    })
    expect(() => planWorkflowMediaOutputRetry({ slot: slot!, run: staleRun })).toThrow(/没有找到/u)
    expect(() => planWorkflowMediaOutputRetry({ slot: slot!, run: { ...staleRun, status: 'success' } })).toThrow(/没有找到/u)
  })

  it('retries one exact failed media item from a terminal successful parent run', () => {
    const source = mediaNode('canvas-cover', 'image', 'images::item::cover')
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = {
      ...failedRun({
        protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
        executionMode: 'each', ports: {}, artifacts: [], evidence: {},
        itemRuns: [{
          itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
          evidence: { canvasNodeId: 'canvas-cover', taskId: 'task-cover-failed', providerStatus: 'failed' },
          artifacts: [], ports: {},
        }],
      }),
      status: 'success' as const,
    }

    expect(planWorkflowMediaOutputRetry({ slot: slot!, run })).toEqual({
      nodeId: 'images',
      mediaRetries: [{ nodeId: 'images', itemId: 'cover', taskId: 'task-cover-failed' }],
    })
  })

  it('does not treat a terminal parent success or error text as authoritative provider failure', () => {
    const source = mediaNode('canvas-cover', 'image', 'images::item::cover')
    const slot = resolveWorkflowMediaOutputSlot([source], source.id)
    expect(slot).not.toBeNull()
    const run = {
      ...failedRun({
        protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
        executionMode: 'each', ports: {}, artifacts: [], evidence: {},
        itemRuns: [{
          itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
          evidence: { canvasNodeId: 'canvas-cover', taskId: 'task-cover-failed', errorMessage: 'provider failed' },
          artifacts: [], ports: {},
        }],
      }),
      status: 'success' as const,
    }

    expect(() => planWorkflowMediaOutputRetry({ slot: slot!, run })).toThrow(/没有找到/u)
  })

  it('resumes a terminal successful execution with an exact failed collection item', async () => {
    const source = mediaNode('canvas-cover', 'image', 'images::item::cover')
    mocks.getFamily.mockResolvedValue({ latestExecutionId: 'execution-terminal' } as WorkflowExecutionFamilyDto)
    mocks.getExecution.mockResolvedValue({ id: 'execution-terminal', status: 'success' } as WorkflowExecutionDto)
    mocks.listRuns.mockResolvedValue([{
      ...failedRun({
        protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
        executionMode: 'each', ports: {}, artifacts: [], evidence: {},
        itemRuns: [{
          itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
          evidence: { canvasNodeId: 'canvas-cover', taskId: 'task-cover-failed', providerStatus: 'failed' },
          artifacts: [], ports: {},
        }],
      }),
      status: 'success',
      executionId: 'execution-terminal',
    }])
    mocks.resume.mockResolvedValue({ id: 'execution-retry' })

    await expect(resumeWorkflowMediaOutput([source], source.id)).resolves.toEqual({ id: 'execution-retry' })
    expect(mocks.resume).toHaveBeenCalledWith('execution-terminal', {
      mediaRetries: [{ nodeId: 'images', itemId: 'cover', taskId: 'task-cover-failed' }],
    })
  })

  it('resumes a terminal execution with a taskless image only when the durable pre-upstream identity matches', async () => {
    const source = {
      ...mediaNode('canvas-image-unsubmitted', 'image', 'images::item::cover'),
      data: {
        ...mediaNode('canvas-image-unsubmitted', 'image', 'images::item::cover').data,
        workflowTaskId: 'task_workflow_cover_stable',
        workflowSubmissionState: 'rejected_pre_upstream',
      },
    }
    mocks.getFamily.mockResolvedValue({ latestExecutionId: 'execution-terminal' } as WorkflowExecutionFamilyDto)
    mocks.getExecution.mockResolvedValue({ id: 'execution-terminal', status: 'failed' } as WorkflowExecutionDto)
    mocks.listRuns.mockResolvedValue([{
      ...failedRun({
        protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
        executionMode: 'each', ports: {}, artifacts: [], evidence: {},
        itemRuns: [{
          itemId: 'cover', index: 0, runtimeNodeId: 'images::item::cover', status: 'failed',
          evidence: {
            canvasNodeId: 'canvas-image-unsubmitted',
            taskId: null,
            workflowTaskId: 'task_workflow_cover_stable',
            workflowSubmissionState: 'rejected_pre_upstream',
            providerStatus: 'failed',
          },
          artifacts: [], ports: {},
        }],
      }),
      executionId: 'execution-terminal',
    }])
    mocks.resume.mockResolvedValue({ id: 'execution-retry' })

    await expect(resumeWorkflowMediaOutput([source], source.id)).resolves.toEqual({ id: 'execution-retry' })
    expect(mocks.resume).toHaveBeenCalledWith('execution-terminal', {
      mediaRetries: [{ nodeId: 'images', itemId: 'cover', taskId: null }],
    })
  })

  it('finds the exact failed image item inside a per-clip pipeline checkpoint', async () => {
    const outerId = 'clip-media-pipeline'
    const outerItemId = 'clip:0'
    const outerRuntimeId = `${outerId}::item::${encodeURIComponent(outerItemId)}`
    const imageNodeId = `${outerRuntimeId}::step::clip-asset-image-generate`
    const failedItemId = 'effect:failed'
    const failedRuntimeId = `${imageNodeId}::item::${encodeURIComponent(failedItemId)}`
    const source = mediaNode('canvas-failed-image', 'image', failedRuntimeId)
    mocks.getFamily.mockResolvedValue({ latestExecutionId: 'execution-terminal' } as WorkflowExecutionFamilyDto)
    mocks.getExecution.mockResolvedValue({ id: 'execution-terminal', status: 'failed' } as WorkflowExecutionDto)
    mocks.listRuns.mockResolvedValue([{
      ...failedRun({
        protocolVersion: '1', executorRef: 'workflow.pipeline.run/v1', nodeId: outerId,
        executionMode: 'each', ports: {}, artifacts: [], evidence: {},
        itemRuns: [{
          itemId: outerItemId, runtimeNodeId: outerRuntimeId, index: 0, status: 'failed', ports: {}, artifacts: [],
          evidence: { pipelineState: { protocolVersion: 'workflow.pipeline.state/v1', steps: {
            'clip-asset-image-generate': { status: 'success', outputRefs: {
              protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: imageNodeId,
              executionMode: 'each', ports: {}, artifacts: [], evidence: { partial: true },
              itemRuns: [
                { itemId: failedItemId, runtimeNodeId: failedRuntimeId, index: 0, status: 'failed', ports: {}, artifacts: [],
                  evidence: { canvasNodeId: source.id, taskId: 'task-failed', providerStatus: 'failed' } },
                { itemId: 'effect:success', runtimeNodeId: `${imageNodeId}::item::effect%3Asuccess`, index: 1,
                  status: 'success', ports: {}, artifacts: [{ type: 'tapcanvas.image/v1', value: 'https://assets.example/ok.png' }],
                  evidence: { canvasNodeId: 'canvas-success', taskId: 'task-success', providerStatus: 'success' } },
              ],
            } },
          } } },
        }],
      }),
      nodeId: outerId,
      executionId: 'execution-terminal',
    }])
    mocks.resume.mockResolvedValue({ id: 'execution-retry' })

    await expect(resumeWorkflowMediaOutput([source], source.id)).resolves.toEqual({ id: 'execution-retry' })
    expect(mocks.resume).toHaveBeenCalledWith('execution-terminal', {
      mediaRetries: [{ nodeId: imageNodeId, itemId: failedItemId, taskId: 'task-failed' }],
    })
  })

  it('does not widen a video upstream action to a node replay without an exact failed media item', async () => {
    const source = mediaNode('canvas-image', 'image', 'images::item::cover')
    mocks.getFamily.mockResolvedValue({ latestExecutionId: 'execution-terminal' } as WorkflowExecutionFamilyDto)
    mocks.getExecution.mockResolvedValue({ id: 'execution-terminal', status: 'failed' } as WorkflowExecutionDto)
    mocks.listRuns.mockResolvedValue([failedRun({
      protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
      executionMode: 'each', ports: {}, artifacts: [], itemRuns: [],
      evidence: { inputContractRejection: { protocolVersion: 'workflow.input-contract-rejection/v1',
        consumerNodeId: 'images', rejectedBindings: [{ targetPortId: 'source', sourceNodeId: 'upstream',
          sourceNodeRunId: 'run-upstream', sourcePortId: 'image', expectedContract: {}, artifacts: [] }],
      } },
    })])
    await expect(resumeWorkflowMediaOutputs([source], [source.id], { exactMediaRetriesOnly: true }))
      .rejects.toThrow('不能扩大恢复范围')
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('reports an active orphan image without claiming its unknown provider receipt will be checked', async () => {
    const source = mediaNode('canvas-orphan', 'image', 'images::item::orphan')
    mocks.getFamily.mockResolvedValue({ latestExecutionId: 'execution-active' } as WorkflowExecutionFamilyDto)
    mocks.getExecution.mockResolvedValue({ id: 'execution-active', status: 'running' } as WorkflowExecutionDto)

    await expect(resumeWorkflowMediaOutput([source], source.id)).rejects.toMatchObject({
      name: 'WorkflowMediaExecutionStillActiveError',
      executionId: 'execution-active',
      executionStatus: 'running',
      attemptStatus: 'failed',
      hasProviderTaskReceipt: false,
      message: expect.stringContaining('无法确认供应商是否已受理'),
    } satisfies Partial<WorkflowMediaExecutionStillActiveError>)
    expect(mocks.listRuns).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })
})
