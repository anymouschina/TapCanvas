import { Badge, type BadgeProps } from '@mantine/core'

export type StatusBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export type StatusBadgeProps = Omit<BadgeProps, 'color'> & {
  tone?: StatusBadgeTone
}

const toneColorMap: Record<StatusBadgeTone, string> = {
  neutral: 'gray',
  info: 'blue',
  success: 'green',
  warning: 'yellow',
  danger: 'red'
}

export function StatusBadge({ tone = 'neutral', className, variant = 'light', ...props }: StatusBadgeProps) {
  const rootClassName = className ? `tc-status-badge ${className}` : 'tc-status-badge'

  return (
    <Badge
      {...props}
      className={rootClassName}
      color={toneColorMap[tone]}
      radius="md"
      size={props.size ?? 'sm'}
      variant={variant}
    />
  )
}
