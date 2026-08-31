// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LibTvMediaQuickActions } from './LibTvMediaQuickActions'
import { MediaEmptyState } from './MediaEmptyState'
import { VeoImageModal } from './VeoImageModal'

beforeAll(() => {
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

describe('LibTV media node parity', () => {
  it('renders the exact image empty-state attempts and executes their actions', () => {
    const onAction = vi.fn()
    render(<MediaEmptyState kind="image" onAction={onAction} />)

    expect(screen.getByText('尝试：')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '图生图' }))
    fireEvent.click(screen.getByRole('button', { name: '图片高清' }))

    expect(onAction).toHaveBeenNthCalledWith(1, 'image-to-image')
    expect(onAction).toHaveBeenNthCalledWith(2, 'image-upscale')
  })

  it('lets the lightweight shell bubble the first action click so React Flow can focus the node', () => {
    const onNodeClick = vi.fn()
    render(
      <div onClick={onNodeClick}>
        <MediaEmptyState
          kind="image"
          stopNodePropagation={false}
          onAction={vi.fn()}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: '图生图' }))

    expect(onNodeClick).toHaveBeenCalledTimes(1)
  })

  it('renders all video empty-state modes in LibTV order', () => {
    const onAction = vi.fn()
    render(<MediaEmptyState kind="video" onAction={onAction} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      '5分钟超长视频',
      '首尾帧生成视频',
      '首帧生成视频',
    ])

    fireEvent.click(buttons[1])
    expect(onAction).toHaveBeenCalledWith('first-last-frame-video')
  })

  it('uses the LibTV image quick-action order', () => {
    render(
      <LibTvMediaQuickActions
        kind="image"
        onReference={vi.fn()}
        onMarker={vi.fn()}
        onStyle={vi.fn()}
        onFocus={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['参考', '标记', '风格', '聚焦'])
  })

  it('uses the LibTV video quick-action order and keeps reference active', () => {
    const onEffect = vi.fn()
    const onFocus = vi.fn()
    render(
      <LibTvMediaQuickActions
        kind="video"
        referenceActive
        markerActive
        onReference={vi.fn()}
        onMarker={vi.fn()}
        onEffect={onEffect}
        onCharacters={vi.fn()}
        onCameraMovement={vi.fn()}
        onFocus={onFocus}
      />,
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '标记',
      '参考',
      '特效',
      '角色库',
      '运镜',
      '聚焦',
    ])
    expect(screen.getByRole('button', { name: '参考' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '标记' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '特效' }))
    expect(onEffect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '聚焦' }))
    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it('keeps viewport focus available while generation actions are disabled', () => {
    render(
      <LibTvMediaQuickActions
        kind="image"
        disabled
        onReference={vi.fn()}
        onMarker={vi.fn()}
        onStyle={vi.fn()}
        onFocus={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '参考' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '聚焦' })).toBeEnabled()
  })

  it('continues from first-frame selection to the tail-frame step for first-last mode', () => {
    const onSetFirstFrameUrl = vi.fn()
    const onContinueToLastFrame = vi.fn()
    const onClose = vi.fn()
    render(
      <MantineProvider>
        <VeoImageModal
          opened
          mode="first"
          statusColor="gray"
          firstFrameLocked={false}
          trimmedFirstFrameUrl=""
          trimmedLastFrameUrl=""
          veoReferenceImages={[]}
          veoReferenceLimitReached={false}
          veoCustomImageInput=""
          veoCandidateImages={[{
            url: 'https://assets.example.com/first-frame.jpg',
            label: '候选首帧',
            sourceType: 'image',
          }]}
          mediaFallbackSurface="#111"
          inlineDividerColor="rgba(255,255,255,.08)"
          continueToLastFrame
          onClose={onClose}
          onCustomImageInputChange={vi.fn()}
          onAddCustomReferenceImage={vi.fn()}
          onRemoveReferenceImage={vi.fn()}
          onSetFirstFrameUrl={onSetFirstFrameUrl}
          onSetLastFrameUrl={vi.fn()}
          onToggleReference={vi.fn()}
          onContinueToLastFrame={onContinueToLastFrame}
        />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '设为首帧' }))

    expect(onSetFirstFrameUrl).toHaveBeenCalledWith('https://assets.example.com/first-frame.jpg')
    expect(onContinueToLastFrame).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})
