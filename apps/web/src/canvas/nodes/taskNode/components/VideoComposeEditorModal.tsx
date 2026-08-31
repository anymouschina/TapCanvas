import React from 'react'
import { Modal, Box, Group, ActionIcon, Text, Button, Stack, Progress, Loader, Divider, Slider } from '@mantine/core'
import {
  IconX, IconPlayerPlay, IconPlayerPause, IconScissors,
  IconArrowBackUp, IconArrowForwardUp,
  IconZoomIn, IconZoomOut, IconArrowsMaximize, IconMagnet, IconTrash,
  IconVolume, IconVolumeOff, IconBadgeCc,
} from '@tabler/icons-react'
import { MP4Clip } from '@webav/av-cliper'
import type { ComposeVideoSource } from './useVideoCompose'
import { useVideoCompose } from './useVideoCompose'
import type { ComposeAudioTrack } from './composeVideosCore'
import { fetchClip } from './reliableClipFetch'
import { SubtitlePanel } from './subtitles/SubtitlePanel'
import { drawSubtitleOverlay } from './subtitles/drawSubtitle'
import { projectSegmentsToTimeline, type ClipWindow } from './subtitles/timeline'
import type { ComposeSubtitleState, SubtitleSegment, SubtitleFontSizeTier } from './subtitles/types'
import { safeSubtitleId } from './subtitles/types'
import { speechAuditToSubtitleSegments } from './subtitles/speechAuditSubtitles'
import { analyzeVideoToSpeechTranscript } from '../../../../api/server'
import { findModelOptionByIdentifier, getModelOptionRequestAlias, useModelOptionsState } from '../../../../config/useModelOptions'
import { VIDEO_ANALYSIS_CAPABILITY_TAG, VIDEO_ANALYSIS_DEFAULT_TAG, videoAnalysisModelHasTag } from '../videoAnalysis/videoAnalysisRuntime'
import { toast } from '../../../../ui/toast'
import type { ComposePhase } from './composeVideosCore'

const US_PER_S = 1_000_000
const MIN_USED_US = 500_000   // 0.5 s minimum per clip
const HANDLE_W = 10
const SNAP_THRESHOLD_PX = 10
const BASE_PX_PER_SEC = 80   // pixels per second at zoom level 1

const COMPOSE_PHASE_LABELS: Record<ComposePhase, string> = {
  preparing: '正在准备合成…',
  loading_media: '正在读取视频素材…',
  parsing_media: '正在解析裁剪区间…',
  initializing_encoder: '正在初始化视频编码器…',
  encoding: '正在编码成片…',
}

function usToDisplay(us: number): string {
  const s = Math.floor(us / US_PER_S)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function usToSecs(us: number): string {
  return (us / US_PER_S).toFixed(2) + 's'
}

/** Compute a nice ruler step (in µs) based on actual px/sec density. */
function rulerStep(pxPerSec: number): number {
  // target ~70px between ticks
  const secsPerTick = 70 / pxPerSec
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60]
  return (steps.find((s) => s >= secsPerTick) ?? 60) * US_PER_S
}

function drawContain(canvas: HTMLCanvasElement, frame: VideoFrame): void {
  const ctx = canvas.getContext('2d')!
  const fw = frame.displayWidth
  const fh = frame.displayHeight
  if (!fw || !fh) return
  const scale = Math.min(canvas.width / fw, canvas.height / fh)
  const dw = fw * scale
  const dh = fh * scale
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(frame, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
}

// ─────────────────────────────────────────────────────────────────────────────
// Data model
// ─────────────────────────────────────────────────────────────────────────────

type EditableClip = {
  id: string
  clip: MP4Clip
  sourceUrl: string
  sourceMeta: { title?: string; thumbnailUrl?: string }
  duration: number   // full duration of this specific clip (µs)
  trimStart: number  // µs to skip at beginning
  trimEnd: number    // µs to skip at end
  /** 本片段 0 点在源视频里的位置（µs）；split 产生的后半段 > 0，字幕投影用 */
  sourceOffsetUs: number
  thumbs: { ts: number; url: string }[]
}

const usedDur = (ec: EditableClip) =>
  Math.max(MIN_USED_US, ec.duration - ec.trimStart - ec.trimEnd)

type TrimRecord = { id: string; trimStart: number; trimEnd: number }

let _clipIdCounter = 0
const newClipId = () => `clip-${++_clipIdCounter}`

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export type VideoComposeEditorModalProps = {
  opened: boolean
  onClose: () => void
  upstreamVideos: ComposeVideoSource[]
  /** 上游音频节点的配音/BGM 轨，合成时从 0 时刻混入 */
  upstreamAudioTracks?: ComposeAudioTrack[]
  onComposeDone: (blob: Blob) => void
  /** 节点上已持久化的字幕（node.data.composeSubtitles） */
  initialSubtitles?: ComposeSubtitleState
  /** 弹窗关闭/合成时回传最新字幕状态（父组件写回节点） */
  onSubtitlesChange?: (state: ComposeSubtitleState) => void
  title?: string
}

export function VideoComposeEditorModal({
  opened,
  onClose,
  upstreamVideos,
  upstreamAudioTracks,
  onComposeDone,
  initialSubtitles,
  onSubtitlesChange,
  title = '视频合成',
}: VideoComposeEditorModalProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const editClipsRef = React.useRef<EditableClip[]>([])

  const [editClips, setEditClips] = React.useState<EditableClip[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [currentUs, setCurrentUs] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [selectedIdx, setSelectedIdx] = React.useState<number | null>(null)
  const [zoomLevel, setZoomLevel] = React.useState(1)
  const [snapEnabled, setSnapEnabled] = React.useState(false)
  // 预览声音（canvas 逐帧预览本身没有音轨，用一个隐藏 <audio> 跟随播放头放当前片段的声音）。
  // 默认开声（播放由用户点击触发＝有用户手势，浏览器允许带声播放）；提供静音开关。
  const [muted, setMuted] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement>(null)

  // ── 字幕 ──────────────────────────────────────────────────────────────────
  const [subtitleSegments, setSubtitleSegments] = React.useState<SubtitleSegment[]>([])
  const [subtitleFontTier, setSubtitleFontTier] = React.useState<SubtitleFontSizeTier>('md')
  const [subtitlePanelOpen, setSubtitlePanelOpen] = React.useState(false)
  const [subtitleGenerating, setSubtitleGenerating] = React.useState(false)
  const [subtitleError, setSubtitleError] = React.useState<string | null>(null)
  const [subtitleSkipped, setSubtitleSkipped] = React.useState<Array<{ url: string; title?: string }>>([])
  const subtitleModelState = useModelOptionsState('text', { enabled: opened })
  const subtitleModelOptions = React.useMemo(
    () => subtitleModelState.options.filter((option) =>
      videoAnalysisModelHasTag(option, VIDEO_ANALYSIS_CAPABILITY_TAG)
      && option.videoAnalysisPricing?.enabled === true
      && option.videoAnalysisPricing.mode === 'duration_metered'
      && option.videoAnalysisPricing.priceCnyPerSecond > 0,
    ),
    [subtitleModelState.options],
  )
  const [subtitleModel, setSubtitleModel] = React.useState('')
  const resolvedSubtitleModel = React.useMemo(() => {
    const stored = findModelOptionByIdentifier(subtitleModelOptions, subtitleModel)
    if (stored) return stored
    const defaults = subtitleModelOptions.filter((option) => videoAnalysisModelHasTag(option, VIDEO_ANALYSIS_DEFAULT_TAG))
    return defaults.length === 1 ? defaults[0] : subtitleModelOptions.length === 1 ? subtitleModelOptions[0] : null
  }, [subtitleModel, subtitleModelOptions])

  const renderingRef = React.useRef(false)
  // Trim undo/redo (stores per-clip trim records)
  const trimUndoRef = React.useRef<TrimRecord[][]>([])
  const trimRedoRef = React.useRef<TrimRecord[][]>([])
  // Scrub drag
  const scrubActiveRef = React.useRef(false)
  const scrubStartXRef = React.useRef(0)
  const wasPlayingRef = React.useRef(false)
  const pointerIsDownRef = React.useRef(false)   // true only while a pointer button is held
  // Trim drag
  type TrimDrag = { clipId: string; side: 'start' | 'end'; startX: number; startTrimUs: number; usPerPx: number }
  const trimDragRef = React.useRef<TrimDrag | null>(null)
  const [activeTrimInfo, setActiveTrimInfo] = React.useState<{ id: string; side: 'start' | 'end'; durationUs: number } | null>(null)

  const { compose, cancel: cancelCompose, composing, progress: composeProgress, phase: composePhase, error: composeError } = useVideoCompose()

  const reportedComposeErrorRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!composeError || reportedComposeErrorRef.current === composeError) return
    reportedComposeErrorRef.current = composeError
    toast(`视频合成失败：${composeError}`, 'error')
  }, [composeError])

  // Keep ref in sync
  React.useEffect(() => { editClipsRef.current = editClips }, [editClips])

  // ── Derived ───────────────────────────────────────────────────────────────
  const clipPositions = React.useMemo(() => {
    let off = 0
    return editClips.map((ec) => { const s = off; off += usedDur(ec); return s })
  }, [editClips])

  const totalUs = React.useMemo(
    () => editClips.reduce((acc, ec) => acc + usedDur(ec), 0),
    [editClips],
  )

  const clipWindows = React.useMemo<ClipWindow[]>(
    () => editClips.map((ec, i) => ({
      sourceUrl: ec.sourceUrl,
      sourceOffsetUs: ec.sourceOffsetUs,
      trimStart: ec.trimStart,
      trimEnd: ec.trimEnd,
      duration: ec.duration,
      timelineStartUs: clipPositions[i],
    })),
    [editClips, clipPositions],
  )

  const timelineSubtitles = React.useMemo(
    () => projectSegmentsToTimeline(subtitleSegments, clipWindows),
    [subtitleSegments, clipWindows],
  )

  /** segmentId → 首个时间线投影（面板显示/seek 用） */
  const projectedById = React.useMemo(() => {
    const m = new Map<string, { startUs: number; endUs: number }>()
    for (const t of timelineSubtitles) {
      if (!m.has(t.segmentId)) m.set(t.segmentId, { startUs: t.startUs, endUs: t.endUs })
    }
    return m
  }, [timelineSubtitles])

  const currentSubtitleText = React.useMemo(
    () => timelineSubtitles.find((t) => currentUs >= t.startUs && currentUs < t.endUs)?.text ?? '',
    [timelineSubtitles, currentUs],
  )

  const openedRef = React.useRef(false)
  React.useEffect(() => {
    openedRef.current = opened
  }, [opened])

  // 打开弹窗时从节点持久化状态恢复字幕（只在 open 边沿恢复是有意选择：编辑中不被父节点
  // 重渲染的 initialSubtitles 新引用覆盖——OCR 2026-07-14 注记，非漏依赖）
  React.useEffect(() => {
    if (!opened) return
    setSubtitleSegments(initialSubtitles?.segments ?? [])
    setSubtitleFontTier(initialSubtitles?.fontSize ?? 'md')
    setSubtitlePanelOpen((initialSubtitles?.segments?.length ?? 0) > 0)
    setSubtitleModel(initialSubtitles?.model ?? '')
    setSubtitleError(null)
    setSubtitleSkipped([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  // ── Load ──────────────────────────────────────────────────────────────────
  const destroyEditClips = React.useCallback((clips: EditableClip[]) => {
    clips.forEach(({ clip, thumbs }) => {
      clip.destroy()
      thumbs.forEach(({ url }) => URL.revokeObjectURL(url))
    })
  }, [])

  React.useEffect(() => {
    if (!opened || upstreamVideos.length === 0) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
      setPlaying(false)
      setCurrentUs(0)
      setSelectedIdx(null)
      trimUndoRef.current = []
      trimRedoRef.current = []

      try {
        // 先并行完成所有片段的网络读取和 MP4 元数据解析。此前这里是串行
        // fetch → ready → thumbnails，片段数量一多，打开编辑器的等待时间会
        // 线性叠加；缩略图不是时间轴可用性的前置条件，必须从首屏路径移出。
        const settled = await Promise.allSettled(upstreamVideos.map(async (src): Promise<EditableClip> => {
          let clip: MP4Clip | null = null
          try {
            if (cancelled) throw new Error('加载已取消')
            const res = await fetchClip(src.url)
            if (!res.body) throw new Error(`无法加载：${src.title || src.url}`)
            clip = new MP4Clip(res.body)
            await clip.ready
            if (cancelled) throw new Error('加载已取消')

            const { duration } = clip.meta
            return {
              id: newClipId(),
              clip,
              sourceUrl: src.url,
              sourceMeta: { title: src.title, thumbnailUrl: src.thumbnailUrl },
              duration,
              trimStart: 0,
              trimEnd: 0,
              sourceOffsetUs: 0,
              thumbs: [],
            }
          } catch (error: unknown) {
            clip?.destroy()
            throw error
          }
        }))

        const newClips = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
        const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (rejected) {
          destroyEditClips(newClips)
          throw rejected.reason
        }

        if (cancelled) { destroyEditClips(newClips); return }

        destroyEditClips(editClipsRef.current)
        setEditClips(newClips)
        // 首帧由现有 render-frame effect 在 editClips 更新后绘制；不再阻塞
        // 时间轴和剪辑操作，避免额外一次 tick 把“可用”推迟到最后。
        setLoading(false)

        // 缩略图仅影响轨道视觉，不影响剪辑、播放或合成。后台逐片生成，
        // 关闭弹窗/切换素材时自动释放 ObjectURL，不把错误伪装成主流程失败。
        void Promise.all(newClips.map(async (editableClip) => {
          const { duration } = editableClip
          const thumbCount = Math.max(4, Math.min(20, Math.ceil(duration / US_PER_S) * 2))
          const step = Math.max(1, Math.floor(duration / thumbCount))
          try {
            if (cancelled) return
            const raw = await editableClip.clip.thumbnails(120, { start: 0, end: duration, step })
            const thumbs = raw.map(({ ts, img }) => ({ ts, url: URL.createObjectURL(img) }))
            if (cancelled) {
              thumbs.forEach(({ url }) => URL.revokeObjectURL(url))
              return
            }
            setEditClips((current) => current.map((clip) => clip.id === editableClip.id ? { ...clip, thumbs } : clip))
          } catch {
            // 缩略图是可选的；主流程已经可用，单片缩略图失败不阻断编辑器。
          }
        }))
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, upstreamVideos])

  // ── Cleanup on close ──────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!opened) {
      setPlaying(false)
      setCurrentUs(0)
      setSelectedIdx(null)
      trimUndoRef.current = []
      trimRedoRef.current = []
      destroyEditClips(editClipsRef.current)
      setEditClips([])
      editClipsRef.current = []
    }
  }, [opened, destroyEditClips])

  // ── Playback ──────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!playing || editClips.length === 0) return
    const startWall = performance.now()
    const startUs = currentUs
    const id = setInterval(() => {
      const next = startUs + (performance.now() - startWall) * 1000
      if (next >= totalUs) { setPlaying(false); setCurrentUs(totalUs) }
      else setCurrentUs(next)
    }, 50)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, totalUs])

  // ── Auto-scroll to keep playhead visible ──────────────────────────────────
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const pxPerUs = (BASE_PX_PER_SEC * zoomLevel) / US_PER_S
    const ph = currentUs * pxPerUs
    const margin = el.clientWidth * 0.15
    if (ph < el.scrollLeft + margin || ph > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = ph - el.clientWidth / 2
    }
  }, [currentUs, playing, zoomLevel])

  // ── Render frame ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    const clips = editClipsRef.current
    if (!clips.length || !canvasRef.current || renderingRef.current) return

    let target: EditableClip | null = null
    let localUs = 0
    let cum = 0
    for (const ec of clips) {
      const ud = usedDur(ec)
      if (currentUs >= cum && currentUs < cum + ud) {
        target = ec
        localUs = currentUs - cum + ec.trimStart
        break
      }
      cum += ud
    }
    if (!target) {
      const last = clips[clips.length - 1]
      target = last
      localUs = last.duration - last.trimEnd - 1000
    }

    renderingRef.current = true
    target.clip.tick(Math.max(0, localUs))
      .then(({ video }) => {
        if (!video || !canvasRef.current) return
        drawContain(canvasRef.current, video)
        video.close()
        // 缓存"叠字幕前"的干净帧：字幕换词/换字号只需重合成，不再触发昂贵 decode（OCR 2026-07-14）。
        const c = canvasRef.current
        let cache = frameCacheRef.current
        if (!cache || cache.width !== c.width || cache.height !== c.height) {
          cache = document.createElement('canvas')
          cache.width = c.width
          cache.height = c.height
          frameCacheRef.current = cache
        }
        cache.getContext('2d')?.drawImage(c, 0, 0)
        drawSubtitleOverlay(c, subtitleTextRef.current, subtitleTierRef.current)
      })
      .catch(() => {})
      .finally(() => { renderingRef.current = false })
  }, [currentUs, editClips])

  // 字幕文本/字号变化：只重合成（干净帧 + overlay），零解码（OCR 2026-07-14：此前字幕词变
  // 进解码 effect deps，播放中每次换词都整帧 decode 一次）。
  const subtitleTextRef = React.useRef('')
  const subtitleTierRef = React.useRef<SubtitleFontSizeTier>('md')
  const frameCacheRef = React.useRef<HTMLCanvasElement | null>(null)
  React.useEffect(() => {
    subtitleTextRef.current = currentSubtitleText
    subtitleTierRef.current = subtitleFontTier
    const c = canvasRef.current
    const cache = frameCacheRef.current
    if (!c || !cache) return
    c.getContext('2d')?.drawImage(cache, 0, 0)
    drawSubtitleOverlay(c, currentSubtitleText, subtitleFontTier)
  }, [currentSubtitleText, subtitleFontTier])

  // ── Sync preview audio to playhead ─────────────────────────────────────────
  // canvas 只画帧、无声。这里用隐藏 <audio> 跟随播放头放「当前片段」的原声（含 seedance 原生对白）：
  // 播放时让 audio 自己走（最顺的音频时钟），只在切片段/大漂移(>0.35s)时 seek 纠偏；暂停/静音即停。
  React.useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const clips = editClipsRef.current
    // 找当前片段 + 片内秒数
    let target: EditableClip | null = null
    let localUs = 0
    let cum = 0
    for (const ec of clips) {
      const ud = usedDur(ec)
      if (currentUs >= cum && currentUs < cum + ud) { target = ec; localUs = currentUs - cum + ec.trimStart; break }
      cum += ud
    }
    if (muted || !playing || !target) { if (!a.paused) a.pause(); return }
    const desiredSec = Math.max(0, localUs) / 1e6
    if (a.getAttribute('data-src') !== target.sourceUrl) {
      a.setAttribute('data-src', target.sourceUrl)
      a.src = target.sourceUrl
      a.currentTime = desiredSec
    } else if (Math.abs(a.currentTime - desiredSec) > 0.35) {
      a.currentTime = desiredSec
    }
    a.muted = false
    if (a.paused) a.play().catch(() => {})
  }, [currentUs, editClips, playing, muted])

  // 关弹窗/停止时确保 audio 停
  React.useEffect(() => { if (!opened && audioRef.current) { audioRef.current.pause() } }, [opened])

  React.useEffect(() => {
    if (currentUs > totalUs && totalUs > 0) setCurrentUs(totalUs)
  }, [totalUs, currentUs])

  // ── Trim history helpers ──────────────────────────────────────────────────
  const saveTrimSnapshot = React.useCallback(() => {
    trimUndoRef.current.push(editClipsRef.current.map((ec) => ({ id: ec.id, trimStart: ec.trimStart, trimEnd: ec.trimEnd })))
    trimRedoRef.current = []
  }, [])

  const applyTrimRecords = React.useCallback((records: TrimRecord[]) => {
    setEditClips((prev) => prev.map((ec) => {
      const rec = records.find((r) => r.id === ec.id)
      return rec ? { ...ec, trimStart: rec.trimStart, trimEnd: rec.trimEnd } : ec
    }))
  }, [])

  const handleUndo = React.useCallback(() => {
    const prev = trimUndoRef.current.pop()
    if (!prev) return
    trimRedoRef.current.push(editClipsRef.current.map((ec) => ({ id: ec.id, trimStart: ec.trimStart, trimEnd: ec.trimEnd })))
    applyTrimRecords(prev)
  }, [applyTrimRecords])

  const handleRedo = React.useCallback(() => {
    const next = trimRedoRef.current.pop()
    if (!next) return
    trimUndoRef.current.push(editClipsRef.current.map((ec) => ({ id: ec.id, trimStart: ec.trimStart, trimEnd: ec.trimEnd })))
    applyTrimRecords(next)
  }, [applyTrimRecords])

  // ── In-point / Out-point ──────────────────────────────────────────────────
  const handleMarkIn = React.useCallback(() => {
    if (selectedIdx === null) return
    const ec = editClipsRef.current[selectedIdx]
    if (!ec) return
    const pos = clipPositions[selectedIdx]
    const localUs = currentUs - pos + ec.trimStart
    const newTrimStart = Math.max(0, Math.min(ec.duration - ec.trimEnd - MIN_USED_US, localUs))
    saveTrimSnapshot()
    setEditClips((prev) => prev.map((c, i) => i === selectedIdx ? { ...c, trimStart: Math.round(newTrimStart) } : c))
  }, [selectedIdx, clipPositions, currentUs, saveTrimSnapshot])

  const handleMarkOut = React.useCallback(() => {
    if (selectedIdx === null) return
    const ec = editClipsRef.current[selectedIdx]
    if (!ec) return
    const pos = clipPositions[selectedIdx]
    const localUs = currentUs - pos + ec.trimStart
    const newTrimEnd = Math.max(0, Math.min(ec.duration - ec.trimStart - MIN_USED_US, ec.duration - localUs))
    saveTrimSnapshot()
    setEditClips((prev) => prev.map((c, i) => i === selectedIdx ? { ...c, trimEnd: Math.round(newTrimEnd) } : c))
  }, [selectedIdx, clipPositions, currentUs, saveTrimSnapshot])

  // ── Split ─────────────────────────────────────────────────────────────────
  const handleSplit = React.useCallback(async () => {
    const idx = selectedIdx ?? editClipsRef.current.findIndex((_, i) => currentUs >= clipPositions[i] && currentUs < clipPositions[i] + usedDur(editClipsRef.current[i]))
    if (idx < 0) return
    const ec = editClipsRef.current[idx]
    if (!ec) return

    const pos = clipPositions[idx]
    const splitAbsUs = currentUs - pos + ec.trimStart  // absolute time in this clip
    if (splitAbsUs <= ec.trimStart + 100_000 || splitAbsUs >= ec.duration - ec.trimEnd - 100_000) return

    const [before, after] = await ec.clip.split(splitAbsUs)
    const beforeClip: EditableClip = {
      id: newClipId(), clip: before, sourceUrl: ec.sourceUrl, sourceMeta: ec.sourceMeta,
      duration: splitAbsUs, trimStart: ec.trimStart, trimEnd: 0,
      sourceOffsetUs: ec.sourceOffsetUs,
      thumbs: ec.thumbs.filter((t) => t.ts < splitAbsUs),
    }
    const afterClip: EditableClip = {
      id: newClipId(), clip: after, sourceUrl: ec.sourceUrl, sourceMeta: ec.sourceMeta,
      duration: ec.duration - splitAbsUs, trimStart: 0, trimEnd: ec.trimEnd,
      sourceOffsetUs: ec.sourceOffsetUs + splitAbsUs,
      thumbs: ec.thumbs.filter((t) => t.ts >= splitAbsUs).map((t) => ({ ...t, ts: t.ts - splitAbsUs })),
    }

    ec.clip.destroy()  // original consumed by split
    setEditClips((prev) => {
      const next = [...prev]
      next.splice(idx, 1, beforeClip, afterClip)
      return next
    })
    setSelectedIdx(idx)  // select the before-clip
    trimUndoRef.current = []
    trimRedoRef.current = []
  }, [selectedIdx, currentUs, clipPositions])

  // ── Delete clip ──────────────────────────────────────────────────────────
  const handleDeleteClip = React.useCallback(() => {
    const idx = selectedIdx
    if (idx === null) return
    const clips = editClipsRef.current
    if (clips.length <= 1) return   // keep at least one clip
    const ec = clips[idx]
    if (!ec) return

    ec.clip.destroy()
    ec.thumbs.forEach(({ url }) => URL.revokeObjectURL(url))

    setEditClips((prev) => {
      const next = [...prev]
      next.splice(idx, 1)
      return next
    })
    setSelectedIdx(null)
    trimUndoRef.current = []
    trimRedoRef.current = []
  }, [selectedIdx])

  // Intercept Delete/Backspace inside modal so canvas doesn't receive them
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation()
        handleDeleteClip()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [opened, handleDeleteClip])

  // ── Snap helper ───────────────────────────────────────────────────────────
  const snapToClipBoundary = React.useCallback((us: number, pxPerUs: number): number => {
    if (!snapEnabled || totalUs === 0) return us
    const thresholdUs = SNAP_THRESHOLD_PX / pxPerUs
    for (let i = 0; i < editClipsRef.current.length; i++) {
      const pos = clipPositions[i]
      const end = pos + usedDur(editClipsRef.current[i])
      if (Math.abs(us - pos) < thresholdUs) return pos
      if (Math.abs(us - end) < thresholdUs) return end
    }
    return us
  }, [snapEnabled, totalUs, clipPositions])

  // ── Scrub ─────────────────────────────────────────────────────────────────
  // px offset from left edge of content → µs (pxPerUs computed at render time)
  const pxToUs = React.useCallback((px: number, pxPerUs: number) =>
    Math.max(0, Math.min(totalUs, px / pxPerUs))
  , [totalUs])

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerIsDownRef.current = true
    scrubActiveRef.current = false
    scrubStartXRef.current = e.clientX
    wasPlayingRef.current = playing
  }

  const handleRulerPointerMove = (e: React.PointerEvent<HTMLDivElement>, pxPerUs: number) => {
    if (!pointerIsDownRef.current) return
    const moved = Math.abs(e.clientX - scrubStartXRef.current) > 4
    if (!moved && !scrubActiveRef.current) return
    if (!scrubActiveRef.current) { scrubActiveRef.current = true; setPlaying(false) }
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    setCurrentUs(snapToClipBoundary(pxToUs(px, pxPerUs), pxPerUs))
  }

  const handleRulerPointerUp = () => {
    pointerIsDownRef.current = false
    const wasScrubbing = scrubActiveRef.current
    scrubActiveRef.current = false
    if (wasPlayingRef.current && wasScrubbing) setPlaying(true)
  }

  // Clip track: click selects clip; drag scrubs
  const handleClipTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>, pxPerUs: number) => {
    pointerIsDownRef.current = true
    scrubStartXRef.current = e.clientX
    scrubActiveRef.current = false
    wasPlayingRef.current = playing
    e.currentTarget.setPointerCapture(e.pointerId)
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    const clickedUs = pxToUs(px, pxPerUs)
    let cum = 0
    let foundIdx: number | null = null
    for (let i = 0; i < editClipsRef.current.length; i++) {
      const ud = usedDur(editClipsRef.current[i])
      if (clickedUs >= cum && clickedUs < cum + ud) { foundIdx = i; break }
      cum += ud
    }
    setSelectedIdx(foundIdx)
  }

  const handleClipTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>, pxPerUs: number) => {
    if (!pointerIsDownRef.current) return
    const moved = Math.abs(e.clientX - scrubStartXRef.current) > 4
    if (!moved) return
    if (!scrubActiveRef.current) { scrubActiveRef.current = true; setPlaying(false) }
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    setCurrentUs(snapToClipBoundary(pxToUs(px, pxPerUs), pxPerUs))
  }

  const handleClipTrackPointerUp = () => {
    pointerIsDownRef.current = false
    if (scrubActiveRef.current && wasPlayingRef.current) setPlaying(true)
    scrubActiveRef.current = false
  }

  // ── Trim drag ─────────────────────────────────────────────────────────────
  const handleTrimDown = (e: React.PointerEvent<HTMLDivElement>, clipId: string, side: 'start' | 'end', pxPerUs: number) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const usPerPx = 1 / pxPerUs
    const ec = editClipsRef.current.find((c) => c.id === clipId)!
    saveTrimSnapshot()
    trimDragRef.current = { clipId, side, startX: e.clientX, startTrimUs: side === 'start' ? ec.trimStart : ec.trimEnd, usPerPx }
    setPlaying(false)
    setActiveTrimInfo({ id: clipId, side, durationUs: usedDur(ec) })
  }

  const handleTrimMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = trimDragRef.current
    if (!drag) return
    e.stopPropagation()
    const { clipId, side, startX, startTrimUs, usPerPx } = drag
    const ec = editClipsRef.current.find((c) => c.id === clipId)!
    if (!ec) return
    const otherTrim = side === 'start' ? ec.trimEnd : ec.trimStart
    const deltaUs = (e.clientX - startX) * usPerPx
    let newTrim = startTrimUs + (side === 'start' ? deltaUs : -deltaUs)
    newTrim = Math.max(0, Math.min(ec.duration - otherTrim - MIN_USED_US, newTrim))
    setEditClips((prev) => prev.map((c) => c.id === clipId ? { ...c, [side === 'start' ? 'trimStart' : 'trimEnd']: Math.round(newTrim) } : c))
    const updated = editClipsRef.current.find((c) => c.id === clipId)!
    setActiveTrimInfo({ id: clipId, side, durationUs: usedDur({ ...updated, [side === 'start' ? 'trimStart' : 'trimEnd']: Math.round(newTrim) }) })
  }

  const handleTrimUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trimDragRef.current) return
    e.stopPropagation()
    trimDragRef.current = null
    setActiveTrimInfo(null)
  }

  // ── Subtitles ─────────────────────────────────────────────────────────────
  const handleGenerateSubtitles = React.useCallback(async () => {
    if (subtitleGenerating) return
    if (
      subtitleSegments.some((s) => s.source === 'auto') &&
      !window.confirm('重新生成将覆盖自动生成的字幕段（含你编辑过的），手动添加的段保留。继续？')
    ) return
    setSubtitleGenerating(true)
    setSubtitleError(null)
    try {
      const model = resolvedSubtitleModel
      if (!model) throw new Error('没有可执行的视频理解模型；请先在 new-api 启用并配置按时长计费的模型。')
      const generated: SubtitleSegment[] = []
      for (const source of upstreamVideos) {
        const loaded = editClipsRef.current.find((clip) => clip.sourceUrl === source.url)
        const durationSeconds = loaded ? loaded.duration / US_PER_S : 0
        if (durationSeconds > 60) {
          throw new Error(`片段“${source.title || source.url}”时长超过视频理解接口 60 秒上限，请先裁剪后再生成字幕。`)
        }
        const response = await analyzeVideoToSpeechTranscript({
          model: getModelOptionRequestAlias(subtitleModelOptions, model.value),
          videoUrl: source.url,
          fps: 1,
        })
        generated.push(...speechAuditToSubtitleSegments(source.url, response))
      }
      // OCR 2026-07-14：长任务期间弹窗可能已关（load() 同款 cancelled 模式）——
      // 关窗后不再写回状态，防对已重置组件 setState。
      if (!openedRef.current) return
      setSubtitleSkipped([])
      setSubtitleSegments((prev) => [...prev.filter((s) => s.source === 'manual'), ...generated])
      if (generated.length === 0) {
        setSubtitleError('视频中没有识别到可听见的人声')
      }
    } catch (err) {
      if (!openedRef.current) return
      setSubtitleError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setSubtitleGenerating(false)
    }
  }, [resolvedSubtitleModel, subtitleGenerating, subtitleModelOptions, subtitleSegments, upstreamVideos])

  const handleAddSubtitleAtPlayhead = React.useCallback(() => {
    for (const w of clipWindows) {
      const used = w.duration - w.trimStart - w.trimEnd
      if (currentUs >= w.timelineStartUs && currentUs < w.timelineStartUs + used) {
        const srcStart = w.sourceOffsetUs + w.trimStart + (currentUs - w.timelineStartUs)
        const srcEnd = Math.min(srcStart + 2_000_000, w.sourceOffsetUs + w.duration - w.trimEnd)
        if (srcEnd - srcStart < 200_000) return
        setSubtitleSegments((prev) => [...prev, {
          id: safeSubtitleId(),
          sourceUrl: w.sourceUrl,
          startUs: Math.round(srcStart),
          endUs: Math.round(srcEnd),
          text: '在这里输入字幕',
          source: 'manual',
        }])
        setSubtitlePanelOpen(true)
        return
      }
    }
  }, [clipWindows, currentUs])

  const handleUpdateSubtitleText = React.useCallback((segId: string, text: string) => {
    setSubtitleSegments((prev) => prev.map((s) => (s.id === segId ? { ...s, text } : s)))
  }, [])

  const handleDeleteSubtitle = React.useCallback((segId: string) => {
    setSubtitleSegments((prev) => prev.filter((s) => s.id !== segId))
  }, [])

  const emitSubtitles = React.useCallback(() => {
    onSubtitlesChange?.({
      segments: subtitleSegments,
      fontSize: subtitleFontTier,
      ...(resolvedSubtitleModel ? { model: resolvedSubtitleModel.value } : {}),
    })
  }, [onSubtitlesChange, resolvedSubtitleModel, subtitleSegments, subtitleFontTier])

  const handleClose = React.useCallback(() => {
    emitSubtitles()
    onClose()
  }, [emitSubtitles, onClose])

  // ── Compose ───────────────────────────────────────────────────────────────
  const handleCompose = async () => {
    setPlaying(false)
    reportedComposeErrorRef.current = null
    emitSubtitles()
    const sources: ComposeVideoSource[] = editClipsRef.current.map((ec) => ({
      url: ec.sourceUrl,
      title: ec.sourceMeta.title,
      thumbnailUrl: ec.sourceMeta.thumbnailUrl,
      trimStart: ec.trimStart,
      trimEnd: ec.trimEnd,
    }))
    const blob = await compose(sources, {
      audioTracks: upstreamAudioTracks,
      subtitles: timelineSubtitles.length > 0
        ? {
            segments: timelineSubtitles.map((t) => ({ startUs: t.startUs, endUs: t.endUs, text: t.text })),
            fontSize: subtitleFontTier,
          }
        : undefined,
    })
    if (blob) { onComposeDone(blob); onClose() }
  }

  // ── Toolbar button states ─────────────────────────────────────────────────
  const canUndo = trimUndoRef.current.length > 0
  const canRedo = trimRedoRef.current.length > 0
  const canMarkIn = selectedIdx !== null && currentUs > clipPositions[selectedIdx]
  const canMarkOut = selectedIdx !== null && currentUs < clipPositions[selectedIdx] + usedDur(editClips[selectedIdx] ?? editClips[0])
  const canSplit = (() => {
    const idx = selectedIdx ?? editClips.findIndex((_, i) => currentUs >= clipPositions[i] && currentUs < clipPositions[i] + usedDur(editClips[i]))
    if (idx < 0) return false
    const ec = editClips[idx]
    if (!ec) return false
    const pos = clipPositions[idx]
    const splitAbs = currentUs - pos + ec.trimStart
    return splitAbs > ec.trimStart + 100_000 && splitAbs < ec.duration - ec.trimEnd - 100_000
  })()

  // ── Pixel-based timeline layout ───────────────────────────────────────────
  const pxPerSec = BASE_PX_PER_SEC * zoomLevel
  const pxPerUs = pxPerSec / US_PER_S
  const contentWidthPx = Math.max(400, (totalUs / US_PER_S) * pxPerSec)
  const playheadPx = currentUs * pxPerUs
  const step = rulerStep(pxPerSec)

  return (
    <Modal
      className="tc-video-compose-editor-modal"
      opened={opened}
      onClose={handleClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      zIndex={8200}
      transitionProps={{ duration: 0 }}
      styles={{
        content: { background: '#1a1a1a', display: 'flex', flexDirection: 'column' },
        body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0 },
      }}
    >
      {/* Header */}
      <Group justify="space-between" px={20} py={8} style={{ borderBottom: '1px solid #2e2e2e', flexShrink: 0, minHeight: 44 }}>
        <Group gap={8}>
          <IconScissors size={15} color="#999" />
          <Text size="sm" fw={500} c="white">{title}</Text>
        </Group>
        <Group gap={4}>
          <ActionIcon
            variant={subtitlePanelOpen ? 'filled' : 'subtle'}
            color={subtitlePanelOpen ? 'blue' : 'gray'}
            size="sm"
            onClick={() => setSubtitlePanelOpen((v) => !v)}
            title="智能字幕"
          >
            <IconBadgeCc size={15} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClose}><IconX size={14} /></ActionIcon>
        </Group>
      </Group>

      {/* Panel + Preview */}
      <Box style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {subtitlePanelOpen ? (
          <SubtitlePanel
            segments={subtitleSegments}
            projected={projectedById}
            fontTier={subtitleFontTier}
            generating={subtitleGenerating}
            error={subtitleError}
            skipped={subtitleSkipped}
            canGenerate={upstreamVideos.length > 0 && !loading && !subtitleModelState.error}
            modelOptions={subtitleModelOptions}
            selectedModel={resolvedSubtitleModel?.value ?? null}
            modelLoading={subtitleModelState.loading}
            modelError={subtitleModelState.error?.message ?? null}
            onGenerate={() => void handleGenerateSubtitles()}
            onChangeModel={(value) => setSubtitleModel(value ?? '')}
            onChangeFontTier={setSubtitleFontTier}
            onUpdateText={handleUpdateSubtitleText}
            onDelete={handleDeleteSubtitle}
            onAddAtPlayhead={handleAddSubtitleAtPlayhead}
            onSeek={(us) => { setPlaying(false); setCurrentUs(us) }}
            onClosePanel={() => setSubtitlePanelOpen(false)}
          />
        ) : null}
        <Box style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', minHeight: 0, padding: 16 }}>
          {loading ? (
            <Stack align="center" gap={10}><Loader size="sm" color="gray" /><Text size="xs" c="dimmed">加载视频…</Text></Stack>
          ) : loadError ? (
            <Text size="sm" c="red">{loadError}</Text>
          ) : (
            <canvas ref={canvasRef} width={960} height={540} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', background: '#000', borderRadius: 4 }} />
          )}
          {/* 隐藏音频元素：跟随播放头放当前片段原声（canvas 预览本身无声） */}
          <audio ref={audioRef} crossOrigin="anonymous" preload="none" style={{ display: 'none' }} />
        </Box>
      </Box>

      {/* Toolbar + controls */}
      <Box px={16} py={8} style={{ background: '#1e1e1e', borderTop: '1px solid #2e2e2e', flexShrink: 0 }}>
        {composing ? (
          <Stack gap={6} align="stretch">
            <Text size="xs" c="dimmed" ta="center">
              {COMPOSE_PHASE_LABELS[composePhase]}{composePhase === 'encoding' ? ` ${composeProgress}%` : ''}
            </Text>
            <Progress value={composeProgress} size="xs" animated={composePhase !== 'encoding'} />
            <Button size="xs" variant="subtle" color="red" onClick={cancelCompose}>取消</Button>
          </Stack>
        ) : (
          <Group justify="space-between" align="center" wrap="nowrap">
            {/* Left: edit actions */}
            <Group gap={2} wrap="nowrap">
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleUndo} disabled={!canUndo} title="撤销">
                <IconArrowBackUp size={15} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleRedo} disabled={!canRedo} title="重做">
                <IconArrowForwardUp size={15} />
              </ActionIcon>
              <Divider orientation="vertical" mx={4} />
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => void handleSplit()} disabled={!canSplit || loading} title="分割">
                <Text size="xs" style={{ fontFamily: 'monospace', letterSpacing: '-2px', lineHeight: 1, color: canSplit ? '#ccc' : '#555' }}>][</Text>
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleMarkIn} disabled={!canMarkIn} title="设置入点">
                <Text size="xs" style={{ fontFamily: 'monospace', lineHeight: 1, color: canMarkIn ? '#ccc' : '#555' }}>[|</Text>
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleMarkOut} disabled={!canMarkOut} title="设置出点">
                <Text size="xs" style={{ fontFamily: 'monospace', lineHeight: 1, color: canMarkOut ? '#ccc' : '#555' }}>|]</Text>
              </ActionIcon>
              <Divider orientation="vertical" mx={4} />
              <ActionIcon variant="subtle" color="red" size="sm" onClick={handleDeleteClip} disabled={selectedIdx === null || editClips.length <= 1} title="删除片段">
                <IconTrash size={14} />
              </ActionIcon>
            </Group>

            {/* Center: playback */}
            <Group gap={10} align="center" wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', minWidth: 40, textAlign: 'right' }}>{usToDisplay(currentUs)}</Text>
              <ActionIcon variant="default" size="md" onClick={() => { if (playing) { setPlaying(false) } else { if (currentUs >= totalUs) setCurrentUs(0); setPlaying(true) } }} disabled={!editClips.length || loading}>
                {playing ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />}
              </ActionIcon>
              <ActionIcon variant={muted ? 'subtle' : 'default'} color={muted ? 'gray' : 'blue'} size="md" onClick={() => setMuted((m) => !m)} title={muted ? '开启声音（预览对白/原声）' : '静音预览'}>
                {muted ? <IconVolumeOff size={15} /> : <IconVolume size={15} />}
              </ActionIcon>
              <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', minWidth: 40 }}>{usToDisplay(totalUs)}</Text>
            </Group>

            {/* Right: zoom + snap + compose */}
            <Group gap={4} align="center" wrap="nowrap">
              <ActionIcon variant={snapEnabled ? 'filled' : 'subtle'} color={snapEnabled ? 'blue' : 'gray'} size="sm" onClick={() => setSnapEnabled(!snapEnabled)} title="磁力吸附">
                <IconMagnet size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setZoomLevel((z) => Math.max(1, z / 1.5))} title="缩小">
                <IconZoomOut size={14} />
              </ActionIcon>
              <Slider
                value={zoomLevel}
                onChange={setZoomLevel}
                min={1}
                max={8}
                step={0.5}
                w={70}
                size="xs"
                styles={{ thumb: { width: 10, height: 10 } }}
              />
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setZoomLevel((z) => Math.min(8, z * 1.5))} title="放大">
                <IconZoomIn size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setZoomLevel(1)} title="适配窗口">
                <IconArrowsMaximize size={14} />
              </ActionIcon>
              <Divider orientation="vertical" mx={4} />
              <Button size="xs" leftSection={<IconScissors size={12} />} onClick={() => void handleCompose()} disabled={upstreamVideos.length < 2 || composing || loading}>
                合成视频
              </Button>
            </Group>
          </Group>
        )}
        {composeError && <Text size="xs" c="red" mt={6}>{composeError}</Text>}
      </Box>

      {/* Timeline */}
      {!loading && !loadError && editClips.length > 0 && (
        <Box style={{ background: '#141414', borderTop: '1px solid #2e2e2e', flexShrink: 0, userSelect: 'none' }}>
          <Box ref={scrollRef} style={{ overflowX: 'auto', paddingLeft: 24, paddingRight: 24, paddingBottom: 48 }}>
            {/* Fixed-width content — 1s = BASE_PX_PER_SEC * zoomLevel px */}
            <Box style={{ width: contentWidthPx, position: 'relative' }}>

              {/* Ruler */}
              <Box
                style={{ position: 'relative', height: 32, cursor: 'ew-resize', borderBottom: '1px solid #2e2e2e' }}
                onPointerDown={handleRulerPointerDown}
                onPointerMove={(e) => handleRulerPointerMove(e, pxPerUs)}
                onPointerUp={handleRulerPointerUp}
              >
                {totalUs > 0 && Array.from({ length: Math.floor(totalUs / step) + 2 }, (_, i) => {
                  const tickPx = (i * step) * pxPerUs
                  if (tickPx > contentWidthPx) return null
                  return (
                    <Box key={i} style={{ position: 'absolute', left: tickPx, top: 0, transform: 'translateX(-50%)', pointerEvents: 'none' }}>
                      <Box style={{ width: 1, height: 6, background: '#555', margin: '0 auto' }} />
                      <Text size="10px" c="dimmed" style={{ fontFamily: 'monospace', lineHeight: 1.3, textAlign: 'center', whiteSpace: 'nowrap' }}>{usToDisplay(i * step)}</Text>
                    </Box>
                  )
                })}
              </Box>

              {/* Subtitle track */}
              {timelineSubtitles.length > 0 && (
                <Box style={{ position: 'relative', height: 18, background: '#101418', borderBottom: '1px solid #222' }}>
                  {timelineSubtitles.map((t) => (
                    <Box
                      key={`${t.segmentId}-${t.startUs}`}
                      title={t.text}
                      style={{
                        position: 'absolute',
                        left: t.startUs * pxPerUs,
                        width: Math.max(2, (t.endUs - t.startUs) * pxPerUs),
                        top: 3,
                        bottom: 3,
                        borderRadius: 2,
                        background: 'rgba(64,158,255,0.55)',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        fontSize: 9,
                        color: '#dfe9f5',
                        padding: '0 3px',
                        lineHeight: '12px',
                        pointerEvents: 'none',
                      }}
                    >
                      {t.text}
                    </Box>
                  ))}
                </Box>
              )}

              {/* Clip track */}
              <Box
                style={{ position: 'relative', height: 80, cursor: 'default', background: '#111' }}
                onPointerDown={(e) => handleClipTrackPointerDown(e, pxPerUs)}
                onPointerMove={(e) => handleClipTrackPointerMove(e, pxPerUs)}
                onPointerUp={handleClipTrackPointerUp}
              >
                {editClips.map((ec, idx) => {
                  const ud = usedDur(ec)
                  const leftPx = clipPositions[idx] * pxPerUs
                  const widthPx = Math.max(2, ud * pxPerUs)
                  const isSelected = selectedIdx === idx
                  const isActiveTrim = activeTrimInfo?.id === ec.id
                  const clipEnd = ec.duration - ec.trimEnd
                  const visibleThumbs = ec.thumbs.filter((t) => t.ts < clipEnd)

                  return (
                    <Box
                      key={ec.id}
                      style={{
                        position: 'absolute',
                        left: leftPx,
                        width: widthPx,
                        height: '100%',
                        overflow: 'hidden',
                        borderRight: idx < editClips.length - 1 ? '2px solid #0d0d0d' : undefined,
                        outline: isSelected ? '2px solid rgba(255,255,255,0.75)' : undefined,
                        outlineOffset: '-2px',
                        borderRadius: 2,
                        background: '#1a2a3a',
                      }}
                    >
                      {/* Thumbnail strip — each frame at its real timestamp */}
                      {visibleThumbs.map((thumb, ti) => {
                        const tStart = Math.max(thumb.ts, ec.trimStart)
                        const tEnd = visibleThumbs[ti + 1]?.ts ?? clipEnd
                        if (tStart >= clipEnd) return null
                        const lPct = ud > 0 ? ((tStart - ec.trimStart) / ud) * 100 : 0
                        const wPct = ud > 0 ? ((Math.min(tEnd, clipEnd) - tStart) / ud) * 100 : 0
                        if (wPct <= 0) return null
                        return (
                          <img
                            key={thumb.ts}
                            src={thumb.url}
                            style={{ position: 'absolute', left: `${lPct}%`, width: `${wPct}%`, height: '100%', objectFit: 'cover', opacity: 0.85, pointerEvents: 'none' }}
                          />
                        )
                      })}

                      {/* Trim handles — selected only */}
                      {isSelected && (
                        <>
                          <Box
                            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: HANDLE_W, background: 'rgba(255,255,255,0.28)', cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                            onPointerDown={(e) => handleTrimDown(e, ec.id, 'start', pxPerUs)}
                            onPointerMove={handleTrimMove}
                            onPointerUp={handleTrimUp}
                          >
                            <Box style={{ width: 2, height: 22, background: 'rgba(255,255,255,0.9)', borderRadius: 1 }} />
                          </Box>
                          <Box
                            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: HANDLE_W, background: 'rgba(255,255,255,0.28)', cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                            onPointerDown={(e) => handleTrimDown(e, ec.id, 'end', pxPerUs)}
                            onPointerMove={handleTrimMove}
                            onPointerUp={handleTrimUp}
                          >
                            <Box style={{ width: 2, height: 22, background: 'rgba(255,255,255,0.9)', borderRadius: 1 }} />
                          </Box>
                        </>
                      )}

                      {/* Duration tooltip during trim drag */}
                      {isActiveTrim && (
                        <Box style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.85)', borderRadius: 4, padding: '2px 8px', pointerEvents: 'none', zIndex: 10 }}>
                          <Text size="xs" c="white" style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{usToSecs(activeTrimInfo!.durationUs)}</Text>
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>

              {/* Playhead — spans ruler + clip track, extends to bottom via paddingBottom */}
              <Box style={{ position: 'absolute', left: playheadPx, top: 0, bottom: -48, width: 2, background: 'white', transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 10, boxShadow: '0 0 4px rgba(255,255,255,0.3)' }} />
              {/* Playhead circle on ruler */}
              <Box style={{ position: 'absolute', left: playheadPx, top: 20, transform: 'translateX(-50%)', width: 12, height: 12, borderRadius: '50%', background: 'white', boxShadow: '0 0 4px rgba(0,0,0,0.6)', pointerEvents: 'none', zIndex: 11 }} />
            </Box>
          </Box>
        </Box>
      )}
    </Modal>
  )
}
