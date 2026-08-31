export type ChatAssetInputRole =
  | 'target'
  | 'reference'
  | 'character'
  | 'scene'
  | 'prop'
  | 'product'
  | 'style'
  | 'context'
  | 'mask'

export type ChatAssetInput = {
  nodeId?: string
  assetId?: string
  assetRefId?: string
  url?: string
  role?: ChatAssetInputRole
  weight?: number
  note?: string
  name?: string
}

type SelectedImageAssetCandidate = {
  nodeId?: string
  assetId?: string
  assetRefId?: string
  url: string
  role?: ChatAssetInputRole
  note?: string
  name?: string
}

type ChatRequestExecution = {
  mode: 'auto'
  forceAssetGeneration: boolean
}

export function buildSelectedImageAssetInputs(
  items: SelectedImageAssetCandidate[],
): ChatAssetInput[] {
  const out: ChatAssetInput[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const url = String(item.url || '').trim()
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId.trim() : ''
    const assetId = typeof item.assetId === 'string' ? item.assetId.trim() : ''
    const assetRefId = typeof item.assetRefId === 'string' ? item.assetRefId.trim() : ''
    if (!url || (!nodeId && !assetId && !assetRefId)) continue
    const key = `${nodeId}|${assetId}|${assetRefId}|${url}`
    if (seen.has(key)) continue
    seen.add(key)
    const role = item.role || 'reference'
    const note = typeof item.note === 'string' ? item.note.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    out.push({
      ...(nodeId ? { nodeId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(assetRefId ? { assetRefId } : {}),
      url,
      role,
      ...(note ? { note } : {}),
      ...(name ? { name } : {}),
    })
  }

  return out
}

export function resolveChatRequestExecution(): ChatRequestExecution {
  return {
    mode: 'auto',
    forceAssetGeneration: false,
  }
}
