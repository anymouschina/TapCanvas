import type { ReactNode } from 'react'

declare module '@mantine/core' {
  interface MantineTheme {
    fn?: {
      rgba: (color: string, alpha: number) => string
    }
  }

  interface TransitionProps {
    className?: string
  }

  interface MenuProps {
    className?: string
    transition?: string
  }

  interface MenuTargetProps {
    className?: string
  }

  interface CopyButtonProps {
    className?: string
  }

  interface SelectProps {
    withinPortal?: boolean
    nothingFound?: ReactNode
  }

  interface GroupProps {
    spacing?: string | number
    position?: string
  }

  interface PopoverProps {
    className?: string
    withinPortal?: boolean
    dropdownProps?: Record<string, unknown>
  }

  interface PopoverTargetProps {
    className?: string
  }

  interface PortalProps {
    zIndex?: number
  }
}

declare module 'framer-motion' {
  interface AnimatePresenceProps {
    className?: string
  }
}
