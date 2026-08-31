import { describe, expect, it } from 'vitest'

import type { ServerAssetDto } from '../api/server'
import {
  buildGenerationHistoryItems,
  buildGenerationHistoryListInput,
  GENERATION_HISTORY_PAGE_SIZE,
} from './generationHistory'

function asset(input: Pick<ServerAssetDto, 'id' | 'name' | 'data' | 'createdAt'>): ServerAssetDto {
  return {
    ...input,
    updatedAt: input.createdAt,
    userId: 'user-1',
    projectId: 'project-1',
  }
}

describe('buildGenerationHistoryItems', () => {
  it('queries the current user global history in pages of 20 without a project filter', () => {
    expect(GENERATION_HISTORY_PAGE_SIZE).toBe(20)
    expect(buildGenerationHistoryListInput(null)).toEqual({
      limit: 20,
      cursor: null,
      kind: 'generation',
    })
    expect(buildGenerationHistoryListInput('2026-08-20T08:00:00.000Z')).toEqual({
      limit: 20,
      cursor: '2026-08-20T08:00:00.000Z',
      kind: 'generation',
    })
    expect(buildGenerationHistoryListInput(null)).not.toHaveProperty('projectId')
  })

  it('projects the canonical generation asset contract written by the API', () => {
    const items = buildGenerationHistoryItems([
      asset({
        id: 'generated-image',
        name: '城市夜景',
        createdAt: '2026-08-20T08:00:00.000Z',
        data: {
          kind: 'generation',
          type: 'image',
          url: 'https://assets.example.com/city.png',
          nodeId: 'node-image-1',
          projectId: 'project-1',
        },
      }),
    ])

    expect(items).toEqual([
      expect.objectContaining({
        assetId: 'generated-image',
        kind: 'image',
        url: 'https://assets.example.com/city.png',
        thumbnailUrl: 'https://assets.example.com/city.png',
        nodeId: 'node-image-1',
        projectId: 'project-1',
      }),
    ])
  })

  it('collects image, video, and audio outputs and sorts them newest first', () => {
    const items = buildGenerationHistoryItems([
      asset({
        id: 'older',
        name: '旧图片',
        createdAt: '2026-07-20T08:00:00.000Z',
        data: {
          kind: 'generation',
          type: 'image',
          url: 'https://cdn.example/old.png',
        },
      }),
      asset({
        id: 'newer',
        name: '新视频',
        createdAt: '2026-07-21T08:00:00.000Z',
        data: {
          kind: 'generation',
          type: 'video',
          nodeId: 'node-video',
          thumbnailUrl: 'https://cdn.example/poster.png',
          url: 'https://cdn.example/video.mp4',
        },
      }),
      asset({
        id: 'audio',
        name: '旁白',
        createdAt: '2026-07-21T07:59:59.000Z',
        data: {
          kind: 'generation',
          type: 'audio',
          url: 'https://cdn.example/voice.mp3',
        },
      }),
    ])

    expect(items.map((item) => item.kind)).toEqual(['video', 'audio', 'image'])
    expect(items[0]).toMatchObject({
      url: 'https://cdn.example/video.mp4',
      thumbnailUrl: 'https://cdn.example/poster.png',
      nodeId: 'node-video',
      projectId: 'project-1',
    })
  })

  it('deduplicates canonical URLs and ignores non-generation compatibility shapes', () => {
    const items = buildGenerationHistoryItems([
      asset({
        id: 'video-1',
        name: '短片',
        createdAt: '2026-07-21T08:00:00.000Z',
        data: {
          kind: 'generation',
          type: 'video',
          url: 'https://cdn.example/video.mp4',
        },
      }),
      asset({
        id: 'video-2',
        name: '重复短片',
        createdAt: '2026-07-21T09:00:00.000Z',
        data: {
          kind: 'generation',
          type: 'video',
          url: 'https://cdn.example/video.mp4',
        },
      }),
      asset({
        id: 'legacy',
        name: '旧双轨数据',
        createdAt: '2026-07-21T10:00:00.000Z',
        data: {
          kind: 'taskNodeOutput',
          videoUrl: 'https://cdn.example/legacy.mp4',
        },
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('video')
  })
})
