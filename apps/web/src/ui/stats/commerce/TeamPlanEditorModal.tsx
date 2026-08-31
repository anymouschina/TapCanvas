import React from 'react'
import { Button, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'
import {
  upsertTeamSubscriptionPlan,
  type TeamSubscriptionPlanDto,
  type TeamSubscriptionPlanFeatures,
} from '../../../api/server'
import { toast } from '../../toast'

const DEFAULT_TEAM_CAPABILITIES = [
  '无限画布编排文本、图片、视频与分镜',
  '小T 与 Agents 基于项目上下文协作创作',
  '多人实时协作与团队项目权限管理',
  '角色卡、参考图与章节资产团队沉淀',
  '多模型图片与视频节点统一执行',
  '章节分镜、镜头设计与视频生产链路',
  '作品发布到 Neo TV 并展示创作过程',
]

const DEFAULT_CAMPAIGN_BENEFITS = [
  '团队席位与生成额度统一管理',
  '团队资产和个人资产相互隔离',
]

type TeamPlanFormState = {
  id?: string
  name: string
  tier: string
  annualIncludedCreditsPerSeat: number
  minSeats: number
  maxSeats: number
  concurrentTasksPerSeat: number
  unlimitedConcurrentTasks: boolean
  variantOrder: number
  sortWeight: number
  enabled: boolean
  badge: string
  accent: 'graphite' | 'violet' | 'blue' | 'cyan'
  featured: boolean
  campaignBenefitsText: string
  capabilitiesText: string
  canvasCollab: boolean
  sharedAssetLibrary: boolean
  seatManagement: boolean
  creditQuotaControl: boolean
  fastInvoice: boolean
}

function createDefaultForm(): TeamPlanFormState {
  return {
    name: 'PLUS',
    tier: 'PLUS',
    annualIncludedCreditsPerSeat: 0,
    minSeats: 5,
    maxSeats: 5,
    concurrentTasksPerSeat: 8,
    unlimitedConcurrentTasks: false,
    variantOrder: 1,
    sortWeight: 10,
    enabled: true,
    badge: '团队套餐',
    accent: 'graphite',
    featured: false,
    campaignBenefitsText: DEFAULT_CAMPAIGN_BENEFITS.join('\n'),
    capabilitiesText: DEFAULT_TEAM_CAPABILITIES.join('\n'),
    canvasCollab: true,
    sharedAssetLibrary: true,
    seatManagement: true,
    creditQuotaControl: true,
    fastInvoice: true,
  }
}

function formFromPlan(plan: TeamSubscriptionPlanDto): TeamPlanFormState {
  const presentation = plan.features.presentation
  return {
    id: plan.id,
    name: plan.name,
    tier: plan.tier,
    annualIncludedCreditsPerSeat: plan.features.creditGrants.annual.includedCreditsPerSeat,
    minSeats: plan.minSeats,
    maxSeats: plan.maxSeats,
    concurrentTasksPerSeat: plan.features.concurrent_tasks_per_seat,
    unlimitedConcurrentTasks: plan.features.unlimited_concurrent_tasks,
    variantOrder: presentation.variantOrder,
    sortWeight: plan.sortWeight,
    enabled: plan.enabled,
    badge: presentation.badge,
    accent: presentation.accent,
    featured: presentation.featured,
    campaignBenefitsText: presentation.campaignBenefits.join('\n'),
    capabilitiesText: presentation.capabilities.join('\n'),
    canvasCollab: plan.features.canvas_collab,
    sharedAssetLibrary: plan.features.shared_asset_library,
    seatManagement: plan.features.seat_management,
    creditQuotaControl: plan.features.credit_quota_control,
    fastInvoice: plan.features.fast_invoice,
  }
}

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

export default function TeamPlanEditorModal({
  opened,
  plan,
  onClose,
  onSaved,
}: {
  opened: boolean
  plan: TeamSubscriptionPlanDto | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [form, setForm] = React.useState<TeamPlanFormState>(createDefaultForm)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!opened) return
    setForm(plan ? formFromPlan(plan) : createDefaultForm())
  }, [opened, plan])

  const submit = React.useCallback(async () => {
    if (!form.name.trim() || !form.tier.trim()) {
      toast('请填写套餐名称和等级代码', 'error')
      return
    }
    if (form.minSeats > form.maxSeats) {
      toast('最小席位不能大于最大席位', 'error')
      return
    }
    const presentation = {
      badge: form.badge.trim(),
      variantOrder: Math.trunc(form.variantOrder),
      accent: form.accent,
      featured: form.featured,
      campaignBenefits: lines(form.campaignBenefitsText),
      capabilities: lines(form.capabilitiesText),
    } satisfies TeamSubscriptionPlanFeatures['presentation']
    setSubmitting(true)
    try {
      await upsertTeamSubscriptionPlan({
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        tier: form.tier.trim().toUpperCase(),
        minSeats: Math.trunc(form.minSeats),
        maxSeats: Math.trunc(form.maxSeats),
        sortWeight: Math.trunc(form.sortWeight),
        enabled: form.enabled,
        features: {
          concurrent_tasks_per_seat: Math.trunc(form.concurrentTasksPerSeat),
          unlimited_concurrent_tasks: form.unlimitedConcurrentTasks,
          canvas_collab: form.canvasCollab,
          shared_asset_library: form.sharedAssetLibrary,
          seat_management: form.seatManagement,
          credit_quota_control: form.creditQuotaControl,
          fast_invoice: form.fastInvoice,
          creditGrants: {
            annual: {
              includedCreditsPerSeat: Math.trunc(form.annualIncludedCreditsPerSeat),
            },
          },
          presentation,
        },
      })
      toast(form.id ? '团队套餐已更新' : '团队套餐已创建', 'success')
      onSaved()
      onClose()
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '保存团队套餐失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [form, onClose, onSaved])

  return (
    <Modal className="team-plan-editor-modal" opened={opened} onClose={onClose} title={plan ? '编辑团队套餐' : '新建团队套餐'} size="xl" centered>
      <Stack className="team-plan-editor-modal__body" gap="sm">
        <Group className="team-plan-editor-modal__row" align="end" grow>
          <TextInput className="team-plan-editor-modal__name" label="套餐名称" value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.currentTarget.value }))} />
          <TextInput className="team-plan-editor-modal__tier" label="等级代码" value={form.tier} onChange={(event) => setForm((state) => ({ ...state, tier: event.currentTarget.value }))} />
          <NumberInput className="team-plan-editor-modal__sort" label="展示顺序" value={form.sortWeight} onChange={(value) => setForm((state) => ({ ...state, sortWeight: Number(value || 0) }))} />
        </Group>
        <Group className="team-plan-editor-modal__row" align="end" grow>
          <NumberInput className="team-plan-editor-modal__variant-order" label="档位顺序" min={1} max={99} value={form.variantOrder} onChange={(value) => setForm((state) => ({ ...state, variantOrder: Math.max(1, Number(value || 1)) }))} />
        </Group>
        <Group className="team-plan-editor-modal__row" align="end" grow>
          <NumberInput className="team-plan-editor-modal__annual-credits" label="年度积分/席" min={0} value={form.annualIncludedCreditsPerSeat} onChange={(value) => setForm((state) => ({ ...state, annualIncludedCreditsPerSeat: Math.max(0, Number(value || 0)) }))} />
        </Group>
        <Group className="team-plan-editor-modal__row" align="end" grow>
          <NumberInput className="team-plan-editor-modal__concurrency" label="每席并发任务" min={0} value={form.concurrentTasksPerSeat} onChange={(value) => setForm((state) => ({ ...state, concurrentTasksPerSeat: Math.max(0, Number(value || 0)) }))} />
        </Group>
        <Group className="team-plan-editor-modal__row" align="end" grow>
          <NumberInput className="team-plan-editor-modal__min-seats" label="最小席位" min={1} max={2000} value={form.minSeats} onChange={(value) => setForm((state) => ({ ...state, minSeats: Math.max(1, Number(value || 1)) }))} />
          <NumberInput className="team-plan-editor-modal__max-seats" label="最大席位" min={1} max={2000} value={form.maxSeats} onChange={(value) => setForm((state) => ({ ...state, maxSeats: Math.max(1, Number(value || 1)) }))} />
          <TextInput className="team-plan-editor-modal__badge" label="活动标识" value={form.badge} onChange={(event) => setForm((state) => ({ ...state, badge: event.currentTarget.value }))} />
          <Select className="team-plan-editor-modal__accent" label="卡片色系" value={form.accent} data={[{ value: 'graphite', label: '石墨黑' }, { value: 'violet', label: '深紫' }, { value: 'blue', label: '深蓝' }, { value: 'cyan', label: '青蓝' }]} onChange={(value) => setForm((state) => ({ ...state, accent: value === 'violet' || value === 'blue' || value === 'cyan' ? value : 'graphite' }))} />
        </Group>
        <Group className="team-plan-editor-modal__switches" gap="lg" wrap="wrap">
          <Switch className="team-plan-editor-modal__enabled" label="上架" checked={form.enabled} onChange={(event) => setForm((state) => ({ ...state, enabled: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__featured" label="重点推荐" checked={form.featured} onChange={(event) => setForm((state) => ({ ...state, featured: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__unlimited-concurrency" label="无限并发" checked={form.unlimitedConcurrentTasks} onChange={(event) => setForm((state) => ({ ...state, unlimitedConcurrentTasks: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__collab" label="多人画布协作" checked={form.canvasCollab} onChange={(event) => setForm((state) => ({ ...state, canvasCollab: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__assets" label="团队资产库" checked={form.sharedAssetLibrary} onChange={(event) => setForm((state) => ({ ...state, sharedAssetLibrary: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__seats" label="席位管理" checked={form.seatManagement} onChange={(event) => setForm((state) => ({ ...state, seatManagement: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__quota" label="额度管控" checked={form.creditQuotaControl} onChange={(event) => setForm((state) => ({ ...state, creditQuotaControl: event.currentTarget.checked }))} />
          <Switch className="team-plan-editor-modal__invoice" label="快速开票" checked={form.fastInvoice} onChange={(event) => setForm((state) => ({ ...state, fastInvoice: event.currentTarget.checked }))} />
        </Group>
        <Textarea className="team-plan-editor-modal__campaign" label="活动权益（每行一项）" minRows={2} value={form.campaignBenefitsText} onChange={(event) => setForm((state) => ({ ...state, campaignBenefitsText: event.currentTarget.value }))} />
        <Textarea className="team-plan-editor-modal__capabilities" label="TapCanvas 画布能力（每行一项）" minRows={7} value={form.capabilitiesText} onChange={(event) => setForm((state) => ({ ...state, capabilitiesText: event.currentTarget.value }))} />
        <Text className="team-plan-editor-modal__hint" size="xs" c="dimmed">开源版团队套餐由管理员分配；最小席位与最大席位相同时按固定席位套餐展示。</Text>
        <Group className="team-plan-editor-modal__actions" justify="flex-end" gap="xs">
          <Button className="team-plan-editor-modal__cancel" variant="subtle" onClick={onClose}>取消</Button>
          <Button className="team-plan-editor-modal__submit" loading={submitting} onClick={() => void submit()}>保存套餐</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
