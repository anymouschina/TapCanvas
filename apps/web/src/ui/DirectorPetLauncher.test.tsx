// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatActivityStore } from './chat/chatActivityStore'
import { useChatCommandStore } from './chat/chatCommandStore'
import { resetVideoRuns, upsertVideoRun } from '../runner/videoRunStore'
import { VIDEO_RUN_STATUS_PROTOCOL_VERSION } from '@tapcanvas/video-orchestrator-protocol'
import DirectorPetLauncher from './DirectorPetLauncher'
import { useUIStore } from './uiStore'

const canonicalStatusFields = {
  protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  authoringState: null,
  authoringClipsReady: 0,
  authoringTotalClips: 0,
  chapterId: null,
  chapterTitle: null,
  updatedAt: '2026-08-03T05:00:00.000Z',
} as const

vi.mock('./director-pet/DirectorPetSprite', () => ({
  DirectorPetSprite: ({ state, mirrored }: { state: string; mirrored?: boolean }) => (
    <div
      className="director-pet-test-sprite"
      data-animation-state={state}
      data-mirrored={mirrored ? 'true' : 'false'}
    />
  ),
}))

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('DirectorPetLauncher', () => {
  beforeEach(() => {
    localStorage.removeItem('tapcanvas.director-pet.position.v1')
    useUIStore.setState({ aiChatOpen: false })
    useChatCommandStore.setState({ busy: false })
    useChatActivityStore.setState({ active: false })
    resetVideoRuns()
  })

  afterEach(() => {
    cleanup()
    const chatWindow = window as unknown as {
      __tcExpandChat?: () => void
      __tcToggleChat?: () => void
    }
    delete chatWindow.__tcExpandChat
    delete chatWindow.__tcToggleChat
  })

  it('opens the AI dialog immediately without a click reaction', async () => {
    const expandChat = vi.fn(() => useUIStore.setState({ aiChatOpen: true }))
    ;(window as unknown as { __tcExpandChat?: () => void }).__tcExpandChat = expandChat

    render(<DirectorPetLauncher />)

    const launcher = screen.getByRole('button', { name: '打开导演小T对话' })
    expect(launcher.hasAttribute('data-click-reaction')).toBe(false)
    fireEvent.click(launcher)

    expect(expandChat).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '打开导演小T对话' })).toBeNull()
      expect(screen.getByRole('button', { name: '收起AI对话' })).toBeTruthy()
    })
  })

  it('collapses the dialog from the peek state and docks at the right wall', async () => {
    const toggleChat = vi.fn(() => useUIStore.setState({ aiChatOpen: false }))
    ;(window as unknown as { __tcToggleChat?: () => void }).__tcToggleChat = toggleChat
    useUIStore.setState({ aiChatOpen: true })

    render(<DirectorPetLauncher />)

    const peek = screen.getByRole('button', { name: '收起AI对话' })
    expect(peek.getAttribute('data-wall-side')).toBe('chat-left')
    expect(peek.getAttribute('title')).toBe('上下拖动调整位置，点击收起AI对话')
    expect(peek.querySelector('.director-pet-test-sprite')?.getAttribute('data-mirrored')).toBe('true')
    fireEvent.click(peek)

    expect(toggleChat).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      const launcher = screen.getByRole('button', { name: '打开导演小T对话' })
      expect(launcher.getAttribute('data-wall-side')).toBe('right')
    })

    const storedPosition = JSON.parse(localStorage.getItem('tapcanvas.director-pet.position.v1') || 'null') as {
      x: number
      y: number
    } | null
    expect(storedPosition?.x).toBe(window.innerWidth - 64)
  })

  it('shows real background video progress after the chat turn has ended', async () => {
    upsertVideoRun({
      ...canonicalStatusFields,
      runId: 'chapter-film-1',
      flowId: null,
      state: 'video_running',
      totalClips: 12,
      clipsDone: 7,
      errorMessage: null,
      completedAt: null,
    })

    render(<DirectorPetLauncher />)

    const launcher = screen.getByRole('button', { name: '打开导演小T对话' })
    expect(launcher.getAttribute('data-production-phase')).toBe('rendering')
    expect(launcher.querySelector('.director-pet-test-sprite')?.getAttribute('data-animation-state')).toBe('working')
    expect(screen.getByText('正在出片 · 7/12 段')).toBeTruthy()
  })

  it('uses the idea animation while an active run is still planning', () => {
    upsertVideoRun({
      ...canonicalStatusFields,
      runId: 'chapter-film-planning',
      flowId: null,
      state: 'collecting',
      totalClips: 0,
      clipsDone: 0,
      errorMessage: null,
      completedAt: null,
    })

    render(<DirectorPetLauncher />)

    const launcher = screen.getByRole('button', { name: '打开导演小T对话' })
    expect(launcher.getAttribute('data-production-phase')).toBe('planning')
    expect(launcher.querySelector('.director-pet-test-sprite')?.getAttribute('data-animation-state')).toBe('idea')
    expect(screen.getByText('正在拆解镜头')).toBeTruthy()
  })
})
