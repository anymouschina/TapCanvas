import { ActionIcon, type ActionIconProps } from '@mantine/core'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type IconActionButtonProps = Omit<ActionIconProps, 'children'> & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  icon: ReactNode
}

export function IconActionButton({
  icon,
  className,
  variant = 'subtle',
  ...props
}: IconActionButtonProps) {
  const rootClassName = className ? `tc-icon-action-button ${className}` : 'tc-icon-action-button'

  return (
    <ActionIcon
      {...props}
      className={rootClassName}
      radius="xs"
      variant={variant}
    >
      {icon}
    </ActionIcon>
  )
}
