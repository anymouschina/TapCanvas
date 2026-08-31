// apps/web/src/canvas/nodes/taskNode/VideoTrimEditor.tsx
import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react'
import { captureFramesAtTimes } from '../../../utils/videoFrameExtractor'

type VideoTrimEditorProps = {
  videoUrl: string
  videoDuration: number
  isDarkUi: boolean
  onClose: () => void
  onConfirm: (blob: Blob, startTime: number, endTime: number) => Promise<void>
}

const MIN_CLIP_DURATION = 0.1

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`
}

export function VideoTrimEditor({
  videoUrl,
  videoDuration,
  isDarkUi,
  onClose,
  onConfirm,
}: VideoTrimEditorProps) {
  const [sourceDuration, setSourceDuration] = React.useState<number | null>(null)
  const [metadataState, setMetadataState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [startTime, setStartTime] = React.useState(0)
  const [endTime, setEndTime] = React.useState(videoDuration)
  const [thumbs, setThumbs] = React.useState<{ objectUrl: string }[]>([])
  const [trimming, setTrimming] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [activeHandle, setActiveHandle] = React.useState<'start' | 'end' | null>(null)

  const timelineRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ handle: 'start' | 'end' } | null>(null)
  const rangeEditedRef = React.useRef(false)

  // videoDuration is the generation setting persisted on the node (often 15s),
  // not necessarily the duration of the source asset. Resolve the source media
  // metadata before exposing the trim range so a long reference video is never
  // silently reduced to the generation default.
  React.useEffect(() => {
    let cancelled = false
    const metadataVideo = document.createElement('video')
    metadataVideo.preload = 'metadata'
    metadataVideo.crossOrigin = 'anonymous'
    setSourceDuration(null)
    setMetadataState('loading')
    setStartTime(0)
    setEndTime(videoDuration)
    rangeEditedRef.current = false

    const handleLoadedMetadata = () => {
      const duration = metadataVideo.duration
      if (cancelled) return
      if (Number.isFinite(duration) && duration > 0) {
        setSourceDuration(duration)
        setMetadataState('ready')
        if (!rangeEditedRef.current) {
          setStartTime(0)
          setEndTime(duration)
        }
      } else {
        setMetadataState('error')
      }
    }
    const handleError = () => {
      if (!cancelled) setMetadataState('error')
    }

    metadataVideo.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true })
    metadataVideo.addEventListener('error', handleError, { once: true })
    metadataVideo.src = videoUrl
    metadataVideo.load()

    return () => {
      cancelled = true
      metadataVideo.removeEventListener('loadedmetadata', handleLoadedMetadata)
      metadataVideo.removeEventListener('error', handleError)
      metadataVideo.removeAttribute('src')
      metadataVideo.load()
    }
  }, [videoDuration, videoUrl])

  // Do not use the persisted generation duration as a timeline fallback. Until
  // source metadata is confirmed, the range is intentionally non-actionable.
  const effectiveDuration = sourceDuration ?? 0

  // 提取缩略帧用于时间轴预览
  React.useEffect(() => {
    if (!effectiveDuration || effectiveDuration <= 0) return
    const COUNT = 8
    const times = Array.from({ length: COUNT }, (_, i) =>
      (i / (COUNT - 1)) * effectiveDuration,
    )
    let cancelled = false
    captureFramesAtTimes({ type: 'url', url: videoUrl }, times, { mimeType: 'image/jpeg', quality: 0.65 })
      .then(({ frames }) => {
        if (cancelled) { frames.forEach(f => URL.revokeObjectURL(f.objectUrl)); return }
        setThumbs(frames.map(f => ({ objectUrl: f.objectUrl })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
      setThumbs(prev => { prev.forEach(t => URL.revokeObjectURL(t.objectUrl)); return [] })
    }
  }, [effectiveDuration, videoUrl])

  const clipDuration = endTime - startTime
  const startRatio = effectiveDuration > 0 ? startTime / effectiveDuration : 0
  const endRatio = effectiveDuration > 0 ? endTime / effectiveDuration : 1

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, handle: 'start' | 'end') => {
    if (metadataState !== 'ready') return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    rangeEditedRef.current = true
    dragRef.current = { handle }
    setActiveHandle(handle)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (metadataState !== 'ready' || !dragRef.current || !timelineRef.current) return
    e.preventDefault()
    const rect = timelineRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = ratio * effectiveDuration
    if (dragRef.current.handle === 'start') {
      setStartTime(Math.max(0, Math.min(t, endTime - MIN_CLIP_DURATION)))
    } else {
      setEndTime(Math.min(effectiveDuration, Math.max(t, startTime + MIN_CLIP_DURATION)))
    }
  }

  const handlePointerUp = () => {
    dragRef.current = null
    setActiveHandle(null)
  }

  const setBoundary = (handle: 'start' | 'end', value: number) => {
    if (metadataState !== 'ready') return
    rangeEditedRef.current = true
    const next = Math.max(0, Math.min(effectiveDuration, value))
    if (handle === 'start') {
      setStartTime(Math.min(next, endTime - MIN_CLIP_DURATION))
    } else {
      setEndTime(Math.max(next, startTime + MIN_CLIP_DURATION))
    }
  }

  const handleTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (metadataState !== 'ready' || !timelineRef.current) return
    const target = e.target as HTMLElement
    if (target.closest('[data-trim-handle="true"]')) return
    const rect = timelineRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const time = ratio * effectiveDuration
    const handle = Math.abs(time - startTime) <= Math.abs(time - endTime) ? 'start' : 'end'
    setBoundary(handle, time)
    setActiveHandle(handle)
  }

  const handleHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, handle: 'start' | 'end') => {
    if (metadataState !== 'ready') return
    const step = e.shiftKey ? 1 : 0.1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setBoundary(handle, (handle === 'start' ? startTime : endTime) - step)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setBoundary(handle, (handle === 'start' ? startTime : endTime) + step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setBoundary(handle, 0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setBoundary(handle, effectiveDuration)
    }
  }

  const resetRange = () => {
    if (metadataState !== 'ready') return
    rangeEditedRef.current = true
    setStartTime(0)
    setEndTime(effectiveDuration)
  }

  const handleConfirm = async () => {
    if (trimming || metadataState !== 'ready') return
    setTrimming(true)
    setProgress(0)
    try {
      const { sliceVideo } = await import('../../../utils/ffmpegTrim')
      const blob = await sliceVideo(videoUrl, startTime, endTime, setProgress)
      await onConfirm(blob, startTime, endTime)
    } finally {
      setTrimming(false)
      setProgress(0)
    }
  }

  const bg = isDarkUi ? 'rgba(18,20,26,0.97)' : 'rgba(240,242,248,0.97)'
  const border = isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const textColor = isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)'

  return (
    <>
      {/* 顶部悬浮工具栏 */}
      <NodeToolbar isVisible position={Position.Top} align="center" offset={8} className="nodrag nopan">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
          borderRadius: 999, background: bg,
          boxShadow: '0 8px 32px rgba(0,0,0,0.36)',
          border: `1px solid ${border}`,
        }}>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: textColor, fontSize: 18, lineHeight: 1, padding: '0 4px' }}
          >
            ×
          </button>
          <div style={{ width: 1, height: 20, background: border }} />
          <span style={{ fontSize: 13, color: textColor, fontVariantNumeric: 'tabular-nums', minWidth: 72 }}>
            {metadataState === 'ready'
              ? `选中 ${clipDuration.toFixed(2)} s`
              : metadataState === 'error' ? '读取视频时长失败' : '读取视频时长…'}
          </span>
          {trimming && progress > 0 && (
            <span style={{ fontSize: 12, color: textColor, opacity: 0.6 }}>
              {Math.round(progress * 100)}%
            </span>
          )}
          <div style={{ width: 1, height: 20, background: border }} />
          <button
            type="button"
            disabled={trimming || metadataState !== 'ready' || clipDuration <= 0.05}
            onClick={() => { void handleConfirm() }}
            style={{
              padding: '5px 16px', borderRadius: 8, border: 'none',
              cursor: trimming ? 'progress' : metadataState === 'ready' ? 'pointer' : 'not-allowed',
              background: isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)',
              color: isDarkUi ? '#131316' : '#fff',
              fontSize: 13, fontWeight: 600,
              opacity: trimming || metadataState !== 'ready' ? 0.7 : 1,
            }}
          >
            {trimming ? '处理中…' : '确认'}
          </button>
        </div>
      </NodeToolbar>

      {/* 时间轴覆盖层（贴合节点底部） */}
      <div
        className="nodrag nopan"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
          height: 132,
          background: 'rgba(0,0,0,0.88)',
          borderRadius: '0 0 10px 10px',
          padding: '8px 10px 10px',
          boxSizing: 'border-box',
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 36, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: 0.5 }}>入点</span>
            <input
              aria-label="入点时间"
              type="number"
              min={0}
              max={effectiveDuration || undefined}
              step={0.1}
              value={startTime.toFixed(2)}
              disabled={metadataState !== 'ready' || trimming}
              onChange={(e) => setBoundary('start', Number(e.target.value))}
              style={{ width: 68, height: 26, padding: '0 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{formatTime(startTime)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center', minWidth: 0 }}>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>已选片段</span>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{metadataState === 'ready' ? `${clipDuration.toFixed(2)} 秒` : '—'}</span>
            {metadataState === 'ready' && <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>拖动白色手柄调整片段</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, justifyContent: 'flex-end' }}>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{formatTime(endTime)}</span>
            <input
              aria-label="出点时间"
              type="number"
              min={0}
              max={effectiveDuration || undefined}
              step={0.1}
              value={endTime.toFixed(2)}
              disabled={metadataState !== 'ready' || trimming}
              onChange={(e) => setBoundary('end', Number(e.target.value))}
              style={{ width: 68, height: 26, padding: '0 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: 0.5 }}>出点</span>
            <button type="button" aria-label="重置剪辑范围" title="重置为整段视频" onClick={resetRange} disabled={metadataState !== 'ready' || trimming} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 6, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)', cursor: 'pointer' }}>
              <IconRefresh size={14} />
            </button>
          </div>
        </div>
        <div
          ref={timelineRef}
          style={{ position: 'relative', height: 78, overflow: 'hidden', borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)' }}
          onPointerDown={handleTimelinePointerDown}
        >
          {/* 缩略帧横排 */}
          <div style={{ display: 'flex', height: '100%' }}>
            {thumbs.length > 0
              ? thumbs.map((t, i) => (
                  <div key={i} style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
                    <img
                      src={t.objectUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                ))
              : <div style={{ flex: 1, background: 'linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.1), rgba(255,255,255,0.05))' }} />
            }
          </div>

          {/* 选区外暗化遮罩 */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              width: `${startRatio * 100}%`,
              background: 'rgba(0,0,0,0.62)',
            }} />
            <div style={{
              position: 'absolute', top: 0, bottom: 0, right: 0,
              width: `${(1 - endRatio) * 100}%`,
              background: 'rgba(0,0,0,0.62)',
            }} />
          </div>

          {/* 选区高亮边框 + 时长标签 */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${startRatio * 100}%`,
            width: `${(endRatio - startRatio) * 100}%`,
            border: '2px solid rgba(255,255,255,0.9)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: 12, fontWeight: 600, color: '#fff',
              whiteSpace: 'nowrap',
              textShadow: '0 1px 4px rgba(0,0,0,0.9)',
              pointerEvents: 'none',
            }}>
              {clipDuration.toFixed(2)} s
            </span>
          </div>

          {metadataState === 'loading' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 12, background: 'rgba(0,0,0,0.25)' }}>
              正在读取视频并生成预览…
            </div>
          )}
          {metadataState === 'error' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffb4ab', fontSize: 12, background: 'rgba(0,0,0,0.4)' }}>
              无法读取视频时长，请关闭后重试
            </div>
          )}

          {/* 起始 handle */}
          <div
            className="nodrag nopan"
            data-trim-handle="true"
            onPointerDown={(e) => handlePointerDown(e, 'start')}
            onKeyDown={(e) => handleHandleKeyDown(e, 'start')}
            onFocus={() => setActiveHandle('start')}
            role="slider"
            aria-label="入点"
            aria-valuemin={0}
            aria-valuemax={effectiveDuration}
            aria-valuenow={startTime}
            tabIndex={metadataState === 'ready' ? 0 : -1}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `calc(${startRatio * 100}% - 8px)`,
              width: 28, cursor: 'ew-resize', zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              outline: activeHandle === 'start' ? '2px solid #fff' : 'none', outlineOffset: -2,
            }}
          >
            <div style={{ width: 5, height: '68%', background: 'white', borderRadius: 3, boxShadow: '0 0 0 2px rgba(0,0,0,0.28)' }} />
            <IconChevronRight size={12} color="rgba(0,0,0,0.65)" style={{ position: 'absolute' }} />
          </div>

          {/* 结束 handle */}
          <div
            className="nodrag nopan"
            data-trim-handle="true"
            onPointerDown={(e) => handlePointerDown(e, 'end')}
            onKeyDown={(e) => handleHandleKeyDown(e, 'end')}
            onFocus={() => setActiveHandle('end')}
            role="slider"
            aria-label="出点"
            aria-valuemin={0}
            aria-valuemax={effectiveDuration}
            aria-valuenow={endTime}
            tabIndex={metadataState === 'ready' ? 0 : -1}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `calc(${endRatio * 100}% - 8px)`,
              width: 28, cursor: 'ew-resize', zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              outline: activeHandle === 'end' ? '2px solid #fff' : 'none', outlineOffset: -2,
            }}
          >
            <div style={{ width: 5, height: '68%', background: 'white', borderRadius: 3, boxShadow: '0 0 0 2px rgba(0,0,0,0.28)' }} />
            <IconChevronLeft size={12} color="rgba(0,0,0,0.65)" style={{ position: 'absolute' }} />
          </div>
        </div>
      </div>
    </>
  )
}
