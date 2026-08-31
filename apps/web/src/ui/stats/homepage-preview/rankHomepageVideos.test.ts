import { describe, expect, it } from 'vitest'

import type { HomepageVideoRankingConfigDto, PublicAssetDto } from '../../../api/server'
import { rankHomepageVideos } from './rankHomepageVideos'

function video(id: string): PublicAssetDto {
  return {
    id,
    name: id,
    type: 'video',
    url: `https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/${id}.mp4`,
    createdAt: '2026-07-20T00:00:00.000Z',
    likeCount: 1,
    favoriteCount: 0,
  }
}

const config: HomepageVideoRankingConfigDto = {
  engagementWeight: 70,
  freshnessWeight: 30,
  freshnessHalfLifeDays: 30,
  items: {},
}

describe('rankHomepageVideos', () => {
  it('removes temporarily blocked works from the live preview result', () => {
    const ranked = rankHomepageVideos(
      [video('allowed'), video('blocked')],
      config,
      Date.parse('2026-07-22T00:00:00.000Z'),
      new Set(['blocked']),
    )

    expect(ranked.map(({ asset }) => asset.id)).toEqual(['allowed'])
  })
})
