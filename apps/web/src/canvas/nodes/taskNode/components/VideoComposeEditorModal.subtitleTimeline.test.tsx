import { useState } from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoComposeEditorModal } from './VideoComposeEditorModal'
import { drawSubtitleOverlay } from './subtitles/drawSubtitle'
import { useVideoCompose, type VideoComposeHookOptions, type ComposeVideoSource } from './useVideoCompose'
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
  MP4Clip: class MP4ClipMock {
    constructor(_stream?: ReadableStream, duration = 2_000_000) { this.meta.duration = duration }
    meta = { width: 640, height: 360, duration: 2_000_000 }
    ready = Promise.resolve(this.meta)
    async tick() { return { video: { displayWidth: 640, displayHeight: 360, close() {} } } }
    async thumbnails() { return [] }
    async split(at: number): Promise<[MP4ClipMock, MP4ClipMock]> {
      return [new MP4ClipMock(undefined, at), new MP4ClipMock(undefined, this.meta.duration - at)]
    }
    destroy() {}
  },
}))

const videos = [{ url: 'https://media.example/one.mp4' }, { url: 'https://media.example/two.mp4' }]
const initialSubtitles: ComposeSubtitleState = {
  fontSize: 'md',
  style: { color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.4 },
  segments: [{ id: 'subtitle-one', sourceUrl: videos[0].url, startUs: 500_000, endUs: 1_500_000, text: '保留这句对白', source: 'manual' }],
}

function EditorHarness({ onSaved, initial = initialSubtitles }: { onSaved: (value: ComposeSubtitleState) => void; initial?: ComposeSubtitleState }) {
  const [opened, setOpened] = useState(true)
  const [subtitles, setSubtitles] = useState(initial)
  return <MantineProvider>
    <button className="subtitle-editor-test__reopen" onClick={() => setOpened(true)}>重新打开剪辑</button>
    {opened && <VideoComposeEditorModal opened onClose={() => setOpened(false)} upstreamVideos={videos}
      onComposeDone={vi.fn()} initialSubtitles={subtitles}
      onSubtitlesChange={(value) => { onSaved(value); setSubtitles(value) }} />}
  </MantineProvider>
}

describe('video editor editable subtitle delivery', () => {
  const compose = vi.fn(async (_videos: ComposeVideoSource[], _options?: VideoComposeHookOptions): Promise<Blob | null> => null)
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    compose.mockClear()
    vi.mocked(drawSubtitleOverlay).mockClear()
    vi.mocked(useVideoCompose).mockReturnValue({ compose, cancel: vi.fn(), composing: false, progress: 0, phase: 'preparing', error: null })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ fillRect: vi.fn(), drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext'])
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps keyboard focus across real mapping updates, saves/reopens timing and exports the edited interval', async () => {
    const saved = vi.fn()
    render(<EditorHarness onSaved={saved} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    const move = screen.getByRole('button', { name: /保留这句对白.*拖动可移动字幕/ })
    move.focus()
    fireEvent.keyDown(move, { key: 'ArrowRight', shiftKey: true })
    expect(document.activeElement).toBe(move)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', shiftKey: true })
    expect(document.activeElement).toBe(move)
    const start = screen.getByRole('button', { name: '调整保留这句对白的开始时间' })
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true })
    expect(document.activeElement).toBe(start)
    const end = screen.getByRole('button', { name: '调整保留这句对白的结束时间' })
    fireEvent.keyDown(end, { key: 'ArrowRight', shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '关闭视频编辑器' }))
    const stored = saved.mock.lastCall?.[0] as ComposeSubtitleState
    expect(stored.segments).toEqual([expect.objectContaining({ startUs: 800_000, endUs: 1_800_000, text: '保留这句对白', sourceInstanceId: expect.any(String) })])
    fireEvent.click(screen.getByRole('button', { name: '重新打开剪辑' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    expect(screen.getByRole('button', { name: /保留这句对白.*00:00.80.*00:01.80.*拖动/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }))
    expect(compose).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ subtitles: expect.objectContaining({
      segments: [{ startUs: 800_000, endUs: 1_800_000, text: '保留这句对白' }],
    }) }))
  })

  it('selects content and seeks from a caption, and text Backspace never deletes a video clip', async () => {
    render(<EditorHarness onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    fireEvent.click(screen.getByLabelText('样式'))
    fireEvent.click(screen.getByRole('button', { name: /保留这句对白.*拖动可移动字幕/ }))
    const text = screen.getByRole('textbox', { name: /字幕内容/ })
    expect(text.closest('[data-selected]')).not.toBeNull()
    await waitFor(() => expect(vi.mocked(drawSubtitleOverlay).mock.lastCall?.[1]).toBe('保留这句对白'))
    fireEvent.focus(text)
    fireEvent.keyDown(text, { key: 'Backspace' })
    fireEvent.change(text, { target: { value: '改过的对白' } })
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }))
    expect(compose.mock.lastCall?.[0]).toHaveLength(2)
    expect(compose.mock.lastCall?.[1]?.subtitles?.segments).toEqual([{ startUs: 500_000, endUs: 1_500_000, text: '改过的对白' }])
  })

  it('exports source-absolute trim windows after a split so video and caption time remain aligned', async () => {
    render(<EditorHarness onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /保留这句对白.*拖动可移动字幕/ }))
    fireEvent.click(screen.getByTitle('分割'))
    await waitFor(() => expect(within(screen.getByTestId('subtitle-timeline-tracks')).getAllByRole('button', { name: /拖动可移动字幕/ })).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }))
    expect(compose.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ url: videos[0].url, trimStart: 0, trimEnd: 1_500_000 }),
      expect.objectContaining({ url: videos[0].url, trimStart: 500_000, trimEnd: 0 }),
      expect.objectContaining({ url: videos[1].url, trimStart: 0, trimEnd: 0 }),
    ])
    expect(compose.mock.lastCall?.[1]?.subtitles?.segments).toEqual([{ startUs: 500_000, endUs: 1_500_000, text: '保留这句对白' }])
  })
  it('keeps a sub-500ms split at its real duration instead of inserting phantom timeline time', async () => {
    render(<EditorHarness onSaved={vi.fn()} initial={{ ...initialSubtitles, segments: [{ ...initialSubtitles.segments[0], startUs: 200_000, endUs: 700_000 }] }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '合成视频' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /保留这句对白.*拖动可移动字幕/ }))
    fireEvent.click(screen.getByTitle('分割'))
    await waitFor(() => expect(screen.getByRole('button', { name: /保留这句对白.*00:00.20.*00:00.70.*拖动/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '合成视频' }))
    expect(compose.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ trimStart: 0, trimEnd: 1_800_000 }),
      expect.objectContaining({ trimStart: 200_000, trimEnd: 0 }),
      expect.objectContaining({ trimStart: 0, trimEnd: 0 }),
    ])
    expect(compose.mock.lastCall?.[1]?.subtitles?.segments).toEqual([{ startUs: 200_000, endUs: 700_000, text: '保留这句对白' }])
  })

})
