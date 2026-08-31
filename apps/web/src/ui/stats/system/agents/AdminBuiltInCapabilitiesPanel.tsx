import React from 'react'
import { Group, ScrollArea, Stack, Switch, Table, Text } from '@mantine/core'
import type { AdminBuiltInCapabilityDto } from '../../../../api/server'
import { PanelCard } from '../../../PanelCard'
import { StatePanel } from '../../../StatePanel'
import { StatusBadge } from '../../../StatusBadge'

type AdminBuiltInCapabilitiesPanelProps = {
  className?: string
  capabilities: AdminBuiltInCapabilityDto[]
  onToggle: (capabilityKey: string, enabled: boolean) => Promise<void>
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '使用系统默认'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '更新系统内置能力失败'
}

export function AdminBuiltInCapabilitiesPanel({
  className,
  capabilities,
  onToggle,
}: AdminBuiltInCapabilitiesPanelProps): JSX.Element {
  const rootClassName = ['stats-built-in-capabilities', className].filter(Boolean).join(' ')
  const [savingKey, setSavingKey] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const toggle = React.useCallback(async (capability: AdminBuiltInCapabilityDto) => {
    if (savingKey) return
    setSavingKey(capability.key)
    setError(null)
    try {
      await onToggle(capability.key, !capability.enabled)
    } catch (reason: unknown) {
      setError(getErrorMessage(reason))
    } finally {
      setSavingKey(null)
    }
  }, [onToggle, savingKey])

  return (
    <PanelCard className={rootClassName} padding="compact">
      <Stack className="stats-built-in-capabilities__stack" gap="sm">
        <Stack className="stats-built-in-capabilities__heading" gap={2}>
          <Group className="stats-built-in-capabilities__title-row" gap={8}>
            <Text className="stats-built-in-capabilities__title" fw={700}>小T 内置能力</Text>
            <StatusBadge className="stats-built-in-capabilities__count" tone="neutral">{capabilities.length}</StatusBadge>
          </Group>
          <Text className="stats-built-in-capabilities__description" size="xs" c="dimmed">
            系统级开关对所有用户和现有会话生效。重新启用不会改变用户自己的停用或工作流替换设置。
          </Text>
        </Stack>

        {error ? (
          <StatePanel className="stats-built-in-capabilities__error" title="无法更新系统开关" description={error} tone="error" />
        ) : null}

        {capabilities.length === 0 ? (
          <StatePanel className="stats-built-in-capabilities__empty" title="没有可配置的内置能力" />
        ) : (
          <ScrollArea className="stats-built-in-capabilities__scroll" type="auto">
            <Table className="stats-built-in-capabilities__table" verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead className="stats-built-in-capabilities__table-head">
                <Table.Tr className="stats-built-in-capabilities__header-row">
                  <Table.Th className="stats-built-in-capabilities__header-cell">能力</Table.Th>
                  <Table.Th className="stats-built-in-capabilities__header-cell">执行工具</Table.Th>
                  <Table.Th className="stats-built-in-capabilities__header-cell">更新时间</Table.Th>
                  <Table.Th className="stats-built-in-capabilities__header-cell stats-built-in-capabilities__header-cell--switch">系统开关</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-built-in-capabilities__table-body">
                {capabilities.map((capability) => (
                  <Table.Tr className="stats-built-in-capabilities__row" key={capability.key}>
                    <Table.Td className="stats-built-in-capabilities__cell stats-built-in-capabilities__cell--identity">
                      <Stack className="stats-built-in-capabilities__identity" gap={1}>
                        <Group className="stats-built-in-capabilities__name-row" gap={6} wrap="nowrap">
                          <Text className="stats-built-in-capabilities__name" size="sm" fw={600}>{capability.name}</Text>
                          <StatusBadge className="stats-built-in-capabilities__status" tone={capability.enabled ? 'success' : 'danger'}>
                            {capability.enabled ? '全局启用' : '全局停用'}
                          </StatusBadge>
                        </Group>
                        <Text className="stats-built-in-capabilities__key" size="xs" c="dimmed">{capability.key}</Text>
                        <Text className="stats-built-in-capabilities__summary" size="xs" c="dimmed" lineClamp={1}>{capability.description}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-built-in-capabilities__cell">
                      <Text className="stats-built-in-capabilities__tool-count" size="xs" c="dimmed">
                        {capability.requiredTools.length} 个
                      </Text>
                    </Table.Td>
                    <Table.Td className="stats-built-in-capabilities__cell">
                      <Text className="stats-built-in-capabilities__updated-at" size="xs" c="dimmed">
                        {formatUpdatedAt(capability.updatedAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td className="stats-built-in-capabilities__cell stats-built-in-capabilities__cell--switch">
                      <Switch
                        className="stats-built-in-capabilities__switch"
                        aria-label={`${capability.enabled ? '停用' : '启用'}${capability.name}`}
                        checked={capability.enabled}
                        disabled={savingKey !== null}
                        onChange={() => void toggle(capability)}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </PanelCard>
  )
}
