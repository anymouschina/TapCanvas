import { describe, expect, it } from 'vitest'
import type { CommerceProductDto } from '../../api/server'
import { buildMembershipPlanCards, classifyMembershipPurchase, formatMembershipDiscount, membershipPlanCode, membershipPlanSummary } from './membershipPlanViewModel'

function createMembershipProduct(title = 'PRO'): CommerceProductDto {
  const variants = [
    ['pro-monthly-64k', 26900, 'monthly', 30, 30900, 1100, '6.4w'],
    ['pro-monthly-91k', 37900, 'monthly', 30, 43500, 1570, '9.1w'],
    ['pro-monthly-117k', 48900, 'monthly', 30, 56200, 2030, '11.7w'],
    ['pro-monthly-143k', 59900, 'monthly', 30, 68800, 2490, '14.3w'],
    ['pro-annual-84k', 290900, 'annual', 365, 36000, 1600, '8.4w'],
    ['pro-annual-118k', 409900, 'annual', 365, 50700, 2250, '11.8w'],
    ['pro-annual-153k', 529900, 'annual', 365, 65600, 2920, '15.3w'],
    ['pro-annual-188k', 649900, 'annual', 365, 80400, 3580, '18.8w'],
  ] as const
  return {
    id: 'pro', title, subtitle: null, description: null, currency: 'CNY', priceCents: 26900, stock: 1, status: 'active',
    entitlementType: 'membership', coverImageUrl: null, images: [], createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    entitlementConfigJson: JSON.stringify({
      billingCycle: 'monthly', durationDays: 30, monthlyCredits: 30900, dailyGiftCredits: 1100, concurrencyLimit: 10, capacityLabel: '6.4w', timezone: 'Asia/Shanghai',
      skuConfigs: Object.fromEntries(variants.map(([id, , billingCycle, durationDays, monthlyCredits, dailyGiftCredits, capacityLabel]) => [id, {
        billingCycle, durationDays, monthlyCredits, dailyGiftCredits, concurrencyLimit: 10, capacityLabel, timezone: 'Asia/Shanghai',
      }])),
      presentation: { sortOrder: 2, featured: true, accent: 'violet', campaignBenefits: ['购买后立即获得本月积分'], features: ['全部创作功能'] },
    }),
    skus: variants.map(([id, priceCents, billingCycle], index) => ({
      id, productId: 'pro', name: id, spec: billingCycle, priceCents, stock: 1, isDefault: index === 0, status: 'active',
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    })),
  }
}

describe('membershipPlanViewModel', () => {
  it('formats only data-backed comparison discounts', () => {
    expect(formatMembershipDiscount(94900, 313300)).toBe('3折')
    expect(formatMembershipDiscount(8900, null)).toBeNull()
  })

  it('keeps all four PRO capacity variants for each billing cycle', () => {
    const monthly = buildMembershipPlanCards([createMembershipProduct()], 'monthly')
    const annual = buildMembershipPlanCards([createMembershipProduct()], 'annual')
    expect(monthly.errors).toEqual([])
    expect(monthly.cards[0].variants).toHaveLength(4)
    expect(monthly.cards[0].variants[0]).toMatchObject({ priceCents: 26900, monthlyCredits: 30900, dailyGiftCredits: 1100, concurrencyLimit: 10, capacityLabel: '6.4w' })
    expect(monthly.cards[0].variants[3]).toMatchObject({ priceCents: 59900, capacityLabel: '14.3w' })
    expect(annual.cards[0].variants).toHaveLength(4)
    expect(annual.cards[0].variants[0]).toMatchObject({ priceCents: 290900, monthlyCredits: 36000, dailyGiftCredits: 1600, capacityLabel: '8.4w' })
  })

  it('uses the selected SKU in the current-plan code', () => {
    const card = buildMembershipPlanCards([createMembershipProduct()], 'monthly').cards[0]
    expect(membershipPlanCode(card, card.variants[2])).toBe('membership:pro:pro-monthly-117k')
  })

  it('does not expose concurrency metadata in the visible plan summary', () => {
    const card = buildMembershipPlanCards([createMembershipProduct()], 'monthly').cards[0]
    const variant = { ...card.variants[0], concurrencyLimit: 999 }

    expect(membershipPlanSummary(card, variant)).toBe('动态算力 6.4w–14.3w')
  })

  it('derives the visible summary from the selected billing-cycle variants', () => {
    const annualCard = buildMembershipPlanCards([createMembershipProduct()], 'annual').cards[0]
    expect(membershipPlanSummary(annualCard, annualCard.variants[0])).toBe('动态算力 8.4w–18.8w')

    const plusProduct = createMembershipProduct('PLUS')
    plusProduct.skus = plusProduct.skus.filter((sku) => sku.id === 'pro-annual-84k')
    const plusCard = buildMembershipPlanCards([plusProduct], 'annual').cards[0]
    expect(membershipPlanSummary(plusCard, plusCard.variants[0])).toBe('每月 36,000 积分 + 每日赠送 1,600')
  })

  it('allows only opening, exact renewal, or a non-decreasing entitlement upgrade', () => {
    const card = buildMembershipPlanCards([createMembershipProduct()], 'monthly').cards[0]
    const current = {
      planCode: membershipPlanCode(card, card.variants[1]),
      monthlyCredits: card.variants[1].monthlyCredits,
      dailyGiftCredits: card.variants[1].dailyGiftCredits,
    }

    expect(classifyMembershipPurchase(null, card, card.variants[0])).toBe('open')
    expect(classifyMembershipPurchase(current, card, card.variants[1])).toBe('renew')
    expect(classifyMembershipPurchase(current, card, card.variants[3])).toBe('upgrade')
    expect(classifyMembershipPurchase(current, card, card.variants[0])).toBe('downgrade')
  })
})
