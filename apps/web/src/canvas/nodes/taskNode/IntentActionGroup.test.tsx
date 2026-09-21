// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { useChatCommandStore } from '../../../ui/chat/chatCommandStore'
import { IntentActionGroup } from './IntentActionGroup'

const { setAiChatOpen, sourceNode } = vi.hoisted(() => ({
  setAiChatOpen: vi.fn(),
  sourceNode: { id: 'chapter-source', kind: 'text', data: { text: '本章真实正文' } },
}))
vi.mock('../../../ui/uiStore', () => ({
  useUIStore: { getState: () => ({ activeStyleBible: null, setAiChatOpen }) },
}))
vi.mock('../../store', () => ({
  useRFStore: { getState: () => ({ nodes: [sourceNode], edges: [] }) },
}))
vi.mock('./intentChapterContext', () => ({
  resolveIntentChapterContext: () => ({
    projectId: 'project-1', bookId: 'book-1', chapterId: 'chapter-1',
    flowSnapshot: { nodes: [sourceNode], edges: [] },
  }),
}))
vi.mock('../../../config/useModelOptions', () => ({
  useModelOptions: () => [{ value: 'catalog-image-model', label: 'Catalog Image Model' }],
}))
vi.mock('./ChapterFilmSpecModal', () => ({ ChapterFilmSpecModal: () => null }))
vi.mock('../../../api/server', () => ({ API_BASE: '/api' }))
vi.mock('../../../ui/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.clearAllMocks()
  useChatCommandStore.setState({ pending: null, pendingQueue: [], deferredUntilFlow: [], busy: false })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})

describe('chapter toolbar to main AI conversation', () => {
  it.each([
    ['生成场景/人物参考图', 'generate_scene_references'],
    ['拆分并生成设计板图片', 'generate_shot_placeholders'],
  ])('clicking %s and confirming submits the configured action to chat', (label, intent) => {
    render(
      <MantineProvider env="test">
        <IntentActionGroup nodeId="chapter-source" kind="text" preset="chapter-info" />
      </MantineProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(useChatCommandStore.getState().pending).toBeNull()
    fireEvent.change(screen.getByLabelText('附加提示词（可选）'), { target: { value: '雨夜庭院' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))
    const command = useChatCommandStore.getState().consume()
    expect(setAiChatOpen).toHaveBeenCalledWith(true)
    expect(command?.canvasNodeId).toBe('chapter-source')
    expect(command?.queuedProjectId).toBe('project-1')
    expect(command?.queuedChapterId).toBe('chapter-1')
    expect(command?.text).toContain(`"intent":"${intent}"`)
    expect(command?.text).toContain('"imageModel":"catalog-image-model"')
    expect(command?.text).toContain('"imageSize":"2K"')
    expect(command?.text).toContain('本章真实正文')
    expect(command?.text).toContain('雨夜庭院')
    if (intent === 'generate_shot_placeholders') {
      expect(command?.text).toContain('"shotDuration":15')
    }
  })
})
