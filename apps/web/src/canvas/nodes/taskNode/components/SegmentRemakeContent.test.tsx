// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentRemakeContent } from './SegmentRemakeContent'
import { normalizeSegmentRemakeRanges } from '../segmentRemakeContract'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

vi.mock('../../../../utils/videoFrameExtractor', () => ({
  captureFramesAtTimes: vi.fn(async () => ({
    frames: [{ time: 0, objectUrl: 'blob:frame-0', blob: new Blob(['frame'], { type: 'image/jpeg' }) }],
  })),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SegmentRemakeContent', () => {
  it('normalizes marked ranges into a stable, non-overlapping execution contract', () => {
    expect(normalizeSegmentRemakeRanges([
      { start: 8, end: 12 },
      { start: 2, end: 5 },
      { start: 4.5, end: 7 },
      { start: -2, end: 1 },
      { start: 19.95, end: 20 },
    ], 10)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 7 },
      { start: 8, end: 10 },
    ])
  })

  it('keeps LibTV quick-action order and submits edited ranges from the contenteditable prompt', async () => {
    let currentPrompt = ''
    const onPromptChange = vi.fn((value: string) => { currentPrompt = value })
    const onConfirm = vi.fn().mockResolvedValue(undefined)

    const view = render(
      <SegmentRemakeContent
        videoUrl="https://assets.example.com/source.mp4"
        videoDuration={10}
        prompt=""
        onPromptChange={onPromptChange}
        onConfirm={onConfirm}
        onReference={vi.fn()}
        onCharacterLibrary={vi.fn()}
        onFullscreen={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '跳转到 0:00' })).toBeInTheDocument())
    const quickActions = screen.getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((label): label is string => label === '参考' || label === '标记片段' || label === '角色库')
    expect(quickActions).toEqual([
      '参考',
      '标记片段',
      '角色库',
    ])

    const editor = screen.getByRole('textbox', { name: '重拍描述' })
    fireEvent.input(editor, { target: { textContent: '把庭院改成雨天' } })
    expect(onPromptChange).toHaveBeenCalledWith('把庭院改成雨天')
    view.rerender(
      <SegmentRemakeContent
        videoUrl="https://assets.example.com/source.mp4"
        videoDuration={10}
        prompt={currentPrompt}
        onPromptChange={onPromptChange}
        onConfirm={onConfirm}
        onReference={vi.fn()}
        onCharacterLibrary={vi.fn()}
        onFullscreen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '标记片段' }))
    fireEvent.click(screen.getByRole('button', { name: '确认片段重拍' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([{ start: 0, end: 2 }], '把庭院改成雨天'))
  })

  it('exposes live model, resolution and batch controls in the retake editor', () => {
    const onModelChange = vi.fn()
    const onResolutionChange = vi.fn()
    const onRunCountChange = vi.fn()
    render(
      <SegmentRemakeContent
        videoUrl="https://assets.example.com/source.mp4"
        videoDuration={10}
        prompt=""
        onPromptChange={vi.fn()}
        onConfirm={vi.fn()}
        onReference={vi.fn()}
        onCharacterLibrary={vi.fn()}
        onFullscreen={vi.fn()}
        modelValue="seedance-2.5"
        modelOptions={[{ value: 'seedance-2.5', label: '2.5' }, { value: 'seedance-2.0', label: '2.0' }]}
        onModelChange={onModelChange}
        resolutionValue="720p"
        resolutionOptions={[{ value: '720p', label: '720P' }, { value: '1080p', label: '1080P' }]}
        onResolutionChange={onResolutionChange}
        runCount={1}
        onRunCountChange={onRunCountChange}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: '重拍模型' }), { target: { value: 'seedance-2.0' } })
    fireEvent.change(screen.getByRole('combobox', { name: '重拍清晰度' }), { target: { value: '1080p' } })
    fireEvent.change(screen.getByRole('combobox', { name: '重拍生成份数' }), { target: { value: '3' } })
    expect(onModelChange).toHaveBeenCalledWith('seedance-2.0')
    expect(onResolutionChange).toHaveBeenCalledWith('1080p')
    expect(onRunCountChange).toHaveBeenCalledWith(3)
  })

  it('uses the LibTV marker tab to update the same ranges submitted by the editor', async () => {
    const onRangesChange = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <SegmentRemakeContent
        videoUrl="https://assets.example.com/source.mp4"
        videoDuration={10}
        prompt=""
        onPromptChange={vi.fn()}
        onRangesChange={onRangesChange}
        onConfirm={onConfirm}
        onReference={vi.fn()}
        onCharacterLibrary={vi.fn()}
        onFullscreen={vi.fn()}
        quickActions={({ markerActive, onMarker }) => (
          <button type="button" aria-pressed={markerActive} onClick={onMarker}>标记</button>
        )}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '标记' }))
    expect(onRangesChange).toHaveBeenLastCalledWith([{ start: 0, end: 2 }])
    expect(screen.getByRole('button', { name: '标记' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '确认片段重拍' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([{ start: 0, end: 2 }], ''))
  })

  it('surfaces preparation failures in the editor instead of reporting a false submission', async () => {
    render(
      <SegmentRemakeContent
        videoUrl="https://assets.example.com/source.mp4"
        videoDuration={10}
        prompt=""
        onPromptChange={vi.fn()}
        onConfirm={vi.fn().mockRejectedValue(new Error('所选模型不支持参考视频'))}
        onReference={vi.fn()}
        onCharacterLibrary={vi.fn()}
        onFullscreen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '确认片段重拍' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('所选模型不支持参考视频')
  })
})
