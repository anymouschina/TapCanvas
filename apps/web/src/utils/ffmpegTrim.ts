// apps/web/src/utils/ffmpegTrim.ts
import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpegCore'

/**
 * 从视频 URL 裁剪片段 [startSec, endSec)，返回 Blob。
 * 使用 -c copy 快速裁剪，不重新编码。
 */
export async function sliceVideo(
  videoUrl: string,
  startSec: number,
  endSec: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ffmpeg = await getFFmpeg()

  const ext = videoUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4'
  const inputName = `in.${ext}`
  const outputName = `out.${ext}`

  const fileData = await fetchFile(videoUrl)
  await ffmpeg.writeFile(inputName, fileData)

  const progressHandler = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)))
    : null
  if (progressHandler) ffmpeg.on('progress', progressHandler)

  const duration = endSec - startSec
  await ffmpeg.exec([
    '-i', inputName,
    '-ss', startSec.toFixed(3),
    '-t', duration.toFixed(3),
    '-c', 'copy',
    outputName,
  ])

  if (progressHandler) ffmpeg.off('progress', progressHandler)

  const data = await ffmpeg.readFile(outputName) as Uint8Array
  await ffmpeg.deleteFile(inputName)
  await ffmpeg.deleteFile(outputName)

  const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4'
  return new Blob([new Uint8Array(data)], { type: mimeType })
}
