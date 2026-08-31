import React from 'react'
import {
  Badge, Button, Group, Modal, NumberInput, Stack, Table, Text, Title,
} from '@mantine/core'
import {
  activateTeamSubscription,
  listAllTeamSubscriptionPlans,
  type TeamListItemDto,
  type TeamSubscriptionPlanDto,
} from '../../../api/server'
import { InlinePanel } from '../../InlinePanel'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'
import TeamPlanEditorModal from './TeamPlanEditorModal'

type StatsTeamPlansManagementProps = {
  activationTeam: TeamListItemDto | null
  className?: string
  onActivationClose: () => void
  onTeamActivated: () => Promise<void>
  teams: readonly TeamListItemDto[]
}

export default function StatsTeamPlansManagement({
  activationTeam,
  className,
  onActivationClose,
  onTeamActivated,
  teams,
}: StatsTeamPlansManagementProps): JSX.Element {
  const rootClassName = ['stats-team-plans', className].filter(Boolean).join(' ')
  const [plans, setPlans] = React.useState<TeamSubscriptionPlanDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [planEditorOpen, setPlanEditorOpen] = React.useState(false)
  const [editingPlan, setEditingPlan] = React.useState<TeamSubscriptionPlanDto | null>(null)

  const [activatePlanId, setActivatePlanId] = React.useState<string>('')
  const [activateSeats, setActivateSeats] = React.useState<number | string>(2)
  const [activateBusy, setActivateBusy] = React.useState(false)

  const reloadPlans = React.useCallback(async () => {
    setLoading(true)
    try {
      const plansData = await listAllTeamSubscriptionPlans()
      setPlans(plansData)
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载团队套餐失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void reloadPlans() }, [reloadPlans])

  const planStats = React.useMemo(() => {
    const real = teams.filter(t => !t.personal)
    return {
      total: real.length,
      free: real.filter(t => t.maxMembers <= 2).length,
      managed: real.filter(t => t.maxMembers > 2).length,
    }
  }, [teams])

  const enabledPlans = React.useMemo(
    () => plans.filter((plan) => plan.enabled && plan.tier !== 'free'),
    [plans],
  )

  React.useEffect(() => {
    if (!activationTeam) return
    const firstPlan = enabledPlans[0]
    setActivatePlanId(firstPlan?.id ?? '')
    setActivateSeats(firstPlan?.minSeats ?? 2)
  }, [activationTeam, enabledPlans])

  const handleActivate = async () => {
    if (!activationTeam || !activatePlanId) return
    const seats = Math.trunc(Number(activateSeats || 2))
    setActivateBusy(true)
    try {
      await activateTeamSubscription(activationTeam.id, {
        planId: activatePlanId,
        billingCycle: 'annual',
        seatCount: seats,
        issueCreditsNow: true,
      })
      toast('套餐已激活，积分已到账', 'success')
      onActivationClose()
      await onTeamActivated()
    } catch (err) {
      toast(err instanceof Error ? err.message : '激活失败', 'error')
    } finally {
      setActivateBusy(false)
    }
  }

  const selectedPlan = plans.find(p => p.id === activatePlanId)
  const activateSeatsNum = Math.trunc(Number(activateSeats || 2))
  const selectedCreditGrant = selectedPlan?.features.creditGrants.annual
  const previewIncludedCredits = selectedCreditGrant
    ? selectedCreditGrant.includedCreditsPerSeat * activateSeatsNum
    : 0

  return (
    <Stack className={rootClassName} gap="md">
      <PanelCard className="stats-team-plans-overview">
        <Group className="stats-team-plans-overview__header" justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <div className="stats-team-plans-overview__copy">
            <Title className="stats-team-plans-overview__title" order={5} mb={4}>团队套餐管理</Title>
            <Text className="stats-team-plans-overview__description" size="xs" c="dimmed">配置团队会员、画布能力与协作席位套餐。</Text>
          </div>
          <Group className="stats-team-plans-overview__actions" gap="xs">
            <Button className="stats-team-plans-overview__create" size="xs" onClick={() => { setEditingPlan(null); setPlanEditorOpen(true) }}>新建套餐</Button>
            <Button className="stats-team-plans-overview__refresh" variant="light" size="xs" loading={loading} onClick={() => void reloadPlans()}>刷新</Button>
          </Group>
        </Group>

        <Group className="stats-team-plans-overview__stats" mt="md" gap="md" wrap="wrap">
          <InlinePanel className="stats-team-plans-stat" padding="compact" style={{ minWidth: 120 }}>
            <Text className="stats-team-plans-stat__label" size="xs" c="dimmed">协作团队总数</Text>
            <Text className="stats-team-plans-stat__value" fw={700} size="xl">{planStats.total}</Text>
          </InlinePanel>
          <InlinePanel className="stats-team-plans-stat" padding="compact" style={{ minWidth: 120 }}>
            <Text className="stats-team-plans-stat__label" size="xs" c="dimmed">免费版（2席）</Text>
            <Text className="stats-team-plans-stat__value" fw={700} size="xl" c="gray">{planStats.free}</Text>
          </InlinePanel>
          <InlinePanel className="stats-team-plans-stat" padding="compact" style={{ minWidth: 120 }}>
            <Text className="stats-team-plans-stat__label" size="xs" c="dimmed">{'管理员套餐（>2席）'}</Text>
            <Text className="stats-team-plans-stat__value" fw={700} size="xl" c="gray">{planStats.managed}</Text>
          </InlinePanel>
        </Group>
      </PanelCard>

      {/* 套餐配置一览 */}
      {plans.filter(p => p.tier !== 'free').length > 0 && (
        <PanelCard className="stats-team-plans-pricelist">
          <Title className="stats-team-plans-pricelist__title" order={6} mb={8}>套餐配置</Title>
          <div className="stats-team-plans-pricelist__scroll" style={{ overflowX: 'auto' }}>
            <Table className="stats-team-plans-pricelist__table" withTableBorder withColumnBorders>
              <Table.Thead className="stats-team-plans-pricelist__head">
                <Table.Tr className="stats-team-plans-pricelist__head-row">
                  <Table.Th className="stats-team-plans-pricelist__heading">套餐档位</Table.Th>
                  <Table.Th className="stats-team-plans-pricelist__heading">状态</Table.Th>
                  <Table.Th className="stats-team-plans-pricelist__heading">年度积分</Table.Th>
                  <Table.Th className="stats-team-plans-pricelist__heading">席位范围</Table.Th>
                  <Table.Th className="stats-team-plans-pricelist__heading">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-team-plans-pricelist__body">
                {plans.filter(p => p.tier !== 'free').map(plan => (
                  <Table.Tr className="stats-team-plans-pricelist__row" key={plan.id}>
                    <Table.Td className="stats-team-plans-pricelist__cell">
                      <Badge className="stats-team-plans-pricelist__plan" variant="light" color="gray" size="sm">{plan.name} · 档 {plan.features.presentation.variantOrder}</Badge>
                    </Table.Td>
                    <Table.Td className="stats-team-plans-pricelist__cell"><Badge className="stats-team-plans-pricelist__status" color={plan.enabled ? 'green' : 'gray'} variant="light" size="xs">{plan.enabled ? '上架' : '停用'}</Badge></Table.Td>
                    <Table.Td className="stats-team-plans-pricelist__cell">{(plan.features.creditGrants.annual.includedCreditsPerSeat * plan.minSeats).toLocaleString()}</Table.Td>
                    <Table.Td className="stats-team-plans-pricelist__cell">{plan.minSeats}–{plan.maxSeats}</Table.Td>
                    <Table.Td className="stats-team-plans-pricelist__cell"><Button className="stats-team-plans-pricelist__edit" size="xs" variant="subtle" onClick={() => { setEditingPlan(plan); setPlanEditorOpen(true) }}>编辑</Button></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </PanelCard>
      )}

      <Modal
        className="stats-team-plan-activation-modal"
        opened={activationTeam !== null}
        onClose={onActivationClose}
        title="后台激活套餐"
        size="sm"
        centered
      >
        {activationTeam && (
          <Stack className="stats-team-plan-activation" gap="md">
            <Stack className="stats-team-plan-activation__summary" gap={4}>
              <Text className="stats-team-plan-activation__team" size="sm">团队：<Text className="stats-team-plan-activation__team-name" span fw={700}>{activationTeam.name}</Text></Text>
              <Text className="stats-team-plan-activation__hint" size="xs" c="dimmed">管理员分配后，套餐与积分立即生效。</Text>
            </Stack>

            <Stack className="stats-team-plan-activation__plans" gap={6}>
              <Text className="stats-team-plan-activation__plans-label" size="sm" fw={500}>选择套餐</Text>
              <Group className="stats-team-plan-activation__plan-options" gap={6} wrap="wrap">
                {enabledPlans.map(p => (
                  <Button
                    className="stats-team-plan-activation__plan"
                    key={p.id}
                    size="xs"
                    variant={activatePlanId === p.id ? 'filled' : 'light'}
                    onClick={() => {
                      setActivatePlanId(p.id)
                      setActivateSeats(p.minSeats)
                    }}
                  >
                    {p.name}
                  </Button>
                ))}
              </Group>
            </Stack>

            <Text className="stats-team-plan-activation__cycle" size="xs" c="dimmed">长期团队会员，按年激活。</Text>

            <NumberInput
              className="stats-team-plan-activation__seats"
              label="席位数量"
              min={selectedPlan?.minSeats ?? 1}
              max={selectedPlan?.maxSeats ?? 2000}
              value={activateSeats}
              onChange={setActivateSeats}
            />

            {selectedPlan && (
              <Stack className="stats-team-plan-activation__preview" gap={4} style={{ padding: '10px 14px', background: 'var(--mantine-color-dark-7)' }}>
                <Text className="stats-team-plan-activation__preview-row" size="xs" c="dimmed">年度积分：<Text className="stats-team-plan-activation__preview-value" span fw={700} c="gray">{previewIncludedCredits.toLocaleString()}</Text></Text>
              </Stack>
            )}

            <Group className="stats-team-plan-activation__actions" justify="flex-end" gap="xs">
              <Button className="stats-team-plan-activation__cancel" variant="subtle" onClick={onActivationClose}>取消</Button>
              <Button className="stats-team-plan-activation__submit" loading={activateBusy} disabled={!activatePlanId} onClick={() => void handleActivate()}>确认激活</Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <TeamPlanEditorModal opened={planEditorOpen} plan={editingPlan} onClose={() => setPlanEditorOpen(false)} onSaved={() => void reloadPlans()} />
    </Stack>
  )
}
