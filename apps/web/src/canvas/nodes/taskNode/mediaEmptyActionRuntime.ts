import type { MediaEmptyAction } from './components/MediaEmptyState'

const pendingActionsByNodeId = new Map<string, MediaEmptyAction>()

export function queueMediaEmptyAction(nodeId: string, action: MediaEmptyAction): void {
  const normalizedNodeId = nodeId.trim()
  if (!normalizedNodeId) return
  pendingActionsByNodeId.set(normalizedNodeId, action)
}

export function consumeMediaEmptyAction(nodeId: string): MediaEmptyAction | null {
  const normalizedNodeId = nodeId.trim()
  if (!normalizedNodeId) return null
  const action = pendingActionsByNodeId.get(normalizedNodeId) ?? null
  pendingActionsByNodeId.delete(normalizedNodeId)
  return action
}

export function clearMediaEmptyAction(nodeId: string): void {
  const normalizedNodeId = nodeId.trim()
  if (!normalizedNodeId) return
  pendingActionsByNodeId.delete(normalizedNodeId)
}
