import type { ServerAssetDto } from '../api/server'

export const GENERATION_HISTORY_PAGE_SIZE = 20

export type GenerationHistoryKind = 'image' | 'video' | 'audio'

export type GenerationHistoryListInput = {
  limit: number
  cursor: string | null
  kind: 'generation'
}

export type GenerationHistoryItem = {
  id: string
  assetId: string
  kind: GenerationHistoryKind
  url: string
  thumbnailUrl: string
  title: string
  createdAt: string
  nodeId: string
  projectId: string | null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

export function buildGenerationHistoryListInput(cursor: string | null): GenerationHistoryListInput {
  return {
    limit: GENERATION_HISTORY_PAGE_SIZE,
    cursor,
    kind: 'generation',
  }
}

export function buildGenerationHistoryItems(assets: readonly ServerAssetDto[]): GenerationHistoryItem[] {
  const items: GenerationHistoryItem[] = []
  const seenMedia = new Set<string>()

  for (const asset of assets) {
    const data = readRecord(asset.data)
    if (readString(data, 'kind') !== 'generation') continue
    const kind = readString(data, 'type')
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') continue
    const url = readString(data, 'url')
    const mediaKey = `${kind}:${url}`
    if (!url || seenMedia.has(mediaKey)) continue
    seenMedia.add(mediaKey)

    items.push({
      id: `${asset.id}:${mediaKey}`,
      assetId: asset.id,
      kind,
      url,
      thumbnailUrl: kind === 'image'
        ? url
        : kind === 'video'
          ? readString(data, 'thumbnailUrl')
          : '',
      title: asset.name.trim() || '未命名生成结果',
      createdAt: asset.createdAt,
      nodeId: readString(data, 'nodeId'),
      projectId: asset.projectId?.trim() || null,
    })
  }

  return items.sort((left, right) => readTimestamp(right.createdAt) - readTimestamp(left.createdAt))
}
