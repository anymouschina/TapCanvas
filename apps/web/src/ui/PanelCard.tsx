import { Paper, type PaperProps } from '@mantine/core'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type PanelCardPadding = 'compact' | 'default' | 'comfortable'

type PanelCardDomProps = Omit<HTMLAttributes<HTMLDivElement>, keyof PaperProps>

export type PanelCardProps = Omit<PaperProps, 'children' | 'p' | 'radius' | 'withBorder'> & PanelCardDomProps & {
  children?: ReactNode
  padding?: PanelCardPadding
}

const paddingBySize: Record<PanelCardPadding, PaperProps['p']> = {
  compact: 'sm',
  default: 'md',
  comfortable: 'lg'
}

export const PanelCard = forwardRef<HTMLDivElement, PanelCardProps>(function PanelCard({
  children,
  className,
  padding = 'default',
  ...props
}, ref) {
  const rootClassName = className ? `tc-panel-card ${className}` : 'tc-panel-card'

  return (
    <Paper
      {...props}
      ref={ref}
      className={rootClassName}
      p={paddingBySize[padding]}
      radius="sm"
      shadow="xs"
      withBorder
    >
      {children}
    </Paper>
  )
})
