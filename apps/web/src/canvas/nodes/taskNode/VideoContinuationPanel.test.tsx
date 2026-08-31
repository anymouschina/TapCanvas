// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { VideoContinuationPanel } from './VideoContinuationPanel'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

beforeAll(() => {
  if (typeof globalThis.ResizeObserver !== 'function') {
    class ResizeObserverMock implements ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock,
    })
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }),
  })
})

afterEach(cleanup)

describe('VideoContinuationPanel', () => {
  it('requires a continuation prompt and submits the selected source segment', () => {
    const onSubmit = vi.fn()
    render(
      <MantineProvider>
        <VideoContinuationPanel
          opened
          readOnly={false}
          sourceVideoUrl="https://assets.example.com/source.mp4"
          sourceDurationSeconds={10}
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />
      </MantineProvider>,
    )

    const submit = screen.getByRole('button', { name: '确认续写' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('请输入需要续写的内容'), {
      target: { value: '人物继续穿过庭院' },
    })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({
      prompt: '人物继续穿过庭院',
      durationSeconds: 5,
      sourceRange: { start: 0, end: 10 },
      sourceDurationSeconds: 10,
    })
  })

  it('uses the real media metadata instead of a stale 15-second node generation default', async () => {
    const onSubmit = vi.fn()
    render(
      <MantineProvider>
        <VideoContinuationPanel
          opened
          readOnly={false}
          sourceVideoUrl="https://assets.example.com/three-minute.mp4"
          sourceDurationSeconds={15}
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />
      </MantineProvider>,
    )

    const video = document.querySelector('video')
    if (!video) throw new Error('视频预览未渲染')
    Object.defineProperty(video, 'duration', { configurable: true, value: 196 })
    fireEvent.loadedMetadata(video)
    await waitFor(() => expect(screen.getByText(/3:16\.0/)).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('请输入需要续写的内容'), {
      target: { value: '人物继续穿过庭院' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认续写' }))

    expect(onSubmit).toHaveBeenCalledWith({
      prompt: '人物继续穿过庭院',
      durationSeconds: 5,
      sourceRange: { start: 181, end: 196 },
      sourceDurationSeconds: 196,
    })
  })
})
