import { create } from 'zustand'

export type SseChatMessage = {
  id: string
  /**
   * Stable root public turn identity shared by live, persisted and canvas-SSE
   * projections. It is optional only for a standalone assistant
   * pendingUserInput action, which is instead bound by requestId.
   */
  turnId?: string
  role: 'user' | 'assistant'
  content: string
  ts: string
  source?: 'agents'
  /** Exact language model fact for the user turn projected by public chat. */
  languageModel?: string
  // request_user_input 确认卡：API key/督工驱动的回合不走面板本地流，
  // 卡必须随 SSE 广播透传，否则面板只见文字没有可点选项。
  pendingUserInput?: {
    status: 'needs_input'
    requestId: string
    questions: Array<{
      id: string
      header: string
      question: string
      options: Array<{ label: string; description?: string; imageUrl?: string; thumbnailUrl?: string }>
    }>
  }
}

type SseChatStore = {
  queue: Array<{ sessionKey: string; message: SseChatMessage }>
  push: (sessionKey: string, messages: SseChatMessage[]) => void
  drain: (sessionKey: string) => SseChatMessage[]
  clear: (sessionKey: string) => void
}

function pendingActionKey(message: SseChatMessage): string | null {
  const requestId = message.pendingUserInput?.requestId?.trim()
  return requestId ? `request_user_input:${requestId}` : null
}

export const useSseChatStore = create<SseChatStore>((set, get) => ({
  queue: [],
  push: (sessionKeyValue, messages) => set((s) => {
    const sessionKey = String(sessionKeyValue || '').trim()
    if (!sessionKey) throw new Error('SSE chat messages require an exact sessionKey')
    const nextQueue = [...s.queue]
    const pendingKeys = new Set(
      nextQueue
        .filter((item) => item.sessionKey === sessionKey)
        .map((item) => pendingActionKey(item.message))
        .filter((key): key is string => key !== null),
    )
    for (const message of messages) {
      const actionKey = pendingActionKey(message)
      if (actionKey && pendingKeys.has(actionKey)) continue
      const existingIndex = nextQueue.findIndex(
        (item) => item.sessionKey === sessionKey && item.message.id === message.id,
      )
      const scopedMessage = { sessionKey, message }
      if (existingIndex >= 0) nextQueue[existingIndex] = scopedMessage
      else nextQueue.push(scopedMessage)
      if (actionKey) pendingKeys.add(actionKey)
    }
    return { queue: nextQueue }
  }),
  drain: (sessionKeyValue) => {
    const sessionKey = String(sessionKeyValue || '').trim()
    if (!sessionKey) return []
    const { queue } = get()
    const selected = queue
      .filter((item) => item.sessionKey === sessionKey)
      .map((item) => item.message)
    if (!selected.length) return []
    set({ queue: queue.filter((item) => item.sessionKey !== sessionKey) })
    return selected
  },
  clear: (sessionKeyValue) => {
    const sessionKey = String(sessionKeyValue || '').trim()
    if (!sessionKey) return
    set((state) => ({
      queue: state.queue.filter((item) => item.sessionKey !== sessionKey),
    }))
  },
}))
