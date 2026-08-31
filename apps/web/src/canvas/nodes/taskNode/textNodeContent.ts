export type TextNodeDisplaySource = {
  prompt?: string
  content?: string
  text?: string
  textHtml?: string
  logs?: string[]
  textResults?: unknown
  lastResult?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeTextNodeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function convertPlainTextToHtml(value: string): string {
  return value
    .split('\n')
    .map((line) => `<p>${escapeTextNodeHtml(line)}</p>`)
    .join('')
}

export function resolveTextNodeLatestResult(data: TextNodeDisplaySource): string {
  if (Array.isArray(data.textResults) && data.textResults.length > 0) {
    const latestResult = data.textResults[data.textResults.length - 1]
    if (!isRecord(latestResult) || typeof latestResult.text !== 'string') return ''
    return latestResult.text.trim()
  }

  if (!isRecord(data.lastResult)) return ''
  const preview = data.lastResult.preview
  if (!isRecord(preview) || preview.type !== 'text' || typeof preview.value !== 'string') return ''
  return preview.value.trim()
}

export function resolveTextNodePlainText(input: {
  data: TextNodeDisplaySource
  latestTextResult: string
}): string {
  const prompt = typeof input.data.prompt === 'string' ? input.data.prompt.trim() : ''
  if (prompt) return String(input.data.prompt || '')

  const content = typeof input.data.content === 'string' ? input.data.content.trim() : ''
  if (content) return String(input.data.content || '')

  const text = typeof input.data.text === 'string' ? input.data.text.trim() : ''
  if (text) return String(input.data.text || '')

  const latestTextResult = String(input.latestTextResult || '').trim()
  if (latestTextResult) return latestTextResult

  const logs = Array.isArray(input.data.logs)
    ? input.data.logs.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (logs.length > 0) return logs.join('\n')

  return ''
}

export function resolveTextNodeDisplayHtml(input: {
  data: TextNodeDisplaySource
  latestTextResult: string
}): string {
  const richHtml = typeof input.data.textHtml === 'string' ? input.data.textHtml.trim() : ''
  if (richHtml) return richHtml
  return convertPlainTextToHtml(resolveTextNodePlainText(input))
}

export function withTextNodeAlpha(colorValue: string, alpha: number): string {
  const raw = String(colorValue || '').trim()
  if (!raw) return `rgba(17,18,21,${alpha})`

  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const value = hex[1]
    const full = value.length === 3 ? value.split('').map((character) => `${character}${character}`).join('') : value
    const red = parseInt(full.slice(0, 2), 16)
    const green = parseInt(full.slice(2, 4), 16)
    const blue = parseInt(full.slice(4, 6), 16)
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`
  }

  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => part.trim())
    const red = Number(parts[0] || 0)
    const green = Number(parts[1] || 0)
    const blue = Number(parts[2] || 0)
    if ([red, green, blue].every((channel) => Number.isFinite(channel))) {
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`
    }
  }

  return raw
}
