import React from 'react'
import { Paper, Text } from '@mantine/core'

type StatusBannerProps = {
  status: string
  lastError?: string | null
  httpStatus?: number | null
}

export function StatusBanner({ status, lastError, httpStatus }: StatusBannerProps) {
  if (!(status === 'error' && lastError)) return null
  return (
    <Paper
      className="task-node-status-banner"
      radius="md"
      p="xs"
      mb="xs"
      style={{
        background: 'rgba(239,68,68,0.1)',
        borderColor: 'rgba(239,68,68,0.3)',
        border: 'none',
      }}
    >
      <Text className="task-node-status-banner__title" size="xs" c="red.4" style={{ fontWeight: 500 }}>
        执行错误
      </Text>
      <Text className="task-node-status-banner__message" size="xs" c="red.3" mt={4} style={{ wordBreak: 'break-word' }}>
        {lastError}
      </Text>
      {httpStatus === 429 && (
        <Text className="task-node-status-banner__hint" size="xs" c="red.2" mt={4} style={{ fontStyle: 'italic' }}>
          💡 提示：API 配额已用尽，请稍后重试或升级您的服务计划
        </Text>
      )}
    </Paper>
  )
}
