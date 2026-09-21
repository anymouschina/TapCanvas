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

  // Anchor local-only rows to the next shared identity in local chronology.
  // Appending every local-only row at the end moves older failures behind the
  // latest successful reply whenever history omits those failed turns.
  const beforeSharedId = new Map<string, T[]>()
  let pendingLocal: T[] = []
  for (const message of localMessages) {
    const id = String(message.id || '').trim()
    if (id && seenHistoryIds.has(id)) {
      beforeSharedId.set(id, [...(beforeSharedId.get(id) ?? []), ...pendingLocal])
      pendingLocal = []
    } else {
      pendingLocal.push(message)
    }
  }
  const merged: T[] = []
  for (const historyMessage of canonicalHistory) {
    const id = String(historyMessage.id || '').trim()
    merged.push(...(beforeSharedId.get(id) ?? []))
    const localIndex = localIndexById.get(id)
    merged.push(localIndex === undefined ? historyMessage : localMessages[localIndex])
  }
  merged.push(...pendingLocal)
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
