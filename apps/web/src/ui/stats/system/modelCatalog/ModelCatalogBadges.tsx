import React from 'react'
import { Badge } from '@mantine/core'

export function EnabledBadge({ enabled }: { enabled: boolean }): JSX.Element {
  return (
    <Badge className="stats-model-catalog-enabled-badge" size="xs" variant="light" color={enabled ? 'green' : 'gray'}>
      {enabled ? '启用' : '禁用'}
    </Badge>
  )
}

export function ApiKeyStatusBadge({ hasApiKey }: { hasApiKey?: boolean }): JSX.Element {
  return (
    <Badge className="stats-model-catalog-apikey-badge" size="xs" variant="light" color={hasApiKey ? 'green' : 'gray'}>
      {hasApiKey ? 'Key 已配置' : 'Key 未配置'}
    </Badge>
  )
}

