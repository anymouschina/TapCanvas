import React from 'react'
import { Badge, Group, Modal, Tabs } from '@mantine/core'
import AgentDiagnosticsContent, { type AgentTraceContextSelection } from './AgentDiagnosticsContent'
import AgentProjectContextContent from './AgentProjectContextContent'
import AgentStateStoragePanel from './AgentStateStoragePanel'
import { useLiveChatRunStore } from './chat/liveChatRunStore'

type AgentAdminWorkbenchPanelProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  canEditGlobal?: boolean
  canEditProject?: boolean
  onClose: () => void
}

export default function AgentAdminWorkbenchPanel(props: AgentAdminWorkbenchPanelProps): JSX.Element {
  const { className, opened, projectId, canEditGlobal = false, canEditProject = false, onClose } = props
  const [tab, setTab] = React.useState<string>('context')
  const [selection, setSelection] = React.useState<AgentTraceContextSelection | null>(null)
  const activeLiveRun = useLiveChatRunStore((state) => state.activeRun)

  return (
    <Modal
      className={className}
      opened={opened}
      onClose={onClose}
      title="AI 管理工作台"
      centered={false}
      size="xl"
      padding="md"
    >
      <Tabs className="agent-admin-workbench-tabs" value={tab} onChange={(value) => setTab(value || 'context')}>
        <Tabs.List className="agent-admin-workbench-tab-list">
          <Tabs.Tab className="agent-admin-workbench-tab" value="context">项目上下文</Tabs.Tab>
          <Tabs.Tab className="agent-admin-workbench-tab" value="diagnostics">
            <Group className="agent-admin-workbench-tab-label" gap={6} wrap="nowrap">
              <span>AI 诊断</span>
              {activeLiveRun?.status === 'running' ? (
                <Badge className="agent-admin-workbench-tab-live-badge" size="xs" color="orange" variant="light">
                  live
                </Badge>
              ) : null}
            </Group>
          </Tabs.Tab>
          <Tabs.Tab className="agent-admin-workbench-tab" value="state">状态存储</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel className="agent-admin-workbench-tab-panel" value="context" pt="md">
          <AgentProjectContextContent
            className="agent-admin-workbench-context"
            opened={opened && tab === 'context'}
            projectId={projectId}
            selection={selection}
            canEditGlobal={canEditGlobal}
            canEditProject={canEditProject}
          />
        </Tabs.Panel>
        <Tabs.Panel className="agent-admin-workbench-tab-panel" value="diagnostics" pt="md">
          <AgentDiagnosticsContent
            className="agent-admin-workbench-diagnostics"
            opened={opened && tab === 'diagnostics'}
            projectId={projectId}
            onInspectTrace={(nextSelection) => {
              setSelection(nextSelection)
              setTab('context')
            }}
          />
        </Tabs.Panel>
        <Tabs.Panel className="agent-admin-workbench-tab-panel" value="state" pt="md">
          <AgentStateStoragePanel
            className="agent-admin-workbench-state-storage"
            opened={opened && tab === 'state'}
          />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}
