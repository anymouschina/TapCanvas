import type { SseChatMessage } from '../../canvas/sync/sseChatStore'
import { bindBroadcastTurnMessageId } from './chatTurnRecovery'

type ExistingChatMessageIdentity = {
  id: string
  pendingUserInput?: {
    requestId: string
  }
}

function isBoundChatTurnProjection(message: SseChatMessage): boolean {
  if (String(message.turnId || '').trim()) return true
  return message.role === 'assistant'
    && Boolean(String(message.pendingUserInput?.requestId || '').trim())
}

function formatBroadcastMessageTime(input: string): string {
  const date = new Date(String(input || '').trim())
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Selects only structurally new canvas-SSE chat projections. A local rich
 * message with the same root turn id always wins; prose and presentation
 * fields never participate in identity.
 */
export function selectNewBroadcastChatMessages(
  existing: readonly ExistingChatMessageIdentity[],
  incoming: readonly SseChatMessage[],
): SseChatMessage[] {
  const seenIds = new Set(existing.map((message) => message.id))
  const seenPendingRequestIds = new Set(
    existing
      .map((message) => String(message.pendingUserInput?.requestId || '').trim())
      .filter(Boolean),
  )
  const selected: SseChatMessage[] = []

  for (const rawMessage of incoming) {
    // Ordinary user/assistant projections must carry the stable public turn
    // identity. Accepting an unbound projection creates a second card beside
    // the optimistic local pair. The only identity that may stand alone is a
    // durable request_user_input action, keyed by its requestId.
    if (!isBoundChatTurnProjection(rawMessage)) continue
    const boundMessage = bindBroadcastTurnMessageId(rawMessage)
    const message = {
      ...boundMessage,
      ts: formatBroadcastMessageTime(boundMessage.ts),
    }
    if (seenIds.has(message.id)) continue
    const pendingRequestId = String(message.pendingUserInput?.requestId || '').trim()
    if (pendingRequestId && seenPendingRequestIds.has(pendingRequestId)) continue
    seenIds.add(message.id)
    if (pendingRequestId) seenPendingRequestIds.add(pendingRequestId)
    selected.push(message)
  }

  return selected
}
