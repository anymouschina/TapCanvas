import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  CopyButton,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconCheck, IconCopy, IconPencil, IconTrash } from '@tabler/icons-react'
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey, type ApiKeyDto } from '../../api/server'
import { useUIStore } from '../uiStore'
import { toast } from '../toast'

function parseOriginsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function formatLastUsedAt(value: string | null | undefined): string {
  if (!value) return '未使用'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString()
}

function defaultOriginsInput(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

type ApiKeyManagementModalProps = {
  className?: string
  opened: boolean
  onClose: () => void
}

export function ApiKeyManagementModal({
  className,
  opened,
  onClose,
}: ApiKeyManagementModalProps): JSX.Element {
  const modalClassName = ['account-api-key-modal', className].filter(Boolean).join(' ')
  const currentCanvasApiKey = useUIStore((state) => state.publicApiKey)
  const setCurrentCanvasApiKey = useUIStore((state) => state.setPublicApiKey)

  const [keys, setKeys] = React.useState<ApiKeyDto[]>([])
  const [keysLoading, setKeysLoading] = React.useState(false)

  const [createLabel, setCreateLabel] = React.useState('当前画布')
  const [createOrigins, setCreateOrigins] = React.useState(defaultOriginsInput)
  const [createEnabled, setCreateEnabled] = React.useState(true)
  const [createSubmitting, setCreateSubmitting] = React.useState(false)
  const [createdKey, setCreatedKey] = React.useState<string | null>(null)
  const [createdKeyVisible, setCreatedKeyVisible] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editLabel, setEditLabel] = React.useState('')
  const [editOrigins, setEditOrigins] = React.useState('')
  const [editEnabled, setEditEnabled] = React.useState(true)

  const reloadKeys = React.useCallback(async () => {
    setKeysLoading(true)
    try {
      const result = await listApiKeys()
      setKeys(Array.isArray(result) ? result : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载 API Key 列表失败'
      setKeys([])
      toast(message, 'error')
    } finally {
      setKeysLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!opened) return
    void reloadKeys()
  }, [opened, reloadKeys])

  React.useEffect(() => {
    if (!opened) return
    setCreateOrigins(defaultOriginsInput())
  }, [opened])

  const handleCreate = React.useCallback(async () => {
    if (createSubmitting) return
    const label = createLabel.trim() || '当前画布'
    const allowedOrigins = parseOriginsInput(createOrigins)
    if (!allowedOrigins.length) {
      toast('请至少填写一个 Origin，或使用 *', 'error')
      return
    }

    setCreateSubmitting(true)
    try {
      const result = await createApiKey({
        label,
        allowedOrigins,
        enabled: createEnabled,
      })
      setKeys((prev) => [result.apiKey, ...prev])
      setCreatedKey(result.key)
      setCreatedKeyVisible(false)
      setCurrentCanvasApiKey(result.key)
      toast('API Key 已生成，并已写入当前画布', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建 API Key 失败'
      toast(message, 'error')
    } finally {
      setCreateSubmitting(false)
    }
  }, [createEnabled, createLabel, createOrigins, createSubmitting, setCurrentCanvasApiKey])

  const openEdit = React.useCallback((item: ApiKeyDto) => {
    setEditId(item.id)
    setEditLabel(item.label)
    setEditOrigins((item.allowedOrigins || []).join('\n'))
    setEditEnabled(item.enabled)
    setEditOpen(true)
  }, [])

  const closeEdit = React.useCallback(() => {
    setEditOpen(false)
    setEditId(null)
    setEditLabel('')
    setEditOrigins('')
    setEditEnabled(true)
    setEditSubmitting(false)
  }, [])

  const handleEditSave = React.useCallback(async () => {
    if (!editId || editSubmitting) return
    const label = editLabel.trim() || '未命名'
    const allowedOrigins = parseOriginsInput(editOrigins)
    if (!allowedOrigins.length) {
      toast('请至少填写一个 Origin，或使用 *', 'error')
      return
    }

    setEditSubmitting(true)
    try {
      const updated = await updateApiKey(editId, {
        label,
        allowedOrigins,
        enabled: editEnabled,
      })
      setKeys((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      closeEdit()
      toast('API Key 已更新', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新 API Key 失败'
      setEditSubmitting(false)
      toast(message, 'error')
    }
  }, [closeEdit, editEnabled, editId, editLabel, editOrigins, editSubmitting])

  const handleDelete = React.useCallback(async (item: ApiKeyDto) => {
    const confirmed = window.confirm(`确定删除 API Key「${item.label || item.keyPrefix}」？删除后外部调用将立即失效。`)
    if (!confirmed) return
    try {
      await deleteApiKey(item.id)
      setKeys((prev) => prev.filter((entry) => entry.id !== item.id))
      toast('API Key 已删除', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除 API Key 失败'
      toast(message, 'error')
    }
  }, [])

  const handleClearCurrentCanvasKey = React.useCallback(() => {
    setCurrentCanvasApiKey('')
    toast('已清空当前画布保存的 API Key', 'success')
  }, [setCurrentCanvasApiKey])

  return (
    <>
      <Modal
        className={modalClassName}
        opened={opened}
        onClose={onClose}
        title="API 管理"
        centered
        size="lg"
      >
        <Stack className="account-api-key-modal-stack" gap="md">
          <Stack className="account-api-key-modal-current" gap={6}>
            <Text className="account-api-key-modal-section-title" size="sm" fw={600}>
              当前画布 Key
            </Text>
            <Group className="account-api-key-modal-current-row" justify="space-between" align="center" wrap="nowrap">
              <Text className="account-api-key-modal-current-text" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                {currentCanvasApiKey ? `${currentCanvasApiKey.slice(0, 12)}...` : '当前画布尚未保存 API Key'}
              </Text>
              {currentCanvasApiKey ? (
                <Button
                  className="account-api-key-modal-current-clear"
                  variant="subtle"
                  size="xs"
                  onClick={handleClearCurrentCanvasKey}
                >
                  清空
                </Button>
              ) : null}
            </Group>
            <Text className="account-api-key-modal-current-hint" size="xs" c="dimmed">
              新建成功后会自动写入当前画布；旧 Key 无法从列表反查明文，只能在创建当次复制保存。
            </Text>
          </Stack>

          <Stack className="account-api-key-modal-create" gap="sm">
            <Text className="account-api-key-modal-section-title" size="sm" fw={600}>
              新建 API Key
            </Text>
            <Group className="account-api-key-modal-create-row" gap="sm" align="flex-start" wrap="wrap">
              <TextInput
                className="account-api-key-modal-create-label"
                label="名称"
                value={createLabel}
                onChange={(event) => setCreateLabel(event.currentTarget.value)}
                placeholder="例如：当前画布"
                w={240}
              />
              <Switch
                className="account-api-key-modal-create-enabled"
                checked={createEnabled}
                onChange={(event) => setCreateEnabled(event.currentTarget.checked)}
                label="启用"
                mt={26}
              />
              <Button
                className="account-api-key-modal-create-submit"
                loading={createSubmitting}
                onClick={() => void handleCreate()}
                mt={22}
              >
                生成并写入当前画布
              </Button>
            </Group>
            <Textarea
              className="account-api-key-modal-create-origins"
              label="Origin 白名单"
              description="每行一个；也可以填 *。默认写入当前站点域名。"
              value={createOrigins}
              onChange={(event) => setCreateOrigins(event.currentTarget.value)}
              minRows={2}
              autosize
              placeholder={'https://example.com\nhttp://localhost:3000'}
            />
            {createdKey ? (
              <Stack className="account-api-key-modal-created" gap={6}>
                <PasswordInput
                  className="account-api-key-modal-created-input"
                  label="刚生成的 Key（仅本次可见）"
                  value={createdKey}
                  readOnly
                  visible={createdKeyVisible}
                  onVisibilityChange={setCreatedKeyVisible}
                />
                <Group className="account-api-key-modal-created-actions" gap="xs" justify="space-between" wrap="wrap">
                  <Text className="account-api-key-modal-created-hint" size="xs" c="dimmed">
                    关闭后不会再返回明文，请立即复制到你的站点或 skill 配置里。
                  </Text>
                  <CopyButton value={createdKey} timeout={1200}>
                    {({ copied, copy }) => (
                      <Button
                        className="account-api-key-modal-created-copy"
                        variant="light"
                        size="xs"
                        leftSection={
                          copied
                            ? <IconCheck className="account-api-key-modal-created-copy-icon" size={14} />
                            : <IconCopy className="account-api-key-modal-created-copy-icon" size={14} />
                        }
                        onClick={copy}
                      >
                        {copied ? '已复制' : '复制 Key'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              </Stack>
            ) : null}
          </Stack>

          <Stack className="account-api-key-modal-list" gap="sm">
            <Group className="account-api-key-modal-list-header" justify="space-between" align="center">
              <Text className="account-api-key-modal-section-title" size="sm" fw={600}>
                已有 API Key
              </Text>
              <Button
                className="account-api-key-modal-refresh"
                variant="subtle"
                size="xs"
                onClick={() => void reloadKeys()}
                loading={keysLoading}
              >
                刷新
              </Button>
            </Group>
            {keysLoading && !keys.length ? (
              <Group className="account-api-key-modal-loading" gap="xs">
                <Loader className="account-api-key-modal-loading-icon" size="sm" />
                <Text className="account-api-key-modal-loading-text" size="sm" c="dimmed">
                  加载中…
                </Text>
              </Group>
            ) : (
              <div className="account-api-key-modal-table-wrap" style={{ overflowX: 'auto' }}>
                <Table className="account-api-key-modal-table" striped highlightOnHover verticalSpacing="xs">
                  <Table.Thead className="account-api-key-modal-table-head">
                    <Table.Tr className="account-api-key-modal-table-head-row">
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 150 }}>名称</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 120 }}>前缀</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell">Origin</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 160 }}>最近使用</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 96 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody className="account-api-key-modal-table-body">
                    {!keysLoading && keys.length === 0 ? (
                      <Table.Tr className="account-api-key-modal-table-empty-row">
                        <Table.Td className="account-api-key-modal-table-empty-cell" colSpan={6}>
                          <Text className="account-api-key-modal-empty-text" size="sm" c="dimmed">
                            暂无 API Key
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                    {keys.map((item) => (
                      <Table.Tr className="account-api-key-modal-table-row" key={item.id}>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Text className="account-api-key-modal-label" size="sm" fw={600}>
                            {item.label || '未命名'}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Text className="account-api-key-modal-prefix" size="sm" c="dimmed">
                            {item.keyPrefix}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Text className="account-api-key-modal-origins" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                            {(item.allowedOrigins || []).join(', ') || '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Badge
                            className="account-api-key-modal-status"
                            size="xs"
                            variant="light"
                            color={item.enabled ? 'green' : 'gray'}
                          >
                            {item.enabled ? '启用' : '禁用'}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Text className="account-api-key-modal-last-used" size="sm" c="dimmed">
                            {formatLastUsedAt(item.lastUsedAt)}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Group className="account-api-key-modal-actions" gap={6} justify="flex-end" wrap="nowrap">
                            <Tooltip className="account-api-key-modal-edit-tooltip" label="编辑" withArrow>
                              <ActionIcon
                                className="account-api-key-modal-edit"
                                size="sm"
                                variant="light"
                                aria-label="编辑 API Key"
                                onClick={() => openEdit(item)}
                              >
                                <IconPencil className="account-api-key-modal-edit-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip className="account-api-key-modal-delete-tooltip" label="删除" withArrow>
                              <ActionIcon
                                className="account-api-key-modal-delete"
                                size="sm"
                                variant="light"
                                color="red"
                                aria-label="删除 API Key"
                                onClick={() => void handleDelete(item)}
                              >
                                <IconTrash className="account-api-key-modal-delete-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </Stack>
        </Stack>
      </Modal>

      <Modal
        className="account-api-key-edit-modal"
        opened={editOpen}
        onClose={closeEdit}
        title="编辑 API Key"
        centered
        size="md"
      >
        <Stack className="account-api-key-edit-modal-stack" gap="sm">
          <TextInput
            className="account-api-key-edit-modal-label"
            label="名称"
            value={editLabel}
            onChange={(event) => setEditLabel(event.currentTarget.value)}
          />
          <Switch
            className="account-api-key-edit-modal-enabled"
            checked={editEnabled}
            onChange={(event) => setEditEnabled(event.currentTarget.checked)}
            label="启用"
          />
          <Textarea
            className="account-api-key-edit-modal-origins"
            label="Origin 白名单"
            value={editOrigins}
            onChange={(event) => setEditOrigins(event.currentTarget.value)}
            minRows={3}
            autosize
          />
          <Group className="account-api-key-edit-modal-actions" justify="flex-end" gap="xs">
            <Button
              className="account-api-key-edit-modal-cancel"
              variant="subtle"
              onClick={closeEdit}
            >
              取消
            </Button>
            <Button
              className="account-api-key-edit-modal-submit"
              loading={editSubmitting}
              onClick={() => void handleEditSave()}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
