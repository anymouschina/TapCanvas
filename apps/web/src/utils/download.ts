import { fetchAssetDownloadBlob } from '../api/server'

type DownloadOptions = {
  url: string
  filename?: string
  /**
   * Try fetching as Blob first to avoid opening/navigating tabs for cross-origin media links.
   * Set false only for same-origin / blob: URLs where a plain <a download> click is guaranteed
   * to download directly (e.g. cached object URLs).
   */
  preferBlob?: boolean
  /**
   * Target for the <a> click when preferBlob=false. The blob path never opens tabs:
   * it downloads via blob: URL or throws so callers can surface the error.
   */
  fallbackTarget?: '_blank' | '_self'
  /**
   * Same-origin proxy that fetches the asset bytes server-side and returns them as a Blob.
   * Used when the direct cross-origin blob fetch fails (e.g. the asset host lacks CORS headers,
   * which would otherwise make <a download> open a new preview tab instead of downloading).
   * The proxy response is same-origin, so the resulting blob: download is guaranteed to be direct.
   * Defaults to the /public/asset-download proxy so every download button stays in-tab.
   */
  proxyBlob?: (url: string) => Promise<Blob>
}

export function appendDownloadSuffix(filename: string, suffix: string | number): string {
  const trimmed = String(filename || '').trim()
  const normalizedSuffix = String(suffix || '').trim()
  if (!trimmed || !normalizedSuffix) return trimmed

  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const dotIndex = trimmed.lastIndexOf('.')
  const hasExtension = dotIndex > slashIndex && dotIndex < trimmed.length - 1

  if (!hasExtension) {
    return `${trimmed}-${normalizedSuffix}`
  }

  return `${trimmed.slice(0, dotIndex)}-${normalizedSuffix}${trimmed.slice(dotIndex)}`
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

/**
 * Aliyun OSS object URLs used by the business API are returned with
 * `Content-Disposition: attachment`. Navigating to such a URL is the native
 * download path and does not require CORS permission. Trying to fetch the
 * bytes first is both unnecessary and unreliable when the API-side proxy is
 * not deployed on an older business-api instance.
 */
function isAliyunObjectAttachmentUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase()
    return hostname.endsWith('.oss-accelerate.aliyuncs.com')
      || /\.oss-cn-[a-z0-9-]+\.aliyuncs\.com$/.test(hostname)
  } catch {
    return false
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    clickDownload(objectUrl, filename, '_self')
  } finally {
    // Defer revoke so the browser has grabbed the blob before we release it.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  }
}

export async function downloadUrl({
  url,
  filename,
  preferBlob = true,
  fallbackTarget = '_self',
  proxyBlob = fetchAssetDownloadBlob,
}: DownloadOptions) {
  const fallbackName = filename || guessFilenameFromUrl(url) || `tapcanvas-${Date.now()}`

  // The production business API currently returns OSS URLs directly and does
  // not expose the newer same-origin asset proxy route. These objects carry
  // `Content-Disposition: attachment`, so navigate directly and let OSS
  // perform the download instead of issuing a CORS-protected fetch first.
  if (preferBlob && isAliyunObjectAttachmentUrl(url)) {
    clickDownload(url, fallbackName, fallbackTarget)
    return
  }

  if (!preferBlob) {
    clickDownload(url, fallbackName, fallbackTarget)
    return
  }

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    downloadBlob(await res.blob(), fallbackName)
    return
  } catch {
    // Direct cross-origin fetch failed — most often the asset host lacks CORS headers.
  }

  // Route through the same-origin proxy (guaranteed CORS + bytes) so the download stays a
  // real download instead of degrading to a new-tab preview.
  try {
    downloadBlob(await proxyBlob(url), fallbackName)
    return
  } catch {
    // Proxy unavailable/failed as well — nothing left that can download in-tab.
  }

  // Both the direct fetch and the same-origin proxy failed (API down / offline). Opening the
  // raw URL would just show a preview tab, so surface the failure to the caller instead.
  throw new Error('下载失败，请稍后重试')
}
