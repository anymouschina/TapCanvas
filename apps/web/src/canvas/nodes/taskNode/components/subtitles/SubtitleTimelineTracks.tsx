import React from 'react'
import type { TimelineSubtitle } from './timeline'
import {
  formatSubtitleTimelineTime, layoutSubtitleTimeline, updateSubtitleTiming,
  type SubtitleTiming, type SubtitleTimingEdit,
} from './subtitleTimelineLayout'
import classes from './SubtitleTimelineTracks.module.css'

const LANE_HEIGHT = 40
const HANDLE_WIDTH = 10
const DRAG_THRESHOLD_PX = 2
const KEYBOARD_STEP_US = 10_000

type SubtitleDrag = {
  key: string
  subtitle: TimelineSubtitle
  edit: SubtitleTimingEdit
  pointerId: number
  clientX: number
  target: HTMLElement
  timing: SubtitleTiming
  moved: boolean
}

type KeyboardFocusRequest = {
  edit: SubtitleTimingEdit
  target: HTMLButtonElement
  timing: SubtitleTiming
}

export type SubtitleTimelineTracksProps = {
  timelineSubtitles: TimelineSubtitle[]
  pxPerUs: number
  totalUs: number
  onSeek: (timeUs: number) => void
  onSelect: (segmentId: string) => void
  onChangeTiming: (segmentId: string, timelineStartUs: number, timelineEndUs: number) => void
  selectedSegmentId?: string | null
  isBusy?: boolean
}

/** Subtitle geometry shares the compose timeline's zero point and pixel scale. */
export function SubtitleTimelineTracks({
  timelineSubtitles, pxPerUs, totalUs, onSeek, onSelect, onChangeTiming,
  selectedSegmentId, isBusy = false,
}: SubtitleTimelineTracksProps) {
  const [localSelection, setLocalSelection] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<{ key: string; timing: SubtitleTiming } | null>(null)
  const dragRef = React.useRef<SubtitleDrag | null>(null)
  const suppressClickRef = React.useRef<string | null>(null)
  const pointerSelectionRef = React.useRef<string | null>(null)
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const keyboardFocusRef = React.useRef<KeyboardFocusRequest | null>(null)
  const layout = React.useMemo(() => layoutSubtitleTimeline(timelineSubtitles, pxPerUs, totalUs), [timelineSubtitles, pxPerUs, totalUs])
  const canInteract = !isBusy && Number.isFinite(totalUs) && totalUs > 0 && Number.isFinite(pxPerUs) && pxPerUs > 0
  const widthPx = Number.isFinite(totalUs * pxPerUs) ? Math.max(1, totalUs * pxPerUs) : 1
  const selectedId = selectedSegmentId === undefined ? localSelection : selectedSegmentId

  React.useLayoutEffect(() => {
    const request = keyboardFocusRef.current
    if (!request) return
    const focused = document.activeElement
    // An asynchronous parent update must not steal focus from a later user action.
    if (!canInteract || (focused !== request.target && focused !== document.body)) {
      keyboardFocusRef.current = null
      return
    }
    const selected = timelineSubtitles.find((subtitle) => subtitle.segmentId === selectedId)
    if (!selected || selected.startUs !== request.timing.startUs || selected.endUs !== request.timing.endUs) return
    const button = trackRef.current?.querySelector<HTMLButtonElement>(`[data-selected="true"] [data-timing-edit="${request.edit}"]`)
    keyboardFocusRef.current = null
    button?.focus({ preventScroll: true })
  }, [timelineSubtitles, selectedId, canInteract])

  const clearDrag = React.useCallback(() => {
    const active = dragRef.current
    dragRef.current = null
    if (active?.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
    setDraft(null)
  }, [])

  const cancelDrag = React.useCallback(() => {
    suppressClickRef.current = dragRef.current?.moved ? dragRef.current.key : null
    pointerSelectionRef.current = null
    clearDrag()
  }, [clearDrag])

  React.useEffect(() => {
    cancelDrag()
  }, [isBusy, pxPerUs, totalUs, cancelDrag])

  React.useEffect(() => {
    const active = dragRef.current
    if (active && !timelineSubtitles.some((subtitle) => subtitle.segmentId === active.subtitle.segmentId
      && subtitle.startUs === active.subtitle.startUs && subtitle.endUs === active.subtitle.endUs)) cancelDrag()
  }, [timelineSubtitles, cancelDrag])

  React.useEffect(() => {
    window.addEventListener('blur', cancelDrag)
    return () => {
      window.removeEventListener('blur', cancelDrag)
      const active = dragRef.current
      dragRef.current = null
      if (active?.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
    }
  }, [cancelDrag])

  const select = (subtitle: TimelineSubtitle) => {
    setLocalSelection(subtitle.segmentId)
    onSelect(subtitle.segmentId)
  }

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>, key: string, subtitle: TimelineSubtitle, edit: SubtitleTimingEdit) => {
    if (!canInteract || event.button !== 0 || dragRef.current) return
    keyboardFocusRef.current = null
    event.stopPropagation()
    const target = event.currentTarget
    dragRef.current = {
      key, subtitle, edit, pointerId: event.pointerId, clientX: event.clientX, target,
      timing: { startUs: subtitle.startUs, endUs: subtitle.endUs }, moved: false,
    }
    pointerSelectionRef.current = key
    suppressClickRef.current = null
    select(subtitle)
    target.setPointerCapture?.(event.pointerId)
  }

  const previewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== event.pointerId || !canInteract) return
    const deltaPx = event.clientX - active.clientX
    if (!active.moved && Math.abs(deltaPx) <= DRAG_THRESHOLD_PX) return
    active.moved = true
    suppressClickRef.current = active.key
    active.timing = updateSubtitleTiming(active.edit, active.subtitle.startUs, active.subtitle.endUs, deltaPx / pxPerUs, totalUs)
    setDraft({ key: active.key, timing: active.timing })
  }

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== event.pointerId) return
    previewDrag(event)
    clearDrag()
    if (active.moved && canInteract) onChangeTiming(active.subtitle.segmentId, active.timing.startUs, active.timing.endUs)
  }

  const activate = (event: React.MouseEvent<HTMLButtonElement>, key: string, subtitle: TimelineSubtitle, timeUs: number) => {
    if (!canInteract) return
    const suppress = suppressClickRef.current === key && event.detail > 0
    suppressClickRef.current = null
    if (suppress) {
      pointerSelectionRef.current = null
      return
    }
    if (pointerSelectionRef.current !== key) select(subtitle)
    pointerSelectionRef.current = null
    onSeek(timeUs)
  }

  const editWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, subtitle: TimelineSubtitle, edit: SubtitleTimingEdit) => {
    if (!canInteract || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    event.stopPropagation()
    if (dragRef.current) return
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const timing = updateSubtitleTiming(edit, subtitle.startUs, subtitle.endUs, direction * KEYBOARD_STEP_US * (event.shiftKey ? 10 : 1), totalUs)
    select(subtitle)
    if (timing.startUs !== subtitle.startUs || timing.endUs !== subtitle.endUs) {
      if (document.activeElement === event.currentTarget) keyboardFocusRef.current = { edit, target: event.currentTarget, timing }
      onChangeTiming(subtitle.segmentId, timing.startUs, timing.endUs)
    }
  }

  return (
    <div className={classes.track} ref={trackRef} aria-label="字幕时间线" data-subtitle-timeline data-testid="subtitle-timeline-tracks"
      style={{ width: widthPx, minWidth: widthPx }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && dragRef.current) {
          event.preventDefault()
          event.stopPropagation()
          cancelDrag()
        }
      }}>
      <div className={classes.header}>
        <span className={classes.label}>字幕轨</span>
        <span className={classes.summary}>{timelineSubtitles.length} 段 · {layout.laneCount} 行{isBusy ? ' · 正在处理' : ''}</span>
      </div>
      <div className={classes.lanes} style={{ height: Math.max(1, layout.laneCount) * LANE_HEIGHT }}>
        {Array.from({ length: layout.laneCount }, (_, lane) => (
          <div className={classes.lane} key={lane} aria-hidden="true" style={{ top: lane * LANE_HEIGHT, height: LANE_HEIGHT }} />
        ))}
        {layout.items.map((item) => {
          const { subtitle } = item
          const timing = draft?.key === item.key ? draft.timing : subtitle
          const blockWidth = draft?.key === item.key ? (timing.endUs - timing.startUs) * pxPerUs : item.widthPx
          const interval = `${formatSubtitleTimelineTime(timing.startUs)} – ${formatSubtitleTimelineTime(timing.endUs)}`
          const label = `${subtitle.text}，${interval}`
          const narrow = blockWidth < HANDLE_WIDTH * 3
          const selected = selectedId === subtitle.segmentId
          return (
            <div className={classes.segment} key={item.key} title={label} data-testid="subtitle-timeline-segment"
              data-subtitle-segment={item.key} data-lane={item.lane} data-selected={selected} data-dragging={dragRef.current?.key === item.key}
              style={{ left: draft?.key === item.key ? timing.startUs * pxPerUs : item.leftPx, top: item.lane * LANE_HEIGHT + 3, width: blockWidth, height: LANE_HEIGHT - 6 }}
              onPointerMove={previewDrag} onPointerUp={finishDrag}
              onPointerCancel={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag() }}
              onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag() }}>
              <button className={classes.action} type="button" disabled={!canInteract} aria-pressed={selected} data-timing-edit="move"
                aria-label={`${label}，拖动可移动字幕；左右键移动，Shift 加速`}
                onPointerDown={(event) => beginDrag(event, item.key, subtitle, 'move')}
                onKeyDown={(event) => editWithKeyboard(event, subtitle, 'move')}
                onClick={(event) => activate(event, item.key, subtitle, subtitle.startUs)}>
                {blockWidth >= 22 && <span className={classes.text}>{subtitle.text || '（空字幕）'}</span>}
                {blockWidth >= 96 && <span className={classes.interval}>{interval}</span>}
              </button>
              {(['start', 'end'] as const).map((edit) => (
                <button className={classes.handle} type="button" key={edit} disabled={!canInteract}
                  data-edge={edit} data-timing-edit={edit} style={edit === 'start' ? { left: narrow ? -HANDLE_WIDTH : 0 } : { right: narrow ? -HANDLE_WIDTH : 0 }}
                  aria-label={`调整${subtitle.text || '字幕'}的${edit === 'start' ? '开始' : '结束'}时间`}
                  title="拖动或按左右键调整时间，Shift 加速"
                  onPointerDown={(event) => beginDrag(event, item.key, subtitle, edit)}
                  onKeyDown={(event) => editWithKeyboard(event, subtitle, edit)}
                  onClick={(event) => activate(event, item.key, subtitle, edit === 'start' ? subtitle.startUs : subtitle.endUs)}>
                  {edit === 'start' ? '‹' : '›'}
                </button>
              ))}
            </div>
          )
        })}
        {timelineSubtitles.length === 0 && <div className={classes.empty}>暂无字幕段，可在智能字幕面板生成或添加。</div>}
      </div>
    </div>
  )
}
