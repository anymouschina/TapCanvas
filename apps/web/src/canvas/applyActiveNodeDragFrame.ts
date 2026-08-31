import type { InternalNode, Node, NodeChange } from '@xyflow/react'

export function applyActiveNodeDragFrame<TNode extends Node>(input: {
  changes: readonly NodeChange<TNode>[]
  nodeLookup: Map<string, InternalNode<TNode>>
  canvasRoot: HTMLElement | null
  elementCache: Map<string, HTMLElement>
}): void {
  const { changes, nodeLookup, canvasRoot, elementCache } = input

  for (const change of changes) {
    if (change.type !== 'position' || !change.position) continue
    const internalNode = nodeLookup.get(change.id)
    if (!internalNode) continue

    const previousPosition = internalNode.position
    const previousAbsolute = internalNode.internals.positionAbsolute
    const positionAbsolute = change.positionAbsolute ?? {
      x: previousAbsolute.x + change.position.x - previousPosition.x,
      y: previousAbsolute.y + change.position.y - previousPosition.y,
    }

    internalNode.position = change.position
    internalNode.dragging = true
    internalNode.internals.positionAbsolute = positionAbsolute

    let element = elementCache.get(change.id) ?? null
    if (!element && canvasRoot) {
      element = canvasRoot.querySelector<HTMLElement>(`[data-id="${CSS.escape(change.id)}"]`)
      if (element) elementCache.set(change.id, element)
    }
    if (element) {
      element.style.transform = `translate(${positionAbsolute.x}px, ${positionAbsolute.y}px)`
    }
  }
}
