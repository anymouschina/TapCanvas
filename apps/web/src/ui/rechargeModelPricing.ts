import type { ModelOption } from '../config/models'

export type RechargeModelPricingRow = {
  value: string
  label: string
  vendorLabel: string
  basePriceLabel: string
  specPriceLabels: string[]
  isConfigured: boolean
}

export type RechargeModelPricingSection = {
  kind: 'text' | 'image' | 'video'
  label: string
  rows: RechargeModelPricingRow[]
}

function formatVendorLabel(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return '未知厂商'
  return normalized
}

function formatPriceLabel(value: number): string {
  return `${Math.max(0, Math.floor(value))} 积分`
}

function compareRows(a: RechargeModelPricingRow, b: RechargeModelPricingRow): number {
  return a.label.localeCompare(b.label, 'zh-Hans-CN')
}

function toPricingRow(option: ModelOption): RechargeModelPricingRow {
  const pricing = option.pricing
  const basePriceLabel =
    pricing && pricing.enabled
      ? formatPriceLabel(pricing.cost)
      : '未配置'
  const specPriceLabels = pricing
    ? pricing.specCosts
        .filter((spec) => spec.enabled)
        .map((spec) => `${spec.specKey} ${formatPriceLabel(spec.cost)}`)
    : []

  return {
    value: option.value,
    label: option.label,
    vendorLabel: formatVendorLabel(option.vendor),
    basePriceLabel,
    specPriceLabels,
    isConfigured: Boolean(pricing && pricing.enabled),
  }
}

function uniqueOptions(options: readonly ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  const result: ModelOption[] = []
  for (const option of options) {
    const key = option.value.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(option)
  }
  return result
}

function createSection(
  kind: RechargeModelPricingSection['kind'],
  label: string,
  options: readonly ModelOption[],
): RechargeModelPricingSection | null {
  const rows = uniqueOptions(options)
    .map(toPricingRow)
    .sort(compareRows)
  if (rows.length === 0) return null
  return { kind, label, rows }
}

export function buildRechargeModelPricingSections(input: {
  textModels: readonly ModelOption[]
  imageModels: readonly ModelOption[]
  videoModels: readonly ModelOption[]
}): RechargeModelPricingSection[] {
  return [
    createSection('text', '文本', input.textModels),
    createSection('image', '图片', input.imageModels),
    createSection('video', '视频', input.videoModels),
  ].filter((section): section is RechargeModelPricingSection => section !== null)
}
