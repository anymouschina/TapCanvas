import type { Node as FlowNode } from '@xyflow/react'

import { downloadUrl } from '../../utils/download'
import { fetchAssetDownloadBlob } from '../../api/server'
import { getTaskNodeCoreType } from '../nodes/taskNodeSchema'

export type GroupDownloadableMediaType = 'image' | 'video' | 'audio'

export type GroupDownloadAsset = {
  nodeId: string
  nodeLabel: string
  mediaType: GroupDownloadableMediaType
  url: string
  filename: string
}

type UnknownNodeData = Record<string, unknown>

type CollectGroupAssetsParams = {
  nodes: FlowNode[]
  groupId: string
}

type DownloadGroupAssetsParams = CollectGroupAssetsParams & {
  groupLabel?: string
  maxDownloads?: number
}

const DEFAULT_MAX_DOWNLOADS = 30

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function guessExtFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || ''
    const dot = last.lastIndexOf('.')
    if (dot <= 0 || dot === last.length - 1) return null
    const ext = last.slice(dot + 1).toLowerCase()
    if (!/^[a-z0-9]{1,8}$/.test(ext)) return null
    return ext
  } catch {
    const path = url.split('?')[0]
    const last = path.split('/').filter(Boolean).pop() || ''
    const dot = last.lastIndexOf('.')
    if (dot <= 0 || dot === last.length - 1) return null
    const ext = last.slice(dot + 1).toLowerCase()
    if (!/^[a-z0-9]{1,8}$/.test(ext)) return null
    return ext
  }
}

function sanitizeFilenamePart(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'untitled'
  const replaced = trimmed
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
  return replaced || 'untitled'
}

function pickPrimaryImageUrl(data: UnknownNodeData): string | null {
  const direct = normalizeString(data.imageUrl)
  if (direct) return direct

  const resultsRaw = data.imageResults
  const results = Array.isArray(resultsRaw) ? resultsRaw : []
  const idxRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.floor(idxRaw)) : 0

  const preferred = results[idx]
  if (preferred && typeof preferred === 'object') {
    const preferredUrl = normalizeString((preferred as { url?: unknown }).url)
    if (preferredUrl) return preferredUrl
  }

  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    const url = normalizeString((item as { url?: unknown }).url)
    if (url) return url
  }

  return null
}

function pickPrimaryVideoUrl(data: UnknownNodeData): string | null {
  const direct = normalizeString(data.videoUrl)
  if (direct) return direct

  const resultsRaw = data.videoResults
  const results = Array.isArray(resultsRaw) ? resultsRaw : []
  const idxRaw = typeof data.videoPrimaryIndex === 'number' ? data.videoPrimaryIndex : Number(data.videoPrimaryIndex)
  const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.floor(idxRaw)) : 0

  const preferred = results[idx]
  if (preferred && typeof preferred === 'object') {
    const preferredUrl = normalizeString((preferred as { url?: unknown }).url)
    if (preferredUrl) return preferredUrl
  }

  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    const url = normalizeString((item as { url?: unknown }).url)
    if (url) return url
  }

  return null
}

function pickPrimaryAudioUrl(data: UnknownNodeData): string | null {
  const direct = normalizeString(data.audioUrl)
  return direct || null
}

function pickPrimaryMedia(data: UnknownNodeData): { mediaType: GroupDownloadableMediaType; url: string } | null {
  const kind = normalizeString(data.kind)
  const coreType = getTaskNodeCoreType(kind)

  const imageUrl = pickPrimaryImageUrl(data)
  const videoUrl = pickPrimaryVideoUrl(data)
  const audioUrl = pickPrimaryAudioUrl(data)

  if (coreType === 'image' || coreType === 'storyboard') {
    if (imageUrl) return { mediaType: 'image', url: imageUrl }
    if (videoUrl) return { mediaType: 'video', url: videoUrl }
    if (audioUrl) return { mediaType: 'audio', url: audioUrl }
    return null
  }

  if (coreType === 'video') {
    if (videoUrl) return { mediaType: 'video', url: videoUrl }
    if (imageUrl) return { mediaType: 'image', url: imageUrl }
    if (audioUrl) return { mediaType: 'audio', url: audioUrl }
    return null
  }

  if (coreType === 'audio') {
    if (audioUrl) return { mediaType: 'audio', url: audioUrl }
    if (videoUrl) return { mediaType: 'video', url: videoUrl }
    if (imageUrl) return { mediaType: 'image', url: imageUrl }
    return null
  }

  if (imageUrl) return { mediaType: 'image', url: imageUrl }
  if (videoUrl) return { mediaType: 'video', url: videoUrl }
  if (audioUrl) return { mediaType: 'audio', url: audioUrl }
  return null
}

function getNodeLabel(node: FlowNode): string {
  const data = node.data
  if (!data || typeof data !== 'object') return String(node.id)
  const label = normalizeString((data as UnknownNodeData).label)
  return label || String(node.id)
}

function getNodeParentId(node: FlowNode): string | null {
  const pid = normalizeString(node.parentId)
  return pid || null
}

type NodeRect = { x: number; y: number; width: number; height: number }

function positiveSize(value: unknown): number | null {
  const size = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(size) && size > 0 ? size : null
}

function getNodeRect(node: FlowNode, nodeById: ReadonlyMap<string, FlowNode>): NodeRect | null {
  let x = node.position.x
  let y = node.position.y
  const visited = new Set<string>([node.id])
  let parentId = getNodeParentId(node)
  while (parentId) {
    if (visited.has(parentId)) return null
    visited.add(parentId)
    const parent = nodeById.get(parentId)
    if (!parent) return null
    x += parent.position.x
    y += parent.position.y
    parentId = getNodeParentId(parent)
  }
  const data = node.data && typeof node.data === 'object' ? node.data as UnknownNodeData : {}
  const width = positiveSize(node.measured?.width ?? node.style?.width ?? data.nodeWidth)
  const height = positiveSize(node.measured?.height ?? node.style?.height ?? data.nodeHeight)
  if (!Number.isFinite(x) || !Number.isFinite(y) || width === null || height === null) return null
  return { x, y, width, height }
}

function findVisualGroupAssets(nodes: FlowNode[], groupId: string): FlowNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const groups = nodes.filter((node) => node.type === 'groupNode')
    .flatMap((node) => {
      const rect = getNodeRect(node, nodeById)
      return rect ? [{ id: node.id, rect, area: rect.width * rect.height }] : []
    })
  if (!groups.some((group) => group.id === groupId)) return []

  return nodes.filter((node) => {
    if (node.type !== 'taskNode' || getNodeParentId(node)) return false
    const rect = getNodeRect(node, nodeById)
    if (!rect) return false
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    const containing = groups
      .filter((group) => centerX >= group.rect.x && centerX <= group.rect.x + group.rect.width
        && centerY >= group.rect.y && centerY <= group.rect.y + group.rect.height)
      .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id))
    return containing[0]?.id === groupId
  })
}

function buildFilenameBase(asset: Omit<GroupDownloadAsset, 'filename'>): string {
  const baseLabel = sanitizeFilenamePart(asset.nodeLabel)
  const ext = guessExtFromUrl(asset.url)
  const typeSuffix = asset.mediaType
  const inferredExt =
    ext ??
    (asset.mediaType === 'image' ? 'png' : asset.mediaType === 'video' ? 'mp4' : asset.mediaType === 'audio' ? 'mp3' : 'bin')
  return `${baseLabel}-${typeSuffix}.${inferredExt}`
}

function ensureUniqueFilenames(assets: Array<Omit<GroupDownloadAsset, 'filename'>>): GroupDownloadAsset[] {
  const used = new Map<string, number>()
  return assets.map((asset) => {
    const raw = buildFilenameBase(asset)
    const prev = used.get(raw) ?? 0
    used.set(raw, prev + 1)
    if (prev === 0) {
      return { ...asset, filename: raw }
    }
    const dot = raw.lastIndexOf('.')
    const withIndex =
      dot > 0 ? `${raw.slice(0, dot)}-${prev + 1}${raw.slice(dot)}` : `${raw}-${prev + 1}`
    return { ...asset, filename: withIndex }
  })
}

export function collectGroupAssetsForDownload({ nodes, groupId }: CollectGroupAssetsParams): GroupDownloadAsset[] {
  const trimmedGroupId = groupId.trim()
  if (!trimmedGroupId) return []

  const assets: Array<Omit<GroupDownloadAsset, 'filename'>> = []
  const groupQueue: string[] = [trimmedGroupId]
  const visitedGroups = new Set<string>()
  let hasStructuralChildren = false

  while (groupQueue.length) {
    const currentGroupId = groupQueue.shift()
    if (!currentGroupId || visitedGroups.has(currentGroupId)) continue
    visitedGroups.add(currentGroupId)

    for (const node of nodes) {
      if (getNodeParentId(node) !== currentGroupId) continue
      hasStructuralChildren = true
      if (node.type === 'groupNode') {
        groupQueue.push(String(node.id))
        continue
      }
      if (node.type !== 'taskNode') continue

      const data = node.data && typeof node.data === 'object' ? (node.data as UnknownNodeData) : {}
      const primary = pickPrimaryMedia(data)
      if (!primary) continue

      assets.push({
        nodeId: String(node.id),
        nodeLabel: getNodeLabel(node),
        mediaType: primary.mediaType,
        url: primary.url,
      })
    }
  }

  // A visible group can contain cards whose positions are inside its rectangle
  // even when they have no parentId. Structural membership takes precedence.
  if (!hasStructuralChildren) {
    for (const node of findVisualGroupAssets(nodes, trimmedGroupId)) {
      const data = node.data && typeof node.data === 'object' ? node.data as UnknownNodeData : {}
      const primary = pickPrimaryMedia(data)
      if (!primary) continue
      assets.push({
        nodeId: String(node.id),
        nodeLabel: getNodeLabel(node),
        mediaType: primary.mediaType,
        url: primary.url,
      })
    }
  }

  return ensureUniqueFilenames(assets)
}

export async function downloadGroupAssets({
  nodes,
  groupId,
  groupLabel,
  maxDownloads = DEFAULT_MAX_DOWNLOADS,
}: DownloadGroupAssetsParams): Promise<{ total: number; attempted: number }> {
  const assets = collectGroupAssetsForDownload({ nodes, groupId })
  if (assets.length === 0) {
    throw new Error('组内没有可下载的素材（图片/视频/音频）')
  }
  if (!Number.isFinite(maxDownloads) || maxDownloads <= 0) {
    throw new Error('maxDownloads 必须为正数')
  }
  if (assets.length > maxDownloads) {
    throw new Error(`组内素材过多（${assets.length} 个）。请拆分分组后重试（上限 ${maxDownloads} 个）。`)
  }

  const groupPrefix = sanitizeFilenamePart(groupLabel || 'group')
  for (const asset of assets) {
    // eslint-disable-next-line no-await-in-loop
    await downloadUrl({
      url: asset.url,
      filename: `${groupPrefix}-${asset.filename}`,
      proxyBlob: fetchAssetDownloadBlob,
    })
    // Slight delay helps browsers treat this as a user-initiated multi-download batch.
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => window.setTimeout(resolve, 60))
  }

  return { total: assets.length, attempted: assets.length }
}
