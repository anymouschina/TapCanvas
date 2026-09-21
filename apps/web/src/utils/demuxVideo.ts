import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpegCore'

export type DemuxedVideo = {
  silentVideo: Blob | null
  audio: Blob | null
  errors: Partial<Record<'video' | 'audio', string>>
}

export type DemuxOutputs = {
  video: boolean
  audio: boolean
}

/**
 * 将已有视频拆为无声视频和独立音频文件。
 * 这是前端可验证的媒体动作：不依赖模型，也不伪造产物。
 */
export async function demuxVideo(videoUrl: string, outputs: DemuxOutputs = { video: true, audio: true }): Promise<DemuxedVideo> {
  if (!outputs.video && !outputs.audio) throw new Error('至少选择一种分离输出')
  const ffmpeg = await getFFmpeg()
  const operationId = crypto.randomUUID()
  const inputName = `demux-input-${operationId}`
  const silentName = `demux-silent-${operationId}.mp4`
  const audioName = `demux-audio-${operationId}.m4a`
  const result: DemuxedVideo = { silentVideo: null, audio: null, errors: {} }
  const filesToClean = [inputName]

  const exportTrack = async (track: 'video' | 'audio', name: string, args: string[], mimeType: string): Promise<Blob | null> => {
    filesToClean.push(name)
    try {
      const exitCode = await ffmpeg.exec(args)
      if (exitCode !== 0) throw new Error(`FFmpeg ${track === 'video' ? '画面' : '音频'}轨道导出失败（退出码 ${exitCode}）`)
      const bytes = await ffmpeg.readFile(name)
      if (typeof bytes === 'string' || bytes.byteLength === 0) throw new Error('轨道未返回有效的媒体文件')
      return new Blob([new Uint8Array(bytes)], { type: mimeType })
    } catch (error: unknown) {
      result.errors[track] = error instanceof Error ? error.message : '轨道导出失败'
      console.error('[media.demux.track_failed]', { operationId, track, message: result.errors[track] })
      return null
    }
  }

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(videoUrl))
    if (outputs.video) {
      result.silentVideo = await exportTrack('video', silentName, [
        '-i', inputName,
        '-map', '0:v:0',
        '-c', 'copy',
        '-an',
        silentName,
      ], 'video/mp4')
    }
    if (outputs.audio) {
      result.audio = await exportTrack('audio', audioName, [
        '-i', inputName,
        '-map', '0:a:0',
        '-vn',
        '-c:a', 'aac',
        '-b:a', '192k',
        audioName,
      ], 'audio/mp4')
    }

    return result
  } finally {
    for (const name of filesToClean) {
      try {
        await ffmpeg.deleteFile(name)
      } catch (error: unknown) {
        console.warn('[media.demux.cleanup_failed]', { operationId, name, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
