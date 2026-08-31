import React from 'react'
import {
	IconArrowUpRight,
	IconCoins,
	IconDots,
	IconEdit,
	IconTrash,
	IconUpload,
} from '@tabler/icons-react'
import type { SkillMarketplaceSellerDashboardDto, SkillMarketplaceSellerListingDto, UserContextAssetDto } from '../../api/server'
import { SkillActionConfirmDialog, type SkillActionConfirmKind } from './SkillActionConfirmDialog'
import { SkillLogo } from './SkillLogo'
import { formatSkillDate, formatSkillFileSize } from './skillMarketplaceViewModel'

type PersonalCatalogView = 'mine' | 'listed' | 'earnings'
type OwnedSkillFilter = 'all' | 'personal' | 'purchased'
type ListingReviewFilter = 'all' | SkillMarketplaceSellerListingDto['reviewStatus']

type SkillPersonalCatalogProps = {
	view: PersonalCatalogView
	query: string
	skills: readonly UserContextAssetDto[]
	sellerListings: readonly SkillMarketplaceSellerListingDto[]
	dashboard: SkillMarketplaceSellerDashboardDto
	canListSkills: boolean
	updatingPersonalId: string
	listingPersonalId: string
	onEditSkill: (skill: UserContextAssetDto) => void
	onDeleteSkill: (skill: UserContextAssetDto) => Promise<boolean>
	onUnlistSkill: (skill: UserContextAssetDto) => Promise<boolean>
}

function matchesQuery(skill: UserContextAssetDto, query: string): boolean {
	const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
	return !normalizedQuery || `${skill.name} ${skill.fileName} ${skill.description || ''}`
		.toLocaleLowerCase('zh-CN')
		.includes(normalizedQuery)
}

function SkillActions({
	skill,
	busy,
	canListSkills,
	onEditSkill,
	onRequestDelete,
	onRequestListing,
	opened,
	onToggle,
	onClose,
}: {
	skill: UserContextAssetDto
	busy: boolean
	canListSkills: boolean
	onEditSkill: (skill: UserContextAssetDto) => void
	onRequestDelete: (skill: UserContextAssetDto) => void
	onRequestListing: (skill: UserContextAssetDto) => void
	opened: boolean
	onToggle: () => void
	onClose: () => void
}): JSX.Element {
	const menuRef = React.useRef<HTMLDivElement | null>(null)
	const purchased = Boolean(skill.sourceMarketplaceProductId)
	const requestListing = (): void => {
		if (canListSkills) onRequestListing(skill)
	}

	React.useEffect(() => {
		if (!opened) return
		const handlePointerDown = (event: PointerEvent): void => {
			if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose()
		}
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('pointerdown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [onClose, opened])

	const runAction = (action: () => void): void => {
		onClose()
		action()
	}

	return (
		<div className="tc-skill-library__personal-menu" ref={menuRef}>
			<button className="tc-skill-library__personal-menu-trigger" type="button" title="更多操作" disabled={busy} aria-label={`${skill.name} 更多操作`} aria-haspopup="menu" aria-expanded={opened} onClick={onToggle}><IconDots className="tc-skill-library__personal-menu-trigger-icon" size={17} /></button>
			{opened ? (
				<div className="tc-skill-library__personal-menu-dropdown" role="menu" aria-label={`${skill.name} 操作`}>
					{!purchased ? <button className="tc-skill-library__personal-menu-item" type="button" role="menuitem" onClick={() => runAction(() => onEditSkill(skill))}><IconEdit className="tc-skill-library__personal-menu-icon" size={15} /><span className="tc-skill-library__personal-menu-label">编辑技能</span></button> : null}
					{!purchased ? <button className="tc-skill-library__personal-menu-item" type="button" role="menuitem" disabled={!canListSkills} onClick={() => runAction(requestListing)}><IconUpload className="tc-skill-library__personal-menu-icon" size={15} /><span className="tc-skill-library__personal-menu-label">{skill.marketplaceListing ? '管理上架' : '上架到商城'}</span>{!canListSkills ? <span className="tc-skill-library__vip-badge">需管理员授权</span> : null}</button> : null}
					<div className="tc-skill-library__personal-menu-divider" role="separator" />
					<button className="tc-skill-library__personal-menu-item tc-skill-library__personal-menu-item--danger" type="button" role="menuitem" onClick={() => runAction(() => onRequestDelete(skill))}><IconTrash className="tc-skill-library__personal-menu-icon" size={15} /><span className="tc-skill-library__personal-menu-label">卸载</span></button>
				</div>
			) : null}
		</div>
	)
}

function OwnedSkills(props: Pick<SkillPersonalCatalogProps,
		'query' | 'skills' | 'sellerListings' | 'canListSkills' | 'updatingPersonalId' | 'listingPersonalId' | 'onEditSkill'
		> & { onRequestListing: (skill: UserContextAssetDto) => void; onRequestDelete: (skill: UserContextAssetDto) => void }): JSX.Element {
	const [filter, setFilter] = React.useState<OwnedSkillFilter>('all')
	const [openMenuSkillId, setOpenMenuSkillId] = React.useState('')
	React.useEffect(() => setOpenMenuSkillId(''), [filter, props.query])
	const filtered = props.skills.filter((skill) => {
		if (!matchesQuery(skill, props.query)) return false
		if (filter === 'personal') return !skill.sourceMarketplaceProductId
		if (filter === 'purchased') return Boolean(skill.sourceMarketplaceProductId)
		return true
	})
	return (
		<div className="tc-skill-library__owned-view">
			<div className="tc-skill-library__owned-filters" role="tablist" aria-label="我的技能来源">
				{([['all', '全部'], ['personal', '个人'], ['purchased', '购买']] as const).map(([value, label]) => <button className={`tc-skill-library__owned-filter${filter === value ? ' is-active' : ''}`} type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}
			</div>
			<div className="tc-skill-library__personal-list">
				{filtered.map((skill) => {
					const sellerListing = props.sellerListings.find((record) => record.asset.id === skill.id)
					return (
						<article className="tc-skill-library__personal" key={skill.id}>
							<SkillLogo className="tc-skill-library__personal-logo" skill={{ ...skill, key: skill.fileName }} priority="visible" />
							<span className="tc-skill-library__personal-copy">
								<strong className="tc-skill-library__personal-name">{skill.name}</strong>
								<span className="tc-skill-library__personal-meta">{skill.sourceMarketplaceProductId ? '购买' : '个人'} · {formatSkillFileSize(skill.sizeBytes)} · {skill.fileName}</span>
								{!skill.logoUrl ? <span className="tc-skill-library__personal-logo-required">缺少 Logo，请编辑补齐</span> : null}
								{skill.marketplaceListing && sellerListing ? <span className={`tc-skill-library__personal-listing-state is-${sellerListing.reviewStatus}`}>{listingReviewLabels[sellerListing.reviewStatus]} · {skill.marketplaceListing.priceCredits} 积分</span> : null}
							</span>
							<SkillActions skill={skill} busy={props.updatingPersonalId === skill.id || props.listingPersonalId === skill.id} canListSkills={props.canListSkills} onEditSkill={props.onEditSkill} onRequestDelete={props.onRequestDelete} onRequestListing={props.onRequestListing} opened={openMenuSkillId === skill.id} onToggle={() => setOpenMenuSkillId((current) => current === skill.id ? '' : skill.id)} onClose={() => setOpenMenuSkillId('')} />
						</article>
					)
				})}
				{filtered.length === 0 ? <div className="tc-skill-library__empty">还没有匹配的 Skill</div> : null}
			</div>
		</div>
	)
}

const listingReviewLabels: Record<SkillMarketplaceSellerListingDto['reviewStatus'], string> = {
	pending: '审核中',
	approved: '已通过',
	rejected: '已驳回',
}

function ListedSkills({ query, sellerListings, listingPersonalId, onRequestListing, onRequestUnlist }: Pick<SkillPersonalCatalogProps, 'query' | 'sellerListings' | 'listingPersonalId'> & { onRequestListing: (skill: UserContextAssetDto) => void; onRequestUnlist: (skill: UserContextAssetDto) => void }): JSX.Element {
	const [filter, setFilter] = React.useState<ListingReviewFilter>('all')
	const filtered = sellerListings.filter((listing) => (
		(filter === 'all' || listing.reviewStatus === filter)
		&& matchesQuery(listing.asset, query)
	))
	return (
		<div className="tc-skill-library__listed-view">
			<div className="tc-skill-library__owned-filters" role="tablist" aria-label="上架审核状态">
				{([['all', '全部'], ['pending', '审核中'], ['approved', '已通过'], ['rejected', '已驳回']] as const).map(([value, label]) => <button className={`tc-skill-library__owned-filter${filter === value ? ' is-active' : ''}`} type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}
			</div>
			<div className="tc-skill-library__personal-list">
				{filtered.map((record) => {
					const skill = record.asset
					const listing = skill.marketplaceListing
					if (!listing) return null
					return (
						<article className="tc-skill-library__personal tc-skill-library__personal--listing" key={skill.id}>
							<SkillLogo className="tc-skill-library__personal-logo" skill={{ ...skill, key: skill.fileName }} priority="visible" />
							<span className="tc-skill-library__personal-copy"><strong className="tc-skill-library__personal-name">{skill.name}</strong><span className="tc-skill-library__personal-meta">{formatSkillFileSize(skill.sizeBytes)} · 提交于 {formatSkillDate(record.submittedAt)}</span><span className={`tc-skill-library__personal-listing-state is-${record.reviewStatus}`}>{listingReviewLabels[record.reviewStatus]} · {listing.priceCredits} 积分 · {record.category}</span></span>
							<span className="tc-skill-library__personal-listing">
								<button className="tc-skill-library__personal-list-button" type="button" disabled={listingPersonalId === skill.id} onClick={() => onRequestListing(skill)}><IconArrowUpRight className="tc-skill-library__personal-list-icon" size={15} /><span className="tc-skill-library__personal-list-label">{record.reviewStatus === 'rejected' ? '重新提交' : '管理'}</span></button>
								<button className="tc-skill-library__personal-unlist-button" type="button" disabled={listingPersonalId === skill.id} onClick={() => onRequestUnlist(skill)}>{record.reviewStatus === 'pending' ? '撤回' : record.reviewStatus === 'rejected' ? '移除' : '下架'}</button>
							</span>
						</article>
					)
				})}
				{filtered.length === 0 ? <div className="tc-skill-library__empty"><strong className="tc-skill-library__empty-title">还没有上架记录</strong><span className="tc-skill-library__empty-copy">在“我的技能”中打开自己的技能，点击“上架到商城”提交审核</span></div> : null}
			</div>
		</div>
	)
}

function Earnings({ dashboard }: { dashboard: SkillMarketplaceSellerDashboardDto }): JSX.Element {
	return (
		<div className="tc-skill-library__earnings">
			<div className="tc-skill-library__earnings-summary">
				<section className="tc-skill-library__metric" aria-label="累计积分收入"><IconCoins className="tc-skill-library__metric-icon" size={19} /><span className="tc-skill-library__metric-copy"><span className="tc-skill-library__metric-label">累计积分收入</span><strong className="tc-skill-library__metric-value">{dashboard.totalIncomeCredits} 积分</strong></span></section>
				<section className="tc-skill-library__metric" aria-label="成交次数"><span className="tc-skill-library__metric-copy"><span className="tc-skill-library__metric-label">成交次数</span><strong className="tc-skill-library__metric-value">{dashboard.soldCount}</strong></span></section>
				<section className="tc-skill-library__metric" aria-label="上架记录"><span className="tc-skill-library__metric-copy"><span className="tc-skill-library__metric-label">上架记录</span><strong className="tc-skill-library__metric-value">{dashboard.listedCount}</strong></span></section>
			</div>
			<section className="tc-skill-library__sales" aria-labelledby="tc-skill-sales-title"><h3 className="tc-skill-library__sales-title" id="tc-skill-sales-title">最近成交</h3><div className="tc-skill-library__sales-list">{dashboard.recentSales.map((sale) => <article className="tc-skill-library__sale" key={sale.id}><span className="tc-skill-library__sale-name">{sale.skillName}</span><time className="tc-skill-library__sale-time" dateTime={sale.createdAt}>{formatSkillDate(sale.createdAt)}</time><strong className="tc-skill-library__sale-amount">+{sale.priceCredits} 积分</strong></article>)}{dashboard.recentSales.length === 0 ? <div className="tc-skill-library__empty tc-skill-library__empty--sales">还没有成交记录</div> : null}</div></section>
		</div>
	)
}

export function SkillPersonalCatalog(props: SkillPersonalCatalogProps & { onRequestListing: (skill: UserContextAssetDto) => void }): JSX.Element {
	const [confirmation, setConfirmation] = React.useState<{ kind: SkillActionConfirmKind; skill: UserContextAssetDto } | null>(null)

	React.useEffect(() => setConfirmation(null), [props.view])

	const content = props.view === 'earnings'
		? <Earnings dashboard={props.dashboard} />
		: props.view === 'listed'
			? <ListedSkills query={props.query} sellerListings={props.sellerListings} listingPersonalId={props.listingPersonalId} onRequestUnlist={(skill) => setConfirmation({ kind: 'unlist', skill })} onRequestListing={props.onRequestListing} />
			: <OwnedSkills query={props.query} skills={props.skills} sellerListings={props.sellerListings} canListSkills={props.canListSkills} updatingPersonalId={props.updatingPersonalId} listingPersonalId={props.listingPersonalId} onEditSkill={props.onEditSkill} onRequestDelete={(skill) => setConfirmation({ kind: 'uninstall', skill })} onRequestListing={props.onRequestListing} />
	const confirmationBusy = Boolean(confirmation && (
		props.updatingPersonalId === confirmation.skill.id
		|| props.listingPersonalId === confirmation.skill.id
	))

	return (
		<div className="tc-skill-library__personal-catalog">
			{content}
			<SkillActionConfirmDialog
				opened={Boolean(confirmation)}
				kind={confirmation?.kind ?? 'uninstall'}
				skill={confirmation?.skill ?? null}
				busy={confirmationBusy}
				onClose={() => setConfirmation(null)}
				onConfirm={async () => {
					if (!confirmation) return false
					const succeeded = confirmation.kind === 'uninstall'
						? await props.onDeleteSkill(confirmation.skill)
						: await props.onUnlistSkill(confirmation.skill)
					if (succeeded) setConfirmation(null)
					return succeeded
				}}
			/>
		</div>
	)
}
