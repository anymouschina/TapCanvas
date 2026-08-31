// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptVideoPreview } from './PromptVideoPreview'

vi.mock('../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ className, alt }: { className: string; alt: string }) => <div className={className} aria-label={alt} />,
}))

const media = {
  id: 'video-1',
  kind: 'video' as const,
  url: 'https://files.example.com/video.mp4',
  thumbnailUrl: 'https://files.example.com/poster.jpg',
  width: 1080,
  height: 1920,
  order: 0,
}

describe('PromptVideoPreview', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not turn a hover cancellation into a permanent preview failure', async () => {
    let rejectPlayback: ((reason: unknown) => void) | null = null
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectPlayback = reject
    }))
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const { container } = render(<PromptVideoPreview media={media} title="视频提示词" />)
    const preview = container.querySelector<HTMLElement>('.prompt-video-preview')

    expect(preview).not.toBeNull()
    fireEvent.mouseEnter(preview as HTMLElement)
    fireEvent.mouseLeave(preview as HTMLElement)
    rejectPlayback?.(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'))

    await waitFor(() => expect(screen.queryByText('预览不可用')).toBeNull())
    expect(play).toHaveBeenCalledTimes(1)
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('ignores any obsolete play rejection after the pointer has left', async () => {
    let rejectPlayback: ((reason: unknown) => void) | null = null
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectPlayback = reject
    }))
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(<PromptVideoPreview media={media} title="视频提示词" />)
    const preview = container.querySelector<HTMLElement>('.prompt-video-preview')

    fireEvent.mouseEnter(preview as HTMLElement)
    fireEvent.mouseLeave(preview as HTMLElement)
    rejectPlayback?.(new DOMException('The element has no supported sources.', 'NotSupportedError'))

    await waitFor(() => expect(screen.queryByText('预览不可用')).toBeNull())
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('reports a current non-interruption playback failure', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('The element has no supported sources.', 'NotSupportedError'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(<PromptVideoPreview media={media} title="视频提示词" />)
    const preview = container.querySelector<HTMLElement>('.prompt-video-preview')

    fireEvent.mouseEnter(preview as HTMLElement)

    expect(await screen.findByText('预览不可用')).not.toBeNull()
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('reports readiness after a posterless video has loaded its first frame', () => {
    const onReady = vi.fn()
    const { container } = render(
      <PromptVideoPreview media={{ ...media, thumbnailUrl: null }} title="视频提示词" onReady={onReady} />,
    )
    const video = container.querySelector('video')

    expect(container.querySelector('.prompt-video-preview.is-ready')).toBeNull()
    fireEvent.loadedData(video as HTMLVideoElement)

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.prompt-video-preview.is-ready')).not.toBeNull()
  })
})
