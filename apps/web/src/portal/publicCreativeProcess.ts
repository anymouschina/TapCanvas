import type { PublicAssetDto } from '../api/server'

type PublicCreativeProcessAsset = Pick<
  PublicAssetDto,
  'canvasPublic' | 'sourceProjectId' | 'projectId'
>

export function resolvePublicCreativeProcessProjectId(asset: PublicCreativeProcessAsset): string | null {
  if (asset.canvasPublic !== true) return null

  const sourceProjectId = asset.sourceProjectId?.trim() || ''
  if (sourceProjectId) return sourceProjectId

  const projectId = asset.projectId?.trim() || ''
  return projectId || null
}

export function buildPublicCreativeProcessPath(asset: PublicCreativeProcessAsset): string | null {
  const projectId = resolvePublicCreativeProcessProjectId(asset)
  if (!projectId) return null
  return `/share/${encodeURIComponent(projectId)}`
}
