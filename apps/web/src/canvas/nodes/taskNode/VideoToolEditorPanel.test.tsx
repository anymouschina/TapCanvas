// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { VideoToolEditorPanel } from './VideoToolEditorPanel'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

beforeAll(() => {
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })
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
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
  if (typeof globalThis.ResizeObserver !== 'function') {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  }
})

afterEach(cleanup)

describe('VideoToolEditorPanel', () => {
  it('collects a real user rectangle before exposing subtitle removal execution', async () => {
    const onUnavailable = vi.fn()
    const { container } = render(
      <MantineProvider>
        <VideoToolEditorPanel
          opened
          mode="subtitle"
          videoUrl="https://assets.example.com/source.mp4"
          readOnly={false}
          onClose={vi.fn()}
          onUnavailable={onUnavailable}
        />
      </MantineProvider>,
    )
    const preview = container.querySelector('.tc-video-tool-editor__preview')
    if (!preview) throw new Error('未渲染视频选区面板')
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) }),
    })

    const submit = screen.getByRole('button', { name: '生成无字幕视频' })
    expect(submit).toBeDisabled()
    fireEvent.pointerDown(preview as Element, { pointerId: 1, buttons: 1, clientX: 40, clientY: 120 })
    fireEvent.pointerMove(preview as Element, { pointerId: 1, buttons: 1, clientX: 320, clientY: 190 })
    fireEvent.pointerUp(preview as Element, { pointerId: 1, clientX: 320, clientY: 190 })

    await waitFor(() => expect(screen.getByText('已标记 1 个区域')).toBeInTheDocument())
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(onUnavailable).toHaveBeenCalledWith('subtitle', [expect.objectContaining({
      x: 0.1,
      y: 0.6,
      width: expect.closeTo(0.7, 5),
      height: 0.35,
    })])
  })

  it('keeps audio/video separation actionable and forwards the selected output', async () => {
    const onSeparate = vi.fn().mockResolvedValue(undefined)
    render(
      <MantineProvider>
        <VideoToolEditorPanel
          opened
          mode="separation"
          videoUrl="https://assets.example.com/source.mp4"
          readOnly={false}
          onClose={vi.fn()}
          onUnavailable={vi.fn()}
          onSeparate={onSeparate}
        />
      </MantineProvider>,
    )
    expect(screen.getByText('视频 + 音轨')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '仅音轨' }))
    const submit = screen.getByRole('button', { name: '导出独立音轨' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(onSeparate).toHaveBeenCalledWith('audio'))
  })

  it('does not route subtitle removal to the generic Seedance video generation model', async () => {
    const onEditSubmit = vi.fn().mockResolvedValue(undefined)
    const onUnavailable = vi.fn()
    const { container } = render(
      <MantineProvider>
        <VideoToolEditorPanel
          opened
          mode="subtitle"
          videoUrl="https://assets.example.com/source.mp4"
          readOnly={false}
          onClose={vi.fn()}
          onUnavailable={onUnavailable}
          editModelValue="doubao-seedance-2.5"
          editModelOptions={[{ value: 'doubao-seedance-2.5', label: '豆包 Seedance 2.5' }]}
          onEditModelChange={vi.fn()}
          onEditSubmit={onEditSubmit}
        />
      </MantineProvider>,
    )
    const preview = container.querySelector('.tc-video-tool-editor__preview')
    if (!preview) throw new Error('未渲染视频选区面板')
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) }),
    })
    fireEvent.pointerDown(preview as Element, { pointerId: 1, buttons: 1, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(preview as Element, { pointerId: 1, buttons: 1, clientX: 320, clientY: 120 })
    fireEvent.pointerUp(preview as Element, { pointerId: 1, clientX: 320, clientY: 120 })
    await waitFor(() => expect(screen.getByText('已标记 1 个区域')).toBeInTheDocument())
    expect(screen.getByText(/volc-erase-video-subtitle-pro/)).toBeInTheDocument()
    expect(screen.queryByText(/Seedance 2\.5/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成无字幕视频' }))
    expect(onEditSubmit).not.toHaveBeenCalled()
    expect(onUnavailable).toHaveBeenCalledWith('subtitle', [expect.objectContaining({ x: 0.1, y: 0.2 })])
  })

  it('submits a structured subtitle edit when the catalog exposes a compatible model', async () => {
    const onEditSubmit = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <MantineProvider>
        <VideoToolEditorPanel
          opened
          mode="subtitle"
          videoUrl="https://assets.example.com/source.mp4"
          readOnly={false}
          onClose={vi.fn()}
          onUnavailable={vi.fn()}
          editModelValue="wan2.7-videoedit"
          editModelOptions={[{ value: 'wan2.7-videoedit', label: 'Wan2.7 VideoEdit' }]}
          editExecutorAvailable
          onEditModelChange={vi.fn()}
          onEditSubmit={onEditSubmit}
        />
      </MantineProvider>,
    )
    const preview = container.querySelector('.tc-video-tool-editor__preview')
    if (!preview) throw new Error('未渲染视频选区面板')
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) }),
    })
    fireEvent.pointerDown(preview as Element, { pointerId: 1, buttons: 1, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(preview as Element, { pointerId: 1, buttons: 1, clientX: 320, clientY: 120 })
    fireEvent.pointerUp(preview as Element, { pointerId: 1, clientX: 320, clientY: 120 })
    await waitFor(() => expect(screen.getByText('已标记 1 个区域')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '生成无字幕视频' }))
    await waitFor(() => expect(onEditSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subtitle',
      modelValue: 'wan2.7-videoedit',
      selections: [expect.objectContaining({ x: 0.1, y: 0.2 })],
    })))
  })

  it('submits a structured subject-removal edit with the selected region', async () => {
    const onEditSubmit = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <MantineProvider>
        <VideoToolEditorPanel
          opened
          mode="subject"
          videoUrl="https://assets.example.com/source.mp4"
          readOnly={false}
          onClose={vi.fn()}
          onUnavailable={vi.fn()}
          editModelValue="wan2.7-videoedit"
          editModelOptions={[{ value: 'wan2.7-videoedit', label: 'Wan2.7 VideoEdit' }]}
          editExecutorAvailable
          onEditModelChange={vi.fn()}
          onEditSubmit={onEditSubmit}
        />
      </MantineProvider>,
    )
    const preview = container.querySelector('.tc-video-tool-editor__preview')
    if (!preview) throw new Error('未渲染视频选区面板')
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON: () => ({}) }),
    })
    fireEvent.pointerDown(preview as Element, { pointerId: 1, buttons: 1, clientX: 120, clientY: 50 })
    fireEvent.pointerMove(preview as Element, { pointerId: 1, buttons: 1, clientX: 280, clientY: 180 })
    fireEvent.pointerUp(preview as Element, { pointerId: 1, clientX: 280, clientY: 180 })
    await waitFor(() => expect(screen.getByText('已标记 1 个区域')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '生成主体消除视频' }))
    await waitFor(() => expect(onEditSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subject',
      modelValue: 'wan2.7-videoedit',
      selections: [expect.objectContaining({ x: 0.3, y: 0.25 })],
    })))
  })
})
