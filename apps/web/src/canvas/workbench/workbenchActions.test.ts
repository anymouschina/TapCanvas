import type { Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateWorkbenchTargets } from './workbenchActions'

const mocks = vi.hoisted(() => ({
  persist: vi.fn(), run: vi.fn(), setGraph: vi.fn(),
  ui: {
    viewOnly: false, currentProject: { id: 'project' }, currentFlow: { id: 'flow' },
    currentChapter: null as { projectId: string; chapterId: string } | null,
  },
  graph: { graphProvenanceKey: 'flow:flow', nodes: [] as Node[], edges: [],
    setNodeStatus: vi.fn(), appendLog: vi.fn(), updateNodeData: vi.fn(), beginRunToken: vi.fn((_id: string) => 'token'),
    endRunToken: vi.fn(), isCanceled: vi.fn((_id: string, _token?: string) => false) },
}))
vi.mock('../../ui/uiStore', () => ({ useUIStore: { getState: () => mocks.ui } }))
vi.mock('../store', () => ({ useRFStore: { getState: () => mocks.graph, setState: mocks.setGraph } }))
vi.mock('../../ui/chat/codex/codexCanvasPersistence', () => ({ persistCodexCanvasBeforeDispatch: mocks.persist }))
vi.mock('../../runner/dag', () => ({ runNodeDagToTarget: mocks.run }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.ui.viewOnly = false
  mocks.ui.currentProject.id = 'project'
  mocks.ui.currentFlow.id = 'flow'
  mocks.ui.currentChapter = null
  mocks.graph.graphProvenanceKey = 'flow:flow'
  mocks.graph.nodes = [
    { id: 'image', type: 'taskNode', position: { x: 21, y: 34 }, data: { kind: 'image' } },
    { id: 'video', type: 'taskNode', position: { x: 55, y: 89 }, data: { kind: 'video' } },
    { id: 'text', type: 'taskNode', position: { x: 0, y: 0 }, data: { kind: 'text' } },
  ]
  mocks.persist.mockResolvedValue({ flowId: 'flow', chapterId: null, canvasRevision: 1 })
  mocks.run.mockResolvedValue(undefined)
})

describe('pipeline media actions', () => {
  it('persists and delegates each distinct media target to the existing dependency runner without moving nodes', async () => {
    const before = structuredClone(mocks.graph.nodes)
    await generateWorkbenchTargets(['image', 'image', 'video'])
    expect(mocks.persist).toHaveBeenCalledWith({ flowId: 'flow', chapterId: null })
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0])
    expect(mocks.run.mock.calls.map(call => call[0])).toEqual(['image', 'video'])
    expect(mocks.run).toHaveBeenCalledWith('image', expect.any(Function), expect.any(Function), { concurrency: 1 })
    expect(mocks.graph.nodes).toEqual(before)
  })

  it('rejects readonly, missing, non-media and stale-scope targets before saving', async () => {
    await expect(generateWorkbenchTargets(['text'])).rejects.toThrow('不支持直接生成')
    await expect(generateWorkbenchTargets(['missing'])).rejects.toThrow('已不存在')
    mocks.graph.nodes[0].data.readOnly = true
    await expect(generateWorkbenchTargets(['image'])).rejects.toThrow('只读')
    mocks.ui.viewOnly = true
    await expect(generateWorkbenchTargets(['video'])).rejects.toThrow('只读')
    mocks.ui.viewOnly = false
    mocks.graph.graphProvenanceKey = 'flow:other'
    await expect(generateWorkbenchTargets(['video'])).rejects.toThrow('作用域尚未就绪')
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('saves chapter scope and rejects a receipt for a different canvas', async () => {
    mocks.ui.currentChapter = { projectId: 'project', chapterId: 'chapter' }
    mocks.graph.graphProvenanceKey = 'chapter:chapter'
    mocks.persist.mockResolvedValueOnce({ flowId: null, chapterId: 'chapter', canvasRevision: 2 })
    await generateWorkbenchTargets(['image'])
    expect(mocks.persist).toHaveBeenCalledWith({ flowId: null, chapterId: 'chapter' })
    mocks.run.mockClear()
    mocks.persist.mockResolvedValueOnce({ flowId: 'other', chapterId: null, canvasRevision: 2 })
    await expect(generateWorkbenchTargets(['image'])).rejects.toThrow('保存回执')
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('rechecks scope, readonly status and abort after persistence', async () => {
    mocks.persist.mockImplementationOnce(async () => { mocks.ui.currentProject.id = 'other' })
    await expect(generateWorkbenchTargets(['image'])).rejects.toThrow('切换画布')
    mocks.ui.currentProject.id = 'project'
    mocks.persist.mockImplementationOnce(async () => { mocks.ui.viewOnly = true })
    await expect(generateWorkbenchTargets(['image'])).rejects.toThrow('只读')
    mocks.ui.viewOnly = false
    const controller = new AbortController()
    mocks.persist.mockImplementationOnce(async () => { controller.abort() })
    await expect(generateWorkbenchTargets(['image'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('never applies late runner updates to another canvas and rejects later dispatch', async () => {
    const update = vi.fn(() => ({ nodes: [] }))
    mocks.run.mockImplementationOnce(async (_id: string, _get: () => unknown,
      set: (updater: typeof update) => void) => {
      mocks.graph.graphProvenanceKey = 'flow:other'
      set(update)
    })
    await expect(generateWorkbenchTargets(['image', 'video'])).rejects.toThrow('切换画布')
    const apply = mocks.setGraph.mock.calls[0][0] as (state: typeof mocks.graph) => unknown
    expect(apply(mocks.graph)).toEqual({})
    expect(update).not.toHaveBeenCalled()
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('reports failure while retaining independent successful targets', async () => {
    mocks.run.mockRejectedValueOnce(new Error('供应商返回具体失败')).mockResolvedValueOnce(undefined)
    await expect(generateWorkbenchTargets(['image', 'video'])).rejects.toThrow('image：供应商返回具体失败')
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })

  it('lets an accepted target finish reading and storing results after stop but prevents subsequent dispatch', async () => {
    const controller = new AbortController()
    const update = vi.fn(() => ({ nodes: mocks.graph.nodes }))
    mocks.run.mockImplementationOnce(async (_id: string, get: () => typeof mocks.graph,
      set: (updater: typeof update) => void) => {
      controller.abort()
      expect(get().nodes).toBe(mocks.graph.nodes)
      get().setNodeStatus('image', 'success', { imageUrl: 'https://assets.test/image.png' })
      set(update)
    })
    await expect(generateWorkbenchTargets(['image', 'video'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.graph.setNodeStatus).toHaveBeenCalledWith('image', 'success', { imageUrl: 'https://assets.test/image.png' })
    const apply = mocks.setGraph.mock.calls[0][0] as (state: typeof mocks.graph) => unknown
    apply(mocks.graph)
    expect(update).toHaveBeenCalled()
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('binds cached runner handlers to the original canvas even if another graph reuses the same node id', async () => {
    mocks.run.mockImplementationOnce(async (_id: string, get: () => typeof mocks.graph) => {
      const cached = get()
      mocks.graph.graphProvenanceKey = 'flow:other'
      cached.setNodeStatus('image', 'success', { imageUrl: 'https://assets.test/original.png' })
      cached.appendLog('image', 'old execution')
      cached.updateNodeData('image', { status: 'success' })
      cached.endRunToken('image')
      expect(cached.isCanceled('image', 'token')).toBe(true)
      expect(() => cached.beginRunToken('image')).toThrow('切换画布')
    })
    await generateWorkbenchTargets(['image'])
    expect(mocks.graph.setNodeStatus).not.toHaveBeenCalled()
    expect(mocks.graph.appendLog).not.toHaveBeenCalled()
    expect(mocks.graph.updateNodeData).not.toHaveBeenCalled()
    expect(mocks.graph.beginRunToken).not.toHaveBeenCalled()
    expect(mocks.graph.endRunToken).not.toHaveBeenCalled()
  })
})
