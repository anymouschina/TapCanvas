export type TapImageDragMeta = {
  label?: string
  prompt?: string
  storyboardScript?: string
  storyboardShotPrompt?: string
  storyboardDialogue?: string
  sourceKind?: string
  sourceNodeId?: string
  sourceIndex?: number
  shotNo?: number
}

export type TapImageDragPayload = {
  url: string
  label?: string
  prompt?: string
  storyboardScript?: string
  storyboardShotPrompt?: string
  storyboardDialogue?: string
  sourceKind?: string
  sourceNodeId?: string
  sourceIndex?: number
  shotNo?: number
}

const trimString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const parseTapImageDragPayload = (raw: string): TapImageDragPayload | null => {
  const trimmed = trimString(raw)
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') {
      const url = trimString(parsed)
      return url ? { url } : null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const url = trimString(record.url)
    if (!url) return null
    const payload: TapImageDragPayload = { url }
    const label = trimString(record.label)
    const prompt = trimString(record.prompt)
    const storyboardScript = trimString(record.storyboardScript)
    const storyboardShotPrompt = trimString(record.storyboardShotPrompt)
    const storyboardDialogue = trimString(record.storyboardDialogue)
    const sourceKind = trimString(record.sourceKind)
    const sourceNodeId = trimString(record.sourceNodeId)
    const sourceIndexRaw = Number(record.sourceIndex)
    const shotNoRaw = Number(record.shotNo)
    if (label) payload.label = label
    if (prompt) payload.prompt = prompt
    if (storyboardScript) payload.storyboardScript = storyboardScript
    if (storyboardShotPrompt) payload.storyboardShotPrompt = storyboardShotPrompt
    if (storyboardDialogue) payload.storyboardDialogue = storyboardDialogue
    if (sourceKind) payload.sourceKind = sourceKind
    if (sourceNodeId) payload.sourceNodeId = sourceNodeId
    if (Number.isFinite(sourceIndexRaw)) payload.sourceIndex = Math.max(0, Math.trunc(sourceIndexRaw))
    if (Number.isFinite(shotNoRaw)) payload.shotNo = Math.max(1, Math.trunc(shotNoRaw))
    return payload
  } catch {
    return trimmed ? { url: trimmed } : null
  }
}

export const getTapImageDragPayload = (dataTransfer: DataTransfer | null | undefined): TapImageDragPayload | null => {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData('application/tap-image-url')
  if (raw) return parseTapImageDragPayload(raw)
  const fallback = dataTransfer.getData('text/plain')
  return parseTapImageDragPayload(fallback)
}

export function setTapImageDragData(
  evt: React.DragEvent,
  url: string,
  meta?: TapImageDragMeta,
): void {
  const trimmed = (url || '').trim()
  if (!trimmed) return
  if (!evt.dataTransfer) return

  try {
    evt.dataTransfer.effectAllowed = 'copy'
  } catch {
    // ignore
  }

  // Used by canvas drop handler.
  try {
    const payload: TapImageDragPayload = { url: trimmed }
    const label = trimString(meta?.label)
    const prompt = trimString(meta?.prompt)
    const storyboardScript = trimString(meta?.storyboardScript)
    const storyboardShotPrompt = trimString(meta?.storyboardShotPrompt)
    const storyboardDialogue = trimString(meta?.storyboardDialogue)
    const sourceKind = trimString(meta?.sourceKind)
    const sourceNodeId = trimString(meta?.sourceNodeId)
    if (label) payload.label = label
    if (prompt) payload.prompt = prompt
    if (storyboardScript) payload.storyboardScript = storyboardScript
    if (storyboardShotPrompt) payload.storyboardShotPrompt = storyboardShotPrompt
    if (storyboardDialogue) payload.storyboardDialogue = storyboardDialogue
    if (sourceKind) payload.sourceKind = sourceKind
    if (sourceNodeId) payload.sourceNodeId = sourceNodeId
    if (Number.isFinite(meta?.sourceIndex)) payload.sourceIndex = Math.max(0, Math.trunc(Number(meta?.sourceIndex)))
    if (Number.isFinite(meta?.shotNo)) payload.shotNo = Math.max(1, Math.trunc(Number(meta?.shotNo)))
    evt.dataTransfer.setData('application/tap-image-url', JSON.stringify(payload))
  } catch {
    // ignore
  }

  // Safari / generic fallbacks.
  try {
    evt.dataTransfer.setData('text/plain', trimmed)
  } catch {
    // ignore
  }
}
