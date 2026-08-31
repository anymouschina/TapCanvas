import React from 'react'

// True when React Flow's onlyRenderVisibleElements is active. Mounted nodes are
// restricted to the visible viewport, so node components can avoid offscreen work.
export const CanvasVirtualizationContext = React.createContext(false)
