import type React from 'react'

// Floating panels sit above the canvas. Trap wheel gestures here so React Flow
// cannot steal scrolling from panel content.
export const stopPanelWheelPropagation: React.WheelEventHandler<HTMLElement> = (event) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
  }
  event.stopPropagation()
}
