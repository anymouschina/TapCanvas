import React from 'react'
import { ActionIcon, Button, Divider, Group, Loader, Modal, NumberInput, Paper, Select, Stack, Switch, Table, Text, Tooltip, Title } from '@mantine/core'
import { IconPencil, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { deleteModelCreditCost, listBillingModels, listModelCreditCosts, upsertModelCreditCost, type BillingModelKind, type BillingModelOptionDto, type ModelCreditCostDto } from '../api/server'
import { toast } from './toast'

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

export default function StatsPlanManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-plan', className].filter(Boolean).join(' ')

  const [models, setModels] = React.useState<BillingModelOptionDto[]>([])
  const [costs, setCosts] = React.useState<ModelCreditCostDto[]>([])
  const [loading, setLoading] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [editModelKey, setEditModelKey] = React.useState<string | null>(null)
  const [editCost, setEditCost] = React.useState<number | ''>(1)
  const [editEnabled, setEditEnabled] = React.useState(true)

  const modelMap = React.useMemo(() => {
    const map = new Map<string, BillingModelOptionDto>()
    for (const m of models) map.set(m.modelKey, m)
    return map
  }, [models])

  const sortedCosts = React.useMemo(() => {
    const items = [...costs]
    items.sort((a, b) => {
      const ak = modelMap.get(a.modelKey)?.kind || 'zzz'
      const bk = modelMap.get(b.modelKey)?.kind || 'zzz'
      if (ak !== bk) return String(ak).localeCompare(String(bk))
      return a.modelKey.localeCompare(b.modelKey)
    })
    return items
  }, [costs, modelMap])

  const modelSelectData = React.useMemo(() => {
    const items = models.map((m) => ({
      value: m.modelKey,
      label: `${m.labelZh}（${kindLabel(m.kind)}）`,
    }))
    items.sort((a, b) => a.label.localeCompare(b.label))
    return items
  }, [models])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [m, c] = await Promise.allSettled([listBillingModels(), listModelCreditCosts()])
      if (m.status === 'fulfilled') {
        setModels(Array.isArray(m.value) ? m.value : [])
      } else {
        setModels([])
        toast((m.reason as any)?.message || '加载模型枚举失败', 'error')
      }

      if (c.status === 'fulfilled') {
        setCosts(Array.isArray(c.value) ? c.value : [])
      } else {
        setCosts([])
        toast((c.reason as any)?.message || '加载扣分配置失败', 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = React.useCallback(() => {
    const first = modelSelectData[0]?.value || null
    setEditModelKey(first)
    setEditCost(1)
    setEditEnabled(true)
    setEditOpen(true)
  }, [modelSelectData])

  const openEdit = React.useCallback((row: ModelCreditCostDto) => {
    setEditModelKey(row.modelKey)
    setEditCost(typeof row.cost === 'number' && Number.isFinite(row.cost) ? Math.max(0, Math.floor(row.cost)) : 0)
    setEditEnabled(Boolean(row.enabled))
    setEditOpen(true)
  }, [])

  const submitEdit = React.useCallback(async () => {
    const modelKey = (editModelKey || '').trim()
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
      const saved = await upsertModelCreditCost({ modelKey, cost, enabled: editEnabled })
      setCosts((prev) => {
        const next = [...prev]
        const idx = next.findIndex((x) => x.modelKey === saved.modelKey)
        if (idx >= 0) next[idx] = saved
        else next.unshift(saved)
        return next
      })
      setEditOpen(false)
      toast('已保存', 'success')
    } catch (err: any) {
      console.error('save model credit cost failed', err)
      toast(err?.message || '保存失败', 'error')
    } finally {
      setEditSubmitting(false)
    }
  }, [editCost, editEnabled, editModelKey, editSubmitting])

  const handleDelete = React.useCallback(async (modelKey: string) => {
    const label = modelMap.get(modelKey)?.labelZh || modelKey
    if (!window.confirm(`确定删除「${label}」的扣分配置？删除后将回退到默认扣分规则。`)) return
    try {
      await deleteModelCreditCost(modelKey)
      setCosts((prev) => prev.filter((x) => x.modelKey !== modelKey))
      toast('已删除', 'success')
    } catch (err: any) {
      console.error('delete model credit cost failed', err)
      toast(err?.message || '删除失败', 'error')
    }
  }, [modelMap])

  return (
    <Paper className={[rootClassName, 'stats-plan-card glass'].filter(Boolean).join(' ')} withBorder radius="lg" p="md">
      <Group className="stats-plan-card-header" justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <div className="stats-plan-card-header-left">
          <Title className="stats-plan-title" order={3}>套餐管理</Title>
          <Text className="stats-plan-subtitle" size="sm" c="dimmed">
            配置不同模型的扣分量；任务生成成功后按模型扣减团队积分。
          </Text>
        </div>
        <Group className="stats-plan-card-header-actions" gap={6}>
          <Button
            className="stats-plan-create"
            size="xs"
            variant="light"
            leftSection={<IconPlus className="stats-plan-create-icon" size={14} />}
            onClick={() => openCreate()}
          >
            新增/修改
          </Button>
          <Tooltip className="stats-plan-reload-tooltip" label="刷新" withArrow>
            <ActionIcon
              className="stats-plan-reload"
              size="sm"
              variant="subtle"
              aria-label="刷新套餐配置"
              onClick={() => void reload()}
              loading={loading}
            >
              <IconRefresh className="stats-plan-reload-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider className="stats-plan-divider" my="md" label="模型扣分配置" labelPosition="left" />

      {loading && !sortedCosts.length ? (
        <Group className="stats-plan-loading" gap="xs" align="center">
          <Loader className="stats-plan-loading-icon" size="sm" />
          <Text className="stats-plan-loading-text" size="sm" c="dimmed">加载中…</Text>
        </Group>
      ) : !sortedCosts.length ? (
        <Text className="stats-plan-empty" size="sm" c="dimmed">暂无配置</Text>
      ) : (
        <Table className="stats-plan-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-plan-table-head">
            <Table.Tr className="stats-plan-table-head-row">
              <Table.Th className="stats-plan-table-head-cell">模型</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">类型</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">扣分</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">启用</Table.Th>
              <Table.Th className="stats-plan-table-head-cell">操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-plan-table-body">
            {sortedCosts.map((row) => {
              const info = modelMap.get(row.modelKey)
              return (
                <Table.Tr className="stats-plan-table-row" key={row.modelKey}>
                  <Table.Td className="stats-plan-table-cell">
                    <Stack className="stats-plan-model" gap={2}>
                      <Text className="stats-plan-model-label" size="sm" fw={600}>{info?.labelZh || row.modelKey}</Text>
                      <Text className="stats-plan-model-key" size="xs" c="dimmed">{row.modelKey}</Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Text className="stats-plan-kind" size="sm">{kindLabel(info?.kind)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Text className="stats-plan-cost" size="sm" fw={600}>{formatCost(row.cost)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Text className="stats-plan-enabled" size="sm" c={row.enabled ? 'green' : 'dimmed'}>{row.enabled ? '启用' : '禁用'}</Text>
                  </Table.Td>
                  <Table.Td className="stats-plan-table-cell">
                    <Group className="stats-plan-actions" gap={6} wrap="nowrap">
                      <Tooltip className="stats-plan-edit-tooltip" label="编辑" withArrow>
                        <ActionIcon className="stats-plan-edit" variant="light" aria-label="edit" onClick={() => openEdit(row)}>
                          <IconPencil className="stats-plan-edit-icon" size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip className="stats-plan-delete-tooltip" label="删除" withArrow>
                        <ActionIcon className="stats-plan-delete" variant="light" color="red" aria-label="delete" onClick={() => void handleDelete(row.modelKey)}>
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
        radius="lg"
        centered
      >
        <Stack className="stats-plan-edit" gap="sm">
          <Select
            className="stats-plan-edit-model"
            label="模型"
            placeholder="请选择模型"
            data={modelSelectData}
            value={editModelKey}
            onChange={setEditModelKey}
            searchable
            nothingFoundMessage="未找到模型"
          />
          <NumberInput
            className="stats-plan-edit-cost"
            label="扣分（积分）"
            value={editCost}
            onChange={setEditCost}
            min={0}
            step={1}
          />
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
    </Paper>
  )
}

