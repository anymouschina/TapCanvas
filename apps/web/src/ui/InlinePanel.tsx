import { Box, type BoxProps } from '@mantine/core'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type InlinePanelPadding = 'compact' | 'default'

type InlinePanelDomProps = Omit<HTMLAttributes<HTMLDivElement>, keyof BoxProps>

export type InlinePanelProps = Omit<BoxProps, 'children'> & InlinePanelDomProps & {
  children?: ReactNode
  padding?: InlinePanelPadding
}

const paddingBySize: Record<InlinePanelPadding, string> = {
  compact: '8px',
  default: '12px'
}

export const InlinePanel = forwardRef<HTMLDivElement, InlinePanelProps>(function InlinePanel(
  {
    children,
    className,
    padding = 'default',
    style,
    ...props
  },
  ref,
) {
  const rootClassName = className ? `tc-inline-panel ${className}` : 'tc-inline-panel'

  return (
    <Box
      {...props}
      ref={ref}
      className={rootClassName}
      style={{
        padding: paddingBySize[padding],
        ...style
      }}
    >
      {children}
    </Box>
  )
})
