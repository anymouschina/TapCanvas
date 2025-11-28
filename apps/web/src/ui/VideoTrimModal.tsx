import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, Group, Loader, Stack, Text } from '@mantine/core'
import { IconPlayerPause, IconPlayerPlay, IconX, IconArrowRight } from '@tabler/icons-react'

type VideoTrimModalProps = {
  opened: boolean
  videoUrl: string
  originalDuration: number
  thumbnails: string[]
  loading?: boolean
  progressPct?: number | null
  defaultRange?: { start: number; end: number }
  onClose: () => void
  onConfirm: (range: { start: number; end: number }) => void
}

const MIN_TRIM_DURATION = 1 // seconds
const MAX_TRIM_DURATION = 3 // seconds
const TIMELINE_HEIGHT = 72
const THUMB_WIDTH = 64

export function VideoTrimModal(props: VideoTrimModalProps): JSX.Element | null {
  const {
    opened,
    videoUrl,
    originalDuration,
    thumbnails,
    loading = false,
    progressPct = null,
    defaultRange,
    onClose,
    onConfirm,
  } = props
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(
    Math.min(originalDuration || 0, MAX_TRIM_DURATION),
  )
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const dragStateRef = useRef<null | {
    type: 'start' | 'end' | 'playhead' | 'range'
    startX: number
    startValue: number
    rangeLength?: number
  }>(null)

  const timelineWidth = useMemo(() => {
    if (!thumbnails.length) return 0
    return thumbnails.length * THUMB_WIDTH
  }, [thumbnails.length])

  // 当弹窗打开且拿到有效时长时，默认选中 0~MAX_TRIM_DURATION 区间
  useEffect(() => {
    if (!opened || originalDuration <= 0) return
    const fallbackEnd = Math.min(originalDuration, MAX_TRIM_DURATION)
    if (defaultRange) {
      const rawStart = Number(defaultRange.start)
      const rawEnd = Number(defaultRange.end)
      let start = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0
      let end = Number.isFinite(rawEnd) ? rawEnd : start + MIN_TRIM_DURATION
      if (end <= start) {
        end = start + MIN_TRIM_DURATION
      }
      end = Math.min(originalDuration, Math.min(start + MAX_TRIM_DURATION, Math.max(start + MIN_TRIM_DURATION, end)))
      if (end > originalDuration) {
        const diff = end - originalDuration
        end = originalDuration
        start = Math.max(0, start - diff)
      }
      if (end - start > MAX_TRIM_DURATION) {
        end = start + MAX_TRIM_DURATION
      }
      if (start > originalDuration) {
        start = Math.max(0, originalDuration - MAX_TRIM_DURATION)
        end = Math.min(originalDuration, start + MAX_TRIM_DURATION)
      }
      setTrimStart(start)
      setTrimEnd(end)
      setCurrentTime(start)
    } else {
      setTrimStart(0)
      setTrimEnd(fallbackEnd)
      setCurrentTime(0)
    }
  }, [opened, originalDuration, defaultRange])

  useEffect(() => {
    if (!opened) {
      setPlaying(false)
      setCurrentTime(0)
      setTrimStart(0)
      setTrimEnd(Math.min(originalDuration || 0, MAX_TRIM_DURATION))
    }
  }, [opened, originalDuration])

  useEffect(() => {
    if (!opened || !playing || !videoRef.current) return
    const v = videoRef.current
    const step = () => {
      if (!v || !playing) return
      const t = v.currentTime
      setCurrentTime(t)
      if (t >= trimEnd) {
        v.currentTime = trimStart
        setCurrentTime(trimStart)
        setPlaying(false)
        v.pause()
        return
      }
      animationFrameRef.current = requestAnimationFrame(step)
    }
    animationFrameRef.current = requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current != null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [opened, playing, trimStart, trimEnd])

  useEffect(() => {
    if (!opened) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opened, onClose, playing, currentTime, trimStart, trimEnd])

  const timeToX = (time: number) => {
    if (!timelineWidth || !originalDuration) return 0
    return (time / originalDuration) * timelineWidth
  }
  const xToTime = (x: number) => {
    if (!timelineWidth || !originalDuration) return 0
    const ratio = Math.min(1, Math.max(0, x / timelineWidth))
    return ratio * originalDuration
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (playing) {
      v.pause()
      setPlaying(false)
      return
    }
    if (currentTime < trimStart || currentTime > trimEnd) {
      v.currentTime = trimStart
      setCurrentTime(trimStart)
    }
    v.play().catch(() => {})
    setPlaying(true)
  }

  const seekTo = (time: number) => {
    const t = Math.min(originalDuration, Math.max(0, time))
    setCurrentTime(t)
    if (videoRef.current) {
      videoRef.current.currentTime = t
    }
  }

  const startDrag = (e: React.MouseEvent, type: 'start' | 'end' | 'playhead') => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const startX = e.clientX - rect.left
    const startValue =
      type === 'start' ? trimStart : type === 'end' ? trimEnd : currentTime
    dragStateRef.current = { type, startX, startValue }
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', endDrag)
  }

  const onDrag = (e: MouseEvent) => {
    if (!dragStateRef.current || !timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const dx = x - dragStateRef.current.startX
    const dt = xToTime(timeToX(dragStateRef.current.startValue) + dx) - dragStateRef.current.startValue
    const nextTime = dragStateRef.current.startValue + dt
    if (dragStateRef.current.type === 'start') {
      let ns = Math.max(
        0,
        Math.min(nextTime, trimEnd - MIN_TRIM_DURATION),
      )
      ns = Math.max(ns, trimEnd - MAX_TRIM_DURATION)
      setTrimStart(ns)
      if (currentTime < ns) seekTo(ns)
    } else if (dragStateRef.current.type === 'end') {
      let ne = Math.min(
        originalDuration,
        Math.max(nextTime, trimStart + MIN_TRIM_DURATION),
      )
      ne = Math.min(ne, trimStart + MAX_TRIM_DURATION)
      setTrimEnd(ne)
      if (currentTime > ne) seekTo(ne)
    } else if (dragStateRef.current.type === 'range') {
      const rangeLength =
        typeof dragStateRef.current.rangeLength === 'number'
          ? dragStateRef.current.rangeLength
          : trimEnd - trimStart
      // 根据拖动的像素偏移计算新的起点
      const baseX = timeToX(dragStateRef.current.startValue)
      const newXStart = baseX + dx
      let ns = xToTime(newXStart)
      const maxStart = Math.max(0, originalDuration - Math.max(rangeLength, MIN_TRIM_DURATION))
      if (!Number.isFinite(ns)) ns = 0
      ns = Math.max(0, Math.min(ns, maxStart))
      const ne = ns + rangeLength
      setTrimStart(ns)
      setTrimEnd(ne)
      if (currentTime < ns || currentTime > ne) {
        seekTo(Math.min(ne, Math.max(ns, currentTime)))
      }
    } else if (dragStateRef.current.type === 'playhead') {
      let nt = Math.min(trimEnd, Math.max(trimStart, nextTime))
      seekTo(nt)
    }
  }

  const endDrag = () => {
    dragStateRef.current = null
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', endDrag)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onDrag)
      window.removeEventListener('mouseup', endDrag)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!opened) return null

  const startX = timeToX(trimStart)
  const endX = timeToX(trimEnd)
  const playheadX = timeToX(currentTime)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.9)',
        color: '#f9fafb',
        zIndex: 9100,
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
        }}
      >
        <Text fw={500} style={{ color: '#f9fafb' }}>
          Trim your video
        </Text>
        <ActionIcon variant="light" onClick={onClose} title="关闭">
          <IconX size={18} />
        </ActionIcon>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 16px',
          gap: 12,
        }}
      >
        <div
          style={{
            width: '86vw',
            maxWidth: 960,
            height: '48vh',
            maxHeight: 420,
            minHeight: 260,
            background: 'black',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            overflow: 'hidden',
            position: 'relative',
          }}
          onClick={() => {
            if (loading) return
            togglePlay()
          }}
        >
          <video
            ref={videoRef}
            src={videoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            muted
          />
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,.6)',
                pointerEvents: 'auto',
                zIndex: 2,
              }}
            >
              <Group gap="xs">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  正在上传并创建角色
                  {typeof progressPct === 'number'
                    ? `（${Math.round(progressPct * 100)}%）`
                    : '…'}
                </Text>
              </Group>
            </div>
          )}
        </div>
        <Group gap="xs">
          <ActionIcon variant="light" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
          </ActionIcon>
          <Text size="xs" c="dimmed">
            {currentTime.toFixed(1)}s / {originalDuration.toFixed(1)}s
          </Text>
        </Group>
      </div>
      <div
        style={{
          padding: '8px 16px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Stack gap={6} style={{ flex: 1 }}>
          <div
            ref={timelineRef}
            style={{
              position: 'relative',
              height: TIMELINE_HEIGHT,
              overflow: 'hidden',
              borderRadius: 8,
              background: 'rgba(15,23,42,.9)',
              border: '1px solid rgba(148,163,184,.4)',
            }}
            onMouseDown={(e) => {
              if (!timelineRef.current) return
              const rect = timelineRef.current.getBoundingClientRect()
              const x = e.clientX - rect.left
              const t = xToTime(x)
              const clamped = Math.min(trimEnd, Math.max(trimStart, t))
              seekTo(clamped)
              dragStateRef.current = {
                type: 'playhead',
                startX: x,
                startValue: clamped,
              }
              window.addEventListener('mousemove', onDrag)
              window.addEventListener('mouseup', endDrag)
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: timelineWidth,
                display: 'flex',
              }}
            >
              {thumbnails.map((src, idx) => (
                <div key={idx} style={{ width: THUMB_WIDTH, height: '100%', overflow: 'hidden' }}>
                  {src.startsWith('blob:') ? (
                    <video
                      src={src}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <img
                      src={src}
                      alt={`frame-${idx}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: startX,
                  background: 'rgba(15,23,42,.75)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: timelineWidth - endX,
                  background: 'rgba(15,23,42,.75)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: startX,
                  width: endX - startX,
                  top: 0,
                  bottom: 0,
                  border: '2px solid white',
                  boxShadow: '0 0 0 1px rgba(15,23,42,.9)',
                }}
              />
            </div>
            {/* 可拖动选区块（保持长度，整体平移） */}
            <div
              style={{
                position: 'absolute',
                left: startX,
                width: endX - startX,
                top: 0,
                bottom: 0,
                cursor: 'grab',
              }}
              onMouseDown={(e) => {
                if (!timelineRef.current) return
                e.stopPropagation()
                const rect = timelineRef.current.getBoundingClientRect()
                const startXLocal = e.clientX - rect.left
                const rangeLength = trimEnd - trimStart
                dragStateRef.current = {
                  type: 'range',
                  startX: startXLocal,
                  startValue: trimStart,
                  rangeLength,
                }
                window.addEventListener('mousemove', onDrag)
                window.addEventListener('mouseup', endDrag)
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: startX - 6,
                top: 0,
                bottom: 0,
                width: 12,
                cursor: 'ew-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                startDrag(e, 'start')
              }}
            >
              <div
                style={{
                  width: 3,
                  height: 32,
                  borderRadius: 999,
                  background: 'white',
                }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                left: endX - 6,
                top: 0,
                bottom: 0,
                width: 12,
                cursor: 'ew-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                startDrag(e, 'end')
              }}
            >
              <div
                style={{
                  width: 3,
                  height: 32,
                  borderRadius: 999,
                  background: 'white',
                }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                left: playheadX - 1,
                top: 0,
                bottom: 0,
                width: 2,
                background: '#fbbf24',
              }}
            />
          </div>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              起点 {trimStart.toFixed(1)}s · 终点 {trimEnd.toFixed(1)}s
            </Text>
          </Group>
        </Stack>
        <ActionIcon
          radius="xl"
          size={48}
          variant="white"
          onClick={() => {
            if (loading) return
            const len = trimEnd - trimStart
            if (len <= 0) return
            const maxEnd = Math.min(trimStart + MAX_TRIM_DURATION, trimEnd, originalDuration)
            if (maxEnd <= trimStart) return
            onConfirm({ start: trimStart, end: maxEnd })
          }}
          disabled={loading}
          title="确认裁剪"
        >
          {loading ? <Loader size="sm" /> : <IconArrowRight size={24} />}
        </ActionIcon>
      </div>
    </div>
  )
}
