import { collectPublicFlowAnchorBindingImageUrls } from '@tapcanvas/flow-anchor-bindings'

type AssetInputLike = {
  url?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRemoteUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : ''
}

function uniqueUrls(items: string[], limit: number): string[] {
  const maxItems = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0
  if (maxItems === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const normalized = readRemoteUrl(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= maxItems) break
  }
  return out
}

function normalizeReferenceImageUrls(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return uniqueUrls(
    value
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean),
    limit,
  )
}

function normalizeAssetInputUrls(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const candidates: string[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const url = readRemoteUrl((item as AssetInputLike).url)
    if (!url) continue
    candidates.push(url)
    if (candidates.length >= limit) break
  }
  return uniqueUrls(candidates, limit)
}

export function collectNodeReferenceImageUrls(nodeData: unknown, limit = 8): string[] {
  if (!isRecord(nodeData)) return []
  return uniqueUrls(
    [
      ...normalizeReferenceImageUrls(nodeData.referenceImages, limit),
      ...collectPublicFlowAnchorBindingImageUrls(nodeData.anchorBindings, limit),
      ...normalizeReferenceImageUrls(nodeData.roleCardReferenceImages, limit),
      ...normalizeAssetInputUrls(nodeData.assetInputs, limit),
    ],
    limit,
  )
}

export function readNodeFirstFrameUrl(nodeData: unknown): string {
  if (!isRecord(nodeData)) return ''
  return readRemoteUrl(nodeData.firstFrameUrl) || readRemoteUrl(nodeData.veoFirstFrameUrl)
}

export function readNodeLastFrameUrl(nodeData: unknown): string {
  if (!isRecord(nodeData)) return ''
  return readRemoteUrl(nodeData.lastFrameUrl) || readRemoteUrl(nodeData.veoLastFrameUrl)
}
