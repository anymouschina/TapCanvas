export type PersistedPromptAssetMentionRef = {
  nodeId: string
  username: string
  displayName: string
  rawLabel: string
  source: 'asset'
  assetUrl: string
  assetId: string | null
  assetRefId: string
  assetName: string
  assetRole: 'style' | 'reference'
  isConnected: true
}

function normalizeMentionUsername(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/gu, '')
    .replace(/\s+/gu, '')
}

export function buildPersistedPromptAssetMentionRefs(
  nodeId: string,
  assetInputs: unknown,
): PersistedPromptAssetMentionRef[] {
  if (!Array.isArray(assetInputs)) return []

  const refs = new Map<string, PersistedPromptAssetMentionRef>()
  for (const input of assetInputs) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue
    const record = input as Record<string, unknown>
    const assetUrl = typeof record.url === 'string' ? record.url.trim() : ''
    const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : ''
    const rawAssetRefId = typeof record.assetRefId === 'string' ? record.assetRefId.trim() : ''
    const rawName = typeof record.name === 'string' ? record.name.trim() : ''
    const username = normalizeMentionUsername(rawAssetRefId || assetId || rawName)
    if (!assetUrl || !username) continue

    const key = username.toLocaleLowerCase()
    if (refs.has(key)) continue
    const displayName = rawName || username
    refs.set(key, {
      nodeId: `persisted-asset-input:${nodeId}:${username}`,
      username,
      displayName,
      rawLabel: displayName,
      source: 'asset',
      assetUrl,
      assetId: assetId || null,
      assetRefId: rawAssetRefId || username,
      assetName: displayName,
      assetRole: record.role === 'style' ? 'style' : 'reference',
      isConnected: true,
    })
  }
  return Array.from(refs.values())
}
