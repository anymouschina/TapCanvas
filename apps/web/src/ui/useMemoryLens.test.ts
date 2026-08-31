import { describe, expect, it } from 'vitest'

import type { MemoryContextSectionDto, MemoryEntryDto } from '../api/server'
import { groupMemoryLensEntries } from './useMemoryLens'

function memory(id: string, scopeType: MemoryEntryDto['scopeType']): MemoryEntryDto {
  return {
    id,
    scopeType,
    scopeId: `${scopeType}-1`,
    memoryType: 'domain_fact',
    title: id,
    summaryText: `${id} summary`,
    content: {},
    importance: 0.8,
    status: 'active',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    tags: [],
  }
}

function context(): MemoryContextSectionDto {
  const projectFact = memory('project-fact', 'project')
  const chapterFact = memory('chapter-fact', 'chapter')
  return {
    userPreferences: [memory('preference', 'user')],
    projectFacts: [projectFact],
    bookFacts: [],
    chapterFacts: [chapterFact],
    artifactRefs: [memory('artifact', 'project')],
    rollups: {
      user: [],
      project: [projectFact],
      book: [],
      chapter: [chapterFact],
      session: [],
    },
    recentConversation: [],
  }
}

describe('groupMemoryLensEntries', () => {
  it('groups the exact memory context supplied to the agent and removes duplicate rollup projections', () => {
    const groups = groupMemoryLensEntries(context())

    expect(groups.map((group) => group.label)).toEqual([
      '长期偏好',
      '项目事实',
      '章节事实',
      '资产线索',
    ])
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      'preference',
      'project-fact',
      'chapter-fact',
      'artifact',
    ])
  })
})
