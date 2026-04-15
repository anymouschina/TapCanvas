import type { ProjectBookIndexDto } from '../../../../src/api/server'
import { buildStoryboardProductionSummary } from '../../../../src/ui/nanoComic/storyboardProduction'

function buildIndex(input: {
  shotPrompts: string[]
  nextChunkIndexByGroup?: { '25'?: number }
  chunkIndexes: number[]
}): ProjectBookIndexDto {
  const now = '2026-03-24T00:00:00.000Z'
  return {
    bookId: 'book-1',
    projectId: 'project-1',
    title: '测试源书',
    chapterCount: 1,
    updatedAt: now,
    rawPath: '/tmp/book-1.md',
    assets: {
      characters: [],
      props: [],
      scenes: [],
      locations: [],
      storyboardPlans: [
        {
          planId: 'plan-1',
          taskId: 'task-1',
          chapter: 1,
          mode: 'full',
          groupSize: 25,
          shotPrompts: input.shotPrompts,
          ...(input.nextChunkIndexByGroup ? { nextChunkIndexByGroup: input.nextChunkIndexByGroup } : {}),
          createdAt: now,
          updatedAt: now,
          createdBy: 'tester',
          updatedBy: 'tester',
        },
      ],
      storyboardChunks: input.chunkIndexes.map((chunkIndex) => ({
        chunkId: `chunk-${chunkIndex}`,
        taskId: 'task-1',
        chapter: 1,
        groupSize: 25,
        chunkIndex,
        shotStart: chunkIndex * 25 + 1,
        shotEnd: chunkIndex * 25 + 25,
        shotPrompts: input.shotPrompts.slice(chunkIndex * 25, chunkIndex * 25 + 25),
        frameUrls: [`https://example.com/chunk-${chunkIndex}.png`],
        tailFrameUrl: `https://example.com/chunk-${chunkIndex}-tail.png`,
        createdAt: now,
        updatedAt: now,
        createdBy: 'tester',
        updatedBy: 'tester',
      })),
    },
    chapters: [
      {
        chapter: 1,
        title: '第一章',
        startLine: 1,
        endLine: 100,
        startOffset: 0,
        endOffset: 1000,
        length: 1000,
      },
    ],
  }
}

describe('buildStoryboardProductionSummary', () => {
  it('keeps the first missing chunk as the next chunk when persisted chunks have a gap', () => {
    const shotPrompts = Array.from({ length: 75 }, (_, index) => `镜头 ${index + 1}`)
    const index = buildIndex({
      shotPrompts,
      nextChunkIndexByGroup: { '25': 3 },
      chunkIndexes: [0, 2],
    })

    const summary = buildStoryboardProductionSummary(index, 1)

    expect(summary).not.toBeNull()
    expect(summary?.nextChunkIndex).toBe(1)
    expect(summary?.nextShotStart).toBe(26)
    expect(summary?.nextShotEnd).toBe(50)
    expect(summary?.isComplete).toBe(false)
  })

  it('uses contiguous persisted chunks even when the stored nextChunkIndex is stale', () => {
    const shotPrompts = Array.from({ length: 75 }, (_, index) => `镜头 ${index + 1}`)
    const index = buildIndex({
      shotPrompts,
      nextChunkIndexByGroup: { '25': 0 },
      chunkIndexes: [0, 1, 2],
    })

    const summary = buildStoryboardProductionSummary(index, 1)

    expect(summary).not.toBeNull()
    expect(summary?.nextChunkIndex).toBe(3)
    expect(summary?.isComplete).toBe(true)
  })
})
