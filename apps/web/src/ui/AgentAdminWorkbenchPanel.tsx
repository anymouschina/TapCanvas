import React from 'react'
import { Badge, Button, Drawer, Group, Pagination, Stack, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core'
import AgentProjectContextContent from './AgentProjectContextContent'
import AgentStateStoragePanel from './AgentStateStoragePanel'
import AgentTaskExecutionContent from './agent-task-execution/AgentTaskExecutionContent'
import { useLiveChatRunStore } from './chat/liveChatRunStore'
import { sendEmailCampaign, getEmailCampaignRecipients, type EmailCampaignRecipient } from '../api/server'

type AgentAdminWorkbenchPanelProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  bookId?: string | null
  chapterId?: string | null
  flowId?: string | null
  canEditGlobal?: boolean
  canEditProject?: boolean
  adminCapabilities: boolean
  onClose: () => void
}

function EmailCampaignPanel(): JSX.Element {
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [result, setResult] = React.useState<{ total: number; sent: number; failed: number; skippedNoEmail: number } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [recipients, setRecipients] = React.useState<EmailCampaignRecipient[]>([])
  const [recipientsTotal, setRecipientsTotal] = React.useState(0)
  const [recipientsPage, setRecipientsPage] = React.useState(1)
  const [recipientsLoading, setRecipientsLoading] = React.useState(false)
  const PAGE_SIZE = 10

  const loadRecipients = React.useCallback(async (page: number) => {
    setRecipientsLoading(true)
    try {
      const res = await getEmailCampaignRecipients(page, PAGE_SIZE)
      setRecipients(res.items)
      setRecipientsTotal(res.total)
      setRecipientsPage(page)
    } catch {
      // ignore
    } finally {
      setRecipientsLoading(false)
    }
  }, [])

  React.useEffect(() => { void loadRecipients(1) }, [loadRecipients])

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setResult(null)
    setError(null)
    try {
      const res = await sendEmailCampaign({ subject: subject.trim(), body: body.trim() })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setSending(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(recipientsTotal / PAGE_SIZE))

  return (
    <Stack gap="md" pt="md">
      <Text size="sm" fw={500}>
        收件人列表（共 {recipientsTotal} 人，已绑定邮箱且未退订）
      </Text>
      <Table striped highlightOnHover withTableBorder fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>登录名</Table.Th>
            <Table.Th>邮箱</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {recipientsLoading ? (
            <Table.Tr><Table.Td colSpan={2}><Text size="xs" c="dimmed">加载中…</Text></Table.Td></Table.Tr>
          ) : recipients.length === 0 ? (
            <Table.Tr><Table.Td colSpan={2}><Text size="xs" c="dimmed">暂无有效收件人</Text></Table.Td></Table.Tr>
          ) : recipients.map(r => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.login}</Table.Td>
              <Table.Td>{r.email}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {totalPages > 1 && (
        <Pagination
          total={totalPages}
          value={recipientsPage}
          onChange={(p) => void loadRecipients(p)}
          size="xs"
        />
      )}
      <TextInput
        label="邮件标题"
        placeholder="邮件标题"
        value={subject}
        onChange={(e) => setSubject(e.currentTarget.value)}
        maxLength={200}
        disabled={sending}
      />
      <Textarea
        label="邮件正文"
        placeholder="邮件正文，支持换行"
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        minRows={6}
        maxLength={5000}
        disabled={sending}
        autosize
      />
      <Group justify="flex-start">
        <Button
          onClick={handleSend}
          loading={sending}
          disabled={!subject.trim() || !body.trim()}
          color="gray"
        >
          发送群发邮件
        </Button>
      </Group>
      {result && (
        <Text size="sm" c="green">
          发送完成：共 {result.total} 封，成功 {result.sent} 封，失败 {result.failed} 封
          {result.skippedNoEmail > 0 ? `，跳过无邮箱 ${result.skippedNoEmail} 人` : ''}
        </Text>
      )}
      {error && (
        <Text size="sm" c="red">{error}</Text>
      )}
    </Stack>
  )
}

export default function AgentAdminWorkbenchPanel(props: AgentAdminWorkbenchPanelProps): JSX.Element {
  const { className, opened, projectId, bookId, chapterId, flowId, canEditGlobal = false, canEditProject = false, adminCapabilities, onClose } = props
  const [tab, setTab] = React.useState<string>('execution')
  const activeLiveRun = useLiveChatRunStore((state) => state.activeRun)

  React.useEffect(() => {
    if (!adminCapabilities && tab !== 'execution' && tab !== 'context') setTab('execution')
  }, [adminCapabilities, tab])

  return (
    <Drawer
      className={className}
      opened={opened}
      onClose={onClose}
      title={chapterId ? 'AI 执行台 · 当前章节' : 'AI 执行台'}
      position="right"
      size="min(760px, 94vw)"
      padding="md"
      withinPortal={false}
    >
      <Tabs className="agent-admin-workbench-tabs" value={tab} onChange={(value) => setTab(value || 'execution')}>
        <Tabs.List className="agent-admin-workbench-tab-list">
          <Tabs.Tab className="agent-admin-workbench-tab" value="execution">
            <Group className="agent-admin-workbench-tab-label" gap={6} wrap="nowrap">
              <span className="agent-admin-workbench-tab-label-text">当前任务</span>
              {activeLiveRun?.status === 'active' ? (
                <Badge className="agent-admin-workbench-tab-live-badge" size="xs" color="orange" variant="light">
                  live
                </Badge>
              ) : null}
            </Group>
          </Tabs.Tab>
          <Tabs.Tab className="agent-admin-workbench-tab" value="context">项目上下文</Tabs.Tab>
          {adminCapabilities ? (
            <>
              <Tabs.Tab className="agent-admin-workbench-tab" value="state">状态存储</Tabs.Tab>
              <Tabs.Tab className="agent-admin-workbench-tab" value="email-campaign">邮件群发</Tabs.Tab>
            </>
          ) : null}
        </Tabs.List>
        <Tabs.Panel className="agent-admin-workbench-tab-panel" value="execution" pt="md">
          <AgentTaskExecutionContent
            className="agent-admin-workbench-execution"
            opened={opened && tab === 'execution'}
            projectId={projectId}
            bookId={bookId}
            chapterId={chapterId}
            flowId={flowId}
            onReturnToChat={onClose}
          />
        </Tabs.Panel>
        <Tabs.Panel className="agent-admin-workbench-tab-panel" value="context" pt="md">
          <AgentProjectContextContent
            className="agent-admin-workbench-context"
            opened={opened && tab === 'context'}
            projectId={projectId}
            selection={null}
            canEditGlobal={canEditGlobal}
            canEditProject={canEditProject}
          />
        </Tabs.Panel>
        {adminCapabilities ? <Tabs.Panel className="agent-admin-workbench-tab-panel" value="state" pt="md">
          <AgentStateStoragePanel
            className="agent-admin-workbench-state-storage"
            opened={opened && tab === 'state'}
          />
        </Tabs.Panel> : null}
        {adminCapabilities ? <Tabs.Panel className="agent-admin-workbench-tab-panel" value="email-campaign" pt="md">
          <EmailCampaignPanel />
        </Tabs.Panel> : null}
      </Tabs>
    </Drawer>
  )
}
