import { describe, expect, it } from 'vitest'
import type { PromptLibraryCard } from '../api/promptLibrary'
import { distributePromptLibraryMasonry, estimatePromptLibraryCardHeight } from './promptLibraryMasonry'

function createEntry(id: string, width: number, height: number): PromptLibraryCard {
  return {
    id,
    title: id,
    description: null,
    promptText: id,
    mediaType: 'image',
    authorLabel: '搜集自网络',
    publishedAt: null,
    models: [],
    media: [{ id: `media-${id}`, kind: 'image', url: `https://example.com/${id}.jpg`, thumbnailUrl: null, width, height, order: 0 }],
  }
}

describe('prompt library masonry distribution', () => {
  it('fills the first row left to right, then appends to the shortest column', () => {
    const items = [
      createEntry('portrait', 100, 200),
      createEntry('landscape', 200, 100),
      createEntry('square', 100, 100),
      createEntry('next', 100, 100),
    ]

    const columns = distributePromptLibraryMasonry(items, 3, 240)

    expect(columns.map((column) => column.map((entry) => entry.id))).toEqual([
      ['portrait'],
      ['landscape', 'next'],
      ['square'],
    ])
  })

  it('keeps existing assignments stable when another page is appended', () => {
    const firstPage = [
      createEntry('1', 100, 200),
      createEntry('2', 200, 100),
      createEntry('3', 100, 100),
    ]
    const before = distributePromptLibraryMasonry(firstPage, 3, 240)
    const after = distributePromptLibraryMasonry([...firstPage, createEntry('4', 100, 100)], 3, 240)

    firstPage.forEach((entry) => {
      const beforeColumn = before.findIndex((column) => column.some((item) => item.id === entry.id))
      const afterColumn = after.findIndex((column) => column.some((item) => item.id === entry.id))
      expect(afterColumn).toBe(beforeColumn)
    })
  })

  it('uses the reserved media dimensions when estimating card height', () => {
    const portrait = createEntry('portrait', 100, 200)
    const landscape = createEntry('landscape', 200, 100)

    expect(estimatePromptLibraryCardHeight(portrait, 240)).toBeGreaterThan(
      estimatePromptLibraryCardHeight(landscape, 240),
    )
  })
})
