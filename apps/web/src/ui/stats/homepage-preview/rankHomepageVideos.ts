import type {
  HomepageVideoRankingConfigDto,
  PublicAssetDto,
  RankingItemControlDto,
} from '../../../api/server'

export type RankedHomepageVideo = {
  asset: PublicAssetDto
  score: number
  displayOrder: number
}

const EMPTY_RANKING_CONTROL: RankingItemControlDto = {
  manualBoost: 0,
  recommended: false,
  pinned: false,
  displayOrder: 0,
}

export function rankHomepageVideos(
  videos: readonly PublicAssetDto[],
  config: HomepageVideoRankingConfigDto | null,
  nowMs: number,
  blockedAssetIds: ReadonlySet<string> = new Set(),
): RankedHomepageVideo[] {
  const eligibleVideos = videos.filter((asset) => !blockedAssetIds.has(asset.id))
  if (!config) {
    return eligibleVideos.map((asset) => ({
      asset,
      score: asset.effectiveScore ?? 0,
      displayOrder: asset.displayOrder ?? 0,
    }))
  }

  const metrics = eligibleVideos.map((asset) => Math.max(0, (asset.likeCount ?? 0) + (asset.favoriteCount ?? 0) * 2))
  const maxMetric = metrics.reduce((maximum, metric) => Math.max(maximum, metric), 0)
  const metricDenominator = Math.log1p(maxMetric)
  const weightTotal = config.engagementWeight + config.freshnessWeight
  const engagementRatio = weightTotal > 0 ? config.engagementWeight / weightTotal : 0
  const freshnessRatio = weightTotal > 0 ? config.freshnessWeight / weightTotal : 0

  return eligibleVideos
    .map((asset, index) => {
      const control = config.items[asset.id] ?? EMPTY_RANKING_CONTROL
      const createdAtMs = Date.parse(asset.createdAt)
      const ageDays = Number.isFinite(createdAtMs) ? Math.max(0, (nowMs - createdAtMs) / 86_400_000) : 0
      const metricScore = metricDenominator > 0 ? Math.log1p(metrics[index]) / metricDenominator : 0
      const freshnessScore = Math.pow(0.5, ageDays / config.freshnessHalfLifeDays)
      const algorithmScore = 100 * (metricScore * engagementRatio + freshnessScore * freshnessRatio)
      const score = algorithmScore
        + control.manualBoost
        + (control.recommended ? 10_000 : 0)
        + (control.pinned ? 100_000 : 0)
      return { asset, score, displayOrder: control.displayOrder }
    })
    .sort((left, right) =>
      right.score - left.score
      || left.displayOrder - right.displayOrder
      || left.asset.id.localeCompare(right.asset.id),
    )
}
