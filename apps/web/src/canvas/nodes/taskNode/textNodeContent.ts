export type TextNodeDisplaySource = {
  prompt?: string
  content?: string
  text?: string
  textHtml?: string
  logs?: string[]
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
