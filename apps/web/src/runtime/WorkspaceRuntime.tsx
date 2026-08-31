import React from 'react'
import { MantineRuntimeProvider } from './MantineRuntimeProvider'

const WorkspaceApp = React.lazy(() => import('../App'))

export default function WorkspaceRuntime(): JSX.Element {
  return (
    <MantineRuntimeProvider>
      <WorkspaceApp />
    </MantineRuntimeProvider>
  )
}
