import type { PromptLibraryCard } from '../api/promptLibrary'

const CARD_BODY_HEIGHT = 0
const COLUMN_GAP = 28
const MIN_MEDIA_HEIGHT = 180
const MAX_MEDIA_HEIGHT = 560

function mediaAspectRatio(entry: PromptLibraryCard): number {
  const media = entry.media[0]
  if (media?.width && media.height) return media.height / media.width
  return media?.kind === 'video' ? 9 / 16 : 10 / 16
}

export function estimatePromptLibraryCardHeight(entry: PromptLibraryCard, columnWidth: number): number {
  const mediaHeight = Math.min(
    MAX_MEDIA_HEIGHT,
    Math.max(MIN_MEDIA_HEIGHT, columnWidth * mediaAspectRatio(entry)),
  )
  return mediaHeight + CARD_BODY_HEIGHT + COLUMN_GAP
}

export function distributePromptLibraryMasonry(
  items: readonly PromptLibraryCard[],
  columnCount: number,
  columnWidth: number,
): PromptLibraryCard[][] {
  const safeColumnCount = Math.max(1, Math.floor(columnCount))
  const safeColumnWidth = Math.max(1, columnWidth)
  const columns = Array.from({ length: safeColumnCount }, () => [] as PromptLibraryCard[])
  const columnHeights = Array.from({ length: safeColumnCount }, () => 0)

  items.forEach((entry) => {
    let shortestColumnIndex = 0
    for (let index = 1; index < columnHeights.length; index += 1) {
      if ((columnHeights[index] ?? 0) < (columnHeights[shortestColumnIndex] ?? 0)) {
        shortestColumnIndex = index
      }
    }
    columns[shortestColumnIndex]?.push(entry)
    columnHeights[shortestColumnIndex] = (columnHeights[shortestColumnIndex] ?? 0)
      + estimatePromptLibraryCardHeight(entry, safeColumnWidth)
  })

  return columns
}
