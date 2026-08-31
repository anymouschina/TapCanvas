import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const findFirst = vi.fn()

vi.mock('../../platform/node/prisma', () => ({
  getPrismaClient: () => ({
    video_runs: { findMany, findFirst },
  }),
}))

import {
  getVideoRunStatusWatermarkForChapter,
  listActiveVideoRunsForChapter,
} from './video-run.repo'

describe('listActiveVideoRunsForChapter', () => {
  beforeEach(() => {
    findMany.mockReset()
    findMany.mockResolvedValue([])
    findFirst.mockReset()
    findFirst.mockResolvedValue(null)
  })

  it('按 chapter_id 返回当前活跃 run，供权威快照原子替换本地状态', async () => {
    await expect(listActiveVideoRunsForChapter('chapter-1244')).resolves.toEqual([])
    expect(findMany).toHaveBeenCalledWith({
      where: {
        chapter_id: 'chapter-1244',
        OR: [
          { state: { notIn: ['concatenated', 'failed', 'cancelled', 'collecting'] } },
          {
            state: 'collecting',
            authoring_state: { not: null, notIn: ['authoring_done', 'authoring_failed'] },
          },
        ],
      },
      orderBy: { updated_at: 'asc' },
    })
  })

  it('先读取整个章节的最新持久更新时间作为快照水位', async () => {
    findFirst.mockResolvedValue({ updated_at: '2026-08-03T05:31:00.433Z' })
    await expect(getVideoRunStatusWatermarkForChapter('chapter-1244'))
      .resolves.toBe('2026-08-03T05:31:00.433Z')
    expect(findFirst).toHaveBeenCalledWith({
      where: { chapter_id: 'chapter-1244' },
      orderBy: { updated_at: 'desc' },
      select: { updated_at: true },
    })
  })
})
