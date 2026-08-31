import { FFmpeg } from '@ffmpeg/ffmpeg'

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm',
      classWorkerURL: '/ffmpeg/ffmpeg.worker.js',
    })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()
  try {
    return await loadPromise
  } catch (e) {
    loadPromise = null
    throw e
  }
}
