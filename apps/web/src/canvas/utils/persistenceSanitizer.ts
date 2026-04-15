type PersistenceSanitizerOptions = {
  stripBinaryUrls?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function looksLikeBase64DataUrl(raw: string): boolean {
  return /^data:[^;]+;base64,/i.test(raw.trim())
}

function looksLikeBlobUrl(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith('blob:')
}

export function sanitizeFlowValueForPersistence<T>(
  value: T,
  options: PersistenceSanitizerOptions = {},
): T {
  const { stripBinaryUrls = false } = options
  const seen = new WeakSet<object>()

  const walk = (input: unknown, parentKey?: string): unknown => {
    if (input === null || input === undefined) return input

    if (typeof input === 'string') {
      if (stripBinaryUrls && (looksLikeBase64DataUrl(input) || looksLikeBlobUrl(input))) {
        return undefined
      }
      return input
    }

    if (typeof input !== 'object') return input
    if (seen.has(input)) return undefined
    seen.add(input)

    if (Array.isArray(input)) {
      const nextItems: unknown[] = []
      for (const item of input) {
        const next = walk(item, parentKey)
        if (next !== undefined) nextItems.push(next)
      }
      return nextItems
    }

    if (!isRecord(input)) return input

    const nextRecord: Record<string, unknown> = {}
    for (const [key, rawValue] of Object.entries(input)) {
      if (key === 'logs') continue
      if (parentKey === 'lastResult' && key === 'preview') continue
      const next = walk(rawValue, key)
      if (next !== undefined) nextRecord[key] = next
    }
    return nextRecord
  }

  return walk(value) as T
}
