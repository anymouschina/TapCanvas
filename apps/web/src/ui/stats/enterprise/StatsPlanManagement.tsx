import React from 'react'
import { ActionIcon, Divider, Group, Loader, Modal, NumberInput, Stack, Switch, Table, Text, Tooltip, Title, Button, TextInput } from '@mantine/core'
import { IconPencil, IconRefresh, IconTrash } from '@tabler/icons-react'
import {
  deleteModelCreditCost,
  listModelCatalogModels,
  listModelCreditCosts,
  upsertModelCreditCost,
  type BillingModelKind,
  type BillingModelOptionDto,
  type ModelCatalogModelDto,
  type ModelCreditCostDto,
} from '../../../api/server'
import { InlinePanel } from '../../InlinePanel'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'

function kindLabel(kind: BillingModelKind | string | null | undefined): string {
  if (kind === 'image') return '图片'
  if (kind === 'video') return '视频'
  if (kind === 'text') return '文本'
  return String(kind || '—')
}

function formatCost(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return String(Math.max(0, Math.floor(value)))
}

function defaultCostByKind(kind: BillingModelKind | string | null | undefined): number {
  if (kind === 'image') return 1
  if (kind === 'video') return 10
  return 0
}

function normalizeCatalogModelOptions(items: ModelCatalogModelDto[]): BillingModelOptionDto[] {
  const out: BillingModelOptionDto[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const modelKey = typeof item?.modelKey === 'string' ? item.modelKey.trim() : ''
    const dedupeKey = modelKey.toLowerCase()
    if (!modelKey || seen.has(dedupeKey)) continue
    const kind = item?.kind
    if (kind !== 'text' && kind !== 'image' && kind !== 'video') continue
    const label = typeof item?.labelZh === 'string' && item.labelZh.trim() ? item.labelZh.trim() : modelKey
    const vendor = typeof item?.vendorKey === 'string' && item.vendorKey.trim() ? item.vendorKey.trim() : undefined
    out.push({
      modelKey,
      labelZh: label,
      kind,
      ...(vendor ? { vendor } : {}),
    })
    seen.add(dedupeKey)
  }
  return out
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function canonicalModelKey(input: string | null | undefined): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  return raw.startsWith('models/') ? raw.slice(7).trim() : raw
}

type DisplayRow = {
  modelKey: string
  specKey: string
  labelZh: string
  kind: BillingModelKind
  cost: number
  enabled: boolean
  hasCustomRule: boolean
}

type ModelDisplayRow = {
  modelKey: string
  labelZh: string
  kind: BillingModelKind
  defaultCost: number
  defaultEnabled: boolean
  hasCustomBaseRule: boolean
  specCount: number
}

export default function StatsPlanManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-plan', className].filter(Boolean).join(' ')

  const [models, setModels] = React.useState<BillingModelOptionDto[]>([])
  const [costs, setCosts] = React.useState<ModelCreditCostDto[]>([])
  const [loading, setLoading] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [editModelKey, setEditModelKey] = React.useState<string | null>(null)
  const [editSpecKey, setEditSpecKey] = React.useState('')
  const [editCost, setEditCost] = React.useState<number | ''>(1)
  const [editEnabled, setEditEnabled] = React.useState(true)

  const modelMap = React.useMemo(() => {
    const map = new Map<string, BillingModelOptionDto>()
    for (const m of models) {
      const key = canonicalModelKey(m.modelKey)
      if (!key) continue
      map.set(key, { ...m, modelKey: key })
    }
    return map
  }, [models])

  const ruleRows = React.useMemo((): DisplayRow[] => {
    const rows: DisplayRow[] = []
    const baseCostMap = new Map<string, ModelCreditCostDto>()
    const specCosts: ModelCreditCostDto[] = []
    for (const c of costs) {
      const mk = canonicalModelKey(c.modelKey)
      if (!mk) continue
      const sk = String(c.specKey || '').trim()
      if (!sk) baseCostMap.set(mk, c)
      else specCosts.push(c)
    }
    const knownModels = new Set<string>()
    for (const m of models) {
      const modelKey = canonicalModelKey(m.modelKey)
      if (!modelKey) continue
      knownModels.add(modelKey)
      const configured = baseCostMap.get(modelKey) || null
      rows.push({
        modelKey,
        specKey: '',
        labelZh: m.labelZh,
        kind: m.kind,
        cost: configured ? configured.cost : defaultCostByKind(m.kind),
        enabled: configured ? Boolean(configured.enabled) : true,
        hasCustomRule: Boolean(configured),
      })
    }
    for (const c of specCosts) {
      const modelKey = canonicalModelKey(c.modelKey)
      const specKey = String(c.specKey || '').trim()
      if (!modelKey || !specKey) continue
      const meta = models.find((m) => canonicalModelKey(m.modelKey) === modelKey)
      rows.push({
        modelKey,
        specKey,
        labelZh: meta?.labelZh || modelKey,
        kind: (meta?.kind || 'text') as BillingModelKind,
        cost: c.cost,
        enabled: Boolean(c.enabled),
        hasCustomRule: true,
      })
    }
    for (const c of costs) {
      const modelKey = canonicalModelKey(c.modelKey)
      const specKey = String(c.specKey || '').trim()
      if (!modelKey || knownModels.has(modelKey) || specKey) continue
      rows.push({
        modelKey,
        specKey,
        labelZh: modelKey,
        kind: 'text',
        cost: c.cost,
        enabled: Boolean(c.enabled),
        hasCustomRule: true,
      })
    }
    rows.sort((a, b) => {
      if (a.kind !== b.kind) return String(a.kind).localeCompare(String(b.kind))
      const mk = a.modelKey.localeCompare(b.modelKey)
      if (mk !== 0) return mk
      return a.specKey.localeCompare(b.specKey)
    })
    return rows
  }, [costs, models])

  const modelDisplayRows = React.useMemo((): ModelDisplayRow[] => {
    const rows: ModelDisplayRow[] = []
    const seen = new Set<string>()
    const baseMap = new Map<string, DisplayRow>()
    for (const row of ruleRows) {
      if (!row.specKey) baseMap.set(row.modelKey, row)
    }
    const specCountMap = new Map<string, number>()
    for (const row of ruleRows) {
      if (!row.specKey) continue
      specCountMap.set(row.modelKey, (specCountMap.get(row.modelKey) || 0) + 1)
    }

    for (const m of models) {
      const key = canonicalModelKey(m.modelKey)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const base = baseMap.get(key)
      rows.push({
        modelKey: key,
        labelZh: m.labelZh,
        kind: m.kind,
        defaultCost: base ? base.cost : defaultCostByKind(m.kind),
        defaultEnabled: base ? base.enabled : true,
        hasCustomBaseRule: Boolean(base?.hasCustomRule),
        specCount: specCountMap.get(key) || 0,
      })
    }

    for (const row of ruleRows) {
      if (seen.has(row.modelKey)) continue
      seen.add(row.modelKey)
      const base = baseMap.get(row.modelKey)
      rows.push({
        modelKey: row.modelKey,
        labelZh: row.labelZh || row.modelKey,
        kind: row.kind,
        defaultCost: base ? base.cost : defaultCostByKind(row.kind),
        defaultEnabled: base ? base.enabled : true,
        hasCustomBaseRule: Boolean(base?.hasCustomRule),
        specCount: specCountMap.get(row.modelKey) || 0,
      })
    }

    rows.sort((a, b) => {
      if (a.kind !== b.kind) return String(a.kind).localeCompare(String(b.kind))
      return a.modelKey.localeCompare(b.modelKey)
    })
    return rows
  }, [models, ruleRows])

  const specMappingsByModel = React.useMemo(() => {
    const map = new Map<string, Array<{ specKey: string; cost: number; enabled: boolean }>>()
    for (const c of costs) {
      const modelKey = canonicalModelKey(c.modelKey)
      const specKey = String(c.specKey || '').trim()
      if (!modelKey || !specKey) continue
      const arr = map.get(modelKey) || []
      arr.push({
        specKey,
        cost: Number.isFinite(Number(c.cost)) ? Math.max(0, Math.floor(Number(c.cost))) : 0,
        enabled: Boolean(c.enabled),
      })
      map.set(modelKey, arr)
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.specKey.localeCompare(b.specKey))
    }
    return map
  }, [costs])

  const editModelRows = React.useMemo(() => {
    const modelKey = canonicalModelKey(editModelKey)
    if (!modelKey) return [] as DisplayRow[]
    return ruleRows.filter((row) => row.modelKey === modelKey)
  }, [ruleRows, editModelKey])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [m, c] = await Promise.allSettled([listModelCatalogModels(), listModelCreditCosts()])
      if (m.status === 'fulfilled') {
        const catalogModels = normalizeCatalogModelOptions(Array.isArray(m.value) ? m.value : [])
        setModels(catalogModels)
      } else {
        setModels([])
        toast(toErrorMessage(m.reason, '加载模型枚举失败'), 'error')
      }

      if (c.status === 'fulfilled') {
        setCosts(Array.isArray(c.value) ? c.value : [])
      } else {
        setCosts([])
        toast(toErrorMessage(c.reason, '加载扣分配置失败'), 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const openEdit = React.useCallback((row: ModelDisplayRow) => {
    setEditModelKey(canonicalModelKey(row.modelKey))
    setEditSpecKey('')
    setEditCost(typeof row.defaultCost === 'number' && Number.isFinite(row.defaultCost) ? Math.max(0, Math.floor(row.defaultCost)) : 0)
    setEditEnabled(Boolean(row.defaultEnabled))
    setEditOpen(true)
  }, [])

  const submitEdit = React.useCallback(async () => {
    const modelKey = canonicalModelKey(editModelKey)
    const specKey = String(editSpecKey || '').trim()
    const cost = typeof editCost === 'number' ? Math.floor(editCost) : NaN
    if (!modelKey) {
      toast('请选择模型', 'error')
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast('请输入有效扣分（>= 0）', 'error')
      return
    }
    if (editSubmitting) return
    setEditSubmitting(true)
    try {
      const saved = await upsertModelCreditCost({ modelKey, specKey: specKey || undefined, cost, enabled: editEnabled })
      setCosts((prev) => {
        const next = [...prev]
        const idx = next.findIndex((x) => canonicalModelKey(x.modelKey) === canonicalModelKey(saved.modelKey) && String(x.specKey || '') === String(saved.specKey || ''))
        if (idx >= 0) next[idx] = saved
        else next.unshift(saved)
        return next
      })
      setEditOpen(false)
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('save model credit cost failed', err)
      toast(toErrorMessage(err, '保存失败'), 'error')
    } finally {
      setEditSubmitting(false)
    }
  }, [editCost, editEnabled, editModelKey, editSpecKey, editSubmitting])

  const handleDelete = React.useCallback(
    async (modelKey: string, specKey: string) => {
      const canonical = canonicalModelKey(modelKey)
      const label = modelMap.get(canonical)?.labelZh || canonical
      const tip = specKey ? `（规格：${specKey}）` : ''
      if (!window.confirm(`确定删除「${label}」${tip}的扣分配置？删除后将回退到默认扣分规则。`)) return
      try {
        await deleteModelCreditCost(canonical, specKey || undefined)
        setCosts((prev) => prev.filter((x) => !(canonicalModelKey(x.modelKey) === canonical && String(x.specKey || '') === specKey)))
        toast('已删除', 'success')
      } catch (err: unknown) {
        console.error('delete model credit cost failed', err)
        toast(toErrorMessage(err, '删除失败'), 'error')
      }
    },
    [modelMap],
  )

  const loadRuleToEditor = React.useCallback((row: DisplayRow) => {
    setEditSpecKey(row.specKey || '')
    setEditCost(typeof row.cost === 'number' && Number.isFinite(row.cost) ? Math.max(0, Math.floor(row.cost)) : 0)
    setEditEnabled(Boolean(row.enabled))
  }, [])

  return (
    <PanelCard className={[rootClassName, 'stats-plan-card glass'].filter(Boolean).join(' ')}>
      <Group className="stats-plan-card-header" justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <div className="stats-plan-card-header-left">
          <Title className="stats-plan-title" order={3}>
            模型积分消耗配置
          </Title>
          <Text className="stats-plan-subtitle" size="sm" c="dimmed">
            配置不同模型的积分消耗；任务生成成功后按模型扣减团队积分。
          </Text>
        </div>
        <Group className="stats-plan-card-header-actions" gap={6}>
          <Tooltip className="stats-plan-reload-tooltip" label="刷新" withArrow>
            <ActionIcon
              className="stats-plan-reload"
              size="sm"
              variant="subtle"
              aria-label="刷新模型积分配置"
              onClick={() => void reload()}
              loading={loading}
            >
              <IconRefresh className="stats-plan-reload-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider className="stats-plan-divider" my="md" label="模型扣分配置" labelPosition="left" />
      <InlinePanel className="stats-plan-spec-guide">
        <Stack className="stats-plan-spec-guide-stack" gap={4}>
          <Text className="stats-plan-spec-guide-title" size="sm" fw={600}>规格 Key 规范</Text>
          <Text className="stats-plan-spec-guide-line" size="xs" c="dimmed">优先级：`model + specKey` 命中时优先，其次回退到 `model` 基础规则。</Text>
          <Text className="stats-plan-spec-guide-line" size="xs" c="dimmed">建议命名：`orientation:landscape|portrait`、`duration:5s|10s`、`quality:fast|pro`。</Text>
          <Text className="stats-plan-spec-guide-line" size="xs" c="dimmed">可组合：同模型下同时配置多个规格规则，未配置规格将走默认模型扣分。</Text>
        </Stack>
      </InlinePanel>

      {loading && !modelDisplayRows.length ? (
        <Group className="stats-plan-loading" gap="xs" align="center">
          <Loader className="stats-plan-loading-icon" size="sm" />
          <Text className="stats-plan-loading-text" size="sm" c="dimmed">
            加载中…
          </Text>
        </Group>
      ) : !modelDisplayRows.length ? (
        <Text className="stats-plan-empty" size="sm" c="dimmed">
          暂无配置
        </Text>
      ) : (
        <Table className="stats-plan-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-plan-table-head">
            <Table.Tr className="stats-plan-table-head-row">
              <Table.Th className="stats-plan-table-head-cell">模型</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">规格</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">规格映射</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">类型</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">扣分</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">启用</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-plan-table-body">
            {modelDisplayRows.map((row) => {
              return (
                <Table.Tr className="stats-plan-table-row" key={row.modelKey}>
                  <Table.Td className="stats-plan-table-cell">
                    <Stack className="stats-plan-model" gap={2}>
                      <Text className="stats-plan-model-label" size="sm" fw={600}>
                        {row.labelZh || row.modelKey}
                      </Text>
                      <Text className="stats-plan-model-key" size="xs" c="dimmed">
                        {row.modelKey}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Text className="stats-plan-spec" size="sm" c="dimmed">
                      {row.specCount > 0 ? `默认 + ${row.specCount} 个规格` : '默认'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    {(() => {
                      const mappings = specMappingsByModel.get(row.modelKey) || []
                      if (!mappings.length) return <Text className="stats-plan-mapping-empty" size="xs" c="dimmed">—</Text>
                      return (
                        <Stack className="stats-plan-mapping-list" gap={2}>
                          {mappings.map((m) => (
                            <Text className="stats-plan-mapping-item" size="xs" c={m.enabled ? undefined : 'dimmed'} key={m.specKey}>
                              {m.specKey} = {formatCost(m.cost)}{m.enabled ? '' : '（禁用）'}
                            </Text>
                          ))}
                        </Stack>
                      )
                    })()}
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Text className="stats-plan-kind" size="sm">
                      {kindLabel(row.kind)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Group className="stats-plan-cost-group" gap={6} wrap="nowrap">
                      <Text className="stats-plan-cost" size="sm" fw={600}>
                        {formatCost(row.defaultCost)}
                      </Text>
                      {!row.hasCustomBaseRule && (
                        <Text className="stats-plan-cost-default" size="xs" c="dimmed">
                          默认
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Text className="stats-plan-enabled" size="sm" c={row.defaultEnabled ? 'green' : 'dimmed'}>
                      {row.defaultEnabled ? '启用' : '禁用'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Group className="stats-plan-actions" gap={6} wrap="nowrap">
                      <Tooltip className="stats-plan-edit-tooltip" label="编辑" withArrow>
                        <ActionIcon className="stats-plan-edit" variant="light" aria-label="edit" onClick={() => openEdit(row)}>
                          <IconPencil className="stats-plan-edit-icon" size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip className="stats-plan-delete-tooltip" label={row.hasCustomBaseRule ? '删除默认规则' : '默认规则无需删除'} withArrow>
                        <ActionIcon
                          className="stats-plan-delete"
                          variant="light"
                          color="red"
                          aria-label="delete"
                          onClick={() => void handleDelete(row.modelKey, '')}
                          disabled={!row.hasCustomBaseRule}
                        >
                          <IconTrash className="stats-plan-delete-icon" size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        className="stats-plan-edit-modal"
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="配置模型扣分"
        size="md"
        radius="md"
        centered
        lockScroll={false}
      >
        <Stack className="stats-plan-edit" gap="sm">
          <Text className="stats-plan-edit-model-readonly" size="sm" c="dimmed">
            模型：{editModelKey || '—'}
          </Text>
          <InlinePanel className="stats-plan-edit-existing" padding="compact">
            <Stack className="stats-plan-edit-existing-stack" gap={6}>
              <Text className="stats-plan-edit-existing-title" size="xs" fw={600}>该模型已有规则</Text>
              {!editModelRows.length ? (
                <Text className="stats-plan-edit-existing-empty" size="xs" c="dimmed">暂无规则</Text>
              ) : (
                <Table className="stats-plan-edit-existing-table" withTableBorder withColumnBorders>
                  <Table.Thead className="stats-plan-edit-existing-head">
                    <Table.Tr className="stats-plan-edit-existing-head-row">
                      <Table.Th className="stats-plan-edit-existing-head-cell">规格</Table.Th>
                      <Table.Th className="stats-plan-edit-existing-head-cell">扣分</Table.Th>
                      <Table.Th className="stats-plan-edit-existing-head-cell">状态</Table.Th>
                      <Table.Th className="stats-plan-edit-existing-head-cell">操作</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody className="stats-plan-edit-existing-body">
                    {editModelRows.map((row) => (
                      <Table.Tr className="stats-plan-edit-existing-row" key={`${row.modelKey}::${row.specKey || '__base__'}`}>
                        <Table.Td className="stats-plan-edit-existing-cell">
                          <Text className="stats-plan-edit-existing-spec" size="xs" c={row.specKey ? undefined : 'dimmed'}>
                            {row.specKey || '默认'}
                          </Text>
                        </Table.Td>
                        <Table.Td className="stats-plan-edit-existing-cell">
                          <Text className="stats-plan-edit-existing-cost" size="xs">{formatCost(row.cost)}</Text>
                        </Table.Td>
                        <Table.Td className="stats-plan-edit-existing-cell">
                          <Text className="stats-plan-edit-existing-enabled" size="xs" c={row.enabled ? 'green' : 'dimmed'}>
                            {row.enabled ? '启用' : '禁用'}
                          </Text>
                        </Table.Td>
                        <Table.Td className="stats-plan-edit-existing-cell">
                          <Group className="stats-plan-edit-existing-actions" gap={6}>
                            <Button className="stats-plan-edit-existing-load" size="xs" variant="light" onClick={() => loadRuleToEditor(row)}>
                              载入编辑
                            </Button>
                            <Button className="stats-plan-edit-existing-delete" size="xs" color="red" variant="subtle" disabled={!row.hasCustomRule} onClick={() => void handleDelete(row.modelKey, row.specKey)}>
                              删除
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </InlinePanel>
          <TextInput
            className="stats-plan-edit-spec"
            label="规格 Key（可选）"
            placeholder="例如：orientation:landscape / duration:10s / quality:pro"
            value={editSpecKey}
            onChange={(e) => setEditSpecKey(e.currentTarget.value)}
          />
          <Group className="stats-plan-edit-spec-presets" gap={6}>
            <Button className="stats-plan-edit-spec-preset" size="xs" variant="light" onClick={() => setEditSpecKey('orientation:landscape')}>
              横屏
            </Button>
            <Button className="stats-plan-edit-spec-preset" size="xs" variant="light" onClick={() => setEditSpecKey('orientation:portrait')}>
              竖屏
            </Button>
            <Button className="stats-plan-edit-spec-preset" size="xs" variant="light" onClick={() => setEditSpecKey('duration:5s')}>
              5s
            </Button>
            <Button className="stats-plan-edit-spec-preset" size="xs" variant="light" onClick={() => setEditSpecKey('duration:10s')}>
              10s
            </Button>
            <Button className="stats-plan-edit-spec-preset" size="xs" variant="light" onClick={() => setEditSpecKey('quality:fast')}>
              fast
            </Button>
            <Button className="stats-plan-edit-spec-preset" size="xs" variant="light" onClick={() => setEditSpecKey('quality:pro')}>
              pro
            </Button>
            <Button className="stats-plan-edit-spec-clear" size="xs" variant="subtle" onClick={() => setEditSpecKey('')}>
              清空规格
            </Button>
          </Group>
          <NumberInput className="stats-plan-edit-cost" label="扣分（积分）" value={editCost} onChange={(value) => setEditCost(typeof value === 'number' && Number.isFinite(value) ? value : '')} min={0} step={1} />
          <Switch
            className="stats-plan-edit-enabled"
            label="启用该模型扣分规则"
            checked={editEnabled}
            onChange={(e) => setEditEnabled(e.currentTarget.checked)}
          />
          <Group className="stats-plan-edit-actions" justify="flex-end" mt="xs">
            <Button className="stats-plan-edit-cancel" variant="subtle" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button className="stats-plan-edit-save" onClick={() => void submitEdit()} loading={editSubmitting}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PanelCard>
  )
}
