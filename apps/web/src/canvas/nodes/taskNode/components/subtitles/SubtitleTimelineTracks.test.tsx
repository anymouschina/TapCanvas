import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubtitleTimelineTracks, type SubtitleTimelineTracksProps } from './SubtitleTimelineTracks'

function pointer(element: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture', clientX: number, pointerId = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  fireEvent(element, event)
}

function renderTrack(overrides: Partial<SubtitleTimelineTracksProps> = {}) {
  const props: SubtitleTimelineTracksProps = {
    timelineSubtitles: [{ segmentId: 'one', startUs: 1_000_000, endUs: 2_000_000, text: '台词' }],
    pxPerUs: 0.0001, totalUs: 5_000_000,
    onSeek: vi.fn(), onSelect: vi.fn(), onChangeTiming: vi.fn(), ...overrides,
  }
  const view = render(<SubtitleTimelineTracks {...props} />)
  return { ...view, props, block: () => screen.getByTestId('subtitle-timeline-segment'), move: () => screen.getByRole('button', { name: /拖动可移动字幕/ }) }
}

describe('SubtitleTimelineTracks', () => {
  it('shows its label and empty state even before subtitles exist', () => {
    renderTrack({ timelineSubtitles: [] })
    expect(screen.getByText('字幕轨')).toBeVisible()
    expect(screen.getByText('暂无字幕段，可在智能字幕面板生成或添加。')).toBeVisible()
  })

  it('separates overlaps and keeps short text within its actual duration', () => {
    renderTrack({ timelineSubtitles: [
      { segmentId: 'one', startUs: 0, endUs: 2_000_000, text: '第一句' },
      { segmentId: 'two', startUs: 1_000_000, endUs: 1_100_000, text: '短字幕' },
    ] })
    const blocks = screen.getAllByTestId('subtitle-timeline-segment')
    expect(blocks.map((block) => block.dataset.lane)).toEqual(['0', '1'])
    expect(blocks[1].style.width).toBe('10px')
    expect(blocks[1]).toHaveAttribute('title', '短字幕，00:01.00 – 00:01.10')
    expect(screen.queryByText('短字幕')).toBeNull()
    expect(screen.getByText('2 段 · 2 行')).toBeVisible()
  })

  it('selects once and seeks on a pointer click without changing timing', () => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointerup', 101)
    fireEvent.click(view.move())
    expect(view.props.onSelect).toHaveBeenCalledTimes(1)
    expect(view.props.onSelect).toHaveBeenCalledWith('one')
    expect(view.props.onSeek).toHaveBeenCalledWith(1_000_000)
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    expect(view.move()).toHaveAttribute('aria-pressed', 'true')
  })

  it('previews moves locally and commits only at pointerup without seeking after drag', () => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150)
    expect(view.block().style.left).toBe('150px')
    expect(screen.getByText('00:01.50 – 00:02.50')).toBeVisible()
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    pointer(view.block(), 'pointerup', 160)
    fireEvent.click(view.move(), { detail: 1 })
    expect(view.props.onChangeTiming).toHaveBeenCalledTimes(1)
    expect(view.props.onChangeTiming).toHaveBeenCalledWith('one', 1_600_000, 2_600_000)
    expect(view.props.onSeek).not.toHaveBeenCalled()
  })

  it.each([
    ['开始', -50, 500_000, 2_000_000],
    ['结束', 500, 1_000_000, 5_000_000],
  ] as const)('resizes the %s edge and clamps at timeline boundaries', (edge, delta, startUs, endUs) => {
    const view = renderTrack()
    const handle = screen.getByRole('button', { name: `调整台词的${edge}时间` })
    pointer(handle, 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 100 + delta)
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    pointer(view.block(), 'pointerup', 100 + delta)
    expect(view.props.onChangeTiming).toHaveBeenCalledTimes(1)
    expect(view.props.onChangeTiming).toHaveBeenCalledWith('one', startUs, endUs)
  })

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur'] as const)('discards a draft after %s', (cancel) => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150)
    if (cancel === 'Escape') fireEvent.keyDown(view.move(), { key: 'Escape' })
    else if (cancel === 'blur') fireEvent.blur(window)
    else pointer(view.block(), cancel, 150)
    expect(view.block().style.left).toBe('100px')
    pointer(view.block(), 'pointerup', 150)
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
  })

  it('ignores other pointers and non-primary mouse buttons', () => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100, 1, 2)
    pointer(view.block(), 'pointerup', 150)
    expect(view.props.onSelect).not.toHaveBeenCalled()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150, 2)
    pointer(view.block(), 'pointercancel', 150, 2)
    pointer(view.block(), 'pointerup', 150, 2)
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    pointer(view.block(), 'pointerup', 150)
    expect(view.props.onChangeTiming).toHaveBeenCalledWith('one', 1_500_000, 2_500_000)
  })

  it('supports keyboard selection and timing edits on the body and either handle', () => {
    const view = renderTrack()
    fireEvent.click(view.move())
    expect(view.props.onSeek).toHaveBeenCalledWith(1_000_000)
    fireEvent.keyDown(view.move(), { key: 'ArrowRight', shiftKey: true })
    expect(view.props.onChangeTiming).toHaveBeenLastCalledWith('one', 1_100_000, 2_100_000)
    fireEvent.keyDown(screen.getByRole('button', { name: '调整台词的开始时间' }), { key: 'ArrowLeft' })
    expect(view.props.onChangeTiming).toHaveBeenLastCalledWith('one', 990_000, 2_000_000)
    fireEvent.keyDown(screen.getByRole('button', { name: '调整台词的结束时间' }), { key: 'ArrowRight' })
    expect(view.props.onChangeTiming).toHaveBeenLastCalledWith('one', 1_000_000, 2_010_000)
  })

  it('discards active drafts and disables editing if processing starts', () => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150)
    view.rerender(<SubtitleTimelineTracks {...view.props} isBusy />)
    pointer(view.block(), 'pointerup', 150)
    expect(view.block().style.left).toBe('100px')
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('honors controlled selection and cancels a draft if the scale changes', () => {
    const view = renderTrack({ selectedSegmentId: null })
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150)
    expect(view.move()).toHaveAttribute('aria-pressed', 'false')
    view.rerender(<SubtitleTimelineTracks {...view.props} pxPerUs={0.0002} selectedSegmentId="one" />)
    pointer(view.block(), 'pointerup', 150)
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    expect(view.move()).toHaveAttribute('aria-pressed', 'true')
    expect(view.block().style.left).toBe('200px')
  })

  it('captures the button itself and releases capture after committing', () => {
    const view = renderTrack()
    const button = view.move()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.defineProperties(button, {
      setPointerCapture: { value: setPointerCapture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releasePointerCapture },
    })
    pointer(button, 'pointerdown', 100, 7)
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    pointer(view.block(), 'pointerup', 150, 7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    pointer(view.block(), 'lostpointercapture', 150, 7)
    expect(view.props.onChangeTiming).toHaveBeenCalledTimes(1)
  })

  it('allows keyboard activation after cancelling and selection after an instance id changes', () => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150)
    fireEvent.keyDown(view.move(), { key: 'Escape' })
    fireEvent.click(view.move(), { detail: 0 })
    expect(view.props.onSeek).toHaveBeenCalledWith(1_000_000)
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointerup', 150)
    view.rerender(<SubtitleTimelineTracks {...view.props} timelineSubtitles={[
      { segmentId: 'new-instance', startUs: 1_500_000, endUs: 2_500_000, text: '台词' },
    ]} />)
    fireEvent.click(view.move(), { detail: 1 })
    expect(view.props.onSeek).toHaveBeenLastCalledWith(1_500_000)
    expect(view.props.onSelect).toHaveBeenLastCalledWith('new-instance')
  })

  it('discards stale timing when the source instance changes during a drag', () => {
    const view = renderTrack()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointermove', 150)
    view.rerender(<SubtitleTimelineTracks {...view.props} timelineSubtitles={[
      { segmentId: 'one', startUs: 2_000_000, endUs: 3_000_000, text: '台词' },
    ]} />)
    pointer(view.block(), 'pointerup', 150)
    expect(view.props.onChangeTiming).not.toHaveBeenCalled()
    expect(view.block().style.left).toBe('200px')
  })

  it.each(['move', 'start', 'end'] as const)('preserves %s keyboard editing across parent updates that change the instance id', (edit) => {
    const onChangeTiming = vi.fn()
    function ControlledTrack() {
      const [subtitle, setSubtitle] = React.useState({ segmentId: 'instance-0', startUs: 1_000_000, endUs: 2_000_000, text: '台词' })
      return <SubtitleTimelineTracks timelineSubtitles={[subtitle]} pxPerUs={0.0001} totalUs={5_000_000}
        selectedSegmentId={subtitle.segmentId} onSelect={vi.fn()} onSeek={vi.fn()}
        onChangeTiming={(segmentId, startUs, endUs) => {
          onChangeTiming(segmentId, startUs, endUs)
          setSubtitle({ ...subtitle, segmentId: `${segmentId}-next`, startUs, endUs })
        }} />
    }
    render(<ControlledTrack />)
    const selector = `[data-timing-edit="${edit}"]`
    const original = screen.getByTestId('subtitle-timeline-segment').querySelector<HTMLButtonElement>(selector)
    if (!original) throw new Error('字幕操作按钮缺失')
    original.focus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight' })
    const next = screen.getByTestId('subtitle-timeline-segment').querySelector<HTMLButtonElement>(selector)
    expect(next).not.toBe(original)
    expect(next).toHaveFocus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight' })
    expect(onChangeTiming).toHaveBeenCalledTimes(2)
    expect(onChangeTiming).toHaveBeenLastCalledWith('instance-0-next', edit === 'end' ? 1_000_000 : 1_020_000, edit === 'start' ? 2_000_000 : 2_020_000)
    expect(screen.getByTestId('subtitle-timeline-segment').querySelector(selector)).toHaveFocus()
  })

  it('does not restore keyboard focus after the user moves focus before a delayed parent update', () => {
    const view = renderTrack({ selectedSegmentId: 'one' })
    view.move().focus()
    fireEvent.keyDown(view.move(), { key: 'ArrowRight' })
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    view.rerender(<SubtitleTimelineTracks {...view.props} selectedSegmentId="replacement" timelineSubtitles={[
      { segmentId: 'replacement', startUs: 1_010_000, endUs: 2_010_000, text: '台词' },
    ]} />)
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('does not restore focus after a pointer edit changes the instance id', () => {
    const view = renderTrack({ selectedSegmentId: 'one' })
    view.move().focus()
    pointer(view.move(), 'pointerdown', 100)
    pointer(view.block(), 'pointerup', 150)
    view.rerender(<SubtitleTimelineTracks {...view.props} selectedSegmentId="replacement" timelineSubtitles={[
      { segmentId: 'replacement', startUs: 1_500_000, endUs: 2_500_000, text: '台词' },
    ]} />)
    expect(document.body).toHaveFocus()
  })
})
