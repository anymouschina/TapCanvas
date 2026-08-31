// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

// Mantine 在 jsdom 下需要 matchMedia。
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// api/server 很重且会拉网络，mock 掉只保留取消函数。
const cancelMock = vi.fn((..._args: unknown[]) => Promise.resolve(1))
vi.mock('../../api/server', () => ({
  cancelProjectVideoRuns: (...args: unknown[]) => cancelMock(...args),
}))

import { VideoRunIndicator } from './VideoRunIndicator'
import { upsertVideoRun, resetVideoRuns } from '../../runner/videoRunStore'
import { VIDEO_RUN_STATUS_PROTOCOL_VERSION } from '@tapcanvas/video-orchestrator-protocol'
import { useUIStore } from '../../ui/uiStore'

const canonicalStatusFields = {
  protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  authoringState: null,
  authoringClipsReady: 0,
  authoringTotalClips: 0,
  updatedAt: new Date().toISOString(),
} as const

function renderIndicator() {
  return render(
    <MantineProvider>
      <VideoRunIndicator projectId="proj-1" currentChapterId="ch43" />
    </MantineProvider>,
  )
}

describe('VideoRunIndicator', () => {
  beforeEach(() => {
    resetVideoRuns()
    useUIStore.getState().setAiChatOpen(false)
    cancelMock.mockClear()
  })

  it('AI 对话展开时让位给唯一的聊天主进度', () => {
    upsertVideoRun({
      ...canonicalStatusFields,
      runId: 'video-run-chat-open',
      flowId: 'f1',
      state: 'video_running',
      totalClips: 3,
      clipsDone: 0,
      errorMessage: null,
      completedAt: null,
      chapterId: 'ch43',
      chapterTitle: '第43章',
    })
    useUIStore.getState().setAiChatOpen(true)
    renderIndicator()
    expect(screen.queryByText(/视频生产中/)).toBeNull()
    expect(screen.queryByLabelText('终止视频生产')).toBeNull()
  })

  afterEach(() => {
    cleanup()
  })

  it('无活跃 run 时不渲染', () => {
    const { container } = renderIndicator()
    expect(container.textContent).not.toContain('视频生产中')
  })

  it('有活跃 run 时显示进度 + 终止按钮，点击按显式 projectId 取消', async () => {
    upsertVideoRun({
      ...canonicalStatusFields,
      runId: 'video-run-ch43-s1s2-group',
      flowId: 'f1',
      state: 'video_running',
      totalClips: 7,
      clipsDone: 1,
      errorMessage: null,
      completedAt: null,
      chapterId: 'ch43',
      chapterTitle: '第43章',
    })
    renderIndicator()
    expect(screen.getByText(/视频生产中 · 1\/7 段/)).toBeTruthy()
    const cancelBtn = screen.getByLabelText('终止视频生产')
    fireEvent.click(cancelBtn)
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('proj-1'))
  })

  it('子片已齐时不再重复显示全局进度，合成状态交给成片节点', () => {
    upsertVideoRun({
      ...canonicalStatusFields,
      runId: 'video-run-ready',
      flowId: 'f1',
      state: 'video_success',
      totalClips: 12,
      clipsDone: 12,
      errorMessage: null,
      completedAt: null,
      chapterId: 'ch43',
      chapterTitle: '第43章',
    })

    renderIndicator()

    expect(screen.queryByText('子片已齐 · 等待画布合成 · 12/12 段')).toBeNull()
    expect(screen.queryByLabelText('终止视频生产')).toBeNull()
  })
})
