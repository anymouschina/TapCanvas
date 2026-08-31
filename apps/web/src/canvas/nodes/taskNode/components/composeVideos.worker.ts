/// <reference lib="webworker" />
/**
 * 视频合成 Web Worker：把 @webav 的逐帧解码/合成/编码整个搬离主线程，
 * 画布 UI 在合成期间不再卡顿。协议见 composeVideosCore 的
 * ComposeWorkerInbound / ComposeWorkerOutbound。
 *
 * 音频轨由主线程预解码成 48kHz PCM 传入（Worker 里没有
 * AudioContext.decodeAudioData）；视频片段在 Worker 内直接 fetch + WebCodecs 解码。
 */
import {
  composeVideosToBlobInline,
  type ComposeWorkerInbound,
  type ComposeWorkerOutbound,
} from './composeVideosCore'

const scope = self as unknown as DedicatedWorkerGlobalScope

function post(msg: ComposeWorkerOutbound): void {
  scope.postMessage(msg)
}

let controller: AbortController | null = null

scope.onmessage = async (e: MessageEvent<ComposeWorkerInbound>) => {
  const msg = e.data
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'cancel') {
    controller?.abort()
    return
  }
  if (msg.type !== 'start') return

  // WebCodecs / OffscreenCanvas 不可用（老浏览器）→ 让主线程回退内联合成
  if (typeof VideoEncoder !== 'function' || typeof OffscreenCanvas !== 'function') {
    post({ type: 'unsupported' })
    return
  }

  controller = new AbortController()
  try {
    const blob = await composeVideosToBlobInline(msg.sources, {
      signal: controller.signal,
      onPhase: (phase) => post({ type: 'phase', value: phase }),
      onProgress: (p) => post({ type: 'progress', value: p }),
      audioTracks: msg.audioTracks,
      subtitles: msg.subtitles,
    })
    post({ type: 'done', blob })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
