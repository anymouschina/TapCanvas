import { Group, Loader, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { InlinePanel, type InlinePanelProps } from './InlinePanel'

export type StatePanelTone = 'default' | 'error' | 'loading'

export type StatePanelProps = Omit<InlinePanelProps, 'title'> & {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  tone?: StatePanelTone
}

export function StatePanel({
  title,
  description,
  icon,
  actions,
  tone = 'default',
  className,
  ...props
}: StatePanelProps) {
  const rootClassName = className ? `tc-state-panel ${className}` : 'tc-state-panel'
  const resolvedIcon = tone === 'loading' ? <Loader size="sm" /> : icon

  return (
    <InlinePanel
      {...props}
      className={rootClassName}
      padding="default"
      data-emphasis={tone === 'error' ? 'strong' : undefined}
    >
      <Stack className="tc-state-panel__content" gap={6}>
        {resolvedIcon ? <Group className="tc-state-panel__icon" gap={8}>{resolvedIcon}</Group> : null}
        <Text className="tc-state-panel__title" fw={600} size="sm">{title}</Text>
        {description ? <Text className="tc-state-panel__description" size="xs">{description}</Text> : null}
        {actions ? <Group className="tc-state-panel__actions" gap={8}>{actions}</Group> : null}
      </Stack>
    </InlinePanel>
  )
}
