import React from 'react'

// Heavy-canvas LOD (level-of-detail) signal — borrowed from game-engine LOD tiers.
//
// True when the canvas is "heavy" (node/edge count over threshold) AND zoomed far
// enough out that full node/edge rendering is wasted (the user can't read labels or
// hit handles at that scale anyway). When true, node components drop to a cheaper
// "overview" billboard (thumbnail + title + handles, no panels/status/inputs) and
// edges render as straight lines without label subtrees.
//
// This is a COARSE boolean, not the raw zoom value: it only flips when crossing the
// degrade threshold, so it triggers a single batched re-render of mounted nodes on
// crossing instead of a per-frame re-render storm while zooming. The focused (sole
// selected) node always renders its full body regardless of this flag.
export const CanvasLODContext = React.createContext(false)
