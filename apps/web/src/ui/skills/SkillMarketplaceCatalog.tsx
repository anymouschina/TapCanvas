import React from 'react'
import { Loader } from '@mantine/core'
import {
  IconArrowLeft,
  IconCheck,
	IconChevronLeft,
  IconChevronRight,
  IconCoins,
  IconMedal,
  IconPlus,
  IconShoppingBag,
} from '@tabler/icons-react'
import type { AgentSkillDto, SkillMarketplaceItemDto, UserContextAssetDto } from '../../api/server'
import { SkillLogo } from './SkillLogo'
import { SkillPurchaseConfirmDialog } from './SkillPurchaseConfirmDialog'
import {
  findInstalledMarketplaceSkill,
  formatSkillDate,
  formatSkillFileSize,
  formatSkillPrice,
  formatSkillPromptLength,
} from './skillMarketplaceViewModel'

const MARKETPLACE_PAGE_SIZE = 24

type SkillMarketplaceCatalogProps = {
  items: readonly SkillMarketplaceItemDto[]
  detailItem: SkillMarketplaceItemDto | null
  creditBalance: number
  personalSkills: readonly UserContextAssetDto[]
  selectedOfficialIds: readonly string[]
  purchasingProductId: string
  selectionMode: 'single' | 'multiple'
  showRank: boolean
  onOpenDetail: (item: SkillMarketplaceItemDto) => void
  onCloseDetail: () => void
  onToggleOfficial: (skill: AgentSkillDto) => void
  onPurchase: (item: SkillMarketplaceItemDto) => Promise<boolean>
  onCompleteSingleSelection: () => void
}

function MarketplaceRow({
  item,
  showRank,
  onOpenDetail,
}: {
  item: SkillMarketplaceItemDto
  showRank: boolean
  onOpenDetail: (item: SkillMarketplaceItemDto) => void
}): JSX.Element {
  return (
    <article className={`tc-skill-library__card${item.owned ? ' is-owned' : ''}`}>
      <button className="tc-skill-library__card-action" type="button" onClick={() => onOpenDetail(item)}>
        <SkillLogo className="tc-skill-library__visual" skill={item.skill} priority="visible" />
        <span className="tc-skill-library__card-copy">
          <span className="tc-skill-library__card-heading">
            <strong className="tc-skill-library__card-name">{item.skill.name || item.skill.key}</strong>
            <span className="tc-skill-library__market-price">{formatSkillPrice(item)}</span>
          </span>
          <span className="tc-skill-library__market-meta">
            <span className="tc-skill-library__market-source">{item.sellerName || '未知创作者'}</span>
            <span className="tc-skill-library__market-separator">·</span>
            <span className="tc-skill-library__market-sales">{item.realPurchaseCount} 人购买</span>
            {item.owned ? <span className="tc-skill-library__owned-label">已拥有</span> : null}
          </span>
          <span className="tc-skill-library__card-description">{item.skill.description || '该 Skill 未提供简介'}</span>
        </span>
        {showRank ? (
          <span className="tc-skill-library__rank" aria-label={`第 ${item.rank} 名`}>
            <IconMedal className="tc-skill-library__rank-icon" size={14} />
            {String(item.rank).padStart(2, '0')}
          </span>
        ) : (
          <IconChevronRight className="tc-skill-library__row-chevron" size={16} aria-hidden="true" />
        )}
      </button>
    </article>
  )
}

export function SkillMarketplaceCatalog({
  items,
  detailItem,
  creditBalance,
  personalSkills,
  selectedOfficialIds,
  purchasingProductId,
  selectionMode,
  showRank,
  onOpenDetail,
  onCloseDetail,
  onToggleOfficial,
  onPurchase,
  onCompleteSingleSelection,
}: SkillMarketplaceCatalogProps): JSX.Element {
	const [confirmingPurchase, setConfirmingPurchase] = React.useState(false)
	const [page, setPage] = React.useState(1)
	const pageCount = Math.max(1, Math.ceil(items.length / MARKETPLACE_PAGE_SIZE))
	const itemIdentity = React.useMemo(() => items.map((item) => item.skill.id).join('\u0000'), [items])
	const pageItems = items.slice((page - 1) * MARKETPLACE_PAGE_SIZE, page * MARKETPLACE_PAGE_SIZE)

	React.useEffect(() => setConfirmingPurchase(false), [detailItem?.skill.id])
	React.useEffect(() => setPage(1), [itemIdentity, showRank])
	React.useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  if (!detailItem) {
		return (
			<div className="tc-skill-library__catalog">
				{items.length > 0 ? <div className="tc-skill-library__paged-grid" role="feed" aria-label={showRank ? '技能榜单列表' : '探索技能列表'}>{pageItems.map((item) => <MarketplaceRow item={item} showRank={showRank} onOpenDetail={onOpenDetail} key={item.skill.id} />)}</div> : <div className="tc-skill-library__empty">没有匹配的 Skill</div>}
				{items.length > 0 ? <nav className="tc-skill-library__pagination" aria-label="技能商城分页">
					<button className="tc-skill-library__page-button tc-skill-library__page-button--arrow" type="button" disabled={page === 1} aria-label="上一页" onClick={() => setPage((current) => Math.max(1, current - 1))}><IconChevronLeft className="tc-skill-library__page-icon" size={15} /></button>
					{Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => <button className={`tc-skill-library__page-button${page === pageNumber ? ' is-active' : ''}`} type="button" aria-current={page === pageNumber ? 'page' : undefined} key={pageNumber} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
					<button className="tc-skill-library__page-button tc-skill-library__page-button--arrow" type="button" disabled={page === pageCount} aria-label="下一页" onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><IconChevronRight className="tc-skill-library__page-icon" size={15} /></button>
					<span className="tc-skill-library__pagination-total">共 {items.length} 个</span>
				</nav> : null}
			</div>
		)
  }

  const installedSkill = findInstalledMarketplaceSkill(detailItem, personalSkills)
  const selected = detailItem.sourceType === 'official'
    ? selectedOfficialIds.includes(detailItem.skill.id)
    : false
  const priceCredits = detailItem.priceCredits ?? 0
  const purchasing = detailItem.productId === purchasingProductId

  const handlePrimaryAction = async (): Promise<void> => {
    if (!detailItem.owned) {
			setConfirmingPurchase(true)
      return
    }
    if (detailItem.sourceType === 'official') {
      onToggleOfficial(detailItem.skill)
      if (selectionMode === 'single') onCompleteSingleSelection()
      return
    }
  }

  return (
    <div className="tc-skill-library__detail">
      <button className="tc-skill-library__detail-back" type="button" onClick={onCloseDetail} aria-label="返回技能列表">
        <IconArrowLeft className="tc-skill-library__detail-back-icon" size={18} />
      </button>
      <div className="tc-skill-library__detail-hero">
        <SkillLogo className="tc-skill-library__detail-logo" skill={detailItem.skill} priority="critical" />
        <div className="tc-skill-library__detail-heading">
          <span className="tc-skill-library__detail-kicker">{detailItem.skill.category}</span>
          <h3 className="tc-skill-library__detail-title">{detailItem.skill.name}</h3>
          <span className="tc-skill-library__detail-author">{detailItem.sellerName || '未知创作者'}</span>
        </div>
        <span className="tc-skill-library__detail-price">{formatSkillPrice(detailItem)}</span>
      </div>
      <div className="tc-skill-library__detail-body">
        <section className="tc-skill-library__detail-description" aria-labelledby="tc-skill-detail-description-title">
          <h4 className="tc-skill-library__detail-section-title" id="tc-skill-detail-description-title">技能介绍</h4>
          <p className="tc-skill-library__detail-copy">{detailItem.skill.description || '创作者未提供技能介绍。'}</p>
        </section>
        <aside className="tc-skill-library__detail-facts" aria-label="技能信息">
          <dl className="tc-skill-library__fact-list">
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">创作者</dt><dd className="tc-skill-library__fact-value">{detailItem.sellerName || '未知'}</dd></div>
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">类别</dt><dd className="tc-skill-library__fact-value">{detailItem.skill.category}</dd></div>
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">购买</dt><dd className="tc-skill-library__fact-value">{detailItem.realPurchaseCount} 人</dd></div>
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">大小</dt><dd className="tc-skill-library__fact-value">{formatSkillFileSize(detailItem.sizeBytes)}</dd></div>
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">提示词长度</dt><dd className="tc-skill-library__fact-value">{formatSkillPromptLength(detailItem.promptCharacterCount)}</dd></div>
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">上架</dt><dd className="tc-skill-library__fact-value">{formatSkillDate(detailItem.listedAt)}</dd></div>
            <div className="tc-skill-library__fact"><dt className="tc-skill-library__fact-label">更新</dt><dd className="tc-skill-library__fact-value">{formatSkillDate(detailItem.skill.updatedAt)}</dd></div>
          </dl>
        </aside>
      </div>
      <footer className="tc-skill-library__detail-footer">
        <span className="tc-skill-library__detail-balance"><IconCoins className="tc-skill-library__detail-balance-icon" size={16} />可用 {creditBalance} 积分</span>
			<button className="tc-skill-library__primary-action" type="button" disabled={purchasing || (detailItem.owned && detailItem.sourceType === 'user_asset')} onClick={() => void handlePrimaryAction()}>
				{purchasing ? <Loader className="tc-skill-library__action-loader" size={14} color="dark" /> : detailItem.owned ? selected || detailItem.sourceType === 'user_asset' ? <IconCheck className="tc-skill-library__action-icon" size={15} /> : <IconPlus className="tc-skill-library__action-icon" size={15} /> : <IconShoppingBag className="tc-skill-library__action-icon" size={15} />}
				<span className="tc-skill-library__action-label">{detailItem.owned ? detailItem.sourceType === 'user_asset' ? installedSkill ? '已安装 · 对话中按轮选择' : '安装状态异常' : selected ? '取消本轮选择' : '用于本轮对话' : `购买 · ${priceCredits} 积分`}</span>
			</button>
      </footer>
			<SkillPurchaseConfirmDialog
				opened={confirmingPurchase}
				item={detailItem}
				creditBalance={creditBalance}
				purchasing={purchasing}
				onClose={() => setConfirmingPurchase(false)}
				onConfirm={async () => {
					const purchased = await onPurchase(detailItem)
					if (purchased) setConfirmingPurchase(false)
					return purchased
				}}
			/>
    </div>
  )
}
