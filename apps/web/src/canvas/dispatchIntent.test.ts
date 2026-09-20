import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadModelOptions } from '../config/useModelOptions'
import { readStoredChatModelValue } from '../ui/chat/chatModelSelection'
import { toast } from '../ui/toast'
import { dispatchIntent, type DispatchIntentOptions } from './dispatchIntent'
import { useIntentLifecycle } from './intentLifecycle'
import { streamChapterIntent } from './streamChapterIntent'

vi.mock('../config/useModelOptions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../config/useModelOptions')>(),
  preloadModelOptions: vi.fn(),
}))
vi.mock('../ui/chat/chatModelSelection', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ui/chat/chatModelSelection')>(),
  readStoredChatModelValue: vi.fn(),
}))
vi.mock('../ui/uiStore', () => ({ useUIStore: { getState: () => ({ activeStyleBible: null }) } }))
vi.mock('../ui/toast', () => ({ toast: vi.fn() }))
vi.mock('./streamChapterIntent', () => ({ streamChapterIntent: vi.fn() }))

const chapterContext: NonNullable<DispatchIntentOptions['chapterContext']> = {
  projectId: 'project-1', bookId: 'book-1', chapterId: 'chapter-1',
  flowSnapshot: { nodes: [], edges: [] },
}

describe('chapter intent language model admission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useIntentLifecycle.getState().cancel()
    useIntentLifecycle.getState().clearPendingUserInput()
    vi.mocked(readStoredChatModelValue).mockReturnValue('Selected model')
    vi.mocked(preloadModelOptions).mockResolvedValue([
      { value: 'Selected model', label: 'Selected model', modelKey: 'exact-catalog-key' },
    ])
    vi.mocked(streamChapterIntent).mockImplementation(async (params) => {
      params.onTerminal({ status: 'succeeded', reason: 'verified', text: '' })
    })
  })

  it.each(['generate_scene_references', 'generate_shot_placeholders'] as const)(
    'resolves the main-chat selection from the text catalog for %s', async (intent) => {
      await dispatchIntent(intent, 'source-1', { chapterContext })
      expect(preloadModelOptions).toHaveBeenCalledWith('text')
      expect(streamChapterIntent).toHaveBeenCalledWith(expect.objectContaining({
        intent, languageModel: { field: 'modelKey', model: 'exact-catalog-key' },
      }))
      expect(toast).not.toHaveBeenCalled()
      expect(useIntentLifecycle.getState().activeRunCount).toBe(0)
    },
  )

  it.each([null, 'removed-model'])('does not send an unselected or unavailable model: %s', async (value) => {
    vi.mocked(readStoredChatModelValue).mockReturnValue(value)
    await dispatchIntent('generate_scene_references', 'source-1', { chapterContext })
    expect(streamChapterIntent).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining(value ? '不在可执行模型目录' : '尚未选择语言模型'), 'error')
    expect(useIntentLifecycle.getState().activeRunCount).toBe(0)
  })

  it('reports catalog failure without submitting a model-less request', async () => {
    vi.mocked(preloadModelOptions).mockRejectedValue(new Error('catalog unavailable'))
    await dispatchIntent('generate_shot_placeholders', 'source-1', { chapterContext })
    expect(streamChapterIntent).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('catalog unavailable'), 'error')
  })

  it('keeps the admitted model when answering a pending question after the chat selection changes', async () => {
    vi.mocked(streamChapterIntent).mockImplementationOnce(async (params) => {
      params.onPendingUserInput?.({ requestId: 'question-1', questions: [] })
    })
    await dispatchIntent('generate_shot_placeholders', 'source-1', { chapterContext })
    const pending = useIntentLifecycle.getState().pendingUserInput
    expect(pending?.languageModel).toEqual({ field: 'modelKey', model: 'exact-catalog-key' })
    if (!pending) throw new Error('Expected pending input')
    vi.mocked(readStoredChatModelValue).mockReturnValue('another-model')
    await dispatchIntent(pending.intent, pending.sourceNodeId, {
      chapterContext: pending.chapterContext,
      languageModel: pending.languageModel,
      requestUserInputResponse: { requestId: pending.request.requestId, answers: [] },
    })
    expect(streamChapterIntent).toHaveBeenLastCalledWith(expect.objectContaining({
      languageModel: { field: 'modelKey', model: 'exact-catalog-key' },
    }))
    expect(preloadModelOptions).toHaveBeenCalledTimes(1)
  })
})
