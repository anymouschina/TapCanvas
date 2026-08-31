import { LoginModal } from '../auth/LoginModal'
import { MantineRuntimeProvider } from '../runtime/MantineRuntimeProvider'

type PortalLoginRuntimeProps = {
  opened: boolean
  onClose: () => void
}

export default function PortalLoginRuntime({ opened, onClose }: PortalLoginRuntimeProps): JSX.Element {
  return (
    <MantineRuntimeProvider>
      <LoginModal opened={opened} onClose={onClose} />
    </MantineRuntimeProvider>
  )
}
