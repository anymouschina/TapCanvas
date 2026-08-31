import { MantineRuntimeProvider } from '../runtime/MantineRuntimeProvider'
import { PortalAccountMenu } from './PortalAccountMenu'

type PortalAccountRuntimeProps = {
  onRequestLogin: () => void
}

export default function PortalAccountRuntime({ onRequestLogin }: PortalAccountRuntimeProps): JSX.Element {
  return (
    <MantineRuntimeProvider>
      <PortalAccountMenu onRequestLogin={onRequestLogin} />
    </MantineRuntimeProvider>
  )
}
