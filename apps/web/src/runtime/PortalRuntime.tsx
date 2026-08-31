import React from 'react'
import { PortalRouter, type PortalPageRoute } from '../portal/PortalRouter'
import { MantineRuntimeProvider } from './MantineRuntimeProvider'

type PortalRuntimeProps = {
  route: PortalPageRoute
}

export default function PortalRuntime({ route }: PortalRuntimeProps): JSX.Element {
  return (
    <MantineRuntimeProvider>
      <PortalRouter route={route} />
    </MantineRuntimeProvider>
  )
}
