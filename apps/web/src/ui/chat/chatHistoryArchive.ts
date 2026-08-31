import { isSameChatConversationScope } from './chatSessionKey'

export type ChatHistorySelection = Readonly<
  | { mode: 'current'; sessionKey: string }
  | { mode: 'archive'; sessionKey: string }
>

/**
 * Historical physical sessions are presentation-only. Selecting one must never
 * rotate the canonical runtime session key or make legacy memory executable
 * again. A selection from the active conversation family simply returns to the
 * live view; every other selection opens a read-only archive.
 */
export function resolveChatHistorySelection(input: Readonly<{
  activeSessionKey: string
  selectedSessionKey: string
}>): ChatHistorySelection {
  const activeSessionKey = input.activeSessionKey.trim()
  const selectedSessionKey = input.selectedSessionKey.trim()
  if (!selectedSessionKey) {
    throw new Error('历史会话缺少 sessionKey')
  }
  return activeSessionKey && isSameChatConversationScope(activeSessionKey, selectedSessionKey)
    ? { mode: 'current', sessionKey: activeSessionKey }
    : { mode: 'archive', sessionKey: selectedSessionKey }
}
