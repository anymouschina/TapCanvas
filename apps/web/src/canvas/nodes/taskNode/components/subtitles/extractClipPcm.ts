import type { MP4Clip } from '@webav/av-cliper'

/** @webav 全库固定采样率（与 composeVideosCore.WEBAV_SAMPLE_RATE 一致） */
export const PCM_SAMPLE_RATE = 48000
const TICK_STEP_US = 100_000

/**
 * 步进 tick 抽出整条音轨（mono，取声道 0）。
 * MP4Clip.tick 顺序调用时返回上次 tick 到本次之间的音频增量。
 * 传入的 clip 不被消耗（内部 clone / finally destroy）。
 */
export async function extractClipPcm(clip: MP4Clip): Promise<Float32Array> {
  const work = await clip.clone()
  try {
    const chunks: Float32Array[] = []
    const duration = work.meta.duration
    for (let t = 0; t <= duration; t += TICK_STEP_US) {
      const { audio, video, state } = await work.tick(t)
      video?.close()
      if (audio?.[0]?.length) chunks.push(audio[0])
      if (state === 'done') break
    }
    let total = 0
    for (const c of chunks) total += c.length
    const pcm = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      pcm.set(c, off)
      off += c.length
    }
    return pcm
  } finally {
    work.destroy()
  }
}
