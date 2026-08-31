import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setCanvasNodeDragging,
  setCanvasViewportMoving,
} from '../../../../domain/resource-runtime/hooks/useViewportVisibility'
import { SkeletonVideoFrame } from './SkeletonVideoFrame'
import { VideoNodePreview } from './VideoNodePreview'
import { disposeAllRetainedVideoSurfaces } from './retainedVideoSurface'

const videoUrl = (id: string): string => `https://media.example.test/${id}.mp4`

function revealHoverPlaybackFrame(video: HTMLVideoElement, currentTime = 0.25): void {
  act(() => {
    video.currentTime = currentTime
    fireEvent.timeUpdate(video)
  })
}

vi.mock('./SkeletonVideoHoverControls', () => ({
  SkeletonVideoHoverControls: ({
    videoRef,
    onManualPlayback,
  }: {
    videoRef: { current: HTMLVideoElement | null }
    onManualPlayback?: (playing: boolean) => void
  }) => (
    <button
      type="button"
      data-testid="manual-playback-toggle"
      onClick={() => {
        onManualPlayback?.(true)
        void videoRef.current?.play()
      }}
    >
      手动播放
    </button>
  ),
}))

beforeEach(() => {
  setCanvasViewportMoving(false)
  setCanvasNodeDragging(false)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  disposeAllRetainedVideoSurfaces()
  vi.restoreAllMocks()
  setCanvasViewportMoving(false)
  setCanvasNodeDragging(false)
})

describe('SkeletonVideoFrame', () => {
  it('keeps an untouched shell source-free, reveals a fresh hover frame, then restores the poster', async () => {
    const src = videoUrl('hover-retained')
    const { container } = render(
      <SkeletonVideoFrame src={src} poster={null} nodeId="video-hover-retained" />,
    )
    const frame = container.querySelector('.tc-task-node__video-frame')
    expect(frame).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()

    await act(async () => {
      fireEvent.pointerEnter(frame as Element, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBe(src)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)

    act(() => fireEvent.loadedData(video as HTMLVideoElement))
    expect(video?.style.opacity).toBe('0')
    revealHoverPlaybackFrame(video as HTMLVideoElement)
    expect(video?.style.opacity).toBe('1')

    fireEvent.pointerLeave(frame as Element, { pointerType: 'mouse' })
    expect(container.querySelector('video')).toBe(video)
    expect(video?.getAttribute('src')).toBe(src)
    expect(video?.style.opacity).toBe('0')
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled()
  })

  it('binds the focused player immediately so its inline controls can operate', async () => {
    const src = videoUrl('focused')
    const { container } = render(
      <SkeletonVideoFrame src={src} poster={null} nodeId="video-focused" focused />,
    )
    await waitFor(() => {
      expect(container.querySelector('video')?.getAttribute('src')).toBe(src)
    })
  })

  it('pauses a focused hover preview on pointer leave without replacing its decoded frame', async () => {
    const src = videoUrl('focused-hover-leave')
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      paused = true
    })
    const { container } = render(
      <SkeletonVideoFrame src={src} poster={null} nodeId="video-focused-hover-leave" focused />,
    )
    const frame = container.querySelector('.tc-task-node__video-frame')

    await act(async () => {
      fireEvent.pointerEnter(frame as Element, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const video = container.querySelector('video') as HTMLVideoElement
    act(() => fireEvent.loadedData(video))
    revealHoverPlaybackFrame(video)
    expect(paused).toBe(false)

    fireEvent.pointerLeave(frame as Element, { pointerType: 'mouse' })

    expect(container.querySelector('video')).toBe(video)
    expect(video.getAttribute('src')).toBe(src)
    expect(video.style.opacity).toBe('0')
    expect(paused).toBe(true)
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled()
  })

  it('keeps a manually started playback visible and running after pointer leave', async () => {
    const src = videoUrl('manual-playback-leave')
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      paused = true
    })

    const { container } = render(
      <SkeletonVideoFrame
        src={src}
        poster="https://media.example.test/manual-playback-leave.jpg"
        nodeId="video-manual-playback-leave"
      />,
    )
    const frame = container.querySelector('.tc-task-node__video-frame') as Element

    await act(async () => {
      fireEvent.pointerEnter(frame, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const video = container.querySelector('video') as HTMLVideoElement
    const manualPlaybackButton = await waitFor(() => container.querySelector('[data-testid="manual-playback-toggle"]'))
    fireEvent.click(manualPlaybackButton as Element)
    expect(paused).toBe(false)

    fireEvent.pointerLeave(frame, { pointerType: 'mouse' })

    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled()
    expect(video.style.opacity).toBe('1')
    expect((container.querySelector('.tc-managed-image-wrap') as HTMLElement).style.opacity).toBe('0')
  })

  it('recreates a source-bound video surface across shell and focused trees without losing playback', async () => {
    const src = videoUrl('focus-reparent')
    function Harness({ focused }: { focused: boolean }): JSX.Element {
      return focused ? (
        <div className="focused-tree" key="focused-tree">
          <SkeletonVideoFrame src={src} poster={null} nodeId="video-focus-reparent" focused />
        </div>
      ) : (
        <section className="shell-tree" key="shell-tree">
          <SkeletonVideoFrame src={src} poster={null} nodeId="video-focus-reparent" />
        </section>
      )
    }

    const view = render(<Harness focused={false} />)
    const frame = view.container.querySelector('.tc-task-node__video-frame')
    await act(async () => {
      fireEvent.pointerEnter(frame as Element, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const originalVideo = view.container.querySelector('video') as HTMLVideoElement
    act(() => fireEvent.loadedData(originalVideo))
    revealHoverPlaybackFrame(originalVideo)
    originalVideo.currentTime = 4.25

    view.rerender(<Harness focused />)

    const focusedVideo = view.container.querySelector('video') as HTMLVideoElement
    expect(focusedVideo).not.toBe(originalVideo)
    act(() => fireEvent.loadedMetadata(focusedVideo))
    expect(focusedVideo.currentTime).toBe(4.25)
    expect(focusedVideo.getAttribute('src')).toBe(src)
    expect(focusedVideo.style.opacity).toBe('0')

    const focusedFrame = view.container.querySelector('.tc-task-node__video-frame') as Element
    await act(async () => {
      fireEvent.pointerEnter(focusedFrame, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    act(() => fireEvent.loadedData(focusedVideo))
    revealHoverPlaybackFrame(focusedVideo, 4.5)

    expect(focusedVideo.style.opacity).toBe('1')
    expect(originalVideo.isConnected).toBe(false)
  })

  it('hands playback to a fresh paused surface when node focus moves elsewhere', async () => {
    const src = videoUrl('focus-leave-paused')
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      paused = true
    })

    function Harness({ focused }: { focused: boolean }): JSX.Element {
      return focused ? (
        <div className="focused-tree" key="focused-tree">
          <SkeletonVideoFrame src={src} poster={null} nodeId="video-focus-leave-paused" focused />
        </div>
      ) : (
        <section className="shell-tree" key="shell-tree">
          <SkeletonVideoFrame src={src} poster={null} nodeId="video-focus-leave-paused" />
        </section>
      )
    }

    const view = render(<Harness focused />)
    const focusedFrame = view.container.querySelector('.tc-task-node__video-frame')
    await act(async () => {
      fireEvent.pointerEnter(focusedFrame as Element, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const focusedVideo = view.container.querySelector('video') as HTMLVideoElement
    act(() => fireEvent.loadedData(focusedVideo))
    revealHoverPlaybackFrame(focusedVideo)
    expect(paused).toBe(false)

    view.rerender(<Harness focused={false} />)

    const shellVideo = view.container.querySelector('video') as HTMLVideoElement
    expect(shellVideo).not.toBe(focusedVideo)
    expect(shellVideo.getAttribute('src')).toBe(src)
    expect(shellVideo.style.opacity).toBe('0')
    expect(paused).toBe(true)
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled()
  })

  it('does not let a stale autoplay rejection restart an unfocused retained decoder', async () => {
    const src = videoUrl('stale-autoplay')
    let rejectPendingPlay: ((reason?: unknown) => void) | null = null
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => {
      paused = false
      return new Promise<void>((_resolve, reject) => {
        rejectPendingPlay = reject
      })
    }).mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      paused = true
    })

    function Harness({ focused }: { focused: boolean }): JSX.Element {
      return focused ? (
        <div className="focused-tree" key="focused-tree">
          <SkeletonVideoFrame src={src} poster={null} nodeId="video-stale-autoplay" focused />
        </div>
      ) : (
        <section className="shell-tree" key="shell-tree">
          <SkeletonVideoFrame src={src} poster={null} nodeId="video-stale-autoplay" />
        </section>
      )
    }

    const view = render(<Harness focused />)
    const frame = view.container.querySelector('.tc-task-node__video-frame')
    await act(async () => {
      fireEvent.pointerEnter(frame as Element, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const video = view.container.querySelector('video') as HTMLVideoElement
    act(() => fireEvent.loadedData(video))

    view.rerender(<Harness focused={false} />)
    await act(async () => {
      rejectPendingPlay?.(new Error('autoplay policy changed'))
      await Promise.resolve()
    })

    expect(view.container.querySelector('video')).not.toBe(video)
    expect(paused).toBe(true)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled()
  })

  it('pauses an active hover preview while the viewport moves and resumes after it settles', () => {
    const src = videoUrl('viewport-motion')
    let paused = false
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      paused = true
    })

    const { container } = render(
      <SkeletonVideoFrame src={src} poster={null} nodeId="video-viewport-motion" focused />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    const frame = container.querySelector('.tc-task-node__video-frame') as Element
    const placeholder = container.querySelector('.tc-task-node__video-placeholder') as HTMLElement
    expect(placeholder.style.opacity).toBe('1')

    fireEvent.pointerEnter(frame, { pointerType: 'mouse' })
    act(() => fireEvent.loadedData(video))
    expect(video.style.opacity).toBe('0')
    revealHoverPlaybackFrame(video)
    expect(video.style.opacity).toBe('1')
    expect(placeholder.style.opacity).toBe('0')

    act(() => setCanvasViewportMoving(true))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
    expect(video.style.opacity).toBe('1')
    expect(placeholder.style.opacity).toBe('0')

    act(() => setCanvasViewportMoving(false))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(video.style.opacity).toBe('1')
    expect(placeholder.style.opacity).toBe('0')
  })

  it('keeps the poster through loadedData and reveals video only after hover playback advances', () => {
    const src = videoUrl('poster-bootstrap')
    const { container } = render(
      <SkeletonVideoFrame
        src={src}
        poster="https://media.example.test/poster-bootstrap.jpg"
        nodeId="video-poster-bootstrap"
        focused
      />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    const frame = container.querySelector('.tc-task-node__video-frame') as Element
    const poster = container.querySelector('.tc-managed-image-wrap') as HTMLElement
    expect(poster.style.opacity).toBe('1')

    act(() => fireEvent.loadedData(video))
    expect(video.style.opacity).toBe('0')
    expect(poster.style.opacity).toBe('1')

    fireEvent.pointerEnter(frame, { pointerType: 'mouse' })
    revealHoverPlaybackFrame(video)
    expect(video.style.opacity).toBe('1')
    expect(poster.style.opacity).toBe('0')

    act(() => setCanvasViewportMoving(true))
    expect(video.style.opacity).toBe('1')
    expect(poster.style.opacity).toBe('0')

    act(() => setCanvasViewportMoving(false))
    expect(video.style.opacity).toBe('1')
    expect(poster.style.opacity).toBe('0')
  })

  it('does not restart an unfocused hover decoder after movement ends elsewhere', async () => {
    const src = videoUrl('hover-motion-leave')
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => {
      paused = true
    })
    const { container } = render(
      <SkeletonVideoFrame src={src} poster={null} nodeId="video-hover-motion-leave" />,
    )
    const frame = container.querySelector('.tc-task-node__video-frame') as Element

    await act(async () => {
      fireEvent.pointerEnter(frame, { pointerType: 'mouse' })
      await Promise.resolve()
    })
    const video = container.querySelector('video') as HTMLVideoElement
    act(() => fireEvent.loadedData(video))
    revealHoverPlaybackFrame(video)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)

    act(() => setCanvasViewportMoving(true))
    fireEvent.pointerLeave(frame, { pointerType: 'mouse' })
    act(() => setCanvasViewportMoving(false))

    expect(paused).toBe(true)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(video.style.opacity).toBe('0')
  })

  it('preserves an active hover frame throughout node dragging', () => {
    const src = videoUrl('node-drag-motion')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const { container } = render(
      <SkeletonVideoFrame src={src} poster={null} nodeId="video-node-drag-motion" focused />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    const frame = container.querySelector('.tc-task-node__video-frame') as Element
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      duration: { configurable: true, value: 10 },
    })
    fireEvent.pointerEnter(frame, { pointerType: 'mouse' })
    act(() => fireEvent.loadedData(video))
    revealHoverPlaybackFrame(video)
    expect(video.style.opacity).toBe('1')

    act(() => setCanvasNodeDragging(true))
    expect(video.style.opacity).toBe('1')

    act(() => setCanvasNodeDragging(false))
    expect(video.style.opacity).toBe('1')
    expect(video.getAttribute('src')).toBe(src)
  })

  it('evicts the oldest unfocused source when decoded-pixel budget is exceeded', async () => {
    const views = Array.from({ length: 7 }, (_, index) => {
      const id = `budget-${index}`
      const view = render(
        <SkeletonVideoFrame src={videoUrl(id)} poster={null} nodeId={id} />,
      )
      return {
        ...view,
        frame: view.container.querySelector('.tc-task-node__video-frame') as Element,
      }
    })

    for (const view of views) {
      await act(async () => {
        fireEvent.pointerEnter(view.frame, { pointerType: 'mouse' })
        await Promise.resolve()
      })
      const video = view.container.querySelector('video') as HTMLVideoElement
      act(() => fireEvent.loadedData(video))
      fireEvent.pointerLeave(view.frame, { pointerType: 'mouse' })
    }

    const oldest = views[0].container.querySelector('video') as HTMLVideoElement
    const newest = views[6].container.querySelector('video') as HTMLVideoElement
    expect(oldest.hasAttribute('src')).toBe(false)
    expect(oldest.style.opacity).toBe('0')
    expect(newest.getAttribute('src')).toBe(videoUrl('budget-6'))
  })
})

describe('VideoNodePreview', () => {
  it('renders no video element in overview mode even when the clip is complete', () => {
    const { container } = render(
      <VideoNodePreview
        src={videoUrl('overview')}
        poster={null}
        nodeId="video-overview"
        label="Clip 1"
        overview
      />,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('[data-video-preview-mode="placeholder"]')).not.toBeNull()
  })

  it('keeps an untouched editing-zoom shell source-free until interaction', () => {
    const { container } = render(
      <VideoNodePreview
        src={videoUrl('editing-shell')}
        poster={null}
        nodeId="video-editing-shell"
        label="Clip 1"
        overview={false}
      />,
    )
    expect(container.querySelector('[data-video-preview-mode="interactive"]')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })
})
