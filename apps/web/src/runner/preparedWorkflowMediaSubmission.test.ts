import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { runPreparedWorkflowMediaNode, usePreparedMediaSubmissionStore } from './preparedWorkflowMediaSubmission'
import { requiresWorkflowMediaRecovery, isUnsubmittedWorkflowMedia } from './workflowMediaExecutionState'

const mocks = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn(), family: vi.fn(), save: vi.fn() }))
vi.mock('../api/preparedWorkflowMedia', () => ({ readPreparedMediaNode: mocks.read, callPreparedMediaTool: mocks.call }))
vi.mock('../api/server', () => ({ getWorkflowExecutionFamily: mocks.family }))
vi.mock('../ui/uiStore', () => ({ useUIStore: { getState: () => ({ currentProject: { id: 'project' } }) } }))
vi.mock('../ui/chat/codex/codexCanvasPersistence', () => ({ persistCodexCanvasBeforeDispatch: mocks.save }))

const node: Node = { id: 'prepared', type: 'taskNode', position: { x: 0, y: 0 }, data: {
  kind: 'video', status: 'idle', prompt: 'Frozen prompt', workflowPreparedOnly: true,
  workflowExecutionId: 'execution', workflowEffectId: 'effect', workflowTaskId: 'preallocated-task',
} }
function state() {
  let current = { nodes: [structuredClone(node)], graphProvenanceKey: 'chapter:chapter' as string | null }
  return { get: () => current, set: (update: (input: typeof current) => Partial<typeof current>) => { current = { ...current, ...update(current) } } }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.family.mockResolvedValue({ activeExecutionCount: 0 })
  mocks.call.mockResolvedValue({ nodeId: node.id, taskId: 'accepted', status: 'running' })
  mocks.save.mockResolvedValue({ chapterId: 'chapter', flowId: null, canvasRevision: 2 })
})
describe('prepared media first submission', () => {
  it('reconciles the same accepted task when the submit response is lost', async () => {
    mocks.call.mockRejectedValueOnce(new Error('connection dropped'))
    mocks.read.mockResolvedValueOnce(node.data)
      .mockResolvedValueOnce({ ...node.data, status: 'running', videoTaskId: 'accepted', mediaTaskExecutionOwner: 'canvas_prepared' })
      .mockResolvedValueOnce({ ...node.data, status: 'success', videoTaskId: 'accepted', videoUrl: 'https://assets.example/video.mp4' })
    const { get, set } = state()
    await runPreparedWorkflowMediaNode(node.id, get, set)
    expect(mocks.call.mock.calls.map(call => call.slice(1))).toEqual([
      ['tapcanvas_video_generate_to_canvas', { nodeId: 'prepared' }],
      ['tapcanvas_video_reconcile', { nodeId: 'prepared', taskId: 'accepted' }],
    ])
    expect(get().nodes[0].data.status).toBe('success')
  })
  it('preserves successful assets when the submission request fails after completion', async () => {
    mocks.call.mockRejectedValueOnce(new Error('connection dropped'))
    mocks.read.mockResolvedValueOnce(node.data)
      .mockResolvedValueOnce({ ...node.data, status: 'success', videoUrl: 'https://assets.example/video.mp4' })
    const { get, set } = state()
    await runPreparedWorkflowMediaNode(node.id, get, set)
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(get().nodes[0].data.videoUrl).toBe('https://assets.example/video.mp4')
    expect(get().nodes[0].data.status).toBe('success')
  })
  it('exposes a definite preflight rejection after reading back the still-idle node', async () => {
    mocks.call.mockRejectedValueOnce(new Error('unsupported duration'))
    mocks.read.mockResolvedValueOnce(node.data).mockResolvedValueOnce(node.data)
    const { get, set } = state()
    await expect(runPreparedWorkflowMediaNode(node.id, get, set)).rejects.toThrow('unsupported duration')
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(get().nodes[0].data.status).toBe('idle')
  })
  it('reports both errors and uncertainty when submission and readback fail', async () => {
    mocks.call.mockRejectedValueOnce(new Error('connection dropped'))
    mocks.read.mockResolvedValueOnce(node.data).mockRejectedValueOnce(new Error('read unavailable'))
    const { get, set } = state()
    await expect(runPreparedWorkflowMediaNode(node.id, get, set)).rejects.toThrow('connection dropped；原节点回读失败：read unavailable；受理状态未确认')
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(usePreparedMediaSubmissionStore.getState().pending.size).toBe(0)
  })
  it('waits for the acknowledged save before reading and submitting the latest prompt and model', async () => {
    const { get, set } = state()
    const edited = { ...node.data, prompt: 'User latest prompt', videoModel: 'selected-model' }
    set(current => ({ nodes: [{ ...current.nodes[0], data: edited }] }))
    let finishSave!: () => void
    mocks.save.mockReturnValueOnce(new Promise<void>(resolve => { finishSave = resolve }))
    mocks.read.mockResolvedValueOnce(edited)
      .mockResolvedValueOnce({ ...edited, status: 'success', videoUrl: 'https://assets.example/video.mp4' })
    const run = runPreparedWorkflowMediaNode(node.id, get, set)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
    finishSave()
    await run
    expect(mocks.save).toHaveBeenCalledWith({ chapterId: 'chapter', flowId: null })
    expect(get().nodes[0].data.prompt).toBe('User latest prompt')
    expect(get().nodes[0].data.videoModel).toBe('selected-model')
  })
  it('retains edits made during the initial read and refuses stale submission', async () => {
    const { get, set } = state()
    mocks.read.mockImplementationOnce(async () => {
      set(current => ({ nodes: [{ ...current.nodes[0], data: { ...current.nodes[0].data, prompt: 'New edit' } }] }))
      return node.data
    })
    await expect(runPreparedWorkflowMediaNode(node.id, get, set)).rejects.toThrow('保存后又发生了编辑')
    expect(get().nodes[0].data.prompt).toBe('New edit')
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('retains edits made after acceptance while merging the real result', async () => {
    const { get, set } = state()
    mocks.read.mockResolvedValueOnce(node.data)
      .mockImplementationOnce(async () => {
        set(current => ({ nodes: [{ ...current.nodes[0], data: { ...current.nodes[0].data, prompt: 'Next revision' } }] }))
        return { ...node.data, status: 'running', videoTaskId: 'accepted', mediaTaskExecutionOwner: 'canvas_prepared' }
      })
      .mockResolvedValueOnce({ ...node.data, status: 'success', videoTaskId: 'accepted', videoUrl: 'https://assets.example/video.mp4' })
    await runPreparedWorkflowMediaNode(node.id, get, set)
    expect(get().nodes[0].data.prompt).toBe('Next revision')
    expect(get().nodes[0].data.status).toBe('success')
    expect(get().nodes[0].data.videoUrl).toBe('https://assets.example/video.mp4')
  })
  it('does not confuse a preallocated task id with an accepted task', () => {
    expect(isUnsubmittedWorkflowMedia(node)).toBe(true)
    expect(requiresWorkflowMediaRecovery(node)).toBe(false)
    for (const patch of [{ videoTaskId: 'accepted' }, { workflowSubmissionState: 'submitting' }, { status: 'failed' }]) {
      expect(requiresWorkflowMediaRecovery({ ...node, data: { ...node.data, ...patch } })).toBe(true)
    }
  })
  it('shows immediate feedback, submits once by the same node ID and only reconciles the accepted task', async () => {
    mocks.read.mockResolvedValueOnce(node.data)
      .mockResolvedValueOnce({ ...node.data, status: 'running', videoTaskId: 'accepted', mediaTaskExecutionOwner: 'canvas_prepared' })
      .mockResolvedValueOnce({ ...node.data, status: 'success', videoTaskId: 'accepted', videoUrl: 'https://assets.example/video.mp4', mediaTaskExecutionOwner: 'canvas_prepared' })
    const { get, set } = state()
    const run = runPreparedWorkflowMediaNode(node.id, get, set)
    expect(usePreparedMediaSubmissionStore.getState().pending.has(node.id)).toBe(true)
    expect(get().nodes[0].data.status).toBe('idle')
    expect(runPreparedWorkflowMediaNode(node.id, get, set)).toBe(run)
    await run
    expect(mocks.call.mock.calls.map(call => call.slice(1))).toEqual([
      ['tapcanvas_video_generate_to_canvas', { nodeId: 'prepared' }],
      ['tapcanvas_video_reconcile', { nodeId: 'prepared', taskId: 'accepted' }],
    ])
    expect(get().nodes.map(value => value.id)).toEqual(['prepared'])
    expect(get().nodes[0].data.workflowEffectId).toBe('effect')
    expect(usePreparedMediaSubmissionStore.getState().pending.size).toBe(0)
  })
  it('never submits while the original workflow is active', async () => {
    mocks.read.mockResolvedValueOnce(node.data)
    mocks.family.mockResolvedValueOnce({ activeExecutionCount: 1 })
    const { get, set } = state()
    await expect(runPreparedWorkflowMediaNode(node.id, get, set)).rejects.toThrow('原工作流仍在执行')
    expect(mocks.call).not.toHaveBeenCalled()
    expect(usePreparedMediaSubmissionStore.getState().pending.size).toBe(0)
  })
  it('reads back a persisted accepted task after reload without resubmitting', async () => {
    mocks.read.mockResolvedValueOnce({ ...node.data, status: 'running', videoTaskId: 'accepted', mediaTaskExecutionOwner: 'canvas_prepared' })
      .mockResolvedValueOnce({ ...node.data, status: 'failed', lastError: 'provider rejected', videoTaskId: 'accepted', mediaTaskExecutionOwner: 'canvas_prepared' })
    const { get, set } = state()
    await expect(runPreparedWorkflowMediaNode(node.id, get, set)).rejects.toThrow('provider rejected')
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call.mock.calls[0][1]).toBe('tapcanvas_video_reconcile')
  })
})
