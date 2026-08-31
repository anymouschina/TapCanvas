import React from 'react'
import { Modal, Group, Text } from '@mantine/core'
import { useIntentLifecycle } from './intentLifecycle'
import { dispatchIntent } from './dispatchIntent'
import {
  PendingUserInputChoices,
  type PendingUserInputAnswer,
} from '../ui/chat/PendingUserInputChoices'

export function CanvasIntentInputDialog() {
  const pendingUserInput = useIntentLifecycle((s) => s.pendingUserInput)
  const clearPendingUserInput = useIntentLifecycle((s) => s.clearPendingUserInput)

  if (!pendingUserInput) return null

  const { request, intent, sourceNodeId, chapterContext, generationConfig, variantParams } = pendingUserInput

  function handleSubmit(response: { requestId: string; answers: PendingUserInputAnswer[] }) {
    clearPendingUserInput()
    void dispatchIntent(intent, sourceNodeId, {
      chapterContext,
      generationConfig,
      variantParams,
      requestUserInputResponse: response,
    })
  }

  if (request.questions.length === 0) return null

  return (
    <Modal
      opened
      onClose={clearPendingUserInput}
      title={
        <Group gap={8}>
          <Text fw={600} size="sm">Agent 需要您的选择</Text>
        </Group>
      }
      centered
      size="sm"
      withCloseButton
      zIndex={300}
    >
      <PendingUserInputChoices request={request} onSubmit={handleSubmit} />
    </Modal>
  )
}
