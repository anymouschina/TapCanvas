import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpegCore'

export type DemuxedVideo = {
  silentVideo: Blob | null
  audio: Blob | null
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
  const sourceExtension = videoUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4'
  const inputName = `demux-input-${Date.now()}.${sourceExtension}`
  const silentName = `demux-silent-${Date.now()}.mp4`
  const audioName = `demux-audio-${Date.now()}.m4a`

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(videoUrl))
    if (outputs.video) {
      await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:v:0',
        '-c', 'copy',
        '-an',
        silentName,
      ])
    }
    if (outputs.audio) {
      await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:a:0',
        '-vn',
        '-c:a', 'aac',
        '-b:a', '192k',
        audioName,
      ])
    }

    const silentBytes = outputs.video ? await ffmpeg.readFile(silentName) : null
    const audioBytes = outputs.audio ? await ffmpeg.readFile(audioName) : null
    return {
      silentVideo: silentBytes === null ? null : new Blob([new Uint8Array(silentBytes as Uint8Array)], { type: 'video/mp4' }),
      audio: audioBytes === null ? null : new Blob([new Uint8Array(audioBytes as Uint8Array)], { type: 'audio/mp4' }),
    }
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined)
    await ffmpeg.deleteFile(silentName).catch(() => undefined)
    await ffmpeg.deleteFile(audioName).catch(() => undefined)
  }
}
