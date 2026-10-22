import React from 'react'
import type { Node } from '@xyflow/react'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { PipelineProductionControls } from './PipelineProductionControls'

const actions = vi.hoisted(() => ({ launch: vi.fn(), catalog: vi.fn(), mount: vi.fn() }))
vi.mock('../store', async () => {
  const { create } = await import('zustand')
  return { useRFStore: create<{ nodes: Node[]; graphProvenanceKey: string | null }>(() => ({ nodes: [], graphProvenanceKey: null })) }
})
vi.mock('../../ui/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create<{
    currentProject: { id: string; name: string } | null
    currentFlow: { id: string; name: string; source: 'server' }
    currentChapter: { projectId: string; bookId: string | null; chapterId: string; chapterTitle: string } | null
    viewOnly: boolean
    openAssetManager: (tab: string) => void
  }>(() => ({ currentProject: { id: 'project', name: '项目' }, currentFlow: { id: 'flow', name: '画布', source: 'server' },
    currentChapter: null, viewOnly: false, openAssetManager: actions.catalog })) }
})
vi.mock('../nodes/taskNode/IntentActionGroup', () => ({
  IntentActionGroup: ({ nodeId, filmOnly }: { nodeId: string; filmOnly: boolean }) => {
    React.useEffect(() => { actions.mount() }, [])
    return <button className="test-film-entry" type="button" data-source={nodeId} data-film-only={filmOnly}
      onClick={() => actions.launch(nodeId)}>一键成片</button>
  },
}))

const chapterNode: Node = { id: 'chapter-seed-chapter', type: 'taskNode', position: { x: 19, y: 23 },
  data: { kind: 'text', preset: 'chapter-info', label: '章节正文' } }
beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ currentProject: { id: 'project', name: '项目' }, currentFlow: { id: 'flow', name: '画布', source: 'server' },
    currentChapter: { projectId: 'project', bookId: null, chapterId: 'chapter', chapterTitle: '章节' }, viewOnly: false })
  useRFStore.setState({ nodes: [structuredClone(chapterNode)], graphProvenanceKey: 'chapter:chapter' })
})
afterEach(cleanup)

describe('pipeline production entry', () => {
  it('requires an explicit source selection for an ordinary flow', () => {
    useUIStore.setState({ currentChapter: null })
    useRFStore.setState({ graphProvenanceKey: 'flow:flow', nodes: [{ ...chapterNode, id: 'text', data: { kind: 'text', label: '唯一正文' } }] })
    render(<MantineProvider><PipelineProductionControls /></MantineProvider>)
    expect((screen.getByRole('button', { name: '一键成片' }) as HTMLButtonElement).disabled).toBe(true)
    expect(actions.launch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('选择成片文本来源'))
    fireEvent.click(screen.getByRole('option', { name: '唯一正文' }))
    fireEvent.click(screen.getByRole('button', { name: '一键成片' }))
    expect(actions.launch).toHaveBeenCalledWith('text')
  })
  it('launches only after a click through the chapter node existing film entry', () => {
    render(<MantineProvider><PipelineProductionControls /></MantineProvider>)
    expect(actions.launch).not.toHaveBeenCalled()
    const entry = screen.getByRole('button', { name: '一键成片' })
    expect(entry.getAttribute('data-film-only')).toBe('true')
    fireEvent.click(entry)
    expect(actions.launch).toHaveBeenCalledWith(chapterNode.id)
    fireEvent.click(screen.getByRole('button', { name: '切换章节' }))
    expect(actions.catalog).toHaveBeenCalledWith('catalog')
  })

  it('keeps the real entry mounted when only the view switches during preparation', () => {
    const { rerender } = render(<MantineProvider><PipelineProductionControls active /></MantineProvider>)
    rerender(<MantineProvider><PipelineProductionControls active={false} /></MantineProvider>)
    expect(actions.mount).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '一键成片' })).toBeTruthy()
  })

  it('hides production for readonly browsing and reports missing durable scope', () => {
    const { rerender } = render(<MantineProvider><PipelineProductionControls /></MantineProvider>)
    act(() => { useUIStore.setState({ viewOnly: true }) })
    expect(screen.queryByRole('button', { name: '一键成片' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => { useUIStore.setState({ viewOnly: false, currentProject: null }) })
    rerender(<MantineProvider><PipelineProductionControls /></MantineProvider>)
    expect(screen.getByRole('alert').textContent).toContain('已保存')
    expect(actions.launch).not.toHaveBeenCalled()
  })

  it('blocks a readonly source even when the canvas is editable', () => {
    useRFStore.setState({ nodes: [{ ...chapterNode, data: { ...chapterNode.data, readOnly: true } }] })
    render(<MantineProvider><PipelineProductionControls /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: '一键成片' }))
    expect(screen.getByRole('alert').textContent).toContain('正文节点为只读')
    expect(actions.launch).not.toHaveBeenCalled()
  })
})
