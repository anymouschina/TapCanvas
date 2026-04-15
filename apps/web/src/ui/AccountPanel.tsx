import React from 'react'
import { ActionIcon, Avatar, Badge, CopyButton, Divider, Group, Loader, Modal, Paper, SegmentedControl, Stack, Table, Text, Title, Tooltip, Transition, useMantineColorScheme } from '@mantine/core'
import { IconApi, IconBrandGithub, IconCheck, IconCoins, IconCopy, IconCreditCard, IconLogout2, IconReceipt2, IconRefresh } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useAuth } from '../auth/store'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { getMyTeam, listModelCatalogModels, listMyTeamCreditLedger, listTaskLogs, type BillingModelKind, type ModelCatalogModelDto, type TeamCreditLedgerEntryDto, type TeamDto, type VendorCallLogDto, type VendorCallLogStatus } from '../api/server'
import { PanelCard } from './PanelCard'
import RechargeModal from './RechargeModal'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { ApiKeyManagementModal } from './account/ApiKeyManagementModal'

function formatCredits(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
  return String(n)
}

function formatTime(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  return new Date(t).toLocaleString()
}

function describeLedgerEntryType(entryType: TeamCreditLedgerEntryDto['entryType']): { label: string; color: string } {
  if (entryType === 'topup') return { label: '充值', color: 'green' }
  if (entryType === 'reserve') return { label: '冻结', color: 'yellow' }
  if (entryType === 'release') return { label: '解冻', color: 'blue' }
  return { label: '扣减', color: 'red' }
}

function formatLedgerAmount(entry: TeamCreditLedgerEntryDto): string {
  const amount = formatCredits(entry.amount)
  if (entry.entryType === 'topup' || entry.entryType === 'release') return `+${amount}`
  return `-${amount}`
}

function describeTaskStatus(status: VendorCallLogStatus | null): { label: string; color: string } {
  if (status === 'succeeded') return { label: '成功', color: 'green' }
  if (status === 'failed') return { label: '失败', color: 'red' }
  if (status === 'running') return { label: '运行中', color: 'yellow' }
  return { label: '—', color: 'gray' }
}

function kindLabel(kind: BillingModelKind | string | null | undefined): string {
  if (kind === 'image') return '图片'
  if (kind === 'video') return '视频'
  if (kind === 'text') return '文本'
  return '—'
}

function defaultCostByKind(kind: BillingModelKind | string | null | undefined): number {
  if (kind === 'image') return 1
  if (kind === 'video') return 10
  return 0
}

function normalizeCatalogModelMap(items: ModelCatalogModelDto[]): Map<string, { modelKey: string; labelZh: string; kind: BillingModelKind | null; pricingCost: number; pricingEnabled: boolean; specRows: Array<{ specKey: string; cost: number; enabled: boolean }> }> {
  const map = new Map<string, { modelKey: string; labelZh: string; kind: BillingModelKind | null; pricingCost: number; pricingEnabled: boolean; specRows: Array<{ specKey: string; cost: number; enabled: boolean }> }>()
  for (const item of items) {
    const modelKey = typeof item?.modelKey === 'string' ? item.modelKey.trim() : ''
    if (!modelKey) continue
    const dedupeKey = modelKey.toLowerCase()
    if (map.has(dedupeKey)) continue
    const labelZh = typeof item?.labelZh === 'string' && item.labelZh.trim() ? item.labelZh.trim() : modelKey
    const rawKind = item?.kind
    const kind = rawKind === 'text' || rawKind === 'image' || rawKind === 'video' ? rawKind : null
    const pricingCost = typeof item?.pricing?.cost === 'number' && Number.isFinite(item.pricing.cost) ? Math.max(0, Math.floor(item.pricing.cost)) : defaultCostByKind(kind)
    const pricingEnabled = typeof item?.pricing?.enabled === 'boolean' ? item.pricing.enabled : true
    const specRows = Array.isArray(item?.pricing?.specCosts)
      ? item.pricing.specCosts
          .map((spec) => {
            const specKey = typeof spec?.specKey === 'string' ? spec.specKey.trim() : ''
            if (!specKey) return null
            return {
              specKey,
              cost: typeof spec.cost === 'number' && Number.isFinite(spec.cost) ? Math.max(0, Math.floor(spec.cost)) : 0,
              enabled: !!spec.enabled,
            }
          })
          .filter((spec): spec is { specKey: string; cost: number; enabled: boolean } => spec !== null)
      : []
    map.set(dedupeKey, { modelKey, labelZh, kind, pricingCost, pricingEnabled, specRows })
  }
  return map
}

function extractModelFromRequestPayload(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>

    const pick = (v: unknown): string | null => {
      if (typeof v !== 'string') return null
      const trimmed = v.trim()
      return trimmed ? trimmed : null
    }

    return (
      pick(obj.model) ||
      pick(obj.modelKey) ||
      pick(obj.model_key) ||
      pick(obj.modelAlias) ||
      pick(obj.model_alias) ||
      (obj.request && typeof obj.request === 'object'
        ? pick((obj.request as Record<string, unknown>).model) ||
          pick((obj.request as Record<string, unknown>).modelKey) ||
          pick((obj.request as Record<string, unknown>).model_key) ||
          pick((obj.request as Record<string, unknown>).modelAlias) ||
          pick((obj.request as Record<string, unknown>).model_alias)
        : null)
    )
  } catch {
    return null
  }
}

export default function AccountPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const promptSuggestMode = useUIStore(s => s.promptSuggestMode)
  const setPromptSuggestMode = useUIStore(s => s.setPromptSuggestMode)
  const mounted = active === 'account'
  const user = useAuth(s => s.user)
  const clear = useAuth(s => s.clear)
  const { colorScheme } = useMantineColorScheme()
  const [team, setTeam] = React.useState<TeamDto | null>(null)
  const [teamLoading, setTeamLoading] = React.useState(false)
  const [ledgerOpen, setLedgerOpen] = React.useState(false)
  const [rechargeOpen, setRechargeOpen] = React.useState(false)
  const [apiKeyModalOpen, setApiKeyModalOpen] = React.useState(false)
  const [modelCostsOpen, setModelCostsOpen] = React.useState(false)
  const [ledgerLoading, setLedgerLoading] = React.useState(false)
  const [modelCostsLoading, setModelCostsLoading] = React.useState(false)
  const [ledgerRows, setLedgerRows] = React.useState<Array<TeamCreditLedgerEntryDto & {
    taskStatus: VendorCallLogStatus | null
    taskVendor: string | null
    taskModel: string | null
  }>>([])
  const [catalogModels, setCatalogModels] = React.useState<ModelCatalogModelDto[]>([])
  const [modelCostsError, setModelCostsError] = React.useState<string | null>(null)
  const isGuest = Boolean(user?.guest)
  const isGithubUser = Boolean(!isGuest && user?.login && /^\d+$/.test(String(user?.sub ?? '')))
  const githubLogin = user?.login ?? ''

  React.useEffect(() => {
    if (!mounted || !user || isGuest) {
      setTeam(null)
      setTeamLoading(false)
      return
    }
    let disposed = false
    setTeamLoading(true)
    void getMyTeam()
      .then((res) => {
        if (disposed) return
        setTeam(res?.team || null)
      })
      .catch(() => {
        if (disposed) return
        setTeam(null)
      })
      .finally(() => {
        if (disposed) return
        setTeamLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [mounted, user?.sub, isGuest])

  const loadLedger = React.useCallback(async () => {
    if (!user || isGuest) {
      setLedgerRows([])
      setLedgerLoading(false)
      return
    }

    setLedgerLoading(true)
    try {
      const [ledger, taskLogs] = await Promise.all([
        listMyTeamCreditLedger(),
        listTaskLogs({ limit: 200 }),
      ])

      const taskMap = new Map<string, VendorCallLogDto>()
      for (const item of taskLogs.items || []) {
        const taskId = typeof item.taskId === 'string' ? item.taskId.trim() : ''
        if (!taskId || taskMap.has(taskId)) continue
        taskMap.set(taskId, item)
      }

      const rows = (Array.isArray(ledger) ? ledger : []).map((item) => {
        const taskId = typeof item.taskId === 'string' ? item.taskId.trim() : ''
        const task = taskId ? taskMap.get(taskId) || null : null
        return {
          ...item,
          taskStatus: task?.status || null,
          taskVendor: task?.vendor || null,
          taskModel: extractModelFromRequestPayload(task?.requestPayload || null),
        }
      })
      setLedgerRows(rows)
    } catch {
      setLedgerRows([])
    } finally {
      setLedgerLoading(false)
    }
  }, [isGuest, user])

  React.useEffect(() => {
    if (!ledgerOpen) return
    void loadLedger()
  }, [ledgerOpen, loadLedger])

  const loadModelCosts = React.useCallback(async () => {
    if (isGuest) {
      setCatalogModels([])
      setModelCostsLoading(false)
      setModelCostsError(null)
      return
    }

    setModelCostsLoading(true)
    setModelCostsError(null)
    try {
      const models = await listModelCatalogModels({ enabled: true })
      setCatalogModels(Array.isArray(models) ? models : [])
    } catch {
      setCatalogModels([])
      setModelCostsError('加载模型积分价格失败')
    } finally {
      setModelCostsLoading(false)
    }
  }, [isGuest])

  React.useEffect(() => {
    if (!modelCostsOpen) return
    void loadModelCosts()
  }, [modelCostsOpen, loadModelCosts])

  const modelCostRows = React.useMemo(() => {
    const catalogMap = normalizeCatalogModelMap(catalogModels)
    const rows: Array<{
      modelKey: string
      specKey?: string
      labelZh: string
      kind: BillingModelKind | null
      cost: number
      enabled: boolean
    }> = []

    for (const [dedupeKey, meta] of catalogMap.entries()) {
      const modelKey = meta.modelKey || dedupeKey
      rows.push({
        modelKey,
        labelZh: meta.labelZh,
        kind: meta.kind,
        cost: meta.pricingCost,
        enabled: meta.pricingEnabled,
      })
      for (const spec of meta.specRows) {
        rows.push({
          modelKey,
          specKey: spec.specKey,
          labelZh: meta.labelZh,
          kind: meta.kind,
          cost: spec.cost,
          enabled: spec.enabled,
        })
      }
    }

    rows.sort((a, b) => {
      const kindA = a.kind || 'unknown'
      const kindB = b.kind || 'unknown'
      if (kindA !== kindB) return kindA.localeCompare(kindB)
      const mk = a.modelKey.localeCompare(b.modelKey)
      if (mk !== 0) return mk
      return String(a.specKey || '').localeCompare(String(b.specKey || ''))
    })
    return rows
  }, [catalogModels])

  if (!mounted) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 120)
  const accountTypeLabel = team?.id?.startsWith('personal_') ? '个人' : '企业'
  return (
    <div className="account-panel-anchor" style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 100 : 140), zIndex: 200 }} data-ux-panel>
      <Transition className="account-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="account-panel-transition-inner" style={styles}>
            <PanelCard
              className="glass"
              style={{
                width: 300,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transformOrigin: 'left center',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="account-panel-arrow panel-arrow" />
              <div className="account-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Group className="account-panel-header">
                  <Avatar className="account-panel-avatar" src={user?.avatarUrl} alt={user?.login} radius={999} />
                  <div className="account-panel-user">
                    <Title className="account-panel-user-name" order={6}>{user?.login || '未登录'}</Title>
                    {user?.email && <Text className="account-panel-user-email" size="xs" c="dimmed">{user.email}</Text>}
                    {isGuest && <Text className="account-panel-user-guest" size="xs" c="dimmed">游客模式（仅保存在当前浏览器）</Text>}
                  </div>
                </Group>
                <Divider className="account-panel-divider" my={10} />
                <Stack className="account-panel-credits" gap={4}>
                  <Text className="account-panel-credits-title" size="xs" c="dimmed">积分</Text>
                  {isGuest ? (
                    <Text className="account-panel-credits-guest" size="xs" c="dimmed">游客模式无团队积分账户</Text>
                  ) : teamLoading ? (
                    <Text className="account-panel-credits-loading" size="xs" c="dimmed">加载中…</Text>
                  ) : team ? (
                    <Group className="account-panel-credits-values" gap={8} wrap="wrap">
                      <Text className="account-panel-credits-available" size="xs">可用 {formatCredits(team.creditsAvailable)}</Text>
                      <Text className="account-panel-credits-frozen" size="xs" c="dimmed">冻结 {formatCredits(team.creditsFrozen)}</Text>
                      <Text className="account-panel-credits-total" size="xs" c="dimmed">总额 {formatCredits(team.credits)}</Text>
                    </Group>
                  ) : (
                    <Text className="account-panel-credits-empty" size="xs" c="dimmed">暂无团队积分账户</Text>
                  )}
                </Stack>
                  <Divider className="account-panel-divider" my={10} />
                <Stack className="account-panel-actions" gap={6}>
                  <Group className="account-panel-action-icons" gap={8} justify="space-between" align="flex-start" wrap="nowrap">
                    <Group className="account-panel-action-icons-main" gap={8} wrap="wrap">
                      {isGithubUser && githubLogin && (
                        <Tooltip className="account-panel-github-tooltip" label="查看 GitHub" withArrow>
                          <ActionIcon className="account-panel-github" component="a" href={`https://github.com/${githubLogin}`} target="_blank" variant="light" size="md" aria-label="查看 GitHub">
                            <IconBrandGithub className="account-panel-github-icon" size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!isGuest && (
                        <Tooltip className="account-panel-recharge-tooltip" label="充值积分" withArrow>
                          <ActionIcon className="account-panel-recharge" variant="light" size="md" onClick={() => setRechargeOpen(true)} aria-label="充值积分">
                            <IconCreditCard className="account-panel-recharge-icon" size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!isGuest && (
                        <Tooltip className="account-panel-ledger-tooltip" label="积分流水" withArrow>
                          <ActionIcon className="account-panel-ledger" variant="light" size="md" onClick={() => setLedgerOpen(true)} aria-label="查看积分流水">
                            <IconReceipt2 className="account-panel-ledger-icon" size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!isGuest && (
                        <Tooltip className="account-panel-model-cost-tooltip" label="模型积分价格" withArrow>
                          <ActionIcon className="account-panel-model-cost" variant="light" size="md" onClick={() => setModelCostsOpen(true)} aria-label="查看模型积分价格">
                            <IconCoins className="account-panel-model-cost-icon" size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                    <Stack className="account-panel-action-icons-side" gap={6} align="center">
                      {!isGuest && (
                        <Tooltip className="account-panel-api-key-tooltip" label="API 管理" withArrow>
                          <ActionIcon className="account-panel-api-key" variant="light" size="md" onClick={() => setApiKeyModalOpen(true)} aria-label="API 管理">
                            <IconApi className="account-panel-api-key-icon" size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip className="account-panel-logout-tooltip" label="退出登录" withArrow>
                        <ActionIcon className="account-panel-logout" variant="light" color="red" size="md" onClick={()=>{ clear(); setActivePanel(null) }} aria-label="退出登录">
                          <IconLogout2 className="account-panel-logout-icon" size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Stack>
                  </Group>
                  <Divider className="account-panel-divider" label="提示词自动补全" labelPosition="left" my={8} />
                  <Stack className="account-panel-autocomplete" gap={4}>
                    <Text className="account-panel-autocomplete-label" size="xs" c={colorScheme === 'dark' ? '#cbd5f5' : '#1f2937'}>补全模式</Text>
                    <SegmentedControl
                      className="account-panel-autocomplete-control"
                      size="xs"
                      value={promptSuggestMode}
                      onChange={(v) => setPromptSuggestMode(v as 'off' | 'history' | 'semantic')}
                      data={[
                        { label: <span className="account-panel-autocomplete-option" style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>关闭</span>, value: 'off' },
                        { label: <span className="account-panel-autocomplete-option" style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>历史匹配</span>, value: 'history' },
                        { label: <span className="account-panel-autocomplete-option" style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>语义匹配</span>, value: 'semantic' },
                      ]}
                    />
                  </Stack>
                </Stack>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
      <ApiKeyManagementModal
        className="account-panel-api-key-management-modal"
        opened={apiKeyModalOpen}
        onClose={() => setApiKeyModalOpen(false)}
      />
      <Modal
        className="account-panel-ledger-modal"
        opened={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        title="我的积分流水"
        size="xl"
        centered
      >
        <Stack className="account-panel-ledger-stack" gap="sm">
          <Group className="account-panel-ledger-header" justify="space-between" align="center">
            <Group className="account-panel-ledger-header-left" gap={8}>
              <Badge className="account-panel-ledger-account-type" variant="light" color={accountTypeLabel === '个人' ? 'blue' : 'grape'}>
                {accountTypeLabel}
              </Badge>
              <Text className="account-panel-ledger-account-id" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                {team?.id || '—'}
              </Text>
            </Group>
            <Tooltip className="account-panel-ledger-refresh-tooltip" label="刷新" withArrow>
              <ActionIcon
                className="account-panel-ledger-refresh"
                variant="subtle"
                size="sm"
                aria-label="refresh-ledger"
                onClick={() => void loadLedger()}
                loading={ledgerLoading}
              >
                <IconRefresh className="account-panel-ledger-refresh-icon" size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {ledgerLoading && !ledgerRows.length ? (
            <Group className="account-panel-ledger-loading" gap={8} align="center">
              <Loader className="account-panel-ledger-loading-icon" size="sm" />
              <Text className="account-panel-ledger-loading-text" size="sm" c="dimmed">加载中…</Text>
            </Group>
          ) : !ledgerRows.length ? (
            <Text className="account-panel-ledger-empty" size="sm" c="dimmed">暂无流水</Text>
          ) : (
            <Table className="account-panel-ledger-table" striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead className="account-panel-ledger-table-head">
                <Table.Tr className="account-panel-ledger-table-head-row">
                  <Table.Th className="account-panel-ledger-table-head-cell">时间</Table.Th>
                  <Table.Th className="account-panel-ledger-table-head-cell">类型</Table.Th>
                  <Table.Th className="account-panel-ledger-table-head-cell">积分</Table.Th>
                  <Table.Th className="account-panel-ledger-table-head-cell">状态</Table.Th>
                  <Table.Th className="account-panel-ledger-table-head-cell">模型/厂商</Table.Th>
                  <Table.Th className="account-panel-ledger-table-head-cell">任务</Table.Th>
                  <Table.Th className="account-panel-ledger-table-head-cell">备注</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="account-panel-ledger-table-body">
                {ledgerRows.map((it) => {
                  const entryType = describeLedgerEntryType(it.entryType)
                  const taskStatus = describeTaskStatus(it.taskStatus)
                  return (
                    <Table.Tr className="account-panel-ledger-table-row" key={it.id}>
                      <Table.Td className="account-panel-ledger-table-cell">
                        <Text className="account-panel-ledger-created-at" size="xs" c="dimmed">{formatTime(it.createdAt)}</Text>
                      </Table.Td>
                      <Table.Td className="account-panel-ledger-table-cell">
                        <Badge className="account-panel-ledger-entry-type" variant="light" color={entryType.color}>{entryType.label}</Badge>
                      </Table.Td>
                      <Table.Td className="account-panel-ledger-table-cell">
                        <Text className="account-panel-ledger-amount" size="sm" fw={600}>{formatLedgerAmount(it)}</Text>
                      </Table.Td>
                      <Table.Td className="account-panel-ledger-table-cell">
                        <Badge className="account-panel-ledger-status" variant="light" color={taskStatus.color}>{taskStatus.label}</Badge>
                      </Table.Td>
                      <Table.Td className="account-panel-ledger-table-cell">
                        <Stack className="account-panel-ledger-model-stack" gap={2}>
                          <Text className="account-panel-ledger-model" size="xs">{it.taskModel || '—'}</Text>
                          <Text className="account-panel-ledger-vendor" size="xs" c="dimmed">{it.taskVendor || '—'}</Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td className="account-panel-ledger-table-cell">
                        {it.taskId ? (
                          <Group className="account-panel-ledger-task" gap={6} wrap="nowrap">
                            <Text className="account-panel-ledger-task-id" size="xs" c="dimmed">{it.taskId.slice(0, 10)}…</Text>
                            <CopyButton value={it.taskId} timeout={1200}>
                              {({ copied, copy }) => (
                                <Tooltip className="account-panel-ledger-task-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                                  <ActionIcon className="account-panel-ledger-task-copy" variant="subtle" size="sm" onClick={copy} aria-label="copy-task-id">
                                    {copied ? <IconCheck className="account-panel-ledger-task-copy-icon" size={14} /> : <IconCopy className="account-panel-ledger-task-copy-icon" size={14} />}
                                  </ActionIcon>
                                </Tooltip>
                              )}
                            </CopyButton>
                          </Group>
                        ) : (
                          <Text className="account-panel-ledger-task-empty" size="xs" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td className="account-panel-ledger-table-cell">
                        <Text className="account-panel-ledger-note" size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>
                          {it.note || '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Modal>
      <Modal
        className="account-panel-model-cost-modal"
        opened={modelCostsOpen}
        onClose={() => setModelCostsOpen(false)}
        title="模型积分消耗价格"
        size="lg"
        centered
      >
        <Stack className="account-panel-model-cost-stack" gap="sm">
          <Group className="account-panel-model-cost-header" justify="space-between" align="center">
            <Text className="account-panel-model-cost-subtitle" size="xs" c="dimmed">任务成功后按「模型 + 规格（如时长/横竖屏/pro-fast）」优先扣分，未命中规格时回退模型默认扣分。</Text>
            <Tooltip className="account-panel-model-cost-refresh-tooltip" label="刷新" withArrow>
              <ActionIcon
                className="account-panel-model-cost-refresh"
                variant="subtle"
                size="sm"
                aria-label="refresh-model-cost"
                onClick={() => void loadModelCosts()}
                loading={modelCostsLoading}
              >
                <IconRefresh className="account-panel-model-cost-refresh-icon" size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {modelCostsLoading && !modelCostRows.length ? (
            <Group className="account-panel-model-cost-loading" gap={8} align="center">
              <Loader className="account-panel-model-cost-loading-icon" size="sm" />
              <Text className="account-panel-model-cost-loading-text" size="sm" c="dimmed">加载中…</Text>
            </Group>
          ) : !modelCostRows.length ? (
            <Text className="account-panel-model-cost-empty" size="sm" c="dimmed">{modelCostsError || '暂无可用模型价格配置'}</Text>
          ) : (
            <Table className="account-panel-model-cost-table" striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead className="account-panel-model-cost-table-head">
                <Table.Tr className="account-panel-model-cost-table-head-row">
                  <Table.Th className="account-panel-model-cost-table-head-cell">模型</Table.Th>
                  <Table.Th className="account-panel-model-cost-table-head-cell">规格</Table.Th>
                  <Table.Th className="account-panel-model-cost-table-head-cell">类型</Table.Th>
                  <Table.Th className="account-panel-model-cost-table-head-cell">扣分（积分）</Table.Th>
                  <Table.Th className="account-panel-model-cost-table-head-cell">状态</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="account-panel-model-cost-table-body">
                {modelCostRows.map((it) => (
                  <Table.Tr className="account-panel-model-cost-table-row" key={`${it.modelKey}::${it.specKey || '__base__'}`}>
                    <Table.Td className="account-panel-model-cost-table-cell">
                      <Stack className="account-panel-model-cost-model-stack" gap={2}>
                        <Text className="account-panel-model-cost-model-label" size="xs">{it.labelZh}</Text>
                        <Text className="account-panel-model-cost-model-key" size="xs" c="dimmed">{it.modelKey}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="account-panel-model-cost-table-cell">
                      <Text className="account-panel-model-cost-spec" size="xs" c={it.specKey ? undefined : 'dimmed'}>
                        {it.specKey || '默认'}
                      </Text>
                    </Table.Td>
                    <Table.Td className="account-panel-model-cost-table-cell">
                      <Badge className="account-panel-model-cost-kind" variant="light">{kindLabel(it.kind)}</Badge>
                    </Table.Td>
                    <Table.Td className="account-panel-model-cost-table-cell">
                      <Text className="account-panel-model-cost-value" size="sm" fw={600}>{formatCredits(it.cost)}</Text>
                    </Table.Td>
                    <Table.Td className="account-panel-model-cost-table-cell">
                      <Badge className="account-panel-model-cost-status" variant="light" color={it.enabled ? 'green' : 'gray'}>
                        {it.enabled ? '启用' : '停用'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Modal>
      <RechargeModal
        opened={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        onPaid={() => {
          void getMyTeam()
            .then((res) => setTeam(res?.team || null))
            .catch(() => undefined)
          void loadLedger()
        }}
      />
    </div>
  )
}
