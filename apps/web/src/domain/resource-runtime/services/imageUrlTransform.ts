import { OBJECT_STORAGE_HOSTS, OBJECT_STORAGE_PUBLIC_BASES } from '../../../config/objectStorageAssets'

// Both configured provider origins are managed so URLs already persisted by the
// inactive provider remain readable after an explicit provider switch.

export const HOSTED_IMAGE_HOSTS: Set<string> = new Set(
  [...OBJECT_STORAGE_HOSTS, ...(import.meta.env.VITE_HOSTED_IMAGE_HOSTS ?? '')
    .split(',')
    .map((h: string) => h.trim().toLowerCase())
    .filter(Boolean)],
)

export type ImageDeliveryTransformOptions = {
  width?: number | null
  height?: number | null
  quality?: number
  fit?: 'cover' | 'contain' | 'fill' | 'scale-down' | 'crop'
}

const TOS_IMAGE_HOST = new URL(OBJECT_STORAGE_PUBLIC_BASES.tos).hostname.toLowerCase()
const TOS_TRANSFORMABLE_IMAGE_PATH = /\.(?:png|jpe?g|webp|bmp|tiff?)$/i
const MIN_TRANSFORM_WIDTH = 64
const MAX_TRANSFORM_WIDTH = 4096

function normalizeTransformWidth(width: number | null | undefined): number | null {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null
  return Math.max(MIN_TRANSFORM_WIDTH, Math.min(MAX_TRANSFORM_WIDTH, Math.round(width)))
}

function unwrapHistoricalCloudflareUrl(parsed: URL): URL {
  const match = parsed.pathname.match(/^\/cdn-cgi\/image\/[^/]+(\/.*)$/)
  if (match?.[1]) parsed.pathname = match[1]
  return parsed
}

// Canvas shells request fixed-size, WebP TOS variants so browser decode memory
// follows the displayed LOD instead of the persisted original dimensions.
// Originals stay untouched for focused editors, and non-TOS providers remain
// unchanged because no equivalent, verified transform contract exists there.
export function buildImageDeliveryUrl(url: string, opts?: ImageDeliveryTransformOptions): string {
  if (!url || !/^https?:\/\//i.test(url)) return url
  let parsed: URL
  try { parsed = new URL(url) } catch { return url }
  const normalized = unwrapHistoricalCloudflareUrl(parsed)
  const width = normalizeTransformWidth(opts?.width)
  if (
    width === null
    || normalized.hostname.toLowerCase() !== TOS_IMAGE_HOST
    || !TOS_TRANSFORMABLE_IMAGE_PATH.test(normalized.pathname)
    || normalized.searchParams.has('x-tos-process')
  ) {
    return normalized.toString()
  }
  normalized.searchParams.set('x-tos-process', `image/resize,w_${width},m_lfit/format,webp`)
  return normalized.toString()
}
