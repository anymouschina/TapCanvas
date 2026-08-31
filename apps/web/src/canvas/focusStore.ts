import { create } from 'zustand'

// Single-focus model for the canvas.
//
// At most ONE task node is "focused" at a time — the sole selected node. Only the focused node
// mounts the heavy interactive TaskNode body (TaskNode.tsx, ~10k lines / ~358 hooks); every other
// node renders a lightweight thumbnail shell (TaskNodeSkeleton). This caps the number of heavy
// React subtrees at 1 regardless of how many nodes (or copies) live on the canvas, which is the
// difference between a 500-node chapter being sluggish and being smooth.
//
// Kept in a dedicated tiny store (not the big RF store / not context) so each node can subscribe to
// the O(1) selector `s => s.focusedNodeId === id` and re-render ONLY when its own focus state flips —
// a focus change touches just the two nodes involved, never the whole canvas.
type FocusStore = {
  focusedNodeId: string | null
  // When true, EVERY node renders its full body (no single-focus gating). Used for view-only mode
  // (published / read-only canvases), where nodes aren't selectable so nothing would ever "focus" —
  // but the reader still needs full content (video playback, full text), not just thumbnails.
  // onlyRenderVisibleElements keeps the mounted-full count bounded to what's on screen.
  allFull: boolean
  setFocusedNodeId: (id: string | null) => void
  setAllFull: (v: boolean) => void
}

export const useFocusStore = create<FocusStore>((set) => ({
  focusedNodeId: null,
  allFull: false,
  setFocusedNodeId: (id) => set((s) => (s.focusedNodeId === id ? s : { focusedNodeId: id })),
  setAllFull: (v) => set((s) => (s.allFull === v ? s : { allFull: v })),
}))

/**
 * Subscribe to whether a specific node should render its full heavy body. True when this node is the
 * focused (sole-selected) node, or when allFull (view-only) is set. O(1); re-renders only on flip.
 */
export function useIsNodeFocused(nodeId: string): boolean {
  return useFocusStore((s) => s.allFull || s.focusedNodeId === nodeId)
}
