import type { AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'

const STATUS_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000, 5_000] as const

export type DurableChatStatusRefresh = () => Promise<AgentsChatTurnStatusDto | null>

export async function recoverAcceptedChatTurnAfterTransportLoss(input: {
  turnId: string
  refresh: DurableChatStatusRefresh
  wait?: (delayMs: number) => Promise<void>
}): Promise<AgentsChatTurnStatusDto | null> {
  const turnId = String(input.turnId || '').trim()
  if (!turnId) return null
  const wait = input.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  }))

  for (const delayMs of STATUS_RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs)
    const snapshot = await input.refresh()
    if (snapshot?.turn?.turnId === turnId) return snapshot
  }
  return null
}
