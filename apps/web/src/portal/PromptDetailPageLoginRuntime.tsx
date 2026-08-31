import React from 'react'

const PortalLoginRuntime = React.lazy(() => import('./PortalLoginRuntime'))

type PromptDetailPageLoginRuntimeProps = Readonly<{
  opened: boolean
  onClose: () => void
}>

export function PromptDetailPageLoginRuntime({ opened, onClose }: PromptDetailPageLoginRuntimeProps): JSX.Element | null {
  if (!opened) return null
  return (
    <React.Suspense fallback={null}>
      <PortalLoginRuntime opened={opened} onClose={onClose} />
    </React.Suspense>
  )
}
