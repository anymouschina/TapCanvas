import React from 'react'
import { Modal, NumberInput, Select } from '@mantine/core'
import {
  IconChartBar,
  IconCoins,
  IconCompass,
  IconGridDots,
  IconListCheck,
  IconSearch,
  IconTrophy,
  IconUpload,
} from '@tabler/icons-react'
import type { AgentSkillDto, UserContextAssetDto } from '../../api/server'
import { SkillEditorDialog } from './SkillEditorDialog'
import { SkillMarketplaceCatalog } from './SkillMarketplaceCatalog'
import { SkillPersonalCatalog } from './SkillPersonalCatalog'
import {
  filterAndSortMarketplaceItems,
  type SkillMarketplaceSort,
} from './skillMarketplaceViewModel'
import type { SkillLibraryData } from './useSkillLibraryData'
import './SkillLibraryDialog.css'

type SkillLibraryTab = 'explore' | 'ranking' | 'mine' | 'listed' | 'earnings'

type SkillLibraryDialogProps = {
  opened: boolean
  onClose: () => void
  data: SkillLibraryData
  selectedOfficialIds: readonly string[]
  onToggleOfficial: (skill: AgentSkillDto) => void
  selectionMode: 'single' | 'multiple'
}

const tabTitles: Record<SkillLibraryTab, string> = {
  explore: '探索',
  ranking: '技能榜单',
  mine: '我的技能',
  listed: '我的上架',
  earnings: '积分收入',
}

const defaultMarketplaceCategories = [
	'图像创作',
	'视频创作',
	'音频配音',
	'文案脚本',
	'故事小说',
	'角色设定',
	'电商营销',
	'社媒运营',
	'效率工具',
	'其他',
] as const

export function SkillLibraryDialog({
  opened,
  onClose,
  data,
  selectedOfficialIds,
  onToggleOfficial,
  selectionMode,
}: SkillLibraryDialogProps): JSX.Element {
  const [activeTab, setActiveTab] = React.useState<SkillLibraryTab>('explore')
  const [category, setCategory] = React.useState('全部')
  const [query, setQuery] = React.useState('')
  const [sort, setSort] = React.useState<SkillMarketplaceSort>('latest')
  const [detailSkillId, setDetailSkillId] = React.useState('')
  const [notice, setNotice] = React.useState('')
	const [editorOpened, setEditorOpened] = React.useState(false)
	const [editorInitialValue, setEditorInitialValue] = React.useState<{ skill: UserContextAssetDto; content: string } | null>(null)
	const [editorLoading, setEditorLoading] = React.useState(false)
	const [listingSkill, setListingSkill] = React.useState<UserContextAssetDto | null>(null)
	const [listingPrice, setListingPrice] = React.useState<number | ''>('')
	const [listingCategory, setListingCategory] = React.useState('其他')

  React.useEffect(() => {
    if (opened) void data.load()
  }, [data.load, opened])

  const categories = React.useMemo(() => [
    '全部',
		...defaultMarketplaceCategories,
    ...Array.from(new Set(data.marketplaceItems.map((item) => item.skill.category).filter(Boolean))),
	].filter((item, index, values) => values.indexOf(item) === index), [data.marketplaceItems])
  const effectiveSort: SkillMarketplaceSort = activeTab === 'ranking' ? 'ranking' : sort
  const marketplaceItems = React.useMemo(() => filterAndSortMarketplaceItems({
    items: data.marketplaceItems,
    category,
    query,
    sort: effectiveSort,
  }), [category, data.marketplaceItems, effectiveSort, query])
  const detailItem = data.marketplaceItems.find((item) => item.skill.id === detailSkillId) ?? null
  const isMarketplaceTab = activeTab === 'explore' || activeTab === 'ranking'
  const showSearch = activeTab !== 'earnings' && !detailItem

  const sidebarItems = [
    { value: 'explore' as const, label: '探索', icon: IconCompass },
    { value: 'ranking' as const, label: '技能榜单', icon: IconTrophy },
    { value: 'mine' as const, label: '我的技能', icon: IconGridDots },
    { value: 'listed' as const, label: '我的上架', icon: IconListCheck },
    { value: 'earnings' as const, label: '积分收入', icon: IconChartBar },
  ]

  const closeDialog = (): void => {
    setDetailSkillId('')
    setNotice('')
		setEditorOpened(false)
		setEditorInitialValue(null)
		setListingSkill(null)
    onClose()
  }

	const requestEdit = async (skill: UserContextAssetDto): Promise<void> => {
		setEditorLoading(true)
		const content = await data.loadPersonalSkillContent(skill.id)
		setEditorLoading(false)
		if (content === null) return
		setEditorInitialValue({ skill, content })
		setEditorOpened(true)
	}

	const requestListing = (skill: UserContextAssetDto): void => {
		if (!data.canListSkills) {
			setNotice('当前账户没有上架权限，请联系管理员授权')
			return
		}
		setListingSkill(skill)
		setListingPrice(skill.marketplaceListing?.priceCredits ?? '')
		const sellerListing = data.sellerListings.find((record) => record.asset.id === skill.id)
		setListingCategory(sellerListing?.category ?? '其他')
	}

  return (
    <Modal
      className="tc-skill-library"
      opened={opened}
      onClose={closeDialog}
      withCloseButton
      centered
      size={1160}
      zIndex={10100}
      overlayProps={{ backgroundOpacity: 0.68, blur: 8 }}
    >
      <div className="tc-skill-library__shell">
        <aside className="tc-skill-library__sidebar" aria-label="技能商城导航">
          <strong className="tc-skill-library__brand">技能</strong>
          <nav className="tc-skill-library__nav" aria-label="技能商城视图">
            {sidebarItems.map(({ value, label, icon: ItemIcon }) => (
              <button
                className={`tc-skill-library__nav-item${activeTab === value ? ' is-active' : ''}`}
                type="button"
                aria-current={activeTab === value ? 'page' : undefined}
                key={value}
                onClick={() => {
                  setActiveTab(value)
                  setDetailSkillId('')
                  setNotice('')
                }}
              >
                <ItemIcon className="tc-skill-library__nav-icon" size={17} />
                <span className="tc-skill-library__nav-label">{label}</span>
              </button>
            ))}
          </nav>
          <div className="tc-skill-library__sidebar-balance">
            <IconCoins className="tc-skill-library__sidebar-balance-icon" size={16} />
            <span className="tc-skill-library__sidebar-balance-copy"><span className="tc-skill-library__sidebar-balance-label">可用积分</span><strong className="tc-skill-library__sidebar-balance-value">{data.creditBalance}</strong></span>
          </div>
        </aside>

        <section className="tc-skill-library__main" aria-labelledby="tc-skill-library-title">
          <header className="tc-skill-library__header">
            <h2 className="tc-skill-library__title" id="tc-skill-library-title">
              {detailItem ? detailItem.skill.name : tabTitles[activeTab]}
            </h2>
            <div className="tc-skill-library__header-actions">
              {isMarketplaceTab && !detailItem ? (
                <label className="tc-skill-library__sort">
                  <span className="tc-skill-library__sort-label">排序</span>
                  <select className="tc-skill-library__sort-select" value={effectiveSort} disabled={activeTab === 'ranking'} onChange={(event) => setSort(event.currentTarget.value as SkillMarketplaceSort)}>
                    <option className="tc-skill-library__sort-option" value="latest">最新</option>
                    <option className="tc-skill-library__sort-option" value="popular">购买最多</option>
                    <option className="tc-skill-library__sort-option" value="price-asc">价格从低到高</option>
                    <option className="tc-skill-library__sort-option" value="ranking">综合排序</option>
                  </select>
                </label>
              ) : null}
              {showSearch ? (
                <label className="tc-skill-library__search">
                  <IconSearch className="tc-skill-library__search-icon" size={16} />
                  <input className="tc-skill-library__search-input" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索技能" />
                </label>
              ) : null}
              {activeTab === 'mine' && !detailItem ? (
                <button className="tc-skill-library__upload" type="button" disabled={data.uploading || editorLoading} onClick={() => { setEditorInitialValue(null); setEditorOpened(true) }}>
                  <IconUpload className="tc-skill-library__upload-icon" size={16} />
                  <span className="tc-skill-library__upload-label">{data.uploading ? '上传中' : editorLoading ? '读取中' : '上传技能'}</span>
                </button>
              ) : null}
            </div>
          </header>

          {isMarketplaceTab && !detailItem ? (
            <div className="tc-skill-library__categories" role="tablist" aria-label="技能分类">
              {categories.map((item) => (
                <button className={`tc-skill-library__category${category === item ? ' is-active' : ''}`} type="button" role="tab" aria-selected={category === item} key={item} onClick={() => setCategory(item)}>{item}</button>
              ))}
            </div>
          ) : null}

          {data.error ? <div className="tc-skill-library__error" role="alert">{data.error}</div> : null}
          {activeTab === 'earnings' && data.sellerDashboardError ? (
            <div className="tc-skill-library__error" role="alert">{data.sellerDashboardError}</div>
          ) : null}
          {notice ? <div className="tc-skill-library__notice" role="status">{notice}</div> : null}

          <div
            className={`tc-skill-library__content${isMarketplaceTab && !detailItem ? ' is-virtualized' : ''}`}
            aria-busy={data.loading}
          >
            {data.loading ? (
              <div className="tc-skill-library__grid" aria-hidden="true">
                {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => <div className="tc-skill-library__card tc-skill-library__card--skeleton" key={key} />)}
              </div>
            ) : null}

            {!data.loading && isMarketplaceTab ? (
              <div className="tc-skill-library__marketplace-page">
                <SkillMarketplaceCatalog
                  items={marketplaceItems}
                  detailItem={detailItem}
                  creditBalance={data.creditBalance}
                  personalSkills={data.personalSkills}
                  selectedOfficialIds={selectedOfficialIds}
                  purchasingProductId={data.purchasingProductId}
                  selectionMode={selectionMode}
                  showRank={activeTab === 'ranking'}
                  onOpenDetail={(item) => {
                    setDetailSkillId(item.skill.id)
                    setNotice('')
                  }}
                  onCloseDetail={() => {
                    setDetailSkillId('')
                    setNotice('')
                  }}
                  onToggleOfficial={onToggleOfficial}
                  onPurchase={async (item) => {
                    const result = await data.purchaseSkill(item)
                    if (!result) return false
                    setNotice(result.status === 'purchased' ? '购买成功，Skill 已安装到“我的技能”' : '该 Skill 已在“我的技能”中')
                    return true
                  }}
                  onCompleteSingleSelection={closeDialog}
                />
              </div>
            ) : null}

            {!data.loading && !isMarketplaceTab && !(activeTab === 'earnings' && data.sellerDashboardError) ? (
              <SkillPersonalCatalog
                view={activeTab}
                query={query}
                skills={data.personalSkills}
							sellerListings={data.sellerListings}
                dashboard={data.sellerDashboard}
						canListSkills={data.canListSkills}
                updatingPersonalId={data.updatingPersonalId}
                listingPersonalId={data.listingPersonalId}
						onEditSkill={(skill) => { void requestEdit(skill) }}
						onDeleteSkill={async (skill) => {
							const deleted = await data.deletePersonalSkill(skill)
							if (deleted) setNotice(`“${skill.name}”已卸载`)
							return deleted
						}}
							onUnlistSkill={async (skill) => {
								const unlisted = await data.unlistPersonalSkill(skill)
								if (unlisted) setNotice(`“${skill.name}”已下架，已购买用户不受影响`)
								return unlisted
							}}
						onRequestListing={requestListing}
              />
            ) : null}
          </div>
        </section>
      </div>
		<SkillEditorDialog
			opened={editorOpened}
			initialValue={editorInitialValue}
			submitting={data.uploading || Boolean(editorInitialValue && data.updatingPersonalId === editorInitialValue.skill.id)}
			onClose={() => { setEditorOpened(false); setEditorInitialValue(null) }}
			onSubmit={async (draft) => {
				const saved = editorInitialValue
					? await data.updatePersonalSkill(editorInitialValue.skill, draft)
					: await data.uploadPersonalSkill(draft)
				if (!saved) return false
				setActiveTab('mine')
				setNotice(editorInitialValue ? '技能已更新' : '上传成功，可通过卡片菜单继续启用或上架')
				return true
			}}
		/>
		<Modal className="tc-skill-listing-dialog" opened={Boolean(listingSkill)} onClose={() => setListingSkill(null)} title={listingSkill?.marketplaceListing ? '管理上架' : '上架到商城'} centered size="sm" zIndex={10200}>
			<div className="tc-skill-listing-dialog__body">
				<strong className="tc-skill-listing-dialog__skill-name">{listingSkill?.name}</strong>
				<span className="tc-skill-listing-dialog__rule">仅使用站内积分交易，积分进入你的个人积分账户，不支持变现或提现。</span>
				<NumberInput className="tc-skill-listing-dialog__price" label="积分售价" min={1} max={10_000_000} allowDecimal={false} suffix=" 积分" value={listingPrice} onChange={(value) => setListingPrice(typeof value === 'number' ? Math.trunc(value) : '')} />
				<Select className="tc-skill-listing-dialog__category" label="商城类目" data={[...defaultMarketplaceCategories]} allowDeselect={false} value={listingCategory} onChange={(value) => { if (value) setListingCategory(value) }} />
			</div>
			<footer className="tc-skill-listing-dialog__footer"><button className="tc-skill-listing-dialog__cancel" type="button" disabled={Boolean(listingSkill && data.listingPersonalId === listingSkill.id)} onClick={() => setListingSkill(null)}>取消</button><button className="tc-skill-listing-dialog__submit" type="button" disabled={!listingSkill || typeof listingPrice !== 'number' || listingPrice < 1 || data.listingPersonalId === listingSkill.id} onClick={() => {
				if (!listingSkill || typeof listingPrice !== 'number') return
				void data.listPersonalSkill(listingSkill, listingPrice, listingCategory).then((listed) => {
					if (!listed) return
					setNotice(listingSkill.marketplaceListing ? '已重新提交审核' : '已提交审核，可在“我的上架”查看进度')
					setListingSkill(null)
				})
			}}>{listingSkill && data.listingPersonalId === listingSkill.id ? '提交中' : listingSkill?.marketplaceListing ? '重新提交审核' : '提交审核'}</button></footer>
		</Modal>
    </Modal>
  )
}
