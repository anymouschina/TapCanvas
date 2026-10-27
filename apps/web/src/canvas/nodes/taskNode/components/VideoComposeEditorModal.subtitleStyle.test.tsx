import { useState } from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoComposeEditorModal } from './VideoComposeEditorModal'
import { drawSubtitleOverlay } from './subtitles/drawSubtitle'
import { useVideoCompose } from './useVideoCompose'
import type { ComposeSubtitleState } from './subtitles/types'

vi.mock('./useVideoCompose', () => ({ useVideoCompose: vi.fn() }))
vi.mock('./subtitles/drawSubtitle', () => ({ drawSubtitleOverlay: vi.fn() }))
vi.mock('./reliableClipFetch', () => ({ fetchClip: vi.fn(async () => ({ body: new ReadableStream() })) }))
vi.mock('../../../../api/server', () => ({ analyzeVideoToSpeechTranscript: vi.fn() }))
vi.mock('../../../../config/useModelOptions', () => ({
  useModelOptionsState: () => ({ options: [], loading: false, error: null }),
  findModelOptionByIdentifier: () => null,
  getModelOptionRequestAlias: vi.fn(),
}))
vi.mock('../../../../ui/toast', () => ({ toast: vi.fn() }))
vi.mock('@webav/av-cliper', () => ({
  MP4Clip: class {
    meta = { width: 640, height: 360, duration: 2_000_000 }
    ready = Promise.resolve(this.meta)
    async tick() { return { video: { displayWidth: 640, displayHeight: 360, close() {} } } }
    async thumbnails() { return [] }
    destroy() {}
  },
}))

const videos = [{ url: 'https://media.example/one.mp4' }, { url: 'https://media.example/two.mp4' }]
const initialSubtitles: ComposeSubtitleState = {
  fontSize: 'md',
  style: { color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.4 },
  segments: [{ id: 'subtitle-one', sourceUrl: videos[0].url, startUs: 0, endUs: 1_000_000, text: '保留这句对白', source: 'manual' }],
}

function EditorHarness({ onSaved }: { onSaved: (value: ComposeSubtitleState) => void }) {
  const [opened, setOpened] = useState(true)
  const [subtitles, setSubtitles] = useState(initialSubtitles)
  return <MantineProvider>
    <button className="subtitle-editor-test__reopen" onClick={() => setOpened(true)}>重新打开剪辑</button>
    {opened && <VideoComposeEditorModal opened onClose={() => setOpened(false)} upstreamVideos={videos}
      onComposeDone={vi.fn()} initialSubtitles={subtitles}
      onSubtitlesChange={(value) => { onSaved(value); setSubtitles(value) }} />}
  </MantineProvider>
}

describe('video editor subtitle style delivery', () => {
  const compose = vi.fn(async () => null)
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    compose.mockClear()
    vi.mocked(drawSubtitleOverlay).mockClear()
    vi.mocked(useVideoCompose).mockReturnValue({
      compose, cancel: vi.fn(), composing: false, progress: 0, phase: 'preparing', error: null,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
      fillRect: vi.fn(), drawImage: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext'])
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('repaints style changes, saves them without changing captions, restores on reopen and sends them to export', async () => {
    const saved = vi.fn()
    render(<EditorHarness onSaved={saved} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    await waitFor(() => expect(drawSubtitleOverlay).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('样式'))
    fireEvent.change(screen.getByLabelText('文字颜色'), { target: { value: '#FFD43B' } })
    fireEvent.click(screen.getByLabelText('粗体'))
    fireEvent.click(screen.getByLabelText('字幕位置', { selector: 'input' }))
    fireEvent.click(screen.getByRole('option', { name: '顶部' }))
    await waitFor(() => expect(vi.mocked(drawSubtitleOverlay).mock.lastCall?.[3]).toEqual(
      expect.objectContaining({ color: '#FFD43B', bold: true, position: 'top' }),
    ))
    fireEvent.click(screen.getByRole('button', { name: '关闭视频编辑器' }))
    const stored = saved.mock.lastCall?.[0] as ComposeSubtitleState
    expect(stored.segments).toEqual(initialSubtitles.segments)
    expect(stored.style).toEqual(expect.objectContaining({ color: '#FFD43B', bold: true, position: 'top' }))
    fireEvent.click(screen.getByRole('button', { name: '重新打开剪辑' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    fireEvent.click(screen.getByLabelText('样式'))
    expect(screen.getByLabelText('文字颜色')).toHaveValue('#FFD43B')
    expect(screen.getByLabelText('粗体')).toBeChecked()
    expect(screen.getByLabelText('字幕位置', { selector: 'input' })).toHaveValue('顶部')
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }))
    expect(compose).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      subtitles: {
        fontSize: 'md', style: stored.style,
        segments: [{ startUs: 0, endUs: 1_000_000, text: '保留这句对白' }],
      },
    }))
  })

  it('applies a size preset after a custom size without retaining the custom override', async () => {
    render(<EditorHarness onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    fireEvent.click(screen.getByLabelText('样式'))
    fireEvent.change(screen.getByLabelText('字号（画面高度百分比）'), { target: { value: '8' } })
    await waitFor(() => expect(vi.mocked(drawSubtitleOverlay).mock.lastCall?.[3]?.fontSizeRatio).toBe(0.08))
    fireEvent.click(screen.getByLabelText('小字'))
    expect(screen.getByLabelText('字号（画面高度百分比）')).toHaveValue('3.5%')
    await waitFor(() => {
      const call = vi.mocked(drawSubtitleOverlay).mock.lastCall
      expect(call?.[2]).toBe('sm')
      expect(call?.[3]?.fontSizeRatio).toBeUndefined()
      expect(call?.[3]?.backgroundOpacity).toBe(0.4)
    })
  })
})
