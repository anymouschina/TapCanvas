export function extractFirstFrame(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null)
      return
    }

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.src = url

    const cleanup = () => {
      try {
        video.pause()
      } catch {
        // ignore
      }
      video.removeAttribute('src')
      video.load()
      video.remove()
    }

    const handleError = () => {
      cleanup()
      resolve(null)
    }

    video.onerror = handleError

    const handleLoadedData = () => {
      try {
        const width = video.videoWidth || 640
        const height = video.videoHeight || 360
        const canvas = document.createElement('canvas')
        // 控制缩略图尺寸，避免过大
        const targetWidth = 480
        const ratio = width > 0 ? targetWidth / width : 1
        canvas.width = targetWidth
        canvas.height = Math.round((height || 270) * ratio)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          cleanup()
          resolve(null)
          return
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/webp', 0.8)
        cleanup()
        resolve(dataUrl || null)
      } catch (err) {
        console.warn('[videoThumb] failed to extract frame', err)
        cleanup()
        resolve(null)
      }
    }

    // 优先使用 loadeddata，确保首帧可用
    video.onloadeddata = handleLoadedData
  })
}

