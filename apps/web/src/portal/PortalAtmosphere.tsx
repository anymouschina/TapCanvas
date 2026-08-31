import React from 'react'

const POINTER_INACTIVE = '0'
const POINTER_ACTIVE = '1'

export function PortalAtmosphere(): JSX.Element {
  const atmosphereRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const atmosphere = atmosphereRef.current
    if (!atmosphere) return

    let animationFrameId: number | null = null
    let pointerX = 0
    let pointerY = 0

    const paintPointer = (): void => {
      animationFrameId = null
      atmosphere.style.setProperty('--tc-portal-pointer-x', `${pointerX}px`)
      atmosphere.style.setProperty('--tc-portal-pointer-y', `${pointerY}px`)
      atmosphere.style.setProperty('--tc-portal-pointer-active', POINTER_ACTIVE)
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
      pointerX = event.clientX
      pointerY = event.clientY
      if (animationFrameId === null) animationFrameId = window.requestAnimationFrame(paintPointer)
    }

    const hidePointer = (): void => {
      atmosphere.style.setProperty('--tc-portal-pointer-active', POINTER_INACTIVE)
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', hidePointer, { passive: true })
    window.addEventListener('blur', hidePointer)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      document.documentElement.removeEventListener('pointerleave', hidePointer)
      window.removeEventListener('blur', hidePointer)
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div ref={atmosphereRef} className="tc-portal-atmosphere" aria-hidden="true">
      <div className="tc-portal-atmosphere__dots" />
      <div className="tc-portal-atmosphere__radiance" />
    </div>
  )
}
