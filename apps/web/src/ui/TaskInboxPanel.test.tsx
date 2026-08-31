// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuth } from '../auth/store'
import TaskInboxPanel from './TaskInboxPanel'
import { useLiveChatRunStore } from './chat/liveChatRunStore'
import { useUIStore } from './uiStore'

const hookMocks = vi.hoisted(() => ({
  markRead: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn(),
  loadMore: vi.fn(),
}))

let focusNode: ReturnType<typeof vi.fn>

vi.mock('@mantine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/core')>()
  return { ...actual, SegmentedControl: () => null }
})

vi.mock('./useTaskInbox', () => ({
  useTaskInbox: () => ({
    items: [{
      taskId: 'task-1',
      vendor: 'newapi',
      kind: 'text_to_image',
      status: 'succeeded',
      assetCount: 1,
      assets: [{ type: 'image', url: 'https://assets.example.com/result.png' }],
      prompt: '一只站在月球上的猫',
      errorMessage: null,
      nodeId: 'node-1',
      chapterId: null,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:01:00.000Z',
      completedAt: '2026-08-14T00:01:00.000Z',
      notificationId: 'task-result:user-1:task-1',
      readAt: null,
    }, {
      taskId: 'task-2',
      vendor: 'newapi',
      kind: 'text_to_video',
      status: 'succeeded',
      assetCount: 1,
      assets: [{ type: 'video', url: 'https://assets.example.com/result.mp4' }],
      prompt: '一艘飞船穿过星云',
      errorMessage: null,
      nodeId: null,
      chapterId: null,
      createdAt: '2026-08-14T00:02:00.000Z',
      updatedAt: '2026-08-14T00:03:00.000Z',
      completedAt: '2026-08-14T00:03:00.000Z',
      notificationId: 'task-result:user-1:task-2',
      readAt: null,
    }],
    unreadCount: 2,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: null,
    reload: hookMocks.reload,
    loadMore: hookMocks.loadMore,
    markRead: hookMocks.markRead,
  }),
}))

vi.mock('../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ alt }: { alt: string }) => <div className="managed-image-test-double">{alt}</div>,
}))

describe('TaskInboxPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    useAuth.setState({ user: { sub: 'user-1', login: 'user-1', role: 'user' } })
    useUIStore.setState({ activePanel: 'task-inbox', panelAnchorX: 420, preview: null, currentProject: null })
    useLiveChatRunStore.setState({ activeRun: null })
    focusNode = vi.fn()
    Object.defineProperty(window, '__tcFocusNode', { value: focusNode, configurable: true })
  })

  afterEach(() => {
    cleanup()
    hookMocks.markRead.mockClear()
    useUIStore.setState({ activePanel: null, panelAnchorX: null, preview: null })
    useAuth.setState({ user: null })
    useLiveChatRunStore.setState({ activeRun: null })
    delete (window as Window & { __tcFocusNode?: (nodeId: string) => void }).__tcFocusNode
    delete (window as Window & { __tcExpandChat?: () => void }).__tcExpandChat
    vi.unstubAllGlobals()
  })

  it('shows the generated asset thumbnail in the log row and opens the media preview directly', () => {
    render(
      <MantineProvider>
        <TaskInboxPanel />
      </MantineProvider>,
    )

    expect(screen.getByText('创作动态')).toBeInTheDocument()
    expect(screen.getByText('生成图片')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '放大查看生成图片' }))

    expect(hookMocks.markRead).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1' }))
    expect(useUIStore.getState().preview).toEqual({
      url: 'https://assets.example.com/result.png',
      kind: 'image',
      name: undefined,
    })
    expect(screen.queryByText('一只站在月球上的猫')).not.toBeInTheDocument()
  })

  it('opens a successful video asset in playback preview mode', () => {
    render(
      <MantineProvider>
        <TaskInboxPanel />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '放大播放生成视频' }))

    expect(hookMocks.markRead).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-2' }))
    expect(useUIStore.getState().preview).toEqual({
      url: 'https://assets.example.com/result.mp4',
      kind: 'video',
      name: undefined,
    })
  })

  it('opens the prompt and artifact detail, marks it read, and keeps canvas focus as an explicit action', () => {
    render(
      <MantineProvider>
        <TaskInboxPanel />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '文生图，执行成功，查看任务事实和全部产物' }))

    expect(hookMocks.markRead).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1' }))
    expect(screen.getByText('一只站在月球上的猫')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '预览图片 1' })).toBeInTheDocument()
    expect(focusNode).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '定位到画布节点' }))
    expect(focusNode).toHaveBeenCalledWith('node-1')

    fireEvent.click(screen.getByRole('button', { name: '预览图片 1' }))
    expect(useUIStore.getState().preview).toEqual({
      url: 'https://assets.example.com/result.png',
      kind: 'image',
      name: undefined,
    })
  })

  it('projects the current agents-cli run into the same activity list and opens the existing chat', () => {
    const expandChat = vi.fn()
    Object.defineProperty(window, '__tcExpandChat', { value: expandChat, configurable: true })
    useUIStore.setState({ currentProject: { id: 'project-1', name: '测试项目' } })
    useLiveChatRunStore.getState().startRun({
      runId: 'run-agent-1',
      requestId: 'request-agent-1',
      requestText: '为第一章生成完整故事板',
      projectId: 'project-1',
      projectName: '测试项目',
      flowId: 'flow-1',
    })

    render(
      <MantineProvider>
        <TaskInboxPanel />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '为第一章生成完整故事板，AI 编排中，打开小 T 对话' }))
    expect(expandChat).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().activePanel).toBeNull()
  })
})
