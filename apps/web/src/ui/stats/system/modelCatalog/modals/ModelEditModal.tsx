import React from 'react'
import { ActionIcon, Button, Divider, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import type { BillingModelKind, ModelCatalogModelDto } from '../deps'
import { toast, upsertModelCatalogModel } from '../deps'
import { KIND_OPTIONS } from '../modelCatalog.constants'
import { defaultModelPricingCost, prettyJson, safeParseJson } from '../modelCatalog.utils'

export type ModelEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; model: ModelCatalogModelDto }
  | { mode: 'duplicate'; model: ModelCatalogModelDto }

type PricingSpecFormRow = {
  id: string
  specKey: string
  cost: number
  enabled: boolean
}

function nextPricingSpecRow(input?: Partial<PricingSpecFormRow>): PricingSpecFormRow {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    specKey: '',
    cost: 0,
    enabled: true,
    ...input,
  }
}

function parseBillingModelKind(value: string | null): BillingModelKind {
  if (value === 'image' || value === 'video' || value === 'text') return value
  return 'text'
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export function ModelEditModal({
  editor,
  vendorOptions,
  onClose,
  onSaved,
}: {
  editor: ModelEditorState | null
  vendorOptions: Array<{ value: string; label: string }>
  onClose: () => void
  onSaved: () => Promise<void> | void
}): JSX.Element {
  const opened = !!editor
  const mode = editor?.mode || null
  const isNew = mode === 'create' || mode === 'duplicate'
  const sourceModel = editor && editor.mode !== 'create' ? editor.model : null
  const isDuplicate = mode === 'duplicate'

  const [submitting, setSubmitting] = React.useState(false)
  const [modelKey, setModelKey] = React.useState('')
  const [modelAlias, setModelAlias] = React.useState('')
  const [modelAliasAuto, setModelAliasAuto] = React.useState(true)
  const [vendorKey, setVendorKey] = React.useState<string>('')
  const [labelZh, setLabelZh] = React.useState('')
  const [kind, setKind] = React.useState<BillingModelKind>('text')
  const [enabled, setEnabled] = React.useState(true)
  const [pricingCost, setPricingCost] = React.useState<number | ''>(0)
  const [pricingEnabled, setPricingEnabled] = React.useState(true)
  const [pricingSpecs, setPricingSpecs] = React.useState<PricingSpecFormRow[]>([])
  const [meta, setMeta] = React.useState('')

  React.useEffect(() => {
    if (!opened) return
    if (mode === 'create') {
      const nextKind: BillingModelKind = 'text'
      setModelKey('')
      setModelAlias('')
      setModelAliasAuto(true)
      setVendorKey(vendorOptions[0]?.value || '')
      setLabelZh('')
      setKind(nextKind)
      setEnabled(true)
      setPricingCost(defaultModelPricingCost(nextKind))
      setPricingEnabled(true)
      setPricingSpecs([])
      setMeta('')
      setSubmitting(false)
      return
    }

    if (!sourceModel) return

    const nextModelKey = isDuplicate ? '' : String(sourceModel.modelKey || '').trim()
    const nextAlias = String(sourceModel.modelAlias || '').trim()
    const nextKind = parseBillingModelKind(sourceModel.kind)
    const nextPricing = sourceModel.pricing
    setModelKey(nextModelKey)
    setModelAlias(isDuplicate ? '' : nextAlias || nextModelKey)
    setModelAliasAuto(isDuplicate)
    setVendorKey(sourceModel.vendorKey)
    setLabelZh(sourceModel.labelZh || '')
    setKind(nextKind)
    setEnabled(!!sourceModel.enabled)
    setPricingCost(typeof nextPricing?.cost === 'number' && Number.isFinite(nextPricing.cost) ? Math.max(0, Math.floor(nextPricing.cost)) : defaultModelPricingCost(nextKind))
    setPricingEnabled(typeof nextPricing?.enabled === 'boolean' ? nextPricing.enabled : true)
    setPricingSpecs(
      Array.isArray(nextPricing?.specCosts)
        ? nextPricing.specCosts.map((spec) =>
            nextPricingSpecRow({
              specKey: String(spec.specKey || '').trim(),
              cost: typeof spec.cost === 'number' && Number.isFinite(spec.cost) ? Math.max(0, Math.floor(spec.cost)) : 0,
              enabled: !!spec.enabled,
            }),
          )
        : [],
    )
    setMeta(prettyJson(sourceModel.meta))
    setSubmitting(false)
  }, [isDuplicate, mode, opened, sourceModel, vendorOptions])

  React.useEffect(() => {
    if (!opened) return
    if (!isNew) return
    if (!modelAliasAuto) return
    setModelAlias(modelKey)
  }, [isNew, modelAliasAuto, modelKey, opened])

  React.useEffect(() => {
    if (!opened) return
    if (!isNew) return
    if (pricingSpecs.length > 0) return
    setPricingCost((current) => {
      if (typeof current === 'number' && current > 0) return current
      return defaultModelPricingCost(kind)
    })
  }, [isNew, kind, opened, pricingSpecs.length])

  const submitModel = React.useCallback(async () => {
    const trimmedModelKey = modelKey.trim()
    const modelAliasRaw = modelAlias.trim()
    const finalAlias = modelAliasRaw || trimmedModelKey
    const trimmedVendorKey = vendorKey.trim()
    const trimmedLabelZh = labelZh.trim()
    const normalizedPricingCost = typeof pricingCost === 'number' && Number.isFinite(pricingCost) ? Math.max(0, Math.floor(pricingCost)) : NaN

    if (!trimmedVendorKey) {
      toast('请选择厂商', 'error')
      return
    }
    if (!trimmedModelKey) {
      toast('请填写模型 Key（例如 gpt-4.1 / nano-banana-pro）', 'error')
      return
    }
    if (!trimmedLabelZh) {
      toast('请填写中文名称', 'error')
      return
    }
    if (!Number.isFinite(normalizedPricingCost) || normalizedPricingCost < 0) {
      toast('请填写有效价格（积分，>= 0）', 'error')
      return
    }

    const metaParsed = safeParseJson(meta)
    if (!metaParsed.ok) {
      toast(`meta JSON 无效：${metaParsed.error}`, 'error')
      return
    }

    const normalizedSpecs = pricingSpecs.map((spec) => ({
      specKey: String(spec.specKey || '').trim(),
      cost: typeof spec.cost === 'number' && Number.isFinite(spec.cost) ? Math.max(0, Math.floor(spec.cost)) : NaN,
      enabled: !!spec.enabled,
    }))

    for (const spec of normalizedSpecs) {
      if (!spec.specKey) {
        toast('规格价格的 specKey 不能为空', 'error')
        return
      }
      if (!/^[a-z0-9:_-]+$/i.test(spec.specKey)) {
        toast(`规格 Key 格式无效：${spec.specKey}`, 'error')
        return
      }
      if (!Number.isFinite(spec.cost) || spec.cost < 0) {
        toast(`规格 ${spec.specKey} 的价格无效`, 'error')
        return
      }
    }

    const seenSpecKeys = new Set<string>()
    for (const spec of normalizedSpecs) {
      const dedupeKey = spec.specKey.toLowerCase()
      if (seenSpecKeys.has(dedupeKey)) {
        toast(`规格 Key 重复：${spec.specKey}`, 'error')
        return
      }
      seenSpecKeys.add(dedupeKey)
    }

    if (submitting) return
    setSubmitting(true)
    try {
      await upsertModelCatalogModel({
        modelKey: trimmedModelKey,
        vendorKey: trimmedVendorKey,
        modelAlias: finalAlias,
        labelZh: trimmedLabelZh,
        kind,
        enabled,
        pricing: {
          cost: normalizedPricingCost,
          enabled: pricingEnabled,
          specCosts: normalizedSpecs,
        },
        ...(typeof metaParsed.value === 'undefined' ? {} : { meta: metaParsed.value }),
      })
      toast('已保存模型', 'success')
      onClose()
      await onSaved()
    } catch (error: unknown) {
      console.error('save model failed', error)
      toast(toErrorMessage(error, '保存模型失败'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [enabled, kind, labelZh, meta, modelAlias, modelKey, onClose, onSaved, pricingCost, pricingEnabled, pricingSpecs, submitting, vendorKey])

  return (
    <Modal
      className="stats-model-catalog-model-modal"
      opened={opened}
      onClose={onClose}
      title={mode === 'edit' ? '编辑模型' : mode === 'duplicate' ? '复制模型' : '新增模型'}
      size="lg"
      radius="md"
      centered
      lockScroll={false}
    >
      <Stack className="stats-model-catalog-model-form" gap="sm">
        <Select
          className="stats-model-catalog-model-form-vendor"
          label="所属平台"
          data={vendorOptions}
          value={vendorKey}
          onChange={(value) => setVendorKey(value || '')}
          searchable
          disabled={!isNew}
        />
        <TextInput
          className="stats-model-catalog-model-form-key"
          label="唯一标识"
          placeholder="例如 gpt-4.1 / nano-banana-pro"
          value={modelKey}
          onChange={(event) => setModelKey(event.currentTarget.value)}
          disabled={!isNew}
        />
        <Select
          className="stats-model-catalog-model-form-kind"
          label="模型类型"
          data={KIND_OPTIONS}
          value={kind}
          onChange={(value) => setKind(parseBillingModelKind(value))}
        />
        <TextInput
          className="stats-model-catalog-model-form-label"
          label="模型名称"
          placeholder="例如 GPT-4.1 / Gemini 3.1 Flash Image"
          value={labelZh}
          onChange={(event) => setLabelZh(event.currentTarget.value)}
        />
        <TextInput
          className="stats-model-catalog-model-form-alias"
          label="Public 别名"
          placeholder="留空则自动使用模型 Key"
          value={modelAlias}
          onChange={(event) => {
            setModelAliasAuto(false)
            setModelAlias(event.currentTarget.value)
          }}
        />

        <Group className="stats-model-catalog-model-form-pricing-row" grow align="flex-end">
          <NumberInput
            className="stats-model-catalog-model-form-pricing-cost"
            label="价格（积分）"
            min={0}
            step={1}
            allowNegative={false}
            value={pricingCost}
            onChange={(value) => setPricingCost(typeof value === 'number' ? value : '')}
          />
          <Switch
            className="stats-model-catalog-model-form-pricing-enabled"
            checked={pricingEnabled}
            onChange={(event) => setPricingEnabled(event.currentTarget.checked)}
            label="价格启用"
            mb={6}
          />
        </Group>

        <Stack className="stats-model-catalog-model-form-pricing-specs" gap={8}>
          <Group className="stats-model-catalog-model-form-pricing-specs-header" justify="space-between" align="center">
            <Text className="stats-model-catalog-model-form-pricing-specs-title" size="sm" fw={600}>规格价格</Text>
            <Button
              className="stats-model-catalog-model-form-pricing-specs-add"
              size="xs"
              variant="light"
              leftSection={<IconPlus className="stats-model-catalog-model-form-pricing-specs-add-icon" size={14} />}
              onClick={() => setPricingSpecs((current) => [...current, nextPricingSpecRow()])}
            >
              添加规格
            </Button>
          </Group>
          {!pricingSpecs.length ? (
            <Text className="stats-model-catalog-model-form-pricing-specs-empty" size="xs" c="dimmed">
              不填则直接使用上面的基础价格。可用于 `orientation:landscape`、`duration:10s`、`quality:pro` 这类差异化计费。
            </Text>
          ) : (
            pricingSpecs.map((spec) => (
              <Group className="stats-model-catalog-model-form-pricing-spec-row" key={spec.id} align="flex-end" wrap="nowrap">
                <TextInput
                  className="stats-model-catalog-model-form-pricing-spec-key"
                  label="specKey"
                  placeholder="例如 duration:10s"
                  value={spec.specKey}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value
                    setPricingSpecs((current) => current.map((item) => item.id === spec.id ? { ...item, specKey: nextValue } : item))
                  }}
                  style={{ flex: 1 }}
                />
                <NumberInput
                  className="stats-model-catalog-model-form-pricing-spec-cost"
                  label="价格"
                  min={0}
                  step={1}
                  allowNegative={false}
                  value={spec.cost}
                  onChange={(value) => {
                    const nextValue = typeof value === 'number' ? value : 0
                    setPricingSpecs((current) => current.map((item) => item.id === spec.id ? { ...item, cost: nextValue } : item))
                  }}
                  style={{ width: 128 }}
                />
                <Switch
                  className="stats-model-catalog-model-form-pricing-spec-enabled"
                  checked={spec.enabled}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.checked
                    setPricingSpecs((current) => current.map((item) => item.id === spec.id ? { ...item, enabled: nextValue } : item))
                  }}
                  label="启用"
                  mb={6}
                />
                <ActionIcon
                  className="stats-model-catalog-model-form-pricing-spec-delete"
                  size="lg"
                  variant="light"
                  color="red"
                  aria-label="删除规格价格"
                  mb={4}
                  onClick={() => setPricingSpecs((current) => current.filter((item) => item.id !== spec.id))}
                >
                  <IconTrash className="stats-model-catalog-model-form-pricing-spec-delete-icon" size={16} />
                </ActionIcon>
              </Group>
            ))
          )}
        </Stack>

        <Textarea className="stats-model-catalog-model-form-meta" label="描述 / meta（JSON，可选）" value={meta} onChange={(event) => setMeta(event.currentTarget.value)} minRows={4} autosize />
        <Text className="stats-model-catalog-model-form-meta-hint" size="xs" c="dimmed">
          视频模型可在 `meta.videoOptions.controls` 或 `meta.videoOptions.controlMappings` 中声明节点控制栏映射。
          例如：`controls: [&#123; key: "duration", binding: "durationSeconds" &#125;, &#123; key: "size", binding: "size" &#125;]`。
        </Text>
        <Switch className="stats-model-catalog-model-form-enabled" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} label="模型启用" />

        <Divider className="stats-model-catalog-model-form-divider" label="保存说明" labelPosition="left" />
        <Text className="stats-model-catalog-model-form-hint" size="xs" c="dimmed">
          模型基础价格和规格价格会与模型配置一起保存；复制模型时也会一起带过去，避免再去单独维护积分表。
        </Text>

        <Group className="stats-model-catalog-model-form-actions" justify="flex-end" gap={8}>
          <Button className="stats-model-catalog-model-form-cancel" variant="subtle" onClick={onClose}>取消</Button>
          <Button className="stats-model-catalog-model-form-save" onClick={() => void submitModel()} loading={submitting}>
            保存
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
