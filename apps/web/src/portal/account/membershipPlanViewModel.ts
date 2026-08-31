import type { CommerceProductDto, CommerceProductSkuDto } from '../../api/server'

export type MembershipBillingCycle = 'annual' | 'monthly'
export type MembershipAccent = 'graphite' | 'violet' | 'blue' | 'cyan'

export type MembershipPlanVariant = {
  sku: CommerceProductSkuDto | null
  priceCents: number
  compareAtPriceCents: number | null
  billingCycle: MembershipBillingCycle
  durationDays: number
  monthlyCredits: number
  dailyGiftCredits: number
  concurrencyLimit: number
  capacityLabel: string
  monthlyPriceCents: number
}

type MembershipPresentation = {
  badge: string
  compareAtPriceCents: number | null
  accent: MembershipAccent
  featured: boolean
  sortOrder: number
  campaignBenefits: string[]
  features: string[]
}

type MembershipConfig = Omit<MembershipPlanVariant, 'sku' | 'priceCents' | 'monthlyPriceCents'> & {
  skuConfigs: Record<string, Omit<MembershipPlanVariant, 'sku' | 'priceCents' | 'monthlyPriceCents'>>
  presentation: MembershipPresentation
}

export type MembershipPlanCard = {
  product: CommerceProductDto
  variants: MembershipPlanVariant[]
  badge: string
  accent: MembershipAccent
  featured: boolean
  sortOrder: number
  campaignBenefits: string[]
  features: string[]
}

export type MembershipPlanCardsResult = {
  cards: MembershipPlanCard[]
  errors: string[]
}

export type CurrentMembershipSnapshot = {
  planCode: string
  monthlyCredits: number
  dailyGiftCredits: number
}

export type MembershipPurchaseKind = 'open' | 'renew' | 'upgrade' | 'downgrade'

export function membershipPlanCode(card: MembershipPlanCard, variant: MembershipPlanVariant): string {
  return `membership:${card.product.id}:${variant.sku?.id ?? 'default'}`
}

export function classifyMembershipPurchase(
  current: CurrentMembershipSnapshot | null,
  card: MembershipPlanCard,
  variant: MembershipPlanVariant,
): MembershipPurchaseKind {
  const selectedPlanCode = membershipPlanCode(card, variant)
  if (!current) return 'open'
  const hasSameEntitlements = variant.monthlyCredits === current.monthlyCredits
    && variant.dailyGiftCredits === current.dailyGiftCredits
  if (current.planCode === selectedPlanCode && hasSameEntitlements) return 'renew'

  const doesNotReduceEntitlements = variant.monthlyCredits >= current.monthlyCredits
    && variant.dailyGiftCredits >= current.dailyGiftCredits
  const improvesAtLeastOneEntitlement = variant.monthlyCredits > current.monthlyCredits
    || variant.dailyGiftCredits > current.dailyGiftCredits
  return doesNotReduceEntitlements && improvesAtLeastOneEntitlement ? 'upgrade' : 'downgrade'
}

export function membershipPlanSummary(card: MembershipPlanCard, variant: MembershipPlanVariant): string {
  if (card.variants.length > 1) {
    const capacityLabels = card.variants.map((item) => item.capacityLabel).filter(Boolean)
    const capacityRange = capacityLabels.length > 1
      ? `${capacityLabels[0]}–${capacityLabels[capacityLabels.length - 1]}`
      : capacityLabels[0] || variant.capacityLabel
    return `动态算力 ${capacityRange}`
  }
  return `每月 ${variant.monthlyCredits.toLocaleString('zh-CN')} 积分 + 每日赠送 ${variant.dailyGiftCredits.toLocaleString('zh-CN')}`
}

export function formatMembershipDiscount(priceCents: number, compareAtPriceCents: number | null): string | null {
  if (!compareAtPriceCents || compareAtPriceCents <= priceCents) return null
  const discount = (priceCents / compareAtPriceCents) * 10
  return `${discount.toFixed(1).replace(/\.0$/, '')}折`
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${key} 必须是正整数`)
  return value
}

function readBillingCycle(record: Record<string, unknown>): MembershipBillingCycle {
  const value = record.billingCycle
  if (value !== 'monthly' && value !== 'annual') throw new Error('billingCycle 必须是 monthly 或 annual')
  return value
}

function readCapacityLabel(record: Record<string, unknown>): string {
  if (typeof record.capacityLabel !== 'string') throw new Error('capacityLabel 必须是字符串')
  return record.capacityLabel.trim()
}

function readCompareAtPrice(record: Record<string, unknown>): number | null {
  const value = record.compareAtPriceCents
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function readStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function readAccent(value: unknown): MembershipAccent {
  if (value === 'violet' || value === 'blue' || value === 'cyan') return value
  return 'graphite'
}

function parseVariantConfig(record: Record<string, unknown>): Omit<MembershipPlanVariant, 'sku' | 'priceCents' | 'monthlyPriceCents'> {
  return {
    billingCycle: readBillingCycle(record),
    durationDays: readPositiveInteger(record, 'durationDays'),
    monthlyCredits: readPositiveInteger(record, 'monthlyCredits'),
    dailyGiftCredits: readPositiveInteger(record, 'dailyGiftCredits'),
    concurrencyLimit: readPositiveInteger(record, 'concurrencyLimit'),
    capacityLabel: readCapacityLabel(record),
    compareAtPriceCents: readCompareAtPrice(record),
  }
}

function parseMembershipConfig(product: CommerceProductDto): MembershipConfig {
  if (!product.entitlementConfigJson) throw new Error('缺少会员权益配置')
  let parsed: unknown
  try {
    parsed = JSON.parse(product.entitlementConfigJson)
  } catch (error: unknown) {
    throw new Error(`会员权益配置不是有效 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const config = readRecord(parsed)
  if (!config) throw new Error('会员权益配置必须是对象')
  const rootVariant = parseVariantConfig(config)
  const skuConfigsRecord = readRecord(config.skuConfigs) || {}
  const skuConfigs: MembershipConfig['skuConfigs'] = {}
  for (const [skuId, rawValue] of Object.entries(skuConfigsRecord)) {
    const value = readRecord(rawValue)
    if (!value) throw new Error(`SKU ${skuId} 的权益配置必须是对象`)
    skuConfigs[skuId] = parseVariantConfig(value)
  }
  const presentationRecord = readRecord(config.presentation) || {}
  const sortOrder = presentationRecord.sortOrder
  return {
    ...rootVariant,
    skuConfigs,
    presentation: {
      badge: typeof presentationRecord.badge === 'string' ? presentationRecord.badge.trim() : '',
      compareAtPriceCents: readCompareAtPrice(presentationRecord),
      accent: readAccent(presentationRecord.accent),
      featured: presentationRecord.featured === true,
      sortOrder: typeof sortOrder === 'number' && Number.isInteger(sortOrder) ? sortOrder : 0,
      campaignBenefits: readStringList(presentationRecord, 'campaignBenefits'),
      features: readStringList(presentationRecord, 'features'),
    },
  }
}

function buildVariant(
  sku: CommerceProductSkuDto | null,
  priceCents: number,
  config: Omit<MembershipPlanVariant, 'sku' | 'priceCents' | 'monthlyPriceCents'>,
  presentationComparePrice: number | null,
): MembershipPlanVariant {
  return {
    sku,
    priceCents,
    ...config,
    compareAtPriceCents: config.compareAtPriceCents ?? presentationComparePrice,
    monthlyPriceCents: config.billingCycle === 'annual' ? Math.round(priceCents / 12) : priceCents,
  }
}

function resolvePlanCard(product: CommerceProductDto, cycle: MembershipBillingCycle): MembershipPlanCard | null {
  if (product.entitlementType !== 'membership') throw new Error('商品不是个人会员权益')
  const config = parseMembershipConfig(product)
  const activeSkus = product.skus.filter((sku) => sku.status === 'active' && sku.stock > 0)
  const variants = activeSkus.map((sku) => {
    const skuConfig = config.skuConfigs[sku.id]
    if (!skuConfig) throw new Error(`SKU ${sku.id} 缺少权益配置`)
    return buildVariant(sku, sku.priceCents, skuConfig, config.presentation.compareAtPriceCents)
  }).filter((variant) => variant.billingCycle === cycle)

  if (activeSkus.length === 0 && product.stock > 0 && config.billingCycle === cycle) {
    variants.push(buildVariant(product.skus.length === 0 ? null : product.skus[0] ?? null, product.priceCents, config, config.presentation.compareAtPriceCents))
  }
  if (variants.length === 0) return null
  variants.sort((left, right) => left.monthlyCredits - right.monthlyCredits || left.priceCents - right.priceCents)
  return {
    product,
    variants,
    badge: config.presentation.badge,
    accent: config.presentation.accent,
    featured: config.presentation.featured,
    sortOrder: config.presentation.sortOrder,
    campaignBenefits: config.presentation.campaignBenefits,
    features: config.presentation.features,
  }
}

export function buildMembershipPlanCards(products: CommerceProductDto[], cycle: MembershipBillingCycle): MembershipPlanCardsResult {
  const cards: MembershipPlanCard[] = []
  const errors: string[] = []
  for (const product of products) {
    try {
      const card = resolvePlanCard(product, cycle)
      if (card) cards.push(card)
    } catch (error: unknown) {
      errors.push(`${product.title}：${error instanceof Error ? error.message : '套餐配置无效'}`)
    }
  }
  cards.sort((left, right) => left.sortOrder - right.sortOrder || left.product.title.localeCompare(right.product.title, 'zh-CN'))
  return { cards, errors }
}
