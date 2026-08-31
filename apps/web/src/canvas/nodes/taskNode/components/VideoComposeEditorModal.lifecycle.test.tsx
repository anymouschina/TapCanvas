// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { VideoComposeEditorModal } from './VideoComposeEditorModal'

vi.mock('@webav/av-cliper', () => ({
  MP4Clip: class MP4ClipMock {},
}))

vi.mock('./useVideoCompose', () => ({
  useVideoCompose: () => ({
    compose: vi.fn(),
    cancel: vi.fn(),
    composing: false,
    progress: 0,
    error: null,
  }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function editor(opened: boolean): React.ReactElement {
  return (
    <MantineProvider env="default">
      <VideoComposeEditorModal
        opened={opened}
        onClose={vi.fn()}
        upstreamVideos={[]}
        onComposeDone={vi.fn()}
      />
    </MantineProvider>
  )
}

describe('VideoComposeEditorModal lifecycle', () => {
  it('renders the dialog when opened even if requestAnimationFrame is suspended', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })),
    )
    const suspendedRequestAnimationFrame = vi.fn((_callback: FrameRequestCallback): number => 1)
    vi.stubGlobal('requestAnimationFrame', suspendedRequestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn((_handle: number): void => undefined))

    const view = render(editor(false))
    expect(document.querySelector('.tc-video-compose-editor-modal [role="dialog"]')).toBeNull()

    view.rerender(editor(true))

    expect(screen.getByRole('dialog').classList.contains('mantine-Modal-content')).toBe(true)
    expect(screen.getByText('视频合成')).not.toBeNull()
    expect(suspendedRequestAnimationFrame).not.toHaveBeenCalled()
  })
})
