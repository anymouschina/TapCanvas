import React from 'react'
import { Modal } from '@mantine/core'
import AgentProjectContextContent from './AgentProjectContextContent'

type AgentProjectContextPanelProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  onClose: () => void
}

export default function AgentProjectContextPanel(props: AgentProjectContextPanelProps): JSX.Element {
  const { className, opened, projectId, onClose } = props

  return (
    <Modal
      className={className}
      opened={opened}
      onClose={onClose}
      title="项目上下文"
      centered={false}
      size="xl"
      padding="md"
    >
      <AgentProjectContextContent className="agent-project-context-panel-stack" opened={opened} projectId={projectId} />
    </Modal>
  )
}
