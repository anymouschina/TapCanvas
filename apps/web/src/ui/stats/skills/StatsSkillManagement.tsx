import React from 'react'
import {
  ActionIcon,
  Center,
  Group,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconDeviceFloppy, IconRefresh } from '@tabler/icons-react'
import {
  getAdminSkillMarketplace,
  saveAdminSkillRanking,
  type RankingItemControlDto,
  type SkillMarketplaceItemDto,
  type SkillRankingConfigDto,
} from '../../../api/server'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'
import './StatsSkillManagement.css'

const EMPTY_CONTROL: RankingItemControlDto = {
  manualBoost: 0,
  recommended: false,
  pinned: false,
  displayOrder: 0,
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export default function StatsSkillManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-skill-ranking', className].filter(Boolean).join(' ')
  const [config, setConfig] = React.useState<SkillRankingConfigDto | null>(null)
  const [items, setItems] = React.useState<SkillMarketplaceItemDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const response = await getAdminSkillMarketplace()
      setConfig(response.config)
      setItems(response.items)
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, 'Skill 榜单加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const patchControl = React.useCallback((skillId: string, patch: Partial<RankingItemControlDto>) => {
    setConfig((current) => current ? {
      ...current,
      items: {
        ...current.items,
        [skillId]: { ...(current.items[skillId] ?? EMPTY_CONTROL), ...patch },
      },
    } : current)
  }, [])

  const save = React.useCallback(async (): Promise<void> => {
    if (!config) return
    setSaving(true)
    setError('')
    try {
      const response = await saveAdminSkillRanking(config)
      setConfig(response.config)
      setItems(response.items)
      toast('Skill 榜单算法已保存', 'success')
    } catch (saveError: unknown) {
      const message = errorMessage(saveError, 'Skill 榜单保存失败')
      setError(message)
      toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [config])

  return (
    <PanelCard className={rootClassName}>
      <Stack className="stats-skill-ranking__stack" gap="md">
        <Group className="stats-skill-ranking__header" justify="space-between" align="flex-start">
          <Stack className="stats-skill-ranking__heading" gap={3}>
            <Title className="stats-skill-ranking__title" order={4}>Skill 商城榜单</Title>
            <Text className="stats-skill-ranking__description" size="sm" c="dimmed">
              真实购买量来自已安装的积分购买记录且不可编辑；榜单由算法分与人工运营参数共同决定。
            </Text>
          </Stack>
          <Group className="stats-skill-ranking__actions" gap={6}>
            <Tooltip className="stats-skill-ranking__tooltip" label="重新加载" withinPortal>
              <ActionIcon
                className="stats-skill-ranking__action"
                variant="subtle"
                aria-label="重新加载 Skill 榜单"
                loading={loading}
                onClick={() => void load()}
              >
                <IconRefresh className="stats-skill-ranking__action-icon" size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="stats-skill-ranking__tooltip" label="保存榜单配置" withinPortal>
              <ActionIcon
                className="stats-skill-ranking__action"
                variant="filled"
                aria-label="保存 Skill 榜单配置"
                loading={saving}
                disabled={!config}
                onClick={() => void save()}
              >
                <IconDeviceFloppy className="stats-skill-ranking__action-icon" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {error ? <Text className="stats-skill-ranking__error" role="alert">{error}</Text> : null}

        {config ? (
          <Group className="stats-skill-ranking__weights" gap="md" align="flex-end">
            <NumberInput
              className="stats-skill-ranking__weight-input"
              label="购买量权重"
              description="真实支付数量在算法分中的占比"
              min={0}
              max={100}
              value={config.purchaseWeight}
              onChange={(value) => setConfig((current) => current ? { ...current, purchaseWeight: typeof value === 'number' ? value : 0 } : current)}
            />
            <NumberInput
              className="stats-skill-ranking__weight-input"
              label="新鲜度权重"
              description="新上架 Skill 的时间衰减占比"
              min={0}
              max={100}
              value={config.freshnessWeight}
              onChange={(value) => setConfig((current) => current ? { ...current, freshnessWeight: typeof value === 'number' ? value : 0 } : current)}
            />
            <NumberInput
              className="stats-skill-ranking__weight-input"
              label="新鲜度半衰期"
              description="单位：天"
              min={1}
              max={3650}
              value={config.freshnessHalfLifeDays}
              onChange={(value) => setConfig((current) => current ? { ...current, freshnessHalfLifeDays: typeof value === 'number' ? value : 1 } : current)}
            />
          </Group>
        ) : null}

        {loading && items.length === 0 ? (
          <Center className="stats-skill-ranking__loading" mih={180}>
            <Loader className="stats-skill-ranking__loader" size="sm" />
          </Center>
        ) : (
          <div className="stats-skill-ranking__table-wrap">
            <Table className="stats-skill-ranking__table" verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead className="stats-skill-ranking__thead">
                <Table.Tr className="stats-skill-ranking__tr">
                  <Table.Th className="stats-skill-ranking__th stats-skill-ranking__th--rank">排名</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">Skill</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">商品</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">真实购买</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">算法分</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">热度加成</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">推荐</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">置顶</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">人工顺序</Table.Th>
                  <Table.Th className="stats-skill-ranking__th">最终分</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-skill-ranking__tbody">
                {items.map((item) => {
                  const control = config?.items[item.skill.id] ?? EMPTY_CONTROL
                  return (
                    <Table.Tr className="stats-skill-ranking__tr" key={item.skill.id}>
                      <Table.Td className="stats-skill-ranking__td stats-skill-ranking__td--rank">{item.rank}</Table.Td>
                      <Table.Td className="stats-skill-ranking__td">
                        <Stack className="stats-skill-ranking__skill" gap={1}>
                          <Text className="stats-skill-ranking__skill-name" size="sm" fw={650}>{item.skill.name}</Text>
                          <Text className="stats-skill-ranking__skill-key" size="xs" c="dimmed">{item.skill.key}</Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td className="stats-skill-ranking__td">
                        <Text className="stats-skill-ranking__product" size="xs" c={item.sourceType === 'official' ? 'dimmed' : 'yellow'}>
                          {item.sourceType === 'official' ? '系统自带' : `${item.priceCredits ?? 0} 积分`}
                        </Text>
                      </Table.Td>
                      <Table.Td className="stats-skill-ranking__td stats-skill-ranking__td--number">{item.realPurchaseCount}</Table.Td>
                      <Table.Td className="stats-skill-ranking__td stats-skill-ranking__td--number">{item.algorithmScore.toFixed(2)}</Table.Td>
                      <Table.Td className="stats-skill-ranking__td">
                        <NumberInput
                          className="stats-skill-ranking__row-input"
                          aria-label={`${item.skill.name} 热度加成`}
                          size="xs"
                          min={-10_000}
                          max={10_000}
                          value={control.manualBoost}
                          onChange={(value) => patchControl(item.skill.id, { manualBoost: typeof value === 'number' ? value : 0 })}
                        />
                      </Table.Td>
                      <Table.Td className="stats-skill-ranking__td">
                        <Switch
                          className="stats-skill-ranking__switch"
                          aria-label={`${item.skill.name} 推荐`}
                          size="xs"
                          checked={control.recommended}
                          onChange={(event) => patchControl(item.skill.id, { recommended: event.currentTarget.checked })}
                        />
                      </Table.Td>
                      <Table.Td className="stats-skill-ranking__td">
                        <Switch
                          className="stats-skill-ranking__switch"
                          aria-label={`${item.skill.name} 置顶`}
                          size="xs"
                          checked={control.pinned}
                          onChange={(event) => patchControl(item.skill.id, { pinned: event.currentTarget.checked })}
                        />
                      </Table.Td>
                      <Table.Td className="stats-skill-ranking__td">
                        <NumberInput
                          className="stats-skill-ranking__row-input"
                          aria-label={`${item.skill.name} 人工顺序`}
                          size="xs"
                          min={-10_000}
                          max={10_000}
                          value={control.displayOrder}
                          onChange={(value) => patchControl(item.skill.id, { displayOrder: typeof value === 'number' ? value : 0 })}
                        />
                      </Table.Td>
                      <Table.Td className="stats-skill-ranking__td stats-skill-ranking__td--number">{item.effectiveScore.toFixed(2)}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </PanelCard>
  )
}
