type DownloadOptions = {
  url: string
  filename?: string
  /**
   * Try fetching as Blob first to avoid opening/navigating tabs for cross-origin media links.
   * Falls back to a normal <a download> click when CORS/streaming prevents blob download.
   */
  preferBlob?: boolean
  /**
   * Target for the fallback <a> click if blob download fails.
   * Defaults to opening a new tab to avoid losing unsaved work.
   */
  fallbackTarget?: '_blank' | '_self'
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

function clickDownload(href: string, filename: string, target: '_blank' | '_self' = '_self') {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener noreferrer'
  a.target = target
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function downloadUrl({
  url,
  filename,
  preferBlob = true,
  fallbackTarget = '_blank',
}: DownloadOptions) {
  const fallbackName = filename || guessFilenameFromUrl(url) || `tapcanvas-${Date.now()}`

  if (!preferBlob) {
    clickDownload(url, fallbackName, fallbackTarget)
    return
  }

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      clickDownload(objectUrl, fallbackName, '_self')
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    // Fallback: best-effort direct download. If browser ignores download attr for cross-origin,
    // it may navigate; open a new tab by default to preserve the current page.
    clickDownload(url, fallbackName, fallbackTarget)
  }
}
