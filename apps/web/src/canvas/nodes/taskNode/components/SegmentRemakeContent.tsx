import React from 'react'
import {
  IconCheck,
  IconMaximize,
  IconPlus,
  IconRefresh,
  IconScissors,
  IconTag,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import { NodeToolbar, Position } from '@xyflow/react'
import { captureFramesAtTimes } from '../../../../utils/videoFrameExtractor'

export type SegmentRemakeRange = {
  start: number
  end: number
}

type SegmentRemakeContentProps = {
  videoUrl: string
  videoDuration: number
  videoTitle?: string | null
  initialRanges?: SegmentRemakeRange[]
  prompt: string
  onPromptChange: (value: string) => void
  onConfirm: (ranges: SegmentRemakeRange[], prompt: string) => Promise<void> | void
  onReference: () => void
  onCharacterLibrary: () => void
  onFullscreen: () => void
  quickActions?: () => React.ReactNode
  modelValue?: string | null
  modelOptions?: Array<{ value: string; label: string }>
  onModelChange?: (value: string) => void
  resolutionValue?: string | null
  resolutionOptions?: Array<{ value: string; label: string }>
  onResolutionChange?: (value: string) => void
  runCount?: number
  onRunCountChange?: (value: number) => void
  readOnly?: boolean
}

type TimelineFrame = {
  time: number
  objectUrl: string
}

const MAX_RANGES = 5

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function clampTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(duration, value))
}

/**
 * LibTV's segment-remake node keeps the source player at 610×350 and attaches
 * the timeline/editor as a floating bottom toolbar. It is deliberately
 * independent from the generic trim overlay because the source node remains
 * available while the user marks several independent clips.
 */
export function SegmentRemakeContent({
  videoUrl,
  videoDuration,
  videoTitle,
  initialRanges = [],
  prompt,
  onPromptChange,
  onConfirm,
  onReference,
  onCharacterLibrary,
  onFullscreen,
  quickActions,
  modelValue = null,
  modelOptions = [],
  onModelChange,
  resolutionValue = null,
  resolutionOptions = [],
  onResolutionChange,
  runCount = 1,
  onRunCountChange,
  readOnly = false,
}: SegmentRemakeContentProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const promptEditorRef = React.useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [ranges, setRanges] = React.useState<SegmentRemakeRange[]>(() => initialRanges.slice(0, MAX_RANGES))
  const [draftRange, setDraftRange] = React.useState<SegmentRemakeRange | null>(null)
  const dragStartRef = React.useRef<number | null>(null)
  const [frames, setFrames] = React.useState<TimelineFrame[]>([])
  const [framesState, setFramesState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [submitting, setSubmitting] = React.useState(false)

  const duration = Math.max(0, Number.isFinite(videoDuration) ? videoDuration : 0)
  const [mediaDuration, setMediaDuration] = React.useState(duration)
  const effectiveDuration = mediaDuration > 0 ? mediaDuration : duration

  React.useEffect(() => {
    setMediaDuration(duration)
  }, [duration])

  React.useEffect(() => {
    const editor = promptEditorRef.current
    if (!editor || editor.textContent === prompt) return
    editor.textContent = prompt
  }, [prompt])

  React.useEffect(() => {
    if (!videoUrl || effectiveDuration <= 0) {
      setFrames([])
      setFramesState('idle')
      return
    }
    let cancelled = false
    setFramesState('loading')
    const count: number = 12
    const times = Array.from({ length: count }, (_, index) =>
      count === 1 ? 0 : (index / (count - 1)) * effectiveDuration,
    )
    captureFramesAtTimes({ type: 'url', url: videoUrl }, times, { mimeType: 'image/jpeg', quality: 0.62 })
      .then(({ frames: captured }) => {
        if (cancelled) {
          captured.forEach((frame) => URL.revokeObjectURL(frame.objectUrl))
          return
        }
        setFrames(captured.map((frame) => ({ time: frame.time, objectUrl: frame.objectUrl })))
        setFramesState('ready')
      })
      .catch(() => {
        if (!cancelled) setFramesState('error')
      })
    return () => {
      cancelled = true
      setFrames((previous) => {
        previous.forEach((frame) => URL.revokeObjectURL(frame.objectUrl))
        return []
      })
    }
  }, [effectiveDuration, videoUrl])

  const handlePlayheadChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = clampTime(Number(event.currentTarget.value), effectiveDuration)
    setCurrentTime(next)
    if (videoRef.current) videoRef.current.currentTime = next
  }

  const handleMark = () => {
    if (readOnly || effectiveDuration <= 0 || ranges.length >= MAX_RANGES) return
    const start = clampTime(currentTime, effectiveDuration)
    const end = clampTime(Math.min(effectiveDuration, start + Math.max(0.5, Math.min(2.5, effectiveDuration / 5))), effectiveDuration)
    if (end <= start) return
    setRanges((previous) => [...previous, { start, end }])
  }

  const readTimelineTime = (event: React.PointerEvent<HTMLDivElement>): number => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || effectiveDuration <= 0) return 0
    const ratio = (event.clientX - bounds.left) / bounds.width
    return clampTime(ratio * effectiveDuration, effectiveDuration)
  }

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || effectiveDuration <= 0 || ranges.length >= MAX_RANGES) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = readTimelineTime(event)
    dragStartRef.current = start
    setCurrentTime(start)
    setDraftRange({ start, end: start })
    if (videoRef.current) videoRef.current.currentTime = start
  }

  const handleTimelinePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (start === null) return
    const point = readTimelineTime(event)
    setCurrentTime(point)
    setDraftRange({ start: Math.min(start, point), end: Math.max(start, point) })
  }

  const handleTimelinePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragStartRef.current = null
    setDraftRange((draft) => {
      if (draft && draft.end - draft.start >= 0.1) {
        setRanges((previous) => [...previous, draft].slice(0, MAX_RANGES))
      }
      return null
    })
  }

  const handleRemoveRange = (index: number) => {
    if (readOnly) return
    setRanges((previous) => previous.filter((_, rangeIndex) => rangeIndex !== index))
  }

  const handleSubmit = async () => {
    if (readOnly || submitting || !videoUrl) return
    setSubmitting(true)
    try {
      await onConfirm(ranges, prompt)
    } finally {
      setSubmitting(false)
    }
  }

  const handleFullscreen = () => {
    const container = containerRef.current
    if (container && typeof container.requestFullscreen === 'function') {
      void container.requestFullscreen()
      return
    }
    onFullscreen()
  }

  return (
    <div ref={containerRef} className="segment-remake-content" style={{ width: '100%', height: '100%', minHeight: 0, background: '#000', color: 'rgba(255,255,255,.9)', borderRadius: 12, overflow: 'visible' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#111', borderRadius: 12, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          className="nodrag nopan nowheel"
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const loadedDuration = event.currentTarget.duration
            if (Number.isFinite(loadedDuration) && loadedDuration > 0) setMediaDuration(loadedDuration)
            setCurrentTime(clampTime(event.currentTarget.currentTime, loadedDuration > 0 ? loadedDuration : effectiveDuration))
          }}
        />
        <div style={{ position: 'absolute', top: 10, left: 10, maxWidth: '70%', padding: '5px 9px', borderRadius: 6, background: 'rgba(0,0,0,.55)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
          {videoTitle || '源视频'}
        </div>
        <button type="button" aria-label="全屏编辑" onClick={handleFullscreen} className="nodrag nopan" style={{ position: 'absolute', top: 10, right: 10, zIndex: 4, width: 34, height: 34, border: 0, borderRadius: 8, background: 'rgba(20,20,20,.72)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconMaximize size={17} />
        </button>
        <div aria-hidden="true" className="nodrag nopan" style={{ position: 'absolute', inset: '0 0 80px', zIndex: 3, cursor: readOnly ? 'default' : 'grab' }} />
      </div>

      <NodeToolbar position={Position.Bottom} align="center" offset={12} className="segment-remake-floating-editor nodrag nopan">
        <div className="segment-remake-timeline-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 16, width: 660, height: 56, padding: '4px 20px 4px 4px', borderRadius: 12, background: 'rgba(37,37,37,.96)', color: 'rgba(255,255,255,.9)', boxShadow: '0 18px 48px rgba(0,0,0,.32)', backdropFilter: 'blur(18px)', boxSizing: 'border-box' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
          data-segment-remake-track="true"
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          className="nodrag nopan"
          style={{ position: 'relative', height: 48, borderRadius: 8, overflow: 'hidden', background: '#0c0c0c', border: '1px solid rgba(255,255,255,.08)', touchAction: 'none', cursor: readOnly ? 'default' : 'crosshair' }}
        >
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            {frames.map((frame, index) => (
              <button key={`${frame.time}-${index}`} type="button" aria-label={`跳转到 ${formatTime(frame.time)}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setCurrentTime(frame.time); if (videoRef.current) videoRef.current.currentTime = frame.time }} className="nodrag nopan" style={{ flex: 1, minWidth: 0, padding: 0, border: 0, borderRight: index < frames.length - 1 ? '1px solid rgba(0,0,0,.3)' : 0, background: '#333', cursor: 'pointer', overflow: 'hidden' }}>
                <img src={frame.objectUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
            {framesState !== 'ready' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.45)', fontSize: 11 }}>{framesState === 'error' ? '缩略图暂不可用，可直接拖动进度' : '正在生成缩略图…'}</div>}
          </div>
          {effectiveDuration > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(currentTime / effectiveDuration) * 100}%`, width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.35)', pointerEvents: 'none' }} />}
          {ranges.map((range, index) => effectiveDuration > 0 ? <div key={`${range.start}-${range.end}-${index}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(range.start / effectiveDuration) * 100}%`, width: `${((range.end - range.start) / effectiveDuration) * 100}%`, background: 'rgba(255,255,255,.22)', border: '1px solid rgba(255,255,255,.8)', pointerEvents: 'none' }} /> : null)}
          {draftRange && effectiveDuration > 0 ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(draftRange.start / effectiveDuration) * 100}%`, width: `${((draftRange.end - draftRange.start) / effectiveDuration) * 100}%`, background: 'rgba(255,255,255,.28)', border: '2px solid #fff', pointerEvents: 'none' }} /> : null}
        </div>
            <input data-segment-remake-playhead="true" aria-label="回放进度" className="nodrag nopan" type="range" min={0} max={effectiveDuration || 1} step={0.01} value={currentTime} onChange={handlePlayheadChange} style={{ width: '100%', height: 8, margin: '-1px 0 0', accentColor: '#fff' }} />
          </div>
          <span style={{ flexShrink: 0, fontSize: 12, color: 'rgba(255,255,255,.62)', fontVariantNumeric: 'tabular-nums' }}>{ranges.length}/{MAX_RANGES} 个片段</span>
        </div>

        {quickActions ? (
          <div className="segment-remake-secondary-tabs" aria-label="视频二级能力">
            {quickActions()}
          </div>
        ) : null}

      <div className="segment-remake-generator-card" style={{ width: 660, marginTop: 8, padding: '14px 18px 16px', borderRadius: 16, background: 'rgba(37,37,37,.98)', color: 'rgba(255,255,255,.9)', boxShadow: '0 18px 48px rgba(0,0,0,.32)', backdropFilter: 'blur(18px)', boxSizing: 'border-box' }}>
      {ranges.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 12px 8px' }}>{ranges.map((range, index) => <button key={`${range.start}-${range.end}-${index}`} type="button" onClick={() => handleRemoveRange(index)} className="nodrag nopan" style={{ border: '1px solid rgba(255,255,255,.17)', borderRadius: 999, padding: '3px 7px', background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.78)', fontSize: 11, cursor: 'pointer' }}>{formatTime(range.start)}–{formatTime(range.end)} <IconX size={11} style={{ verticalAlign: 'middle' }} /></button>)}</div>}

      <div style={{ position: 'relative', margin: '10px 0 10px', minHeight: 76 }}>
        <div
          ref={promptEditorRef}
          role="textbox"
          aria-label="重拍描述"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          data-placeholder="留空＝原样重跑一次；也可以写要改什么，例如：把黄色台灯换成白色台灯"
          onInput={(event) => onPromptChange(event.currentTarget.textContent || '')}
          className="nodrag nopan segment-remake-prompt-editor"
          style={{ width: '100%', minHeight: 80, border: 0, borderRadius: 8, padding: '10px 11px', background: '#1b1b1b', color: '#fff', outline: 'none', font: 'inherit', fontSize: 13, lineHeight: 1.8, boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        />
      </div>

      <div className="segment-remake-config-row">
        {modelOptions.length > 0 ? (
          <label className="segment-remake-config-control">模型
            <select aria-label="重拍模型" value={modelValue || modelOptions[0]?.value || ''} disabled={readOnly || !onModelChange} onChange={(event) => onModelChange?.(event.currentTarget.value)}>
              {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : null}
        {resolutionOptions.length > 0 ? (
          <label className="segment-remake-config-control">清晰度
            <select aria-label="重拍清晰度" value={resolutionValue || resolutionOptions[0]?.value || ''} disabled={readOnly || !onResolutionChange} onChange={(event) => onResolutionChange?.(event.currentTarget.value)}>
              {resolutionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : null}
        <label className="segment-remake-config-control">生成份数
          <select aria-label="重拍生成份数" value={String(Math.max(1, Math.min(4, runCount)))} disabled={readOnly || !onRunCountChange} onChange={(event) => onRunCountChange?.(Number(event.currentTarget.value))}>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 个</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button type="button" onClick={onReference} disabled={readOnly} className="nodrag nopan" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 0, borderRadius: 999, padding: '4px 8px', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1.3 }}><IconPlus size={14} /> 参考</button>
        <button type="button" onClick={handleMark} disabled={readOnly || ranges.length >= MAX_RANGES} className="nodrag nopan" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 0, borderRadius: 999, padding: '4px 8px', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1.3, opacity: ranges.length >= MAX_RANGES ? .45 : 1 }}><IconTag size={14} /> 标记片段</button>
        <button type="button" onClick={onCharacterLibrary} disabled={readOnly} className="nodrag nopan" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 0, borderRadius: 999, padding: '4px 8px', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1.3 }}><IconUsers size={14} /> 角色库</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,.45)' }}>最长 5 个片段</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => { setRanges([]); setCurrentTime(0); if (videoRef.current) videoRef.current.currentTime = 0 }} disabled={readOnly || submitting} aria-label="重置片段" className="nodrag nopan" style={{ marginLeft: 'auto', width: 30, height: 30, border: 0, borderRadius: 7, background: 'rgba(255,255,255,.08)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><IconRefresh size={15} /></button>
        <button type="button" onClick={() => { void handleSubmit() }} disabled={readOnly || submitting} aria-label="确认片段重拍" className="nodrag nopan" style={{ width: 38, height: 34, border: 0, borderRadius: 9, background: '#fff', color: '#151515', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: submitting ? .65 : 1 }}><IconCheck size={19} /></button>
      </div>
        </div>
      </NodeToolbar>
    </div>
  )
}
