import type { Node, NodeChange } from '@xyflow/react'

/**
 * Keep the canvas drag hot path proportional to the changes emitted for the
 * current frame. In particular, this function must not inspect the full node
 * collection: React Flow already owns applying position changes to that list.
 */
export function normalizeCanvasNodeChanges(
  changes: readonly NodeChange<Node>[],
  dragActive: boolean,
): NodeChange<Node>[] {
  const normalized: NodeChange<Node>[] = []

  for (const change of changes) {
    // Deletion is handled by the canvas' explicit delete actions. Ignoring
    // transient remove changes also prevents accidental data loss.
    if (change.type === 'remove') continue

    if (
      dragActive &&
      change.type === 'position' &&
      change.position &&
      typeof change.dragging !== 'boolean'
    ) {
      normalized.push({ ...change, dragging: true })
      continue
    }

    normalized.push(change)
  }

  return normalized
}
