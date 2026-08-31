type ImageResult = {
  url: string | null
  thumbnailUrl: string | null
}
function readUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readImageResults(value: unknown): ImageResult[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (!item || typeof item !== 'object') return { url: null, thumbnailUrl: null }
    const record = item as Record<string, unknown>
    return {
      url: readUrl(record.url),
      thumbnailUrl: readUrl(record.thumbnailUrl),
    }
  })
}

function readPrimaryIndex(value: unknown, resultCount: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  return value >= 0 && value < resultCount ? value : 0
}

export function resolveImageNodePreviewUrl(data: Record<string, unknown>): string | null {
  const results = readImageResults(data.imageResults)
  const primary = results[readPrimaryIndex(data.imagePrimaryIndex, results.length)]

  return primary?.thumbnailUrl
    ?? readUrl(data.imageThumbnailUrl)
    ?? readUrl(data.thumbnailUrl)
    ?? results.find((result) => result.thumbnailUrl)?.thumbnailUrl
    ?? primary?.url
    ?? results.find((result) => result.url)?.url
    ?? readUrl(data.imageUrl)
    ?? (
      data.mediaNaturalSize && typeof data.mediaNaturalSize === 'object'
        ? readUrl((data.mediaNaturalSize as Record<string, unknown>).url)
        : null
    )
}
