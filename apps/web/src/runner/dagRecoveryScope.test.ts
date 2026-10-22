import type { Edge, Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowExecutionDto, WorkflowNodeRunDto } from '../api/server'
import { runNodeDagToTarget } from './dag'

const mocks = vi.hoisted(() => ({
  execution: vi.fn(), runs: vi.fn(), resume: vi.fn(), resumeMany: vi.fn(), apply: vi.fn(),
}))

vi.mock('../api/server', () => ({ getWorkflowExecution: mocks.execution, listWorkflowNodeRuns: mocks.runs }))
vi.mock('./workflowMediaOutputExecution', () => ({ resumeWorkflowMediaOutput: mocks.resume, resumeWorkflowMediaOutputs: mocks.resumeMany }))
vi.mock('../canvas/workflowExecutionProjection', () => ({ applyWorkflowNodeRuns: mocks.apply }))
vi.mock('./remoteRunner', () => ({ runNodeRemote: vi.fn() }))
vi.mock('./audioRunner', () => ({ runNodeAudio: vi.fn() }))
vi.mock('./mockRunner', () => ({ runNodeMock: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => { resolve = fulfill })
  return { promise, resolve }
}

const execution: WorkflowExecutionDto = {
  id: 'recovered', flowId: 'flow', flowVersionId: 'version', ownerId: 'owner',
  status: 'success', concurrency: 1, executionFamilyId: 'family', createdAt: '2026-10-21T00:00:00Z',
}
const runs: WorkflowNodeRunDto[] = [{
  id: 'run', executionId: execution.id, nodeId: 'images', status: 'success', attempt: 1,
  createdAt: execution.createdAt,
}]

function createGraph(path: 'target' | 'upstream') {
  const image: Node = {
    id: 'image', type: 'taskNode', position: { x: 0, y: 0 }, data: {
      kind: 'image', status: 'failed', workflowExecutionId: 'original',
      workflowExecutionFamilyId: 'family', workflowRuntimeNodeId: 'images::item::cover',
    },
  }
  const video: Node = {
    id: 'video', type: 'taskNode', position: { x: 100, y: 0 }, data: {
      kind: 'video', status: 'failed', referenceImageNodeIds: ['image'],
      workflowExecutionId: 'original', workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: 'videos::item::clip',
    },
  }
  let current = true
  const state = { graphProvenanceKey: 'flow:flow', nodes: path === 'target' ? [image] : [image, video], edges: [] as Edge[] }
  const get = () => {
    if (!current) throw new Error('画布已切换')
    return state
  }
  return { state, get, switchScope: () => { current = false }, targetId: path === 'target' ? image.id : video.id }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resume.mockResolvedValue(execution)
  mocks.resumeMany.mockResolvedValue(execution)
  mocks.execution.mockResolvedValue(execution)
  mocks.runs.mockResolvedValue(runs)
})

describe.each(['target', 'upstream'] as const)('workflow recovery scope: %s', (path) => {
  it('rejects responses from an in-flight recovery request after switching canvas without projecting them', async () => {
    const graph = createGraph(path)
    const response = deferred<WorkflowExecutionDto>()
    mocks.execution.mockReturnValue(response.promise)
    const work = runNodeDagToTarget(graph.targetId, graph.get, vi.fn())
    const rejected = expect(work).rejects.toThrow('画布已切换')
    await vi.waitFor(() => expect(mocks.execution).toHaveBeenCalledWith(execution.id))
    graph.switchScope()
    response.resolve(execution)
    await rejected
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(graph.state.nodes.every(node => node.data.status === 'failed')).toBe(true)
  })

  it('projects acknowledged recovery results and completes while the canvas remains current', async () => {
    const graph = createGraph(path)
    mocks.apply.mockImplementation(() => {
      graph.state.nodes = graph.state.nodes.map(node => ({ ...node, data: {
        ...node.data, status: 'success', workflowExecutionId: execution.id,
        ...(node.data.kind === 'image' ? { imageUrl: 'https://assets.example/cover.png' } : { videoUrl: 'https://assets.example/clip.mp4' }),
      } }))
    })
    await runNodeDagToTarget(graph.targetId, graph.get, vi.fn())
    expect(mocks.apply).toHaveBeenCalledTimes(1)
    expect(mocks.apply).toHaveBeenCalledWith(execution.id, runs, execution.status, execution.executionFamilyId)
    expect(graph.state.nodes.every(node => node.data.status === 'success')).toBe(true)
  })

  it('does not request recovery receipts if the canvas switches while recovery is being accepted', async () => {
    const graph = createGraph(path)
    const acceptance = deferred<WorkflowExecutionDto>()
    const resume = path === 'target' ? mocks.resume : mocks.resumeMany
    resume.mockReturnValue(acceptance.promise)
    const work = runNodeDagToTarget(graph.targetId, graph.get, vi.fn())
    const rejected = expect(work).rejects.toThrow('画布已切换')
    graph.switchScope()
    acceptance.resolve(execution)
    await rejected
    expect(mocks.execution).not.toHaveBeenCalled()
    expect(mocks.runs).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
