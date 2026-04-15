import React from 'react'
import { Paper, Text } from '@mantine/core'
import { formatErrorMessage } from '../../../utils/formatErrorMessage'

type StatusBannerProps = {
  status: string
  lastError?: unknown
  httpStatus?: number | null
}

export function StatusBanner({ status, lastError, httpStatus }: StatusBannerProps) {
  const message = formatErrorMessage(lastError).trim()
  void httpStatus
  if (!(status === 'error' && message)) return null
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
        {message}
      </Text>
    </Paper>
  )
}
