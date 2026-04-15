import React from 'react'
import { Button, type ButtonProps } from '@mantine/core'
import { IconVectorBezier2 } from '@tabler/icons-react'
import { spaNavigate } from '../utils/spaNavigate'

type CanvasEntryButtonProps = {
  href: string
  label?: string
} & Omit<ButtonProps, 'onClick'>

export default function CanvasEntryButton({
  href,
  label = '进入画布',
  ...buttonProps
}: CanvasEntryButtonProps): JSX.Element {
  return (
    <Button
      className="canvas-entry-button"
      leftSection={<IconVectorBezier2 className="canvas-entry-button__icon" size={14} />}
      onClick={() => spaNavigate(href)}
      {...buttonProps}
    >
      {label}
    </Button>
  )
}
