type DownloadOptions = {
  url: string
  filename?: string
  /**
   * Try fetching as Blob first to avoid opening/navigating tabs for cross-origin media links.
   * Falls back to a normal <a download> click when CORS/streaming prevents blob download.
   */
  preferBlob?: boolean
}

function guessFilenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || ''
    return last || null
  } catch {
    const parts = url.split('?')[0].split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : null
  }
}

function clickDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener noreferrer'
  // Keep in current tab; some browsers default to opening a new tab for cross-origin downloads.
  a.target = '_self'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function downloadUrl({ url, filename, preferBlob = true }: DownloadOptions) {
  const fallbackName = filename || guessFilenameFromUrl(url) || `tapcanvas-${Date.now()}`

  if (!preferBlob) {
    clickDownload(url, fallbackName)
    return
  }

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      clickDownload(objectUrl, fallbackName)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    // Fallback: best-effort direct download. If browser ignores download attr for cross-origin,
    // it may navigate; but we avoid forcing a new tab here.
    clickDownload(url, fallbackName)
  }
}

