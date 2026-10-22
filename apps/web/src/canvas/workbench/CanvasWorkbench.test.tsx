import React from 'react'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import CanvasWorkbench from './CanvasWorkbench'
import { CanvasWorkspace } from './CanvasWorkspace'
import { CanvasViewSwitcher } from './CanvasViewSwitcher'
import { useWorkbenchViewStore } from './workbenchViewStore'

const actions = vi.hoisted(() => ({ generate: vi.fn(), cancel: vi.fn(), preview: vi.fn() }))

vi.mock('./workbenchActions', () => ({
  generateWorkbenchTargets: actions.generate,
}))

// Production controls have independent integration coverage; keep these tests focused on the workspace.
vi.mock('./PipelineProductionControls', () => ({
  PipelineProductionControls: ({ active }: { active: boolean }) => <div className="test-production-controls" data-testid="production-controls" data-active={active}>制作控制区</div>,
}))

// Keep real reactive selectors while isolating persistence, media requests and the full editor runtime.
vi.mock('../store', async () => {
  const { create } = await import('zustand')
  return {
    useRFStore: create<{
      nodes: Node[]
      edges: Edge[]
      graphProvenanceKey: string
      pendingFocusNodeId: string | null
      cancelNode: (id: string) => void
    }>(() => ({ nodes: [], edges: [], graphProvenanceKey: 'flow:flow', pendingFocusNodeId: null, cancelNode: actions.cancel })),
  }
})

vi.mock('../../ui/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create<{
    viewOnly: boolean
    currentProject: { id: string }
    currentFlow: { id: string }
    currentChapter: { chapterId: string; projectId: string } | null
    openPreview: (preview: unknown) => void
  }>(() => ({ viewOnly: false, currentProject: { id: 'project' }, currentFlow: { id: 'flow' }, currentChapter: null, openPreview: actions.preview })) }
})

vi.mock('../../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ alt, src }: { alt: string; src: string }) => <div className="test-managed-image" role="img" aria-label={alt} data-src={src} />,
}))

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function fixtureNodes(): Node[] {
  const task = (id: string, data: Record<string, unknown>): Node => ({
    id, type: 'taskNode', position: { x: 30, y: 10 }, data,
  })
  return [
    { ...task('script', { kind: 'text', label: '第一幕剧本', prompt: '雨夜，林青推开旧书店的门。', scriptDoc: { scenes: [{ action: '推门' }] } }), selected: true },
    task('character', { kind: 'image', referenceType: 'character', label: '林青角色卡', prompt: '完整角色身份描述', status: 'idle' }),
    task('scene', { kind: 'image', referenceType: 'scene', label: '旧书店空间', imageUrl: 'https://assets.test/scene.png' }),
    task('prop', { kind: 'image', referenceType: 'prop', label: '旧书道具', imageUrl: 'https://assets.test/prop.png' }),
    task('other', { kind: 'futureTask', label: '自定义参考', text: '尚未分类的参考说明' }),
    task('storyboard', { kind: 'storyboardImage', label: '书店分镜板', imageUrl: 'https://assets.test/board.png' }),
    task('video', { kind: 'video', label: '书店片段', status: 'success', videoUrl: 'https://assets.test/bookshop.mp4' }),
    task('audio', { kind: 'audio', label: '雨夜环境声', audioUrl: 'https://assets.test/rain.mp3' }),
    task('final', { kind: 'videoCompose', label: '第一幕成片', videoUrl: 'https://assets.test/final.mp4' }),
  ]
}

function renderPipeline() {
  return render(<MantineProvider><CanvasWorkbench active /></MantineProvider>)
}

function characterCard(): HTMLElement {
  const card = document.querySelector<HTMLElement>('[data-node-id="character"]')
  if (!card) throw new Error('Character fixture card was not rendered')
  return card
}

function renderWorkspace() {
  return render(<MantineProvider><CanvasViewSwitcher /><CanvasWorkspace><input className="test-canvas" aria-label="画布内状态" defaultValue="保留输入" /></CanvasWorkspace></MantineProvider>)
}

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: matches && query === '(prefers-reduced-motion: reduce)',
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  vi.resetAllMocks()
  actions.generate.mockResolvedValue(undefined)
  useUIStore.setState({ viewOnly: false })
  useWorkbenchViewStore.setState({ view: 'canvas' })
  useRFStore.setState({
    nodes: fixtureNodes(),
    edges: [{ id: 'script-character', source: 'script', target: 'character' }],
    graphProvenanceKey: 'flow:flow',
    pendingFocusNodeId: null,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CanvasWorkbench behavior', () => {
  it('keeps complete clip script text and reference instructions available in place', () => {
    const source = '  参考：@场景卡=旧书店\n镜头1：推门。\n\n声音只有对白。  \n'
    useRFStore.setState({ nodes: [{
      id: 'clip', type: 'taskNode', position: { x: 0, y: 0 },
      data: { kind: 'video', workflowClipId: 'clip-1', clipIndex: 0, workflowSourcePrompt: source },
    }], edges: [] })
    const { container } = renderPipeline()
    fireEvent.click(within(screen.getByRole('navigation', { name: '制作阶段' })).getByRole('button', { name: /分镜设计/ }))
    expect(container.querySelector('.tc-shot-card__raw')?.textContent).toBe(source)
    const expand = screen.getByRole('button', { name: '展开完整镜头脚本' })
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.tc-shot-card__raw')).toHaveStyle({ maxHeight: 'none' })
  })

  it('groups content behind five connected production steps with one selected stage and no node or prompt configuration', () => {
    const before = useRFStore.getState().nodes
    const { container } = renderPipeline()
    expect(screen.getByRole('region', { name: '创作流水线' })).toBeVisible()
    expect(screen.getByTestId('production-controls')).toHaveAttribute('data-active', 'true')
    const navigation = screen.getByRole('navigation', { name: '制作阶段' })
    expect(within(navigation).getAllByRole('button')).toHaveLength(5)
    expect(container.querySelector('.tc-pipeline-rail')).toBeInTheDocument()
    expect(container.querySelectorAll('.tc-pipeline-stage')).toHaveLength(1)
    expect(within(navigation).getByRole('button', { name: /角色与场景/ })).toHaveAttribute('aria-current', 'step')
    const groups = [
      ['故事剧本', ['script']],
      ['角色与场景', ['character', 'scene', 'prop', 'other']],
      ['分镜设计', ['storyboard']],
      ['视频片段', ['video', 'audio']],
      ['最终成片', ['final']],
    ] as const
    for (const [label, ids] of groups) {
      const step = within(navigation).getByRole('button', { name: new RegExp(label) })
      fireEvent.click(step)
      expect(step).toHaveAttribute('aria-current', 'step')
      const panel = screen.getByRole('region', { name: label })
      expect([...panel.querySelectorAll('[data-node-id]')].map((card) => card.getAttribute('data-node-id'))).toEqual(ids)
      expect(container.querySelectorAll('.tc-pipeline-stage')).toHaveLength(1)
    }
    fireEvent.click(within(navigation).getByRole('button', { name: /角色与场景/ }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('完整角色身份描述')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /在画布中打开|创建节点|添加节点/ })).not.toBeInTheDocument()
    expect(container.querySelector('form, details')).not.toBeInTheDocument()
    // Ungenerated assets have nothing to preview, and no detail layer opens.
    expect(within(characterCard()).queryByRole('button', { name: /预览林青角色卡/ })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('region', { name: '角色与场景' })).getByRole('button', { name: '预览旧书店空间' }))
    expect(actions.preview).toHaveBeenCalledWith({ url: 'https://assets.test/scene.png', kind: 'image', name: '旧书店空间' })
    expect(screen.queryByRole('complementary', { name: /素材详情/ })).not.toBeInTheDocument()
    expect(useRFStore.getState().nodes).toBe(before)
  })

  it('expands a script in place instead of opening a side panel', () => {
    renderPipeline()
    fireEvent.click(within(screen.getByRole('navigation', { name: '制作阶段' })).getByRole('button', { name: /故事剧本/ }))
    const toggle = screen.getByRole('button', { name: '展开第一幕剧本' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起第一幕剧本' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('[data-node-id="script"]')).toHaveAttribute('data-expanded', 'true')
    expect(screen.queryByRole('complementary', { name: /素材详情/ })).not.toBeInTheDocument()
  })

  it('shows generation feedback before the request settles and prevents duplicate clicks', async () => {
    const request = deferred()
    actions.generate.mockReturnValue(request.promise)
    renderPipeline()
    const card = characterCard()
    const generate = within(card).getByRole('button', { name: '生成' })
    const laneGenerate = within(screen.getByRole('region', { name: '角色与场景' })).getByRole('button', { name: '生成未完成素材 · 1' })
    fireEvent.click(generate)
    expect(card).toHaveAttribute('data-busy', 'true')
    expect(within(card).getByText('正在执行')).toBeVisible()
    expect(within(card).getByRole('button', { name: '生成中' })).toBeDisabled()
    expect(screen.getByText('本次生成 · 1 项素材')).toBeVisible()
    fireEvent.click(generate)
    fireEvent.click(laneGenerate)
    expect(actions.generate).toHaveBeenCalledTimes(1)
    expect(actions.generate).toHaveBeenCalledWith(['character'], expect.any(AbortSignal))
    await act(async () => { request.resolve(); await request.promise })
    expect(card).toHaveAttribute('data-busy', 'false')
    expect(within(card).getByRole('button', { name: '生成' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '停止后续生成' })).not.toBeInTheDocument()
  })

  it('generates only the missing assets in the selected stage', async () => {
    renderPipeline()
    fireEvent.click(within(screen.getByRole('region', { name: '角色与场景' })).getByRole('button', { name: '生成未完成素材 · 1' }))
    expect(actions.generate).toHaveBeenCalledWith(['character'], expect.any(AbortSignal))
    await waitFor(() => expect(characterCard()).toHaveAttribute('data-busy', 'false'))
  })

  it('shows a failed operation inline and clears the error immediately on a successful retry', async () => {
    const first = deferred()
    const second = deferred()
    actions.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    renderPipeline()
    fireEvent.click(within(characterCard()).getByRole('button', { name: '生成' }))
    await act(async () => { first.reject(new Error('供应商明确拒绝请求')); await first.promise.catch(() => undefined) })
    expect(screen.getByRole('alert')).toHaveTextContent('供应商明确拒绝请求')
    expect(characterCard()).toHaveAttribute('data-busy', 'false')
    fireEvent.click(within(characterCard()).getByRole('button', { name: '生成' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(characterCard()).toHaveAttribute('data-busy', 'true')
    expect(actions.generate).toHaveBeenCalledTimes(2)
    await act(async () => { second.resolve(); await second.promise })
    expect(characterCard()).toHaveAttribute('data-busy', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps readonly results inspectable without generation or editing controls', () => {
    useUIStore.setState({ viewOnly: true })
    renderPipeline()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /生成未完成素材|重新生成/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '预览旧书店空间' }))
    expect(actions.preview).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image' }))
    expect(screen.queryByRole('button', { name: /在画布中打开/ })).not.toBeInTheDocument()
    expect(actions.generate).not.toHaveBeenCalled()
  })

  it('stops the pending action with its real abort signal, retains data and releases controls', async () => {
    actions.generate.mockImplementation((_ids: string[], signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('已停止本次生成', 'AbortError')), { once: true })
    }))
    const before = useRFStore.getState().nodes
    renderPipeline()
    fireEvent.click(within(characterCard()).getByRole('button', { name: '生成' }))
    fireEvent.click(screen.getByRole('button', { name: '停止后续生成' }))
    expect(actions.cancel).not.toHaveBeenCalled()
    expect(actions.generate.mock.calls[0][1].aborted).toBe(true)
    await waitFor(() => expect(characterCard()).toHaveAttribute('data-busy', 'false'))
    expect(screen.queryByRole('button', { name: '已停止后续派发' })).not.toBeInTheDocument()
    expect(within(characterCard()).getByRole('button', { name: '生成' })).toBeEnabled()
    expect(useRFStore.getState().nodes).toBe(before)
  })
})

describe('CanvasWorkspace cube switch', () => {
  it('uses one mode switch and keeps both faces and the same canvas mounted across view changes', async () => {
    const before = useRFStore.getState().nodes
    const { container } = renderWorkspace()
    const canvas = screen.getByRole('textbox', { name: '画布内状态' })
    const root = container.querySelector('.tc-canvas-workspace')
    const canvasFace = container.querySelector('.tc-workspace-face--canvas')
    const pipelineFace = container.querySelector('.tc-workspace-face--pipeline')
    fireEvent.change(canvas, { target: { value: '已编辑状态' } })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(canvasFace).toHaveAttribute('aria-hidden', 'false')
    expect(pipelineFace).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    expect(root).toHaveAttribute('data-view', 'workbench')
    expect(root).toHaveAttribute('data-turning', 'true')
    expect(canvasFace).toHaveAttribute('aria-hidden', 'true')
    expect(canvasFace).toHaveAttribute('inert')
    expect(pipelineFace).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('正在加载流水线')
    await screen.findByRole('region', { name: '创作流水线' })
    expect(container.querySelectorAll('.tc-workspace-mode-switch')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '切换到画布' }))
    expect(root).toHaveAttribute('data-view', 'canvas')
    expect(canvasFace).toHaveAttribute('aria-hidden', 'false')
    expect(pipelineFace).toHaveAttribute('aria-hidden', 'true')
    expect(pipelineFace).toHaveAttribute('inert')
    expect(screen.getByRole('textbox', { name: '画布内状态' })).toBe(canvas)
    expect(canvas).toHaveValue('已编辑状态')
    expect(container.querySelector('[aria-label="创作流水线"]')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '创作流水线' })).not.toBeInTheDocument()
    expect(useRFStore.getState().nodes).toBe(before)
    expect(useRFStore.getState().edges).toEqual([{ id: 'script-character', source: 'script', target: 'character' }])
    expect(actions.generate).not.toHaveBeenCalled()
  })

  it('clears the turning state when the current rotation settles', async () => {
    mockReducedMotion(false)
    const { container } = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    await screen.findByRole('region', { name: '创作流水线' })
    const root = container.querySelector('.tc-canvas-workspace')
    expect(root).toHaveAttribute('data-turning', 'true')
    await waitFor(() => expect(root).toHaveAttribute('data-turning', 'false'), { timeout: 1500 })
    fireEvent.click(screen.getByRole('button', { name: '切换到画布' }))
    expect(root).toHaveAttribute('data-turning', 'true')
    await waitFor(() => expect(root).toHaveAttribute('data-turning', 'false'), { timeout: 1500 })
  })

  it('settles reduced-motion switches without waiting for the cube animation duration', async () => {
    mockReducedMotion(true)
    const { container } = renderWorkspace()
    const root = container.querySelector('.tc-canvas-workspace')
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    expect(root).toHaveAttribute('data-turning', 'true')
    await act(async () => { vi.advanceTimersByTime(0) })
    expect(root).toHaveAttribute('data-turning', 'false')
    expect(root).toHaveAttribute('data-view', 'workbench')
    fireEvent.click(screen.getByRole('button', { name: '切换到画布' }))
    await act(async () => { vi.advanceTimersByTime(0) })
    expect(root).toHaveAttribute('data-turning', 'false')
    expect(root).toHaveAttribute('data-view', 'canvas')
  })

  it('cancels stale settling timers when switching direction rapidly', async () => {
    mockReducedMotion(false)
    const { container } = renderWorkspace()
    const root = container.querySelector('.tc-canvas-workspace')
    const canvas = screen.getByRole('textbox', { name: '画布内状态' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    await act(async () => { vi.advanceTimersByTime(300) })
    fireEvent.click(screen.getByRole('button', { name: '切换到画布' }))
    expect(root).toHaveAttribute('data-view', 'canvas')
    expect(root).toHaveAttribute('data-turning', 'false')
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    await act(async () => { vi.advanceTimersByTime(320) })
    expect(root).toHaveAttribute('data-view', 'workbench')
    expect(root).toHaveAttribute('data-turning', 'true')
    await act(async () => { vi.advanceTimersByTime(440) })
    expect(root).toHaveAttribute('data-turning', 'false')
    expect(container.querySelector('.tc-workspace-face--canvas')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.tc-workspace-face--pipeline')).toHaveAttribute('aria-hidden', 'false')
    expect(container.querySelector('.test-canvas')).toBe(canvas)
  })
})
