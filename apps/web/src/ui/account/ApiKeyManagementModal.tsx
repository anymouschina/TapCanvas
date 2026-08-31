import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  CopyButton,
  Group,
  Loader,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconChartBar, IconCheck, IconCopy, IconPencil, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import {
  createApiKey,
  deleteApiKey,
  listApiKeyBillingOptions,
  listApiKeys,
  rotateApiKey,
  updateApiKey,
  type ApiKeyScope,
  type ApiKeyBillingOptionDto,
  type ApiKeyDto,
} from '../../api/server'
import { useUIStore } from '../uiStore'
import { toast } from '../toast'
import { ApiKeyUsagePanel } from './ApiKeyUsagePanel'
import './api-key-management.css'

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

// 「跟随默认（不指定）」哨兵：提交时映射为 null（回落 key 拥有者解析出的团队）。
const BILLING_FOLLOW_DEFAULT = '__default__'
const ALL_API_KEY_SCOPES: ApiKeyScope[] = ['public:read', 'public:write', 'agent:execute']
const API_KEY_SCOPE_OPTIONS = [
  { value: 'public:read', label: '读取公开资源' },
  { value: 'public:write', label: '创建与修改资源' },
  { value: 'agent:execute', label: 'CLI / Agent API / 小T' },
]

function defaultExpiryInput(): string {
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  const local = new Date(expires.getTime() - expires.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toExpiryIso(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('请选择有效的过期时间')
  return parsed.toISOString()
}

function buildBillingSelectData(
  options: ApiKeyBillingOptionDto[],
): { value: string; label: string }[] {
  return [
    { value: BILLING_FOLLOW_DEFAULT, label: '跟随默认（不指定）' },
    ...options.map((option) => ({
      value: option.teamId,
      label: `${option.name}（${option.availableCredits}分）`,
    })),
  ]
}

type ApiKeyManagementModalProps = {
  className?: string
  opened: boolean
  onClose: () => void
  persistCreatedKeyLocally?: boolean
}

export function ApiKeyManagementModal({
  className,
  opened,
  onClose,
  persistCreatedKeyLocally = true,
}: ApiKeyManagementModalProps): JSX.Element {
  const modalClassName = ['account-api-key-modal', className].filter(Boolean).join(' ')
  const currentCanvasApiKey = useUIStore((state) => state.publicApiKey)
  const setCurrentCanvasApiKey = useUIStore((state) => state.setPublicApiKey)

  const [keys, setKeys] = React.useState<ApiKeyDto[]>([])
  const [keysLoading, setKeysLoading] = React.useState(false)
  const [keysError, setKeysError] = React.useState<string | null>(null)

  const [billingOptions, setBillingOptions] = React.useState<ApiKeyBillingOptionDto[]>([])
  const [billingLoading, setBillingLoading] = React.useState(false)
  const [billingError, setBillingError] = React.useState<string | null>(null)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createLabel, setCreateLabel] = React.useState(() => persistCreatedKeyLocally ? '当前画布' : 'Agent API')
  const [createOrigins, setCreateOrigins] = React.useState(defaultOriginsInput)
  const [createEnabled, setCreateEnabled] = React.useState(true)
  const [createScopes, setCreateScopes] = React.useState<ApiKeyScope[]>(ALL_API_KEY_SCOPES)
  const [createExpiresAt, setCreateExpiresAt] = React.useState(defaultExpiryInput)
  const [createBillingTeamId, setCreateBillingTeamId] = React.useState<string>(BILLING_FOLLOW_DEFAULT)
  const [createSubmitting, setCreateSubmitting] = React.useState(false)
  const [createdKey, setCreatedKey] = React.useState<string | null>(null)
  const [createdKeyVisible, setCreatedKeyVisible] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editLabel, setEditLabel] = React.useState('')
  const [editOrigins, setEditOrigins] = React.useState('')
  const [editEnabled, setEditEnabled] = React.useState(true)
  const [editScopes, setEditScopes] = React.useState<ApiKeyScope[]>(ALL_API_KEY_SCOPES)
  const [editExpiresAt, setEditExpiresAt] = React.useState(defaultExpiryInput)
  const [editBillingTeamId, setEditBillingTeamId] = React.useState<string>(BILLING_FOLLOW_DEFAULT)

  const [usageKeyId, setUsageKeyId] = React.useState<string | null>(null)

  const reloadKeys = React.useCallback(async () => {
    setKeysLoading(true)
    setKeysError(null)
    try {
      const result = await listApiKeys()
      setKeys(Array.isArray(result) ? result : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载 API Key 列表失败'
      setKeys([])
      setKeysError(message)
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
    if (opened) return
    setCreateOpen(false)
    setCreatedKey(null)
    setCreatedKeyVisible(false)
  }, [opened])

  React.useEffect(() => {
    if (!opened) return
    let cancelled = false
    setBillingLoading(true)
    setBillingError(null)
    void (async () => {
      try {
        const options = await listApiKeyBillingOptions()
        if (!cancelled) setBillingOptions(Array.isArray(options) ? options : [])
      } catch (error: unknown) {
        if (!cancelled) {
          setBillingOptions([])
          setBillingError(error instanceof Error ? error.message : '加载 API 配额失败')
        }
      } finally {
        if (!cancelled) setBillingLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [opened])

  const billingSelectData = React.useMemo(() => buildBillingSelectData(billingOptions), [billingOptions])

  const billingTeamNameById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const option of billingOptions) map.set(option.teamId, option.name)
    return map
  }, [billingOptions])

  const openCreate = React.useCallback(() => {
    setCreateLabel(persistCreatedKeyLocally ? '当前画布' : 'Agent API')
    setCreateOrigins(defaultOriginsInput())
    setCreateEnabled(true)
    setCreateScopes(ALL_API_KEY_SCOPES)
    setCreateExpiresAt(defaultExpiryInput())
    setCreateBillingTeamId(BILLING_FOLLOW_DEFAULT)
    setCreatedKey(null)
    setCreatedKeyVisible(false)
    setCreateOpen(true)
  }, [persistCreatedKeyLocally])

  const closeCreate = React.useCallback(() => {
    if (createSubmitting) return
    setCreateOpen(false)
    setCreatedKey(null)
    setCreatedKeyVisible(false)
  }, [createSubmitting])

  const handleCreate = React.useCallback(async () => {
    if (createSubmitting) return
    const label = createLabel.trim() || (persistCreatedKeyLocally ? '当前画布' : 'Agent API')
    const allowedOrigins = parseOriginsInput(createOrigins)
    if (!allowedOrigins.length) {
      toast('请至少填写一个 Origin，或使用 *', 'error')
      return
    }
    if (!createScopes.length) {
      toast('请至少选择一个权限范围', 'error')
      return
    }

    setCreateSubmitting(true)
    try {
      const result = await createApiKey({
        label,
        allowedOrigins,
        enabled: createEnabled,
        scopes: createScopes,
        expiresAt: toExpiryIso(createExpiresAt),
        billingTeamId:
          createBillingTeamId === BILLING_FOLLOW_DEFAULT ? null : createBillingTeamId,
      })
      setKeys((prev) => [result.apiKey, ...prev])
      setCreatedKey(result.key)
      setCreatedKeyVisible(false)
      if (persistCreatedKeyLocally) setCurrentCanvasApiKey(result.key)
      toast(persistCreatedKeyLocally ? 'API Key 已生成，并已写入当前画布' : 'API Key 已生成', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建 API Key 失败'
      toast(message, 'error')
    } finally {
      setCreateSubmitting(false)
    }
  }, [createBillingTeamId, createEnabled, createExpiresAt, createLabel, createOrigins, createScopes, createSubmitting, persistCreatedKeyLocally, setCurrentCanvasApiKey])

  const openEdit = React.useCallback((item: ApiKeyDto) => {
    setEditId(item.id)
    setEditLabel(item.label)
    setEditOrigins((item.allowedOrigins || []).join('\n'))
    setEditEnabled(item.enabled)
    setEditScopes(item.scopes)
    const expiry = item.expiresAt ? new Date(item.expiresAt) : new Date(defaultExpiryInput())
    const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000)
    setEditExpiresAt(localExpiry.toISOString().slice(0, 16))
    setEditBillingTeamId(item.billingTeamId || BILLING_FOLLOW_DEFAULT)
    setEditOpen(true)
  }, [])

  const closeEdit = React.useCallback(() => {
    setEditOpen(false)
    setEditId(null)
    setEditLabel('')
    setEditOrigins('')
    setEditEnabled(true)
    setEditScopes(ALL_API_KEY_SCOPES)
    setEditExpiresAt(defaultExpiryInput())
    setEditBillingTeamId(BILLING_FOLLOW_DEFAULT)
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
    if (!editScopes.length) {
      toast('请至少选择一个权限范围', 'error')
      return
    }

    setEditSubmitting(true)
    try {
      const updated = await updateApiKey(editId, {
        label,
        allowedOrigins,
        enabled: editEnabled,
        scopes: editScopes,
        expiresAt: toExpiryIso(editExpiresAt),
        billingTeamId:
          editBillingTeamId === BILLING_FOLLOW_DEFAULT ? null : editBillingTeamId,
      })
      setKeys((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      closeEdit()
      toast('API Key 已更新', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新 API Key 失败'
      setEditSubmitting(false)
      toast(message, 'error')
    }
  }, [closeEdit, editBillingTeamId, editEnabled, editExpiresAt, editId, editLabel, editOrigins, editScopes, editSubmitting])

  const handleRotate = React.useCallback(async (item: ApiKeyDto) => {
    if (!window.confirm(`轮换 API Key「${item.label}」？旧 Key 会立即失效。`)) return
    try {
      const result = await rotateApiKey(item.id)
      setKeys((current) => [result.apiKey, ...current.filter((entry) => entry.id !== item.id)])
      setCreatedKey(result.key)
      setCreatedKeyVisible(false)
      setCreateOpen(true)
      if (persistCreatedKeyLocally && currentCanvasApiKey.startsWith(item.keyPrefix)) {
        setCurrentCanvasApiKey(result.key)
      }
      toast('API Key 已轮换，旧 Key 已撤销', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'API Key 轮换失败', 'error')
    }
  }, [currentCanvasApiKey, persistCreatedKeyLocally, setCurrentCanvasApiKey])

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
        title="密钥管理"
        centered
        size="xl"
        aria-label="密钥管理"
      >
        <Stack className="account-api-key-modal-stack" gap="md">
          {persistCreatedKeyLocally ? <Stack className="account-api-key-modal-current" gap={6}>
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
          </Stack> : null}

          <Stack className="account-api-key-modal-quota" gap={6}>
            <Group className="account-api-key-modal-quota-header" justify="space-between" align="center">
              <Text className="account-api-key-modal-section-title" size="sm" fw={600}>
                可用配额
              </Text>
              {billingLoading ? <Loader className="account-api-key-modal-quota-loader" size="xs" /> : null}
            </Group>
            {billingError ? (
              <Text className="account-api-key-modal-quota-error" size="xs" c="red">
                {billingError}
              </Text>
            ) : null}
            {!billingLoading && !billingError && billingOptions.length === 0 ? (
              <Text className="account-api-key-modal-quota-empty" size="xs" c="dimmed">
                暂无可用计费账户
              </Text>
            ) : null}
            {billingOptions.length > 0 ? (
              <div className="account-api-key-modal-quota-list">
                {billingOptions.map((option) => (
                  <div className="account-api-key-modal-quota-item" key={option.teamId}>
                    <span className="account-api-key-modal-quota-name">{option.name}</span>
                    <strong className="account-api-key-modal-quota-value">{option.availableCredits.toLocaleString('zh-CN')} 积分</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </Stack>

          <Stack className="account-api-key-modal-list" gap="sm">
            <Group className="account-api-key-modal-list-header" justify="space-between" align="center">
              <div className="account-api-key-modal-section-heading">
                <Text className="account-api-key-modal-section-title" size="sm" fw={600}>
                  已有 API Key
                </Text>
                <Text className="account-api-key-modal-section-description" size="xs" c="dimmed">
                  {keys.length > 0 ? `${keys.length} 个密钥` : '管理调用权限、计费归属与消耗记录'}
                </Text>
              </div>
              <Group className="account-api-key-modal-list-actions" gap="xs" wrap="nowrap">
                <Tooltip className="account-api-key-modal-refresh-tooltip" label="刷新列表" withArrow>
                  <ActionIcon
                    className="account-api-key-modal-refresh"
                    variant="subtle"
                    size="md"
                    aria-label="刷新 API Key 列表"
                    onClick={() => void reloadKeys()}
                    loading={keysLoading}
                  >
                    <IconRefresh className="account-api-key-modal-refresh-icon" size={16} />
                  </ActionIcon>
                </Tooltip>
                <Button
                  className="account-api-key-modal-open-create"
                  leftSection={<IconPlus className="account-api-key-modal-open-create-icon" size={15} />}
                  onClick={openCreate}
                >
                  新建 API Key
                </Button>
              </Group>
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
                <Table className="account-api-key-modal-table" highlightOnHover verticalSpacing="xs">
                  <Table.Thead className="account-api-key-modal-table-head">
                    <Table.Tr className="account-api-key-modal-table-head-row">
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 150 }}>名称</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 120 }}>前缀</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell">Origin</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 150 }}>计费归属</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 110 }}>可用配额</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 160 }}>最近使用</Table.Th>
                      <Table.Th className="account-api-key-modal-table-head-cell" style={{ width: 132 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody className="account-api-key-modal-table-body">
                    {!keysLoading && !keysError && keys.length === 0 ? (
                      <Table.Tr className="account-api-key-modal-table-empty-row">
                        <Table.Td className="account-api-key-modal-table-empty-cell" colSpan={8}>
                          <Text className="account-api-key-modal-empty-text" size="sm" c="dimmed">
                            暂无 API Key
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                    {!keysLoading && keysError ? (
                      <Table.Tr className="account-api-key-modal-table-error-row">
                        <Table.Td className="account-api-key-modal-table-error-cell" colSpan={8}>
                          <Text className="account-api-key-modal-error-text" size="sm" c="red">
                            {keysError}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                    {keys.map((item) => (
                      <React.Fragment key={item.id}>
                      <Table.Tr className="account-api-key-modal-table-row">
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
                          <Text className="account-api-key-modal-scopes" size="xs" c="dimmed">
                            {item.scopes.join(' · ')} · 到期 {formatLastUsedAt(item.expiresAt)}
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
                          <Text className="account-api-key-modal-billing" size="sm" c={item.billingTeamId ? undefined : 'dimmed'}>
                            {item.billingTeamId
                              ? (item.billingTeamName || billingTeamNameById.get(item.billingTeamId) || item.billingTeamId)
                              : '默认'}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Text className="account-api-key-modal-quota-value-cell" size="sm" c={typeof item.billingAvailableCredits === 'number' ? undefined : 'dimmed'}>
                            {typeof item.billingAvailableCredits === 'number'
                              ? `${item.billingAvailableCredits.toLocaleString('zh-CN')} 积分`
                              : '随默认账户'}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Text className="account-api-key-modal-last-used" size="sm" c="dimmed">
                            {formatLastUsedAt(item.lastUsedAt)}
                          </Text>
                        </Table.Td>
                        <Table.Td className="account-api-key-modal-table-cell">
                          <Group className="account-api-key-modal-actions" gap={6} justify="flex-end" wrap="nowrap">
                            <Tooltip className="account-api-key-modal-usage-tooltip" label="消耗" withArrow>
                              <ActionIcon
                                className="account-api-key-modal-usage"
                                size="sm"
                                variant="light"
                                color={usageKeyId === item.id ? 'blue' : 'gray'}
                                aria-label="查看 API Key 消耗"
                                onClick={() => setUsageKeyId((prev) => (prev === item.id ? null : item.id))}
                              >
                                <IconChartBar className="account-api-key-modal-usage-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
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
                            <Tooltip className="account-api-key-modal-rotate-tooltip" label="轮换" withArrow>
                              <ActionIcon
                                className="account-api-key-modal-rotate"
                                size="sm"
                                variant="light"
                                aria-label="轮换 API Key"
                                onClick={() => void handleRotate(item)}
                              >
                                <IconRefresh className="account-api-key-modal-rotate-icon" size={14} />
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
                      <Table.Tr className="account-api-key-modal-usage-row">
                        <Table.Td className="account-api-key-modal-usage-cell" colSpan={8} p={0} style={{ borderTop: 'none' }}>
                          <Collapse in={usageKeyId === item.id}>
                            <div className="account-api-key-modal-usage-panel" style={{ padding: '8px 4px 16px' }}>
                              {usageKeyId === item.id ? <ApiKeyUsagePanel apiKeyId={item.id} /> : null}
                            </div>
                          </Collapse>
                        </Table.Td>
                      </Table.Tr>
                      </React.Fragment>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </Stack>
        </Stack>
      </Modal>

      <Modal
        className="account-api-key-create-modal"
        opened={createOpen}
        onClose={closeCreate}
        title={createdKey ? 'API Key 已生成' : '新建 API Key'}
        centered
        size="md"
        closeOnClickOutside={!createSubmitting}
        closeOnEscape={!createSubmitting}
        withCloseButton={!createSubmitting}
      >
        {createdKey ? (
          <Stack className="account-api-key-create-modal-result" gap="sm">
            <div className="account-api-key-create-modal-result-heading">
              <Text className="account-api-key-create-modal-result-title" size="sm" fw={600}>
                完整密钥仅在本次显示
              </Text>
              <Text className="account-api-key-create-modal-result-description" size="xs" c="dimmed">
                关闭弹窗后无法再次查看，请立即复制并保存到安全位置。
              </Text>
            </div>
            <PasswordInput
              className="account-api-key-modal-created-input"
              label="API Key"
              value={createdKey}
              readOnly
              visible={createdKeyVisible}
              onVisibilityChange={setCreatedKeyVisible}
            />
            <Group className="account-api-key-create-modal-result-actions" justify="flex-end" gap="xs">
              <Button
                className="account-api-key-create-modal-done"
                variant="subtle"
                onClick={closeCreate}
              >
                完成
              </Button>
              <CopyButton value={createdKey} timeout={1200}>
                {({ copied, copy }) => (
                  <Button
                    className="account-api-key-modal-created-copy"
                    leftSection={
                      copied
                        ? <IconCheck className="account-api-key-modal-created-copy-icon" size={15} />
                        : <IconCopy className="account-api-key-modal-created-copy-icon" size={15} />
                    }
                    onClick={copy}
                  >
                    {copied ? '已复制' : '复制 Key'}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        ) : (
          <Stack className="account-api-key-create-modal-stack" gap="sm">
            <Text className="account-api-key-create-modal-description" size="xs" c="dimmed">
              创建后仅显示一次完整密钥，请确认调用来源与计费账户。
            </Text>
            <TextInput
              className="account-api-key-modal-create-label"
              label="名称"
              value={createLabel}
              onChange={(event) => setCreateLabel(event.currentTarget.value)}
              placeholder={persistCreatedKeyLocally ? '例如：当前画布' : '例如：生产服务'}
            />
            <Select
              className="account-api-key-modal-create-billing"
              label="计费归属"
              description="指定扣费账户；不指定时跟随 Key 拥有者的默认团队。"
              data={billingSelectData}
              value={createBillingTeamId}
              onChange={(value) => setCreateBillingTeamId(value || BILLING_FOLLOW_DEFAULT)}
              allowDeselect={false}
              checkIconPosition="right"
            />
            <Textarea
              className="account-api-key-modal-create-origins"
              label="Origin 白名单"
              description="每行一个，也可以填 *；默认写入当前站点域名。"
              value={createOrigins}
              onChange={(event) => setCreateOrigins(event.currentTarget.value)}
              minRows={3}
              autosize
              placeholder={'https://example.com\nhttp://localhost:3000'}
            />
            <MultiSelect
              className="account-api-key-modal-create-scopes"
              label="权限范围"
              description="CLI 与 Agent API 需要“小T / Agent API”权限。"
              data={API_KEY_SCOPE_OPTIONS}
              value={createScopes}
              onChange={(value) => setCreateScopes(value as ApiKeyScope[])}
              hidePickedOptions
            />
            <TextInput
              className="account-api-key-modal-create-expiry"
              type="datetime-local"
              label="过期时间"
              value={createExpiresAt}
              onChange={(event) => setCreateExpiresAt(event.currentTarget.value)}
            />
            <Group className="account-api-key-modal-create-actions" justify="space-between" align="center" wrap="wrap">
              <Switch
                className="account-api-key-modal-create-enabled"
                checked={createEnabled}
                onChange={(event) => setCreateEnabled(event.currentTarget.checked)}
                label="创建后立即启用"
              />
              <Group className="account-api-key-create-modal-form-actions" gap="xs">
                <Button
                  className="account-api-key-create-modal-cancel"
                  variant="subtle"
                  disabled={createSubmitting}
                  onClick={closeCreate}
                >
                  取消
                </Button>
                <Button
                  className="account-api-key-modal-create-submit"
                  loading={createSubmitting}
                  onClick={() => void handleCreate()}
                >
                  {persistCreatedKeyLocally ? '生成并写入当前画布' : '生成 API Key'}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
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
          <Select
            className="account-api-key-edit-modal-billing"
            label="计费归属"
            description="分配给谁就扣谁的积分；跟随默认则回落 Key 拥有者的团队。"
            data={billingSelectData}
            value={editBillingTeamId}
            onChange={(value) => setEditBillingTeamId(value || BILLING_FOLLOW_DEFAULT)}
            allowDeselect={false}
            checkIconPosition="right"
          />
          <Textarea
            className="account-api-key-edit-modal-origins"
            label="Origin 白名单"
            value={editOrigins}
            onChange={(event) => setEditOrigins(event.currentTarget.value)}
            minRows={3}
            autosize
          />
          <MultiSelect
            className="account-api-key-edit-scopes"
            label="权限范围"
            data={API_KEY_SCOPE_OPTIONS}
            value={editScopes}
            onChange={(value) => setEditScopes(value as ApiKeyScope[])}
            hidePickedOptions
          />
          <TextInput
            className="account-api-key-edit-expiry"
            type="datetime-local"
            label="过期时间"
            value={editExpiresAt}
            onChange={(event) => setEditExpiresAt(event.currentTarget.value)}
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
