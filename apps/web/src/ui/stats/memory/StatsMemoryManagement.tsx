import React from 'react'
import { Divider, Stack, Text, Title } from '@mantine/core'
import StatsMemoryDebugger from '../system/StatsMemoryDebugger'
import StatsMemoryContextDebugger from '../system/StatsMemoryContextDebugger'
import { PanelCard } from '../../PanelCard'

export default function StatsMemoryManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-memory-management', className].filter(Boolean).join(' ')

  return (
    <PanelCard className={rootClassName}>
      <Stack className="stats-memory-management__stack" gap="md">
        <div className="stats-memory-management__header">
          <Title className="stats-memory-management__title" order={3}>记忆调试</Title>
          <Text className="stats-memory-management__subtitle" size="sm" c="dimmed">
            集中查看用户记忆检索结果，以及 agents bridge 实际拿到的记忆上下文。
          </Text>
        </div>

        <Divider className="stats-memory-management__divider" label="用户记忆调试" labelPosition="left" />
        <StatsMemoryDebugger className="stats-memory-management__search" />

        <Divider className="stats-memory-management__divider" label="记忆上下文调试" labelPosition="left" />
        <StatsMemoryContextDebugger className="stats-memory-management__context" />
      </Stack>
    </PanelCard>
  )
}
