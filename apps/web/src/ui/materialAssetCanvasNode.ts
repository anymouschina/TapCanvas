import type { MaterialAssetDto } from '../api/server'
import { getMaterialAssetImageUrl } from './materialAssetPresentation'

type CanvasMaterialNodeData = Record<string, unknown> & {
  kind: 'image'
  label: string
  status: 'done'
  materialKind: MaterialAssetDto['kind']
  materialProjectId: string
  sourceMaterialAssetId: string
  sourceProjectId: string
  imageUrl: string
  imageResults: Array<{ url: string }>
}

const REFERENCE_TYPES = new Set<MaterialAssetDto['kind']>([
  'character',
  'scene',
  'prop',
  'style',
  'ensemble',
  'pose',
])

const COPY_FIELDS = [
  'prompt',
  'description',
  'identityAnchors',
  'prohibitedDrift',
  'characterAssetRole',
  'approvalStatus',
  'stateKey',
  'stateDescription',
  'styleLockId',
  'styleFingerprint',
  'styleSource',
  'styleReferenceImages',
  'threeViewImageUrl',
  'characterRoleNames',
] as const

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function collectImageUrls(data: Record<string, unknown>, primaryImageUrl: string): string[] {
  const urls = primaryImageUrl ? [primaryImageUrl] : []
  const results = Array.isArray(data.imageResults) ? data.imageResults : []
  for (const result of results) {
    const record = readRecord(result)
    const url = readHttpUrl(record?.url) || readHttpUrl(record?.imageUrl)
    if (url && !urls.includes(url)) urls.push(url)
  }
  return urls
}

function buildCardLabel(kind: MaterialAssetDto['kind'], name: string): string {
  if (kind === 'character') return `角色卡｜${name}`
  if (kind === 'scene') return `场景卡｜${name}`
  if (kind === 'prop') return `道具卡｜${name}`
  if (kind === 'ensemble') return `群像图｜${name}`
  if (kind === 'pose') return `姿态卡｜${name}`
  if (kind === 'style') return `风格卡｜${name}`
  return name
}

/**
 * Material library assets become current-project assets by existing as durable nodes on a
 * current project/chapter canvas. Preserve the source version for audit, but never reuse the
 * source asset ID as the new project's identity: the saved canvas node is the new identity.
 */
export function buildMaterialAssetCanvasNodeData(input: {
  asset: MaterialAssetDto
  targetProjectId: string
}): CanvasMaterialNodeData {
  const targetProjectId = input.targetProjectId.trim()
  if (!targetProjectId) throw new Error('targetProjectId is required')
  const name = input.asset.name.trim()
  if (!name) throw new Error('material asset name is required')

  const latestData = input.asset.latestVersion?.data ?? {}
  const imageUrl = getMaterialAssetImageUrl(input.asset)
  if (!imageUrl) throw new Error('material asset image is required')
  const imageUrls = collectImageUrls(latestData, imageUrl)
  const copiedFields: Record<string, unknown> = {}
  for (const key of COPY_FIELDS) {
    const value = latestData[key]
    if (value !== undefined && value !== null) copiedFields[key] = value
  }

  const semanticIdentity: Record<string, unknown> = {}
  if (input.asset.kind === 'character') semanticIdentity.roleName = name
  if (input.asset.kind === 'scene') semanticIdentity.sceneName = name
  if (input.asset.kind === 'prop') semanticIdentity.propName = name

  return {
    kind: 'image',
    label: buildCardLabel(input.asset.kind, name),
    status: 'done',
    productionLayer: 'anchors',
    materialKind: input.asset.kind,
    ...(REFERENCE_TYPES.has(input.asset.kind) ? { referenceType: input.asset.kind } : {}),
    ...semanticIdentity,
    ...copiedFields,
    imageUrl,
    imageResults: imageUrls.map((url) => ({ url })),
    materialProjectId: targetProjectId,
    sourceMaterialAssetId: input.asset.id,
    sourceMaterialAssetVersionId: input.asset.latestVersion?.id ?? null,
    sourceMaterialAssetVersion: input.asset.latestVersion?.version ?? input.asset.currentVersion,
    sourceProjectId: input.asset.projectId,
    sourceProjectNodeId: input.asset.origin?.nodeId ?? null,
    sourceProjectOwnerType: input.asset.origin?.ownerType ?? null,
    sourceProjectOwnerId: input.asset.origin?.ownerId ?? null,
  }
}
