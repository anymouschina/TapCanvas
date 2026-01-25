/**
 * Lightweight browser-side video frame extractor for development/testing.
 * Works for:
 * - Local File/Blob via createObjectURL
 * - Remote MP4/WEBM with proper CORS headers
 *
 * Limitations:
 * - Cannot read HLS/DASH/DRM streams
 * - Seeks snap to nearest keyframe; timestamps are approximate
 * - Protected/unauthorized URLs will fail due to CORS
 */
export type FrameCaptureSource =
  | { type: 'file'; file: File }
  | { type: 'url'; url: string }

export type CapturedFrame = {
  time: number // seconds (requested)
  blob: Blob
  objectUrl: string
  width: number
  height: number
}

export async function captureFramesAtTimes(
  source: FrameCaptureSource,
  times: number[],
  options?: { mimeType?: string; quality?: number },
): Promise<{ frames: CapturedFrame[]; duration: number; width: number; height: number }> {
  if (!times.length) return { frames: [], duration: 0, width: 0, height: 0 }

  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  const revokeObjectUrl = source.type === 'file' ? URL.createObjectURL(source.file) : null
  video.src = source.type === 'file' ? revokeObjectUrl! : source.url

  const frames: CapturedFrame[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve()
      const onError = () => reject(new Error('Failed to load video'))
      video.addEventListener('loadedmetadata', onLoaded, { once: true })
      video.addEventListener('error', onError, { once: true })
    })

    const meta = {
      duration: video.duration || 0,
      width: video.videoWidth,
      height: video.videoHeight,
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    const mime = options?.mimeType || 'image/jpeg'
    const quality = options?.quality ?? 0.9

    for (const t of times) {
      // Clamp to duration range
      const target = Math.max(0, Math.min(t, meta.duration || t))
      await seekVideo(video, target)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode frame'))), mime, quality)
      })
      const objectUrl = URL.createObjectURL(blob)
      frames.push({ time: target, blob, objectUrl, width: canvas.width, height: canvas.height })
    }

    return { frames, duration: meta.duration, width: meta.width, height: meta.height }
  } catch (err) {
    frames.forEach((f) => {
      try {
        URL.revokeObjectURL(f.objectUrl)
      } catch {
        // ignore
      }
    })
    throw err
  } finally {
    if (revokeObjectUrl) {
      try {
        URL.revokeObjectURL(revokeObjectUrl)
      } catch {
        // ignore
      }
    }
  }
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const hasRequestVideoFrameCallback = typeof (video as any).requestVideoFrameCallback === 'function'
  const epsilon = 0.01
  const isSameTime = Math.abs((video.currentTime || 0) - time) < epsilon

  return new Promise((resolve, reject) => {
    let done = false
    const timeout = window.setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      reject(new Error('Seek timeout'))
    }, 2500)
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('error', onError)
    }
    const finish = () => {
      if (done) return
      done = true
      cleanup()
      resolve()
    }
    const onError = () => {
      if (done) return
      done = true
      cleanup()
      reject(new Error('Seek failed'))
    }
    const onLoadedData = () => {
      if (!isSameTime) return
      finish()
    }
    const onSeeked = () => {
      if (!hasRequestVideoFrameCallback) {
        finish()
        return
      }
      ;(video as any).requestVideoFrameCallback(() => {
        finish()
      })
    }

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('loadeddata', onLoadedData, { once: true })
    video.addEventListener('error', onError, { once: true })

    try {
      video.currentTime = time
    } catch {
      // keep waiting (or timeout)
    }

    // Some browsers don't fire `seeked` when seeking to the current time (e.g. 0s on first load).
    if (isSameTime) {
      if (hasRequestVideoFrameCallback) {
        ;(video as any).requestVideoFrameCallback(() => {
          finish()
        })
      } else if (video.readyState >= 2) {
        finish()
      }
    }
  })
}
