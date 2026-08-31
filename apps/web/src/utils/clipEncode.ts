import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { getFFmpeg } from './ffmpegCore'

export function isWebCodecsMp4Supported(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window
}

/** H.264 codec string：≤720p 用 baseline 3.1，更高用 High 4.0 */
export function avcCodecString(width: number, height: number): string {
  return width * height > 1280 * 720 ? 'avc1.640028' : 'avc1.42001f'
}

export type Mp4ClipEncoder = {
  addBitmap: (bitmap: ImageBitmap, frameIndex: number) => void
  finish: () => Promise<Blob>
}

/** WebCodecs 硬件编码器：逐帧 addBitmap → finish 出 mp4。width/height 必须偶数。 */
export function createWebCodecsEncoder(opts: { width: number; height: number; fps: number; bitrate?: number }): Mp4ClipEncoder {
  const { width, height, fps } = opts
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  })
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })
  encoder.configure({ codec: avcCodecString(width, height), width, height, bitrate: opts.bitrate ?? 6_000_000, framerate: fps })
  return {
    addBitmap: (bitmap, frameIndex) => {
      const ts = Math.round((frameIndex / fps) * 1_000_000)
      const frame = new VideoFrame(bitmap, { timestamp: ts, duration: Math.round(1_000_000 / fps) })
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 })
      frame.close()
    },
    finish: async () => {
      await encoder.flush()
      muxer.finalize()
      const { buffer } = muxer.target as ArrayBufferTarget
      return new Blob([buffer], { type: 'video/mp4' })
    },
  }
}

/** ffmpeg.wasm 兜底命令（老浏览器：PNG 序列 → libx264 mp4） */
export function buildFfmpegEncodeArgs(fps: number, frameCount: number): string[] {
  return ['-framerate', String(fps), '-i', 'frame%05d.png', '-frames:v', String(frameCount), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', 'out.mp4']
}

async function bitmapToPngBytes(bitmap: ImageBitmap): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('2d ctx 不可用')
  ctx.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png'))
  if (!blob) throw new Error('PNG 编码失败')
  return new Uint8Array(await blob.arrayBuffer())
}

/** 兜底：把已收集的 ImageBitmap 数组用 ffmpeg.wasm 编码（仅 WebCodecs 缺失时走） */
export async function encodeBitmapsWithFfmpeg(bitmaps: ImageBitmap[], fps: number): Promise<Blob> {
  if (bitmaps.length === 0) throw new Error('无帧可编码')
  const ffmpeg = await getFFmpeg()
  const names: string[] = []
  for (let i = 0; i < bitmaps.length; i++) {
    const name = `frame${String(i).padStart(5, '0')}.png`
    await ffmpeg.writeFile(name, await bitmapToPngBytes(bitmaps[i]))
    names.push(name)
  }
  await ffmpeg.exec(buildFfmpegEncodeArgs(fps, bitmaps.length))
  const data = (await ffmpeg.readFile('out.mp4')) as Uint8Array
  for (const n of names) await ffmpeg.deleteFile(n).catch(() => {})
  await ffmpeg.deleteFile('out.mp4').catch(() => {})
  return new Blob([new Uint8Array(data)], { type: 'video/mp4' })
}
