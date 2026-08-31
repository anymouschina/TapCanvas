import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureFramesAtTimes: vi.fn(),
  uploadCanvasImageBlob: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
  onConnect: vi.fn(),
  toast: vi.fn(),
  revokeObjectURL: vi.fn(),
}))

vi.mock('../../../../utils/videoFrameExtractor', () => ({
  captureFramesAtTimes: mocks.captureFramesAtTimes,
}))

vi.mock('../../directorConsole/uploadCanvasImageBlob', () => ({
  uploadCanvasImageBlob: mocks.uploadCanvasImageBlob,
}))

vi.mock('../../../store', () => ({
  useRFStore: {
    getState: mocks.getState,
    setState: mocks.setState,
  },
}))

vi.mock('../../../../ui/toast', () => ({
  toast: mocks.toast,
}))

import { SkeletonVideoHoverControls } from './SkeletonVideoHoverControls'

const VIDEO_URL = 'https://file.example.test/video.mp4'
const FRAME_URL = 'blob:test-frame'
const HOSTED_FRAME_URL = 'https://file.example.test/frame.jpg'

type TestCanvasNode = {
  id: string
  type?: string
  position: { x: number; y: number }
  width?: number
  data?: Record<string, unknown>
  selected?: boolean
}

let nodes: TestCanvasNode[] = []

beforeEach(() => {
  nodes = [{ id: 'video-1', position: { x: 100, y: 200 }, width: 240 }]
  const frameBlob = new Blob(['frame'], { type: 'image/jpeg' })

  mocks.captureFramesAtTimes.mockResolvedValue({
    frames: [{
      time: 12.5,
      blob: frameBlob,
      objectUrl: FRAME_URL,
      width: 1920,
      height: 1080,
    }],
    duration: 37,
    width: 1920,
    height: 1080,
  })
  mocks.uploadCanvasImageBlob.mockResolvedValue({ url: HOSTED_FRAME_URL })
  mocks.getState.mockImplementation(() => ({ nodes, onConnect: mocks.onConnect }))
  mocks.setState.mockImplementation((updater: unknown) => {
    if (typeof updater !== 'function') throw new Error('Expected Zustand state updater')
    const next = (updater as (state: { nodes: TestCanvasNode[] }) => { nodes: TestCanvasNode[] })({ nodes })
    nodes = next.nodes
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: mocks.revokeObjectURL,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SkeletonVideoHoverControls', () => {
  it('reports manual play and pause intent to the retained surface owner', async () => {
    const video = document.createElement('video')
    let paused = true
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
    vi.spyOn(video, 'play').mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
    vi.spyOn(video, 'pause').mockImplementation(() => {
      paused = true
    })
    const onManualPlayback = vi.fn()

    render(
      <SkeletonVideoHoverControls
        videoRef={{ current: video }}
        onManualPlayback={onManualPlayback}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    fireEvent.play(video)
    const pauseButton = await waitFor(() => screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(pauseButton)

    expect(onManualPlayback).toHaveBeenNthCalledWith(1, true)
    expect(onManualPlayback).toHaveBeenNthCalledWith(2, false)
  })

  it('reports an explicit failure while the video frame is not ready', () => {
    const video = document.createElement('video')
    render(
      <SkeletonVideoHoverControls
        videoRef={{ current: video }}
        nodeId="video-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '截取当前帧' }))

    expect(mocks.captureFramesAtTimes).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('截帧失败：视频画面尚未加载完成', 'error')
  })

  it('captures the current time through the CORS-aware frame extractor instead of the playback canvas', async () => {
    const video = document.createElement('video')
    Object.defineProperties(video, {
      currentSrc: { configurable: true, value: VIDEO_URL },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      duration: { configurable: true, value: 37 },
    })
    video.currentTime = 12.5

    render(
      <SkeletonVideoHoverControls
        videoRef={{ current: video }}
        nodeId="video-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '截取当前帧' }))

    await waitFor(() => {
      expect(mocks.uploadCanvasImageBlob).toHaveBeenCalledTimes(1)
    })
    expect(mocks.captureFramesAtTimes).toHaveBeenCalledWith(
      { type: 'url', url: VIDEO_URL },
      [12.5],
      { mimeType: 'image/jpeg', quality: 0.92 },
    )
    expect(mocks.uploadCanvasImageBlob).toHaveBeenCalledWith(expect.objectContaining({
      blob: expect.any(Blob),
      ownerNodeId: 'video-1',
    }))
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'taskNode',
        data: expect.objectContaining({
          kind: 'image',
          imageUrl: HOSTED_FRAME_URL,
        }),
      }),
    ]))
    expect(mocks.onConnect).toHaveBeenCalledWith(expect.objectContaining({
      source: 'video-1',
      sourceHandle: 'out-video',
      targetHandle: 'in-image',
    }))
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith(FRAME_URL)
    expect(mocks.toast).toHaveBeenCalledWith('已截取当前帧并生成图片节点', 'success')
  })
})
