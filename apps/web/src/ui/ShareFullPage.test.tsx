// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicProjectFlowDto } from '../api/server'

const apiMocks = vi.hoisted(() => ({
  cloneProject: vi.fn(),
  getPublicProjectConversation: vi.fn(),
  getPublicProjectFlows: vi.fn(),
  listPublicProjects: vi.fn(),
}))

vi.mock('../api/server', () => apiMocks)
vi.mock('../canvas/Canvas', () => ({ default: () => 'canvas-ready' }))
vi.mock('./PublicConversationPanel', () => ({
  PublicConversationPanel: () => <aside aria-label="创作对话记录" />,
}))
vi.mock('./toast', () => ({ toast: vi.fn() }))

import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'
import ShareFullPage from './ShareFullPage'

const publicFlow: PublicProjectFlowDto = {
  id: 'flow-1',
  name: '公开工作流',
  data: {
    nodes: [{
      id: 'node-1',
      type: 'taskNode',
      position: { x: 4200, y: 2600 },
      data: { label: '第一步' },
    }],
    edges: [],
    viewport: { x: -50000, y: -50000, zoom: 1 },
  },
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver
})

describe('ShareFullPage public canvas initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/share/project-1')
    useRFStore.getState().reset()
    useUIStore.getState().setRestoreViewport({ x: 99, y: 88, zoom: 2 })
    apiMocks.listPublicProjects.mockResolvedValue([{
      id: 'project-1',
      name: '公开项目',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      isPublic: true,
    }])
    apiMocks.getPublicProjectConversation.mockResolvedValue({ sessions: [] })
  })

  afterEach(() => {
    cleanup()
    useRFStore.getState().reset()
    useUIStore.getState().setRestoreViewport(null)
  })

  it('waits for the real graph, ignores the author viewport, then mounts the canvas', async () => {
    let resolveFlows: ((flows: PublicProjectFlowDto[]) => void) | null = null
    apiMocks.getPublicProjectFlows.mockReturnValue(new Promise<PublicProjectFlowDto[]>((resolve) => {
      resolveFlows = resolve
    }))

    render(
      <MantineProvider>
        <ShareFullPage />
      </MantineProvider>,
    )

    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.queryByText('canvas-ready')).toBeNull()

    await act(async () => {
      resolveFlows?.([publicFlow])
    })

    await screen.findByText('canvas-ready')
    await waitFor(() => {
      expect(useRFStore.getState().nodes.map((node) => node.id)).toEqual(['node-1'])
      expect(useUIStore.getState().restoreViewport).toBeNull()
    })
    expect(screen.getByRole('complementary', { name: '项目目录' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '创作对话记录' })).toBeTruthy()
    expect(apiMocks.getPublicProjectFlows).toHaveBeenCalledWith('project-1')
    expect(apiMocks.getPublicProjectConversation).toHaveBeenCalledWith('project-1')
  })

  it('ignores legacy chapter query parameters and loads the complete project', async () => {
    window.history.replaceState({}, '', '/share/project-1?ownerType=chapter&ownerId=chapter-1')
    apiMocks.getPublicProjectFlows.mockResolvedValue([publicFlow])

    render(
      <MantineProvider>
        <ShareFullPage />
      </MantineProvider>,
    )

    await screen.findByText('canvas-ready')
    expect(apiMocks.getPublicProjectFlows).toHaveBeenCalledWith('project-1')
    expect(apiMocks.getPublicProjectConversation).toHaveBeenCalledWith('project-1')
  })
})
