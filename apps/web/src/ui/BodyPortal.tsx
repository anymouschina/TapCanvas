import React from 'react'
import { createPortal } from 'react-dom'

type BodyPortalProps = {
  children: React.ReactNode
}

export default function BodyPortal({ children }: BodyPortalProps): React.ReactPortal | JSX.Element {
  if (typeof document === 'undefined') {
    return <>{children}</>
  }
  return createPortal(children, document.body)
}
