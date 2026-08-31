import type { SkillMarketplaceItemDto } from '../../api/server'

export type SkillMarketplaceSort = 'latest' | 'ranking' | 'popular' | 'price-asc'

export function formatSkillPrice(item: SkillMarketplaceItemDto): string {
  if (!item.purchasable) return '系统自带'
  return `${item.priceCredits ?? 0} 积分`
}

export function formatSkillFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return '未提供'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  return `${(sizeBytes / 1024).toFixed(sizeBytes < 10_240 ? 1 : 0)} KB`
}

export function formatSkillPromptLength(promptCharacterCount: number): string {
  return `${new Intl.NumberFormat('zh-CN').format(promptCharacterCount)} 字符`
}

export function formatSkillDate(value: string | null): string {
  if (!value) return '未提供'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function filterAndSortMarketplaceItems(input: {
  items: readonly SkillMarketplaceItemDto[]
  category: string
  query: string
  sort: SkillMarketplaceSort
}): SkillMarketplaceItemDto[] {
  const normalizedQuery = input.query.trim().toLocaleLowerCase('zh-CN')
  const filtered = input.items.filter((item) => {
    const matchesCategory = input.category === '全部' || item.skill.category === input.category
    const searchable = `${item.skill.name} ${item.skill.key} ${item.skill.description || ''} ${item.sellerName || ''}`
      .toLocaleLowerCase('zh-CN')
    return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery))
  })
  return [...filtered].sort((left, right) => {
    if (input.sort === 'popular') {
      return right.realPurchaseCount - left.realPurchaseCount || left.rank - right.rank
    }
    if (input.sort === 'price-asc') {
      return (left.priceCredits ?? 0) - (right.priceCredits ?? 0) || left.rank - right.rank
    }
    if (input.sort === 'latest') {
      return Date.parse(right.listedAt || right.skill.createdAt) - Date.parse(left.listedAt || left.skill.createdAt)
        || left.rank - right.rank
    }
    return left.rank - right.rank
  })
}

export function findInstalledMarketplaceSkill(
  item: SkillMarketplaceItemDto,
  personalSkills: readonly import('../../api/server').UserContextAssetDto[],
): import('../../api/server').UserContextAssetDto | null {
  if (!item.productId) return null
  return personalSkills.find((skill) => (
    skill.sourceMarketplaceProductId === item.productId
    || skill.marketplaceListing?.productId === item.productId
  )) ?? null
}
