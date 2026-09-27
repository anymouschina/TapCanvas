import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import * as remoteRunner from './remoteRunner'
import { runNodeDagToTarget } from './dag'
import { useRFStore } from '../canvas/store'
import { useChatCommandStore } from '../ui/chat/chatCommandStore'

const mocks = vi.hoisted(() => ({ resume: vi.fn(), resumeOutputs: vi.fn(), prepared: vi.fn(),
  getExecution: vi.fn(), listRuns: vi.fn(), apply: vi.fn() }))
vi.mock('./preparedWorkflowMediaSubmission', () => ({ runPreparedWorkflowMediaNode: mocks.prepared, usePreparedMediaSubmissionStore: { setState: vi.fn() } }))
vi.mock('./workflowMediaOutputExecution', () => ({ resumeWorkflowMediaOutput: mocks.resume, resumeWorkflowMediaOutputs: mocks.resumeOutputs,
  WorkflowMediaExecutionStillActiveError: class WorkflowMediaExecutionStillActiveError extends Error {} }))
vi.mock('../canvas/workflowExecutionRequest', () => ({ requestWorkflowExecutionSnapshot: vi.fn() }))
vi.mock('../api/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/server')>()),
  getWorkflowExecution: mocks.getExecution, listWorkflowNodeRuns: mocks.listRuns }))
vi.mock('../canvas/workflowExecutionProjection', () => ({ applyWorkflowNodeRuns: mocks.apply }))

const output: Node = {
  id: 'video-output', type: 'taskNode', position: { x: 0, y: 0 }, selected: true,
  data: {
    kind: 'video', status: 'failed', videoTaskId: 'previous-task',
    workflowExecutionId: 'execution', workflowRuntimeNodeId: 'submit', workflowEffectId: 'effect',
    prompt: 'Current edited prompt', videoModel: 'seedance20',
  },
}

beforeAll(() => { vi.stubGlobal('window', {}) })

beforeEach(() => {
  mocks.prepared.mockReset()
  mocks.resume.mockReset().mockResolvedValue({ id: 'recovery-execution' })
  mocks.resumeOutputs.mockReset().mockResolvedValue({ id: 'recovery-execution' })
  mocks.getExecution.mockReset().mockResolvedValue({ id: 'recovery-execution', status: 'success', executionFamilyId: 'family' })
  mocks.listRuns.mockReset().mockResolvedValue([])
  mocks.apply.mockReset().mockImplementation(() => {
    useRFStore.setState((state) => ({ nodes: state.nodes.map((node) => node.data.status === 'failed'
      ? { ...node, data: { ...node.data, status: 'success', workflowExecutionId: 'recovery-execution',
        ...(node.data.kind === 'image' ? { imageUrl: `https://assets.example/${node.id}.png` }
          : { videoUrl: `https://assets.example/${node.id}.mp4` }) } }
      : node) }))
  })
  useRFStore.setState({ nodes: [structuredClone(output)], edges: [] })
  vi.spyOn(useChatCommandStore.getState(), 'dispatchSend')
  vi.spyOn(remoteRunner, 'runNodeRemote').mockImplementation(async (id) => {
    useRFStore.getState().setNodeStatus(id, 'success')
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('direct video generation', () => {
  it.each(['image', 'video'] as const)('executes an ordinary %s output on its own node id', async (kind) => {
    const ordinary: Node = { ...output, data: { kind, status: 'failed', taskId: 'previous-task', prompt: 'Current prompt' } }
    useRFStore.setState({ nodes: [
      { ...output, id: 'other-selected', data: { kind: 'text', prompt: 'Other' } },
      { ...ordinary, selected: false },
    ], edges: [] })
    await runNodeDagToTarget(ordinary.id, useRFStore.getState, useRFStore.setState)
    expect(remoteRunner.runNodeRemote).toHaveBeenCalledTimes(1)
    expect(remoteRunner.runNodeRemote).toHaveBeenCalledWith(ordinary.id, expect.any(Function), expect.any(Function))
    expect(useChatCommandStore.getState().dispatchSend).not.toHaveBeenCalled()
  })
  it('submits prepared dependencies and the video in place without a failed-item recovery or clone', async () => {
    const image: Node = { ...output, id: 'prepared-image', data: { kind: 'image', status: 'idle', workflowExecutionId: 'execution', workflowPreparedOnly: true } }
    const video: Node = { ...output, data: { kind: 'video', status: 'idle', workflowExecutionId: 'execution', workflowPreparedOnly: true, referenceImageNodeIds: [image.id] } }
    useRFStore.setState({ nodes: [image, video], edges: [] })
    const statesAtSubmission: unknown[] = []
    mocks.prepared.mockImplementation(async (id: string) => {
      statesAtSubmission.push(useRFStore.getState().nodes.find(node => node.id === id)?.data.status)
      useRFStore.setState(state => ({ nodes: state.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, status: 'success', ...(id === image.id ? { imageUrl: 'https://assets.example/image.png' } : { videoUrl: 'https://assets.example/video.mp4' }) } } : node) }))
    })
    await useRFStore.getState().runNodeBranchClones(video.id, 3)
    expect(mocks.prepared.mock.calls.map(([id]) => id)).toEqual([image.id, video.id])
    expect(statesAtSubmission).toEqual(['idle', 'idle'])
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(remoteRunner.runNodeRemote).not.toHaveBeenCalled()
    expect(useRFStore.getState().nodes.map(node => node.id)).toEqual([image.id, video.id])
  })

  it('recovers failed workflow images as one upstream batch before a first video submission', async () => {
    const image = (id: string): Node => ({ id, type: 'taskNode', position: { x: 0, y: 0 }, data: {
      kind: 'image', status: 'failed', workflowExecutionId: 'execution', workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: `pipeline::item::clip::step::images::item::${id}`, workflowEffectId: `${id}-effect`,
    } })
    const images = [image('image-a'), image('image-b')]
    const video: Node = { id: 'prepared-video', type: 'taskNode', position: { x: 100, y: 0 }, data: {
      kind: 'video', status: 'idle', workflowPreparedOnly: true, workflowExecutionId: 'execution',
      workflowRuntimeNodeId: 'video', workflowEffectId: 'video-effect', referenceImageNodeIds: images.map((item) => item.id),
    } }
    useRFStore.setState({ nodes: [...images, video], edges: [] })

    mocks.prepared.mockImplementation(async (id: string) => {
      useRFStore.setState((state) => ({ nodes: state.nodes.map((node) => node.id === id
        ? { ...node, data: { ...node.data, status: 'success', videoUrl: 'https://assets.example/prepared-video.mp4' } }
        : node) }))
    })
    await runNodeDagToTarget(video.id, useRFStore.getState, useRFStore.setState)
    expect(mocks.resumeOutputs).toHaveBeenCalledTimes(1)
    expect(mocks.resumeOutputs).toHaveBeenCalledWith(expect.any(Array), images.map((item) => item.id),
      { exactMediaRetriesOnly: true })
    expect(mocks.prepared).toHaveBeenCalledTimes(1)
    expect(remoteRunner.runNodeRemote).not.toHaveBeenCalled()
    expect(useRFStore.getState().nodes.find((node) => node.id === video.id)?.data.status).toBe('success')
  })

  it('routes a workflow output run through durable recovery without creating a derivative', async () => {
    await useRFStore.getState().runSelected()
    expect(mocks.resume).toHaveBeenCalledWith([expect.objectContaining({ id: output.id })], output.id)
    expect(useRFStore.getState().nodes.map((node) => node.id)).toEqual([output.id])
    expect(remoteRunner.runNodeRemote).not.toHaveBeenCalled()
    expect(useRFStore.getState().nodes[0].data.prompt).toBe('Current edited prompt')
    expect(useChatCommandStore.getState().dispatchSend).not.toHaveBeenCalled()
  })

  it('creates a separate manual version when the clicked workflow video already succeeded', async () => {
    const succeeded: Node = { ...output, data: { ...output.data, status: 'success',
      videoUrl: 'https://assets.example/original.mp4', videoResults: [{ url: 'https://assets.example/original.mp4' }],
    } }
    useRFStore.setState({ nodes: [succeeded], edges: [] })
    await runNodeDagToTarget(succeeded.id, useRFStore.getState, useRFStore.setState)

    const nodes = useRFStore.getState().nodes
    const derivative = nodes.find((node) => node.id !== succeeded.id)
    expect(nodes.find((node) => node.id === succeeded.id)?.data.videoUrl).toBe('https://assets.example/original.mp4')
    expect(derivative?.data).toMatchObject({ mediaTaskExecutionOwner: 'manual', sourceWorkflowOutput: { nodeId: succeeded.id } })
    expect(derivative?.data).not.toHaveProperty('videoUrl')
    expect(derivative?.data).not.toHaveProperty('videoResults')
    expect(remoteRunner.runNodeRemote).toHaveBeenCalledWith(derivative?.id, expect.any(Function), expect.any(Function))
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('exposes a pre-submit failure and keeps the prepared node eligible for its first submission', async () => {
    const prepared: Node = { ...output, data: { kind: 'video', status: 'idle', workflowExecutionId: 'execution', workflowPreparedOnly: true } }
    useRFStore.setState({ nodes: [prepared], edges: [] })
    mocks.prepared.mockRejectedValue(new Error('Saved input is incomplete; no provider request'))
    await expect(runNodeDagToTarget(prepared.id, useRFStore.getState, useRFStore.setState))
      .rejects.toThrow('Saved input is incomplete; no provider request')
    expect(useRFStore.getState().nodes[0].data.status).toBe('idle')
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('does not create a manual derivative for workflow output through the ordinary DAG runner', async () => {
    await runNodeDagToTarget(output.id, useRFStore.getState, useRFStore.setState)
    expect(useRFStore.getState().nodes.map((node) => node.id)).toEqual([output.id])
    expect(remoteRunner.runNodeRemote).not.toHaveBeenCalled()
  })

  it('routes workflow branch-count requests into one durable recovery instead of cloning nodes', async () => {
    await useRFStore.getState().runNodeBranchClones(output.id, 3)
    expect(mocks.resume).toHaveBeenCalledTimes(1)
    expect(useRFStore.getState().nodes.map((node) => node.id)).toEqual([output.id])
    expect(remoteRunner.runNodeRemote).not.toHaveBeenCalled()
  })

  it('does not dispatch a chat for a non-workflow clipRunId node', async () => {
    const clip: Node = { ...output, data: { kind: 'video', clipRunId: 'clip-run', clipIndex: 0 } }
    useRFStore.setState({ nodes: [clip], edges: [] })
    await runNodeDagToTarget(clip.id, useRFStore.getState, useRFStore.setState)
    expect(remoteRunner.runNodeRemote).toHaveBeenCalledTimes(1)
    expect(remoteRunner.runNodeRemote).toHaveBeenCalledWith(clip.id, expect.any(Function), expect.any(Function))
    expect(useChatCommandStore.getState().dispatchSend).not.toHaveBeenCalled()
  })

  it('generates explicit upstream images before submitting an ordinary video', async () => {
    const image: Node = {
      id: 'shared-image', type: 'taskNode', position: { x: 0, y: 0 },
      data: { kind: 'image', prompt: 'Shared frame' },
    }
    const clip: Node = {
      id: 'clip', type: 'taskNode', position: { x: 100, y: 0 },
      data: { kind: 'video', prompt: 'Clip prompt', referenceImageNodeIds: [image.id], firstFrameFromNodeId: image.id },
    }
    useRFStore.setState({ nodes: [image, clip], edges: [] })
    vi.mocked(remoteRunner.runNodeRemote).mockImplementation(async (id) => {
      useRFStore.setState((state) => ({
        nodes: state.nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, status: 'success', ...(id === image.id ? { imageUrl: 'https://assets.example.com/shared.png' } : {}) } }
          : node),
      }))
    })

    await runNodeDagToTarget(clip.id, useRFStore.getState, useRFStore.setState)

    expect(vi.mocked(remoteRunner.runNodeRemote).mock.calls.map(([id]) => id)).toEqual([image.id, clip.id])
    expect(useRFStore.getState().nodes.find((node) => node.id === clip.id)?.data).toMatchObject({
      firstFrameUrl: 'https://assets.example.com/shared.png',
      referenceImages: ['https://assets.example.com/shared.png'],
      status: 'success',
    })
  })

  it('holds video submission when an upstream image finishes without a real URL', async () => {
    const image: Node = {
      id: 'missing-image', type: 'taskNode', position: { x: 0, y: 0 },
      data: { kind: 'image', prompt: 'Frame' },
    }
    const clip: Node = {
      id: 'clip', type: 'taskNode', position: { x: 100, y: 0 },
      data: { kind: 'video', prompt: 'Clip prompt', referenceImageNodeIds: [image.id] },
    }
    useRFStore.setState({ nodes: [image, clip], edges: [] })

    await expect(runNodeDagToTarget(clip.id, useRFStore.getState, useRFStore.setState)).rejects.toThrow('真实图片 URL')

    expect(vi.mocked(remoteRunner.runNodeRemote).mock.calls.map(([id]) => id)).toEqual([image.id])
    expect(useRFStore.getState().nodes.find((node) => node.id === clip.id)?.data).toMatchObject({
      status: 'error',
      lastError: expect.stringMatching(/missing-image.*真实图片 URL/u),
    })
  })

  it('holds video submission when an ordinary image edge has no real URL', async () => {
    const image: Node = {
      id: 'connected-image', type: 'taskNode', position: { x: 0, y: 0 },
      data: { kind: 'image', prompt: 'Frame' },
    }
    const clip: Node = {
      id: 'connected-clip', type: 'taskNode', position: { x: 100, y: 0 },
      data: { kind: 'video', prompt: 'Clip prompt' },
    }
    useRFStore.setState({
      nodes: [image, clip],
      edges: [{ id: 'image-to-video', source: image.id, target: clip.id }],
    })

    await expect(runNodeDagToTarget(clip.id, useRFStore.getState, useRFStore.setState)).rejects.toThrow('真实图片 URL')

    expect(vi.mocked(remoteRunner.runNodeRemote).mock.calls.map(([id]) => id)).toEqual([image.id])
    expect(useRFStore.getState().nodes.find((node) => node.id === clip.id)?.data).toMatchObject({
      status: 'error',
      lastError: expect.stringMatching(/connected-image.*真实图片 URL/u),
    })
  })
})
