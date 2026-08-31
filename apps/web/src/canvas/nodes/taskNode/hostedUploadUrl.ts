import { HOSTED_IMAGE_HOSTS } from '../../../domain/resource-runtime/services/imageUrlTransform'

const API_STORAGE_PROXY_UPLOAD_PATTERN = /^\/assets\/storage\/uploads\/user\/[A-Za-z0-9_-]+\/\d{8}\/[0-9a-fA-F-]+\.[A-Za-z0-9]+$/

function parseUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed)
  } catch {
    return null
  }
}

export function isTapCanvasHostedUploadUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl)
  if (!parsed) return false
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const pathname = parsed.pathname.replace(/\/{2,}/g, '/')
  if (API_STORAGE_PROXY_UPLOAD_PATTERN.test(pathname)) return true

  return HOSTED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())
}
