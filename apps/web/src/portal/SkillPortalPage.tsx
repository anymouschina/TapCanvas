import React from 'react'
import { Loader, Modal } from '@mantine/core'
import { IconArrowLeft, IconBookmark, IconBookmarkFilled, IconCoins, IconPlus, IconSearch, IconShoppingBag } from '@tabler/icons-react'
import { listSkillFavorites, setSkillFavorite, type SkillMarketplaceItemDto } from '../api/server'
import { useAuth } from '../auth/store'
import { SkillLogo } from '../ui/skills/SkillLogo'
import { filterAndSortMarketplaceItems, formatSkillPrice } from '../ui/skills/skillMarketplaceViewModel'
import { useSkillLibraryData } from '../ui/skills/useSkillLibraryData'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { useRouteNavigationLease } from '../utils/useRouteNavigationLease'
import { PortalHeader } from './PortalHeader'
import { SkillMakerDialog } from './SkillMakerDialog'
import { useProjectLibrary } from './useProjectLibrary'
import { SkillCasePlayer } from './SkillCasePlayer'
import { OIIOII_SKILL_CATALOG, OIIOII_SKILL_CATEGORIES, getOiioiiCaseSkills, getOiioiiSkillCaseUrl, isOiioiiCatalogSkill } from './oiioiiSkillCatalog'
import './SkillPortalPage.css'

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const

export default function SkillPortalPage(): JSX.Element {
  const auth = useAuth()
  const acquireRouteNavigationLease = useRouteNavigationLease()
  const data = useSkillLibraryData()
  const [category, setCategory] = React.useState('全部')
  const [query, setQuery] = React.useState('')
  const [detailItem, setDetailItem] = React.useState<SkillMarketplaceItemDto | null>(null)
  const [notice, setNotice] = React.useState('')
  const [makerOpen, setMakerOpen] = React.useState(false)
  const [tryItem, setTryItem] = React.useState<SkillMarketplaceItemDto | null>(null)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [caseItem, setCaseItem] = React.useState<SkillMarketplaceItemDto | null>(null)
  const [favoriteKeys, setFavoriteKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [favoriteBusyKeys, setFavoriteBusyKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const projectLibrary = useProjectLibrary(auth.token, 0)
  const caseSkills = React.useMemo(() => getOiioiiCaseSkills(), [])
  const caseIndex = caseItem ? caseSkills.findIndex((item) => item.skill.key === caseItem.skill.key) : -1

  React.useEffect(() => {
    if (auth.token) {
      void data.load()
    }
  }, [auth.token, data.load])

  React.useEffect(() => {
    if (!auth.token) {
      setFavoriteKeys(new Set())
      return
    }
    let active = true
    void listSkillFavorites()
      .then((skillKeys) => {
        if (active) setFavoriteKeys(new Set(skillKeys))
      })
      .catch((reason: unknown) => {
        if (active) setNotice(reason instanceof Error ? reason.message : '加载 Skill 收藏失败')
      })
    return () => { active = false }
  }, [auth.token])

  const sourceItems = React.useMemo(() => auth.token
    ? [...OIIOII_SKILL_CATALOG, ...data.marketplaceItems]
    : [...OIIOII_SKILL_CATALOG], [auth.token, data.marketplaceItems])
  const loading = auth.token ? data.loading : false
  const error = auth.token ? data.error : ''

  const categories = React.useMemo(() => [
    ...OIIOII_SKILL_CATEGORIES,
    ...sourceItems.map((item) => item.skill.category).filter(Boolean),
  ].filter((item, index, values) => values.indexOf(item) === index), [sourceItems])

  const items = React.useMemo(() => filterAndSortMarketplaceItems({
    items: category === '我的技能' ? sourceItems.filter((item) => item.owned) : sourceItems,
    category: category === '我的技能' ? '全部' : category,
    query,
    sort: 'ranking',
  }), [category, query, sourceItems])

  const purchase = async (): Promise<void> => {
    if (!detailItem || detailItem.owned) return
    const result = await data.purchaseSkill(detailItem)
    if (!result) return
    setNotice(result.status === 'purchased' ? '购买成功，Skill 已安装到“我的技能”' : '该 Skill 已在“我的技能”中')
    setDetailItem((current) => current ? { ...current, owned: true } : null)
  }

  const createSkillProject = async (): Promise<void> => {
    if (!tryItem) return
    if (!auth.token) {
      setNotice('请先登录，再在新项目中使用该 Skill')
      setTryItem(null)
      return
    }
    setCreatingProject(true)
    setNotice('')
    const navigationLease = acquireRouteNavigationLease()
    try {
      const project = await projectLibrary.createProject(tryItem.skill.name || 'Skill 创作')
      if (!navigationLease.isCurrent()) return
      window.sessionStorage.setItem('tapcanvas.pendingSkillLaunch', JSON.stringify({
        projectId: project.id,
        skillKey: tryItem.skill.key,
        skillName: tryItem.skill.name,
        skillDescription: tryItem.skill.description || '',
      }))
      spaNavigate(buildStudioUrl({
        projectId: project.id,
        ownerType: 'project',
        ownerId: project.id,
      }))
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : '创建 Skill 项目失败')
    } finally {
      setCreatingProject(false)
    }
  }

  const toggleFavorite = async (item: SkillMarketplaceItemDto): Promise<void> => {
    const skillKey = item.skill.key
    if (!auth.token) {
      setNotice('请先登录，再收藏 Skill')
      return
    }
    if (favoriteBusyKeys.has(skillKey)) return
    const favorited = !favoriteKeys.has(skillKey)
    setFavoriteBusyKeys((current) => new Set(current).add(skillKey))
    setNotice('')
    try {
      await setSkillFavorite(skillKey, favorited)
      setFavoriteKeys((current) => {
        const next = new Set(current)
        if (favorited) next.add(skillKey)
        else next.delete(skillKey)
        return next
      })
      setNotice(favorited ? `已收藏“${item.skill.name}”` : `已取消收藏“${item.skill.name}”`)
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : `${favorited ? '收藏' : '取消收藏'} Skill 失败`)
    } finally {
      setFavoriteBusyKeys((current) => {
        const next = new Set(current)
        next.delete(skillKey)
        return next
      })
    }
  }

  return (
    <div className="skill-portal-page">
      <PortalHeader active="skills" />
      <div className="tc-portal-scroll-area">
        <main className="skill-portal-main">
          <header className="skill-portal-heading">
            <div className="skill-portal-heading__copy">
              <span className="skill-portal-heading__eyebrow">TapCanvas Skills</span>
              <h1 className="skill-portal-heading__title">技能</h1>
              <p className="skill-portal-heading__description">为创作 Agent 装配专业方法与工作流，让同一个想法更快抵达可执行结果。</p>
            </div>
            <label className="skill-portal-search">
              <IconSearch className="skill-portal-search__icon" size={16} />
              <input className="skill-portal-search__input" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索技能、类别或创作者" />
            </label>
            <button className="skill-portal-create" type="button" onClick={() => setMakerOpen(true)}><IconPlus className="skill-portal-create__icon" size={16} /><span className="skill-portal-create__label">创建我的 Skill</span></button>
          </header>

          <nav className="skill-portal-categories" aria-label="技能筛选">
            {categories.map((item) => (
              <button className={`skill-portal-category${category === item ? ' is-active' : ''}`} type="button" aria-current={category === item ? 'page' : undefined} key={item} onClick={() => setCategory(item)}>{item}</button>
            ))}
          </nav>

          {error ? <div className="skill-portal-state is-error" role="alert">{error}</div> : null}
          {!auth.token ? <div className="skill-portal-state">公开 Skill 可以浏览；登录后可创建、安装和启用自己的 Skill。</div> : null}
          {notice ? <div className="skill-portal-state is-success" role="status">{notice}</div> : null}
          {auth.token && !loading && !error && items.length === 0 ? <div className="skill-portal-state">当前筛选下没有 Skill</div> : null}

          <section className="skill-portal-grid" aria-label="技能列表" aria-busy={loading}>
            {loading ? SKELETON_KEYS.map((key) => <div className="skill-portal-card skill-portal-card--skeleton tc-portal-skeleton" aria-hidden="true" key={key} />) : null}
            {!loading ? items.map((item) => (
              <article className={`skill-portal-card${isOiioiiCatalogSkill(item) ? ' is-oiioii' : ''}`} key={item.skill.id}>
                <button className="skill-portal-card__action" type="button" onClick={() => { setDetailItem(item); setNotice('') }}>
                  <span className="skill-portal-card__visual"><SkillLogo className="skill-portal-card__logo" skill={item.skill} priority="visible" /></span>
                  <span className="skill-portal-card__body">
                    <span className="skill-portal-card__meta"><span className="skill-portal-card__category">{item.skill.category}</span><span className="skill-portal-card__price">{formatSkillPrice(item)}</span></span>
                    <strong className="skill-portal-card__title">{item.skill.name || item.skill.key}</strong>
                    <span className="skill-portal-card__description">{item.skill.description || '该 Skill 未提供简介'}</span>
                    <span className="skill-portal-card__author">{item.sellerName || 'TapCanvas'}</span>
                  </span>
                </button>
                <footer className="skill-portal-card__footer">
                  {getOiioiiSkillCaseUrl(item) ? <button className="skill-portal-card__case" type="button" onClick={() => setCaseItem(item)}>1 个案例</button> : <span className="skill-portal-card__usage">{item.realPurchaseCount} 人使用</span>}
                  <button
                    className={`skill-portal-card__favorite${favoriteKeys.has(item.skill.key) ? ' is-active' : ''}`}
                    type="button"
                    aria-label={favoriteKeys.has(item.skill.key) ? `取消收藏 ${item.skill.name}` : `收藏 ${item.skill.name}`}
                    aria-pressed={favoriteKeys.has(item.skill.key)}
                    disabled={favoriteBusyKeys.has(item.skill.key)}
                    onClick={() => void toggleFavorite(item)}
                  >
                    {favoriteKeys.has(item.skill.key) ? <IconBookmarkFilled className="skill-portal-card__favorite-icon" size={15} /> : <IconBookmark className="skill-portal-card__favorite-icon" size={15} />}
                  </button>
                  <button className="skill-portal-card__try" type="button" onClick={() => { if (isOiioiiCatalogSkill(item)) { setTryItem(item); setDetailItem(null) } else { setDetailItem(item) } }}>{isOiioiiCatalogSkill(item) ? '试试看' : '查看详情'}</button>
                </footer>
              </article>
            )) : null}
          </section>
        </main>
      </div>

      <Modal className="skill-portal-detail" opened={Boolean(detailItem)} onClose={() => setDetailItem(null)} withCloseButton={false} centered size={720} overlayProps={{ backgroundOpacity: 0.72, blur: 6 }}>
        {detailItem ? (
          <div className="skill-portal-detail__shell">
            <button className="skill-portal-detail__back" type="button" aria-label="返回技能列表" onClick={() => setDetailItem(null)}><IconArrowLeft className="skill-portal-detail__back-icon" size={18} /></button>
            <header className="skill-portal-detail__header">
              <SkillLogo className="skill-portal-detail__logo" skill={detailItem.skill} priority="critical" />
              <div className="skill-portal-detail__heading"><span className="skill-portal-detail__category">{detailItem.skill.category}</span><h2 className="skill-portal-detail__title">{detailItem.skill.name}</h2><span className="skill-portal-detail__author">{detailItem.sellerName || 'TapCanvas'}</span></div>
              <strong className="skill-portal-detail__price">{formatSkillPrice(detailItem)}</strong>
            </header>
            <section className="skill-portal-detail__content"><h3 className="skill-portal-detail__section-title">技能介绍</h3><p className="skill-portal-detail__description">{detailItem.skill.description || '创作者未提供技能介绍。'}</p></section>
            <footer className="skill-portal-detail__footer">
              <span className="skill-portal-detail__balance"><IconCoins className="skill-portal-detail__balance-icon" size={16} />{auth.token ? `可用 ${data.creditBalance} 积分` : '登录后可安装和使用'}</span>
              {isOiioiiCatalogSkill(detailItem) ? (
                <button className="skill-portal-detail__primary" type="button" onClick={() => { setTryItem(detailItem); setDetailItem(null) }}><span className="skill-portal-detail__primary-label">试试看</span></button>
              ) : (
                <button className="skill-portal-detail__primary" type="button" disabled={!auth.token || !detailItem.purchasable || detailItem.owned || data.purchasingProductId === detailItem.productId} onClick={() => void purchase()}>{data.purchasingProductId === detailItem.productId ? <Loader className="skill-portal-detail__loader" size={14} color="dark" /> : <IconShoppingBag className="skill-portal-detail__primary-icon" size={16} />}<span className="skill-portal-detail__primary-label">{!auth.token ? '登录后使用' : !detailItem.purchasable ? '系统自带' : detailItem.owned ? '已拥有' : `购买 · ${detailItem.priceCredits ?? 0} 积分`}</span></button>
              )}
            </footer>
          </div>
        ) : null}
      </Modal>
      <SkillMakerDialog opened={makerOpen} onClose={() => setMakerOpen(false)} onCreated={() => { setNotice('Skill 已保存到“我的技能”'); void data.load() }} />
      {caseItem ? (
        <SkillCasePlayer
          item={caseItem}
          previousDisabled={caseIndex <= 0}
          nextDisabled={caseIndex < 0 || caseIndex >= caseSkills.length - 1}
          onClose={() => setCaseItem(null)}
          onOpenDetail={() => { setDetailItem(caseItem); setCaseItem(null) }}
          onPrevious={() => { if (caseIndex > 0) setCaseItem(caseSkills[caseIndex - 1]) }}
          onNext={() => { if (caseIndex >= 0 && caseIndex < caseSkills.length - 1) setCaseItem(caseSkills[caseIndex + 1]) }}
        />
      ) : null}
      <Modal className="skill-try-dialog" opened={Boolean(tryItem)} onClose={() => { if (!creatingProject) setTryItem(null) }} centered size={420} title="在新项目中使用该技能" closeOnClickOutside={!creatingProject} closeOnEscape={!creatingProject} withCloseButton={!creatingProject} overlayProps={{ backgroundOpacity: 0.72, blur: 6 }}>
        <div className="skill-try-dialog__body">
          <p className="skill-try-dialog__description">创建一个名为“{tryItem?.skill.name}”的新项目，并将该 Skill 作为本次创作的启动上下文。</p>
          <footer className="skill-try-dialog__actions"><button className="skill-try-dialog__cancel" type="button" disabled={creatingProject} onClick={() => setTryItem(null)}>取消</button><button className="skill-try-dialog__continue" type="button" disabled={creatingProject} onClick={() => void createSkillProject()}>{creatingProject ? <Loader className="skill-try-dialog__loader" size={14} color="dark" /> : null}<span className="skill-try-dialog__continue-label">{creatingProject ? '创建中' : '继续'}</span></button></footer>
        </div>
      </Modal>
    </div>
  )
}
