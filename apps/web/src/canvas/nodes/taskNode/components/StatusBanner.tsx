import React from 'react'
import { Paper, Text } from '@mantine/core'
import { formatErrorMessage } from '../../../utils/formatErrorMessage'
import { isModerationFailure } from '../../../../runner/taskErrorClassifier'

type StatusBannerProps = {
  status: string
  lastError?: unknown
  httpStatus?: number | null
}

function StatusBanner({ status, lastError, httpStatus }: StatusBannerProps) {
  const message = formatErrorMessage(lastError).trim()
  void httpStatus
  if (!(status === 'error' && message)) return null
  const moderationFailed = isModerationFailure(status, lastError)
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
        {moderationFailed ? '审核失败' : '执行错误'}
      </Text>
      <Text className="task-node-status-banner__message" size="xs" c="red.3" mt={4} style={{ wordBreak: 'break-word' }}>
        {message}
      </Text>
    </Paper>
  )
}

const _StatusBanner = React.memo(StatusBanner)
export { _StatusBanner as StatusBanner }
