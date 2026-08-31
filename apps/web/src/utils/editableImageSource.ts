export type EditableImageSource = {
  image: HTMLImageElement
  release: () => void
}

function normalizeImageUrl(rawUrl: string): string {
  const url = rawUrl.trim()
  if (!url) throw new Error('图片地址不能为空')
  return url
}

function buildEditableImageRequest(url: string): RequestInit {
  const isRemote = /^https?:\/\//i.test(url)
  return {
    method: 'GET',
    ...(isRemote ? {
      mode: 'cors' as const,
      credentials: 'omit' as const,
      // 编辑必须读取真实字节。绕过同 URL 可能已经写入的 no-cors 缓存，
      // 让 OSS/CDN 以本次 Origin 重新返回可验证的 CORS 响应。
      cache: 'reload' as const,
    } : {}),
  }
}

export async function fetchEditableImageBlob(rawUrl: string): Promise<Blob> {
  const url = normalizeImageUrl(rawUrl)
  const response = await fetch(url, buildEditableImageRequest(url))
  if (!response.ok) {
    throw new Error(`图片读取失败：HTTP ${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.trim().toLowerCase() ?? ''
  if (!contentType.startsWith('image/')) {
    throw new Error(`图片读取失败：资源类型为 ${contentType || 'unknown'}`)
  }
  return await response.blob()
}

export async function loadEditableImageSource(rawUrl: string): Promise<EditableImageSource> {
  const blob = await fetchEditableImageBlob(rawUrl)
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.decoding = 'async'
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片解码失败'))
      element.src = objectUrl
    })
    let released = false
    return {
      image,
      release: () => {
        if (released) return
        released = true
        URL.revokeObjectURL(objectUrl)
      },
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}
