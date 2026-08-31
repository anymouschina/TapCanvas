import React from 'react'
import { useRFStore } from '../../../store'
import { uploadCanvasImageBlob } from '../../directorConsole/uploadCanvasImageBlob'
import { toast } from '../../../../ui/toast'
import { captureFramesAtTimes } from '../../../../utils/videoFrameExtractor'

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// 视频壳 hover 迷你控件条（对齐 Neowow WorkflowCanvas 视觉规格，非库、纯手写）：
// 播放/暂停 | 2px 进度条(::before 扩 8px 热区,点击 seek) | mm:ss/mm:ss | 静音 | 截取当前帧。
// 全部事件 stopPropagation，防止与画布拖拽/选中手势打架。仅 hover 时挂载，监听器生命周期短。
export function SkeletonVideoHoverControls({ videoRef, nodeId, onManualPlayback }: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  nodeId?: string
  onManualPlayback?: (playing: boolean) => void
}): JSX.Element {
  const [playing, setPlaying] = React.useState(false)
  const [muted, setMuted] = React.useState(false)
  const [current, setCurrent] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [capturing, setCapturing] = React.useState(false)

  React.useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const sync = () => {
      setPlaying(!v.paused)
      setMuted(v.muted)
      setCurrent(v.currentTime || 0)
      setDuration(Number.isFinite(v.duration) ? v.duration : 0)
    }
    sync()
    v.addEventListener('timeupdate', sync)
    v.addEventListener('play', sync)
    v.addEventListener('pause', sync)
    v.addEventListener('durationchange', sync)
    v.addEventListener('volumechange', sync)
    return () => {
      v.removeEventListener('timeupdate', sync)
      v.removeEventListener('play', sync)
      v.removeEventListener('pause', sync)
      v.removeEventListener('durationchange', sync)
      v.removeEventListener('volumechange', sync)
    }
  }, [videoRef])

  const stop = React.useCallback((e: React.SyntheticEvent) => { e.stopPropagation() }, [])

  const togglePlay = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      onManualPlayback?.(true)
      void v.play()
        .catch(() => {
          v.muted = true
          return v.play()
        })
        .catch(() => {
          onManualPlayback?.(false)
        })
    } else {
      onManualPlayback?.(false)
      v.pause()
    }
  }, [onManualPlayback, videoRef])

  const toggleMute = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    // 解除静音的选择被记忆（默认静音起播只对未解除过的壳生效）。
    if (!v.muted) v.dataset.tcUnmuted = '1'
    else delete v.dataset.tcUnmuted
  }, [videoRef])

  const seek = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    v.currentTime = ratio * v.duration
  }, [videoRef])

  // 截取当前帧 → 上传 TOS → 在源节点右侧生成图片节点并连边（对齐 Neowow 功能，
  // 复用 uploadCanvasImageBlob（导演台同款）+ 画布 image 节点标准形状）。
  const captureFrame = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoRef.current
    if (capturing) return
    if (!v) {
      toast('截帧失败：视频播放器尚未就绪', 'error')
      return
    }
    if (!v.videoWidth) {
      toast('截帧失败：视频画面尚未加载完成', 'error')
      return
    }
    setCapturing(true)
    try {
      const sourceUrl = v.currentSrc || v.src
      if (!sourceUrl) throw new Error('当前视频缺少可读取的源地址')
      const captureTime = Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : 0
      const { frames } = await captureFramesAtTimes(
        { type: 'url', url: sourceUrl },
        [captureTime],
        { mimeType: 'image/jpeg', quality: 0.92 },
      )
      const frame = frames[0]
      if (!frame) throw new Error('当前时间点没有可用视频帧')

      try {
        const hosted = await uploadCanvasImageBlob({
          blob: frame.blob,
          label: '视频截帧',
          filePrefix: 'video-frame',
          ownerNodeId: nodeId || 'video-frame',
        })
        const s = useRFStore.getState()
        const source = nodeId ? s.nodes.find((n) => n.id === nodeId) : null
        const newId = `frame-${Date.now().toString(36)}`
        useRFStore.setState((st) => ({
          nodes: [...st.nodes, {
            id: newId,
            type: 'taskNode' as const,
            position: {
              x: (source?.position?.x ?? 0) + (((source as unknown as { width?: number })?.width) ?? 320) + 80,
              y: source?.position?.y ?? 0,
            },
            data: {
              label: `截帧 ${fmt(captureTime)}`,
              kind: 'image',
              imageUrl: hosted.url,
            },
            selected: false,
          }],
        }))
        if (nodeId) s.onConnect({ source: nodeId, sourceHandle: 'out-video', target: newId, targetHandle: 'in-image' })
        toast('已截取当前帧并生成图片节点', 'success')
      } finally {
        frames.forEach((capturedFrame) => URL.revokeObjectURL(capturedFrame.objectUrl))
      }
    } catch (err) {
      toast(`截帧失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setCapturing(false)
    }
  }, [videoRef, nodeId, capturing])

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className="tc-video-hover-controls nodrag nopan" onClick={stop} onDoubleClick={stop} onPointerDown={stop}>
      <button className="tc-video-hover-action" type="button" title={playing ? '暂停' : '播放'} onClick={togglePlay}>
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>
      <div className="tc-video-progress-track" onClick={seek}>
        <div className="tc-video-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="tc-video-hover-time">{fmt(current)} / {fmt(duration)}</span>
      <button className="tc-video-hover-action" type="button" title={muted ? '取消静音' : '静音'} onClick={toggleMute}>
        {muted ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
        )}
      </button>
      <button className="tc-video-hover-action tc-video-hover-text-btn" type="button" onClick={captureFrame} disabled={capturing}>
        截取当前帧
      </button>
    </div>
  )
}
