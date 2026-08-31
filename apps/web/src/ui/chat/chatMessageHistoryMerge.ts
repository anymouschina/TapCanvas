type MergeableChatAsset = {
  title?: string
  url?: string
  thumbnailUrl?: string
}

type MergeableTodoItem = {
  status: string
  content: string
}

export type MergeableChatMessage = {
	id: string
  role: string
  content: string
  phase?: string
  kind?: string
  assets?: MergeableChatAsset[]
  todoSnapshot?: MergeableTodoItem[]
}

/**
 * Reconcile a server history snapshot with richer in-memory messages.
 * Stable message identity is the only merge key. Matching local messages win
 * so request provenance and live diagnostics are not erased merely because
 * the persisted history has caught up. Content, assets and TODOs must never
 * participate in identity because the two projections intentionally carry
 * different detail levels for the same durable turn.
 */
export function mergeLoadedHistoryWithLocalMessages<T extends MergeableChatMessage>(
  history: readonly T[],
  localMessages: readonly T[],
): T[] {
  const seenHistoryIds = new Set<string>()
  const canonicalHistory: T[] = []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    const id = String(message.id || '').trim()
    if (id && seenHistoryIds.has(id)) continue
    if (id) seenHistoryIds.add(id)
    canonicalHistory.unshift(message)
  }
  if (!localMessages.length) return canonicalHistory

  const localIndexById = new Map<string, number>()
  localMessages.forEach((message, index) => {
    const id = String(message.id || '').trim()
    if (id && !localIndexById.has(id)) localIndexById.set(id, index)
  })

  const matchedLocalIndices = new Set<number>()
  const mergedHistory = canonicalHistory.map((historyMessage) => {
    const localIndex = localIndexById.get(String(historyMessage.id || '').trim())
    if (localIndex === undefined) return historyMessage
    matchedLocalIndices.add(localIndex)
    return localMessages[localIndex]
  })
  const localOnlyMessages = localMessages.filter((_, index) => !matchedLocalIndices.has(index))

  const merged = [...mergedHistory, ...localOnlyMessages]
  // 会话内重复用户气泡兜底（同 durable turn 的双投影）：
  // onOpen 重绑若因竞态未把本地临时 id（m_user_*）换成稳定 id（m_user_recovered_*），
  // 历史/广播的稳定副本会与本地临时副本并存 → UI 出现两条同文案用户气泡，刷新后
  // 只剩历史一条。这里只对「本地临时 m_user_* 存在稳定 m_user_recovered_* 同文案副本」
  // 的情形丢弃临时副本；两个真实不同回合（都是 m_user_recovered_*）不会被误删。
  const stableUserContent = new Set<string>()
  for (const message of merged) {
    if (message.role !== 'user') continue
    const id = String(message.id || '').trim()
    const content = String(message.content || '').trim()
    if (!id.startsWith('m_user_recovered_') || !content) continue
    stableUserContent.add(content)
  }
  if (stableUserContent.size === 0) return merged
  return merged.filter((message) => {
    if (message.role !== 'user') return true
    const id = String(message.id || '').trim()
    if (id.startsWith('m_user_recovered_') || id.startsWith('m_user_queued_')) return true
    const content = String(message.content || '').trim()
    if (!content) return true
    return !stableUserContent.has(content)
  })
}
