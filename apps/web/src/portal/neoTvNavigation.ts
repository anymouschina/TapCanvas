export function buildNeoTvWatchPath(assetId: string): string {
  const normalizedAssetId = assetId.trim()
  if (!normalizedAssetId) throw new Error('Neo TV 作品 ID 不能为空')
  return `/neo-tv?watch=${encodeURIComponent(normalizedAssetId)}`
}
