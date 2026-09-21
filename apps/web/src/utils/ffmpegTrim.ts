// apps/web/src/utils/ffmpegTrim.ts
import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpegCore'

export type VideoTimeRange = Readonly<{
  start: number
  end: number
}>

function buildWorkspaceFileName(prefix: string, extension: string): string {
  const token = crypto.randomUUID().replace(/-/g, '')
  return `${prefix}-${token}.${extension}`
}

function readVideoExtension(videoUrl: string): string {
  const extension = videoUrl.split('?')[0].split('.').pop()?.toLowerCase()
  return extension === 'webm' ? 'webm' : 'mp4'
}

function readBlobFromFfmpegOutput(data: Uint8Array | string, mimeType: string): Blob {
  if (typeof data === 'string') {
    throw new Error('视频裁剪输出格式无效')
  }
  return new Blob([new Uint8Array(data)], { type: mimeType })
}

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

  const ext = readVideoExtension(videoUrl)
  const inputName = buildWorkspaceFileName('trim-input', ext)
  const outputName = buildWorkspaceFileName('trim-output', ext)

  const fileData = await fetchFile(videoUrl)
  await ffmpeg.writeFile(inputName, fileData)

  const progressHandler = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)))
    : null
  if (progressHandler) ffmpeg.on('progress', progressHandler)

  const duration = endSec - startSec
  try {
    await ffmpeg.exec([
      '-i', inputName,
      '-ss', startSec.toFixed(3),
      '-t', duration.toFixed(3),
      '-c', 'copy',
      outputName,
    ])

    const data = await ffmpeg.readFile(outputName)
    const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4'
    return readBlobFromFfmpegOutput(data, mimeType)
  } finally {
    if (progressHandler) ffmpeg.off('progress', progressHandler)
    await Promise.allSettled([
      ffmpeg.deleteFile(inputName),
      ffmpeg.deleteFile(outputName),
    ])
  }
}

/**
 * 把同一源视频中的多个时间段按时间顺序拼成一个真实参考视频。
 * 所有片段来自同一编码源，先无损切片再 concat，避免为重拍参考引入二次画质损失。
 */
export async function sliceVideoRanges(
  videoUrl: string,
  ranges: readonly VideoTimeRange[],
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (ranges.length === 0) throw new Error('至少需要一个有效片段')
  if (ranges.length === 1) {
    const [range] = ranges
    if (!range) throw new Error('片段范围无效')
    return await sliceVideo(videoUrl, range.start, range.end, onProgress)
  }

  const ffmpeg = await getFFmpeg()
  const ext = readVideoExtension(videoUrl)
  const token = crypto.randomUUID().replace(/-/g, '')
  const inputName = `remake-input-${token}.${ext}`
  const concatName = `remake-concat-${token}.txt`
  const outputName = `remake-output-${token}.${ext}`
  const partNames = ranges.map((_, index) => `remake-part-${token}-${index}.${ext}`)
  const cleanupNames = [inputName, concatName, outputName, ...partNames]
  const progressHandler = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)))
    : null

  await ffmpeg.writeFile(inputName, await fetchFile(videoUrl))
  if (progressHandler) ffmpeg.on('progress', progressHandler)

  try {
    for (const [index, range] of ranges.entries()) {
      const duration = range.end - range.start
      if (!Number.isFinite(range.start) || !Number.isFinite(duration) || range.start < 0 || duration <= 0) {
        throw new Error(`第 ${index + 1} 个片段范围无效`)
      }
      const partName = partNames[index]
      if (!partName) throw new Error(`第 ${index + 1} 个片段文件名无效`)
      await ffmpeg.exec([
        '-i', inputName,
        '-ss', range.start.toFixed(3),
        '-t', duration.toFixed(3),
        '-c', 'copy',
        partName,
      ])
    }

    const concatList = partNames.map((partName) => `file '${partName}'`).join('\n')
    await ffmpeg.writeFile(concatName, new TextEncoder().encode(concatList))
    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatName,
      '-c', 'copy',
      outputName,
    ])

    const data = await ffmpeg.readFile(outputName)
    const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4'
    return readBlobFromFfmpegOutput(data, mimeType)
  } finally {
    if (progressHandler) ffmpeg.off('progress', progressHandler)
    await Promise.allSettled(cleanupNames.map((fileName) => ffmpeg.deleteFile(fileName)))
  }
}
