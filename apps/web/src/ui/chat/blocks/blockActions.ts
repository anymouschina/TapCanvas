import { useChatCommandStore, type GenerationProposalContext } from '../chatCommandStore'

export function focusCanvasNode(nodeId?: string): void {
  const id = String(nodeId || '').trim()
  if (!id || typeof window === 'undefined') return
  const focusNode = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
  focusNode?.(id)
}

export function sendChatAction(text?: string, options?: { displayText?: string; generationProposal?: GenerationProposalContext }): void {
  const value = String(text || '').trim()
  if (!value) return
  const displayText = String(options?.displayText || '').trim()
  useChatCommandStore.getState().dispatchSend({
    text: value,
    ...(displayText ? { displayText } : {}),
    ...(options?.generationProposal ? { generationProposal: options.generationProposal } : {}),
  })
}
