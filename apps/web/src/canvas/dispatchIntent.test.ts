import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAPTER_CANVAS_INTENTS } from '@tapcanvas/chapter-canvas-intents'
import { useChatCommandStore } from '../ui/chat/chatCommandStore'
import { toast } from '../ui/toast'
import { buildIntentChatCommand, dispatchIntent, type DispatchIntentOptions } from './dispatchIntent'

const { setAiChatOpen } = vi.hoisted(() => ({ setAiChatOpen: vi.fn() }))
vi.mock('../ui/uiStore', () => ({
  useUIStore: { getState: () => ({ activeStyleBible: { styleName: '水墨', referenceImages: ['https://example.com/style.png'] }, setAiChatOpen }) },
}))
vi.mock('../ui/toast', () => ({ toast: vi.fn() }))

const chapterContext: NonNullable<DispatchIntentOptions['chapterContext']> = {
  projectId: 'project-1', bookId: 'book-1', chapterId: 'chapter-1',
  flowSnapshot: {
    nodes: [
      { id: 'source-1', kind: 'text', data: { text: '用户实际看到的章节正文' } },
      { id: 'other-node', kind: 'text', data: { text: '不应常驻发送的其他节点正文' } },
    ],
    edges: [],
  },
}

function readFacts(text: string): Record<string, unknown> {
  return JSON.parse(text.split('\n')[2]) as Record<string, unknown>
}

describe('canvas actions enter the main AI chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatCommandStore.setState({ pending: null, pendingQueue: [], deferredUntilFlow: [], busy: false })
  })

  it.each(['generate_scene_references', 'generate_shot_placeholders'] as const)(
    '%s opens the main chat and preserves source, generation settings and user hints', (intent) => {
      dispatchIntent(intent, 'source-1', {
        chapterContext,
        generationConfig: { imageModel: 'user-image-model', imageSize: '4K' },
        variantParams: { lineArt: true, shotDuration: 30, rebuildSceneReferences: true },
        userHints: '保留旧资产，新增版本',
      })
      const command = useChatCommandStore.getState().consume()
      expect(setAiChatOpen).toHaveBeenCalledWith(true)
      expect(command).toMatchObject({ canvasNodeId: 'source-1', attachCanvasContext: true })
      if (!command) throw new Error('Expected main chat command')
      expect(readFacts(command.text)).toMatchObject({
        intent, projectId: 'project-1', bookId: 'book-1', chapterId: 'chapter-1',
        sourceNode: chapterContext.flowSnapshot.nodes[0],
        generationConfig: { imageModel: 'user-image-model', imageSize: '4K' },
        variantParams: { lineArt: true, shotDuration: 30, rebuildSceneReferences: true },
        styleGuide: { styleName: '水墨', referenceImages: ['https://example.com/style.png'] },
      })
      expect(command.text).toContain('保留旧资产，新增版本')
      expect(command.text).not.toContain('不应常驻发送的其他节点正文')
      expect(command.displayText).not.toContain('project-1')
      expect(command.freshConversation).toBeUndefined()
      expect(toast).not.toHaveBeenCalled()
    },
  )

  it.each(CHAPTER_CANVAS_INTENTS)('uses the same chat channel for %s', (intent) => {
    const command = buildIntentChatCommand(intent, 'source-1', { chapterContext })
    expect(command.text).toContain('自主决定执行步骤')
    expect(command.canvasNodeId).toBe('source-1')
    expect(command.queuedProjectId).toBe('project-1')
    expect(command.queuedChapterId).toBe('chapter-1')
    expect(command).not.toHaveProperty('modelKey')
    expect(command).not.toHaveProperty('sessionKey')
    expect(command).not.toHaveProperty('executionToolPolicy')
  })

  it('keeps the clicked chapter scope when a queued action is consumed after navigation', () => {
    const clickedContext = { ...chapterContext }
    useChatCommandStore.getState().dispatchSend({ text: 'earlier request' })
    dispatchIntent('generate_scene_references', 'source-1', { chapterContext: clickedContext })

    clickedContext.projectId = 'project-2'
    clickedContext.chapterId = 'chapter-2'
    expect(useChatCommandStore.getState().consume()?.text).toBe('earlier request')
    const command = useChatCommandStore.getState().consume()
    expect(command).toMatchObject({
      queuedProjectId: 'project-1',
      queuedChapterId: 'chapter-1',
    })
  })

  it('uses the existing main-chat submission path when a turn is already active', () => {
    useChatCommandStore.getState().setBusy(true)
    dispatchIntent('generate_scene_references', 'source-1', { chapterContext })
    expect(useChatCommandStore.getState().pending?.canvasNodeId).toBe('source-1')
    expect(useChatCommandStore.getState().busy).toBe(true)
    expect(toast).not.toHaveBeenCalled()
  })

  it.each([undefined, { ...chapterContext, chapterId: '' }])('rejects missing chapter scope', (context) => {
    dispatchIntent('generate_scene_references', 'source-1', { chapterContext: context })
    expect(useChatCommandStore.getState().pending).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('缺少真实'), 'error')
  })

  it('rejects a missing source node before submitting', () => {
    dispatchIntent('generate_shot_placeholders', 'missing', { chapterContext })
    expect(useChatCommandStore.getState().pending).toBeNull()
    expect(setAiChatOpen).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('找不到指定源节点'), 'error')
  })
})
