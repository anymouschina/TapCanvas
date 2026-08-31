import { AudioClip, EmbedSubtitlesClip, MP4Clip, OffscreenSprite, Combinator } from '@webav/av-cliper'
import { fetchClip } from './reliableClipFetch'
import { SUBTITLE_FONT_RATIO, SUBTITLE_BOTTOM_OFFSET_RATIO, SUBTITLE_MIN_FONT_PX, type SubtitleFontSizeTier } from './subtitles/types'

export type ComposeVideoSource = {
  url: string
  title?: string
  thumbnailUrl?: string
  durationSec?: number
  trimStart?: number  // microseconds to skip at beginning
  trimEnd?: number    // microseconds to skip at end
  /** 上游 clip 节点的 prompt 原文（含 @角色：「台词」行），字幕提取用 */
  dialoguePrompt?: string
}

export type ComposeAudioTrack = {
  url: string
  /** 0~2，默认 1 */
  volume?: number
  /** BGM 短于成片时循环铺底，默认 false（配音语义） */
  loop?: boolean
  title?: string
}

/**
 * 已在主线程预解码为 PCM 的音频轨（Worker 内没有 AudioContext.decodeAudioData，
 * AudioClip 从字节流解码走不通；但它接受 Float32Array[] 直接构造）。
 * 采样率必须是 48000（@webav DEFAULT_AUDIO_CONF.sampleRate）。
 */
export type PreparedAudioTrack = {
  pcm: Float32Array[]
  volume?: number
  loop?: boolean
  title?: string
}

/** 烧录字幕输入：全局时间线（µs），调用方负责已按 start 排序、互不重叠 */
export type ComposeSubtitlesInput = {
  segments: Array<{ startUs: number; endUs: number; text: string }>
  fontSize: SubtitleFontSizeTier
}

export type ComposePhase =
  | 'preparing'
  | 'loading_media'
  | 'parsing_media'
  | 'initializing_encoder'
  | 'encoding'

export type ComposeOptions = {
  signal?: AbortSignal
  onProgress?: (progress: number) => void
  onPhase?: (phase: ComposePhase) => void
  audioTracks?: ComposeAudioTrack[]
  subtitles?: ComposeSubtitlesInput
}

type WorkerStartMessage = {
  type: 'start'
  sources: ComposeVideoSource[]
  audioTracks: PreparedAudioTrack[]
  subtitles?: ComposeSubtitlesInput
}

export type ComposeWorkerInbound = WorkerStartMessage | { type: 'cancel' }

export type ComposeWorkerOutbound =
  | { type: 'phase'; value: ComposePhase }
  | { type: 'progress'; value: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string }
  /** worker 环境缺 WebCodecs/OffscreenCanvas，主线程应回退内联合成 */
  | { type: 'unsupported' }

/** @webav 全库固定的音频采样率（DEFAULT_AUDIO_CONF.sampleRate）。 */
export const WEBAV_SAMPLE_RATE = 48000

/**
 * EmbedSubtitlesClip 样式：白字黑描边+阴影（库默认），字号/边距按视频高换算。
 * 注意：EmbedSubtitlesClip 传数组时 start/end 单位是微秒。
 */
export function buildEmbedSubtitleOpts(
  videoWidth: number,
  videoHeight: number,
  tier: SubtitleFontSizeTier,
) {
  return {
    videoWidth,
    videoHeight,
    fontSize: Math.max(SUBTITLE_MIN_FONT_PX, Math.round(videoHeight * SUBTITLE_FONT_RATIO[tier])),
    fontFamily: 'sans-serif',
    color: '#FFF',
    strokeStyle: '#000',
    bottomOffset: Math.round(videoHeight * SUBTITLE_BOTTOM_OFFSET_RATIO),
  }
}

/**
 * 内联（当前线程）合成实现：把多个视频片段按顺序拼接成一个 MP4 Blob。
 * 不依赖 React / DOM，可在 Web Worker 与 DAG runner 等上下文中调用。
 *
 * 片段与音频轨全部并行加载（此前是逐个串行 await，N 段就要排 N 趟网络往返）。
 *
 * audioTracks：上游音频节点的配音/BGM 轨，从 0 时刻起与视频混音，
 * 时长钉成片总长（音频更长则截断，loop=true 时循环铺满）。支持 url
 * （本线程解码）或预解码 PCM（Worker 场景）。
 *
 * @throws 视频数量 < 1 时抛出；AbortSignal 触发时抛出；加载/拼接失败时抛出
 */
export async function composeVideosToBlobInline(
  sources: ComposeVideoSource[],
  options?: Omit<ComposeOptions, 'audioTracks'> & {
    audioTracks?: Array<ComposeAudioTrack | PreparedAudioTrack>
  },
): Promise<Blob> {
  if (sources.length < 1) {
    throw new Error('至少需要 1 个视频才能剪辑')
  }

  const signal = options?.signal
  const onProgress = options?.onProgress
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error('合成已取消')
  }

  // 主体 clips（按 sources 顺序一一对应；构造即登记，失败路径也能清理）
  const clips: Array<MP4Clip | null> = new Array(sources.length).fill(null)
  // split 产生的 after clips，仅用于 finally 清理，不参与迭代
  const extraClips: MP4Clip[] = []
  const audioClips: AudioClip[] = []
  let subtitlesClip: EmbedSubtitlesClip | null = null

  try {
    options?.onPhase?.('loading_media')
    // 视频片段与音频轨并行加载/解析
    const audioTrackDefs = options?.audioTracks || []
    const [, preparedAudio] = await Promise.all([
      Promise.all(
        sources.map(async (v, i) => {
          throwIfAborted()
          const res = await fetchClip(v.url, { signal })
          if (!res.body) throw new Error(`无法加载视频：${v.title || v.url}`)
          const clip = new MP4Clip(res.body)
          clips[i] = clip
          await clip.ready
        }),
      ),
      Promise.all(
        audioTrackDefs.map(async (track) => {
          throwIfAborted()
          const volume =
            typeof track.volume === 'number' ? Math.min(2, Math.max(0, track.volume)) : 1
          const opts = { volume, loop: track.loop === true }
          let clip: AudioClip
          if ('pcm' in track) {
            clip = new AudioClip(track.pcm, opts)
          } else {
            const res = await fetchClip(track.url, { signal })
            if (!res.body) throw new Error(`无法加载音频：${track.title || track.url}`)
            clip = new AudioClip(res.body, opts)
          }
          audioClips.push(clip)
          await clip.ready
          return clip
        }),
      ),
    ])

    throwIfAborted()
    options?.onPhase?.('parsing_media')

    const first = clips[0] as MP4Clip
    const { width, height } = first.meta

    let offset = 0
    const sprites: OffscreenSprite[] = []

    for (let i = 0; i < sources.length; i++) {
      const clip = clips[i] as MP4Clip
      const src = sources[i]
      const trimStart = src.trimStart ?? 0
      const trimEnd = src.trimEnd ?? 0
      const originalDuration = clip.meta.duration
      const usedDuration = Math.max(0, originalDuration - trimStart - trimEnd)
      if (usedDuration <= 0) continue

      let workClip: MP4Clip = clip
      if (trimStart > 0) {
        const [, after] = await clip.split(trimStart)
        extraClips.push(after)
        workClip = after
      }

      const spr = new OffscreenSprite(workClip)
      spr.time = { offset, duration: usedDuration }
      spr.rect.w = width
      spr.rect.h = height
      offset += usedDuration
      sprites.push(spr)
    }

    options?.onPhase?.('initializing_encoder')
    const combinator = new Combinator({ width, height })
    combinator.on('OutputProgress', (p: number) => {
      onProgress?.(Math.round(p * 100))
    })

    for (const spr of sprites) {
      await combinator.addSprite(spr)
    }

    const totalDuration = offset

    // 字幕烧录：单个 EmbedSubtitlesClip sprite 盖在最上层（后 add 的在上）
    const subs = options?.subtitles
    if (subs && subs.segments.length > 0) {
      const clipped = subs.segments
        .map((s) => ({ start: s.startUs, end: Math.min(s.endUs, totalDuration), text: s.text }))
        .filter((s) => s.start < totalDuration && s.end - s.start > 0)
        .sort((a, b) => a.start - b.start)
      if (clipped.length > 0) {
        subtitlesClip = new EmbedSubtitlesClip(
          clipped,
          buildEmbedSubtitleOpts(width, height, subs.fontSize),
        )
        const subSprite = new OffscreenSprite(subtitlesClip)
        subSprite.time = { offset: 0, duration: clipped[clipped.length - 1].end }
        await combinator.addSprite(subSprite)
      }
    }

    // 上游音频节点的配音/BGM 轨：从 0 时刻混入，时长钉成片总长。
    for (const audioClip of preparedAudio) {
      if (signal?.aborted) {
        combinator.destroy()
        throw new Error('合成已取消')
      }
      const audioSprite = new OffscreenSprite(audioClip)
      audioSprite.time = { offset: 0, duration: totalDuration }
      await combinator.addSprite(audioSprite)
    }

    if (signal?.aborted) {
      combinator.destroy()
      throw new Error('合成已取消')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[] = []
    options?.onPhase?.('encoding')
    const reader = combinator.output().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }

    combinator.destroy()
    return new Blob(chunks, { type: 'video/mp4' })
  } finally {
    clips.forEach((c) => c?.destroy())
    extraClips.forEach((c) => c.destroy())
    audioClips.forEach((c) => c.destroy())
    subtitlesClip?.destroy()
  }
}

/** 主线程把音频轨字节解码成 48kHz PCM，供 Worker 内 AudioClip 直接构造。 */
async function prepareAudioTracks(
  tracks: ComposeAudioTrack[],
  signal?: AbortSignal,
): Promise<PreparedAudioTrack[]> {
  return Promise.all(
    tracks.map(async (track) => {
      const res = await fetchClip(track.url, { signal })
      const bytes = await res.arrayBuffer()
      // OfflineAudioContext.decodeAudioData 会重采样到 context 采样率
      const ctx = new OfflineAudioContext(2, WEBAV_SAMPLE_RATE, WEBAV_SAMPLE_RATE)
      const buf = await ctx.decodeAudioData(bytes)
      const pcm: Float32Array[] = []
      for (let ch = 0; ch < Math.min(2, buf.numberOfChannels); ch += 1) {
        pcm.push(buf.getChannelData(ch))
      }
      return { pcm, volume: track.volume, loop: track.loop, title: track.title }
    }),
  )
}

class WorkerComposeUnsupportedError extends Error {}

function composeInWorker(
  sources: ComposeVideoSource[],
  audioTracks: PreparedAudioTrack[],
  options?: ComposeOptions,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./composeVideos.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch (err) {
      reject(new WorkerComposeUnsupportedError(String(err)))
      return
    }
    const signal = options?.signal
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('合成已取消'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (e: MessageEvent<ComposeWorkerOutbound>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        options?.onProgress?.(msg.value)
      } else if (msg.type === 'phase') {
        options?.onPhase?.(msg.value)
      } else if (msg.type === 'done') {
        cleanup()
        resolve(msg.blob)
      } else if (msg.type === 'error') {
        cleanup()
        reject(new Error(msg.message))
      } else if (msg.type === 'unsupported') {
        cleanup()
        reject(new WorkerComposeUnsupportedError('worker lacks WebCodecs'))
      }
    }
    // worker 脚本本身加载失败（打包/环境问题）→ 回退内联
    worker.onerror = () => {
      cleanup()
      reject(new WorkerComposeUnsupportedError('worker failed to load'))
    }
    worker.onmessageerror = () => {
      cleanup()
      reject(new Error('视频合成 Worker 响应无法解析'))
    }

    const start: WorkerStartMessage = { type: 'start', sources, audioTracks, subtitles: options?.subtitles }
    worker.postMessage(
      start,
      audioTracks.flatMap((t) => t.pcm.map((a) => a.buffer)),
    )
  })
}

/**
 * 合成入口（对外 API 不变）：优先在 Web Worker 里合成——逐帧解码/合成/编码
 * 不再占用主线程，画布交互不卡；Worker 不可用（环境缺 WebCodecs、脚本加载
 * 失败等）时回退到当前线程内联合成。真实合成错误（片段损坏等）不做回退，
 * 直接抛给调用方。
 */
export async function composeVideosToBlob(
  sources: ComposeVideoSource[],
  options?: ComposeOptions,
): Promise<Blob> {
  if (sources.length < 1) {
    throw new Error('至少需要 1 个视频才能剪辑')
  }
  const signal = options?.signal
  options?.onPhase?.('preparing')
  const hasAudioTracks = (options?.audioTracks?.length ?? 0) > 0
  // 音频轨需要主线程预解码（OfflineAudioContext）；纯视频拼接只要有 Worker 就走
  if (
    typeof Worker === 'function' &&
    (!hasAudioTracks || typeof OfflineAudioContext === 'function')
  ) {
    try {
      const prepared = await prepareAudioTracks(options?.audioTracks || [], signal)
      return await composeInWorker(sources, prepared, options)
    } catch (err) {
      if (!(err instanceof WorkerComposeUnsupportedError)) throw err
      // 回退内联
    }
  }
  return composeVideosToBlobInline(sources, options)
}
