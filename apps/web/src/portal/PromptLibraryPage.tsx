import React from 'react'
import { TextInput } from '@mantine/core'
import { IconPhoto, IconSearch, IconVideo } from '@tabler/icons-react'
import { listPromptLibrary, type PromptLibraryCard as PromptLibraryCardDto, type PromptLibraryFacets, type PromptLibrarySort, type PromptMediaKind } from '../api/promptLibrary'
import { useAuth } from '../auth/store'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { StatePanel } from '../ui/StatePanel'
import { useActiveTeamId } from '../ui/team/activeTeam'
import { ToastHost, toast } from '../ui/toast'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { PortalFooter } from './PortalFooter'
import { PortalHeader } from './PortalHeader'
import { PromptDetailPageLoginRuntime } from './PromptDetailPageLoginRuntime'
import { PromptLibraryCard } from './PromptLibraryCard'
import { PromptModelSelect } from './PromptModelSelect'
import { PromptSortSelect } from './PromptSortSelect'
import { distributePromptLibraryMasonry } from './promptLibraryMasonry'
import { createPromptLibraryProject, PromptLibraryCanvasSaveError } from './promptLibraryProject'
import './PromptLibrary.css'

type MediaFilter = 'all' | PromptMediaKind

const EMPTY_FACETS: PromptLibraryFacets = { media: [], models: [], allMediaCount: 0, allModelCount: 0 }
const PROMPT_TOOLBAR_ORB_URL = 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/static/portal/prompt-toolbar-orb-v1-20260825.png'
const MASONRY_COLUMN_GAP = 20

type PromptLibraryLayout = Readonly<{
  columnCount: number
  columnWidth: number
}>

function promptLibraryLayout(): PromptLibraryLayout {
  if (typeof window === 'undefined') return { columnCount: 5, columnWidth: 299 }
  const viewportWidth = window.innerWidth
  const columnCount = viewportWidth <= 560 ? 1 : viewportWidth <= 860 ? 2 : viewportWidth <= 1180 ? 4 : 5
  const horizontalInset = viewportWidth <= 560 ? 20 : viewportWidth <= 860 ? 28 : 64
  const contentWidth = Math.min(1560, Math.max(1, viewportWidth - horizontalInset))
  return {
    columnCount,
    columnWidth: Math.max(1, (contentWidth - (columnCount - 1) * MASONRY_COLUMN_GAP) / columnCount),
  }
}

function usePromptLibraryLayout(): PromptLibraryLayout {
  const [layout, setLayout] = React.useState(promptLibraryLayout)
  React.useEffect(() => {
    const update = (): void => setLayout(promptLibraryLayout())
    window.addEventListener('resize', update, { passive: true })
    return () => window.removeEventListener('resize', update)
  }, [])
  return layout
}

export default function PromptLibraryPage(): JSX.Element {
  const pageRef = React.useRef<HTMLElement | null>(null)
  const toolbarSentinelRef = React.useRef<HTMLDivElement | null>(null)
  const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = React.useRef(false)
  const creatingProjectRef = React.useRef(false)
  const requestVersionRef = React.useRef(0)
  const currentUser = useAuth((state) => state.user)
  const activeTeamId = useActiveTeamId()
  const [items, setItems] = React.useState<PromptLibraryCardDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [facets, setFacets] = React.useState<PromptLibraryFacets>(EMPTY_FACETS)
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [model, setModel] = React.useState('')
  const [mediaType, setMediaType] = React.useState<MediaFilter>('all')
  const [sort, setSort] = React.useState<PromptLibrarySort>('likes_desc')
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState('')
  const [loadMoreError, setLoadMoreError] = React.useState('')
  const [toolbarStuck, setToolbarStuck] = React.useState(false)
  const [toolbarHovered, setToolbarHovered] = React.useState(false)
  const [modelSelectOpen, setModelSelectOpen] = React.useState(false)
  const [sortSelectOpen, setSortSelectOpen] = React.useState(false)
  const [loginOpen, setLoginOpen] = React.useState(false)
  const [creatingEntryId, setCreatingEntryId] = React.useState<string | null>(null)
  const layout = usePromptLibraryLayout()
  const itemColumns = React.useMemo(() => {
    return distributePromptLibraryMasonry(items, layout.columnCount, layout.columnWidth)
  }, [items, layout.columnCount, layout.columnWidth])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  React.useEffect(() => {
    let active = true
    requestVersionRef.current += 1
    setLoading(true)
    setError('')
    setLoadMoreError('')
    setPage(1)
    void listPromptLibrary({ query: query || undefined, model: model || undefined, mediaType: mediaType === 'all' ? undefined : mediaType, sort, page: 1 })
      .then((result) => {
        if (!active) return
        setItems(result.items)
        setTotal(result.total)
        setFacets(result.facets)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : '加载提示词失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [mediaType, model, query, sort])

  const hasMore = items.length < total

  const loadMore = React.useCallback(async (): Promise<void> => {
    if (loading || loadingMoreRef.current || !hasMore) return
    loadingMoreRef.current = true
    const requestVersion = requestVersionRef.current
    const nextPage = page + 1
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const result = await listPromptLibrary({ query: query || undefined, model: model || undefined, mediaType: mediaType === 'all' ? undefined : mediaType, sort, page: nextPage })
      if (requestVersion !== requestVersionRef.current) return
      setItems((current) => {
        const existingIds = new Set(current.map((entry) => entry.id))
        return [...current, ...result.items.filter((entry) => !existingIds.has(entry.id))]
      })
      setPage(nextPage)
      setTotal(result.total)
      setFacets(result.facets)
    } catch (reason) {
      if (requestVersion === requestVersionRef.current) {
        setLoadMoreError(reason instanceof Error ? reason.message : '加载更多提示词失败')
      }
    } finally {
      loadingMoreRef.current = false
      if (requestVersion === requestVersionRef.current) setLoadingMore(false)
    }
  }, [hasMore, loading, mediaType, model, page, query, sort])

  const createProjectFromEntry = React.useCallback(async (entry: PromptLibraryCardDto): Promise<void> => {
    if (creatingProjectRef.current) return
    if (!currentUser) {
      setLoginOpen(true)
      return
    }
    creatingProjectRef.current = true
    setCreatingEntryId(entry.id)
    try {
      const result = await createPromptLibraryProject(entry, activeTeamId)
      toast('项目与画布已创建', 'success')
      spaNavigate(buildStudioUrl({
        projectId: result.project.id,
        ownerType: 'project',
        ownerId: result.project.id,
        flowId: result.flow.id,
      }))
    } catch (error) {
      if (error instanceof PromptLibraryCanvasSaveError) {
        toast(`项目“${error.project.name}”已创建，但提示词添加到画布失败：${error.message}`, 'error')
      } else {
        toast(error instanceof Error ? error.message : '新建项目失败', 'error')
      }
    } finally {
      creatingProjectRef.current = false
      setCreatingEntryId(null)
    }
  }, [activeTeamId, currentUser])

  React.useEffect(() => {
    const root = pageRef.current
    const sentinel = toolbarSentinelRef.current
    if (!root || !sentinel) return
    const updateStickyState = (): void => {
      const nextStuck = root.scrollTop > Math.max(0, sentinel.offsetTop - 74)
      setToolbarStuck((current) => current === nextStuck ? current : nextStuck)
    }
    updateStickyState()
    root.addEventListener('scroll', updateStickyState, { passive: true })
    return () => root.removeEventListener('scroll', updateStickyState)
  }, [])

  React.useEffect(() => {
    if (!loading && mediaType !== 'all' && !facets.media.some((facet) => facet.kind === mediaType && facet.count > 0)) {
      setMediaType('all')
    }
  }, [facets.media, loading, mediaType])

  React.useEffect(() => {
    if (!loading && model && !facets.models.some((facet) => facet.slug === model && facet.count > 0)) {
      setModel('')
    }
  }, [facets.models, loading, model])

  React.useEffect(() => {
    const root = pageRef.current
    const sentinel = loadMoreSentinelRef.current
    if (!root || !sentinel || loading || !hasMore || loadMoreError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    }, { root, rootMargin: '640px 0px', threshold: 0.01 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore, loadMoreError, loading])

  return (
    <main className="prompt-library-page" ref={pageRef}>
      <PortalHeader active="prompts" onRequestLogin={() => setLoginOpen(true)} />
      <ToastHost className="prompt-library-page__toast" />
      <PromptDetailPageLoginRuntime opened={loginOpen} onClose={() => setLoginOpen(false)} />
      <section className="prompt-library-page__content">
        <header className="prompt-library-page__intro">
          <div className="prompt-library-page__headline">
            <p className="prompt-library-page__eyebrow">提示词</p>
            <h1 className="prompt-library-page__title">找到一条灵感，直接带进画布</h1>
            <p className="prompt-library-page__subtitle">浏览图片与视频案例，选择合适的提示词后继续在画布中创作。</p>
          </div>
          <TextInput
            className="prompt-library-page__search"
            classNames={{ input: 'prompt-library-page__search-input', section: 'prompt-library-page__search-section' }}
            aria-label="搜索提示词"
            value={queryInput}
            onChange={(event) => setQueryInput(event.currentTarget.value)}
            placeholder="搜索人物、风格、镜头或场景"
            leftSection={<IconSearch className="prompt-library-page__search-icon" size={18} stroke={1.7} />}
            size="sm"
          />
        </header>

        <div className="prompt-library-page__toolbar-sentinel" ref={toolbarSentinelRef} aria-hidden="true" />
        <div
          className={`prompt-library-page__toolbar${toolbarStuck ? ' is-stuck' : ''}${!toolbarStuck || toolbarHovered || modelSelectOpen || sortSelectOpen ? ' is-expanded' : ' is-collapsed'}`}
          onMouseEnter={() => setToolbarHovered(true)}
          onMouseLeave={() => setToolbarHovered(false)}
          onFocusCapture={() => setToolbarHovered(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setToolbarHovered(false)
          }}
        >
          <button className="prompt-library-page__toolbar-orb" type="button" aria-label="返回页面顶部" title="返回顶部" onClick={() => pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <ManagedImage className="prompt-library-page__toolbar-orb-image" src={PROMPT_TOOLBAR_ORB_URL} alt="" priority="critical" />
          </button>
          <div className="prompt-library-page__toolbar-controls">
            <div className="prompt-library-page__scope" role="tablist" aria-label="媒体类型">
              {facets.allMediaCount > 0 ? (
                <button className={`prompt-library-page__scope-button${mediaType === 'all' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={mediaType === 'all'} onClick={() => setMediaType('all')}>
                  <span className="prompt-library-page__scope-name">全部</span><span className="prompt-library-page__scope-count">{facets.allMediaCount.toLocaleString('zh-CN')}</span>
                </button>
              ) : null}
              {facets.media.map((facet) => (
                <button className={`prompt-library-page__scope-button${mediaType === facet.kind ? ' is-active' : ''}`} key={facet.kind} type="button" role="tab" aria-selected={mediaType === facet.kind} onClick={() => setMediaType(facet.kind)}>
                  {facet.kind === 'image' ? <IconPhoto className="prompt-library-page__scope-icon" size={14} /> : <IconVideo className="prompt-library-page__scope-icon" size={14} />}
                  <span className="prompt-library-page__scope-name">{facet.kind === 'image' ? '图片' : '视频'}</span><span className="prompt-library-page__scope-count">{facet.count.toLocaleString('zh-CN')}</span>
                </button>
              ))}
            </div>
            <div className="prompt-library-page__model-filter">
              <span className="prompt-library-page__model-label-text">模型</span>
              <PromptModelSelect value={model} options={facets.models} allCount={facets.allModelCount} onChange={setModel} onOpenChange={setModelSelectOpen} />
            </div>
            <div className="prompt-library-page__sort-filter">
              <span className="prompt-library-page__sort-label-text">排序</span>
              <PromptSortSelect value={sort} onChange={setSort} onOpenChange={setSortSelectOpen} />
            </div>
            <span className={`prompt-library-page__count${loading ? ' is-filtering' : ''}`} aria-live="polite">
              {loading && items.length > 0
                ? '正在筛选…'
                : `已载入 ${items.length.toLocaleString('zh-CN')} / ${total.toLocaleString('zh-CN')}`}
            </span>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="prompt-library-page__state"><StatePanel className="prompt-library-page__state-panel" title="正在加载提示词…" tone="loading" /></div>
        ) : error && items.length === 0 ? (
          <div className="prompt-library-page__state"><StatePanel className="prompt-library-page__state-panel" title="提示词加载失败" description={error} tone="error" /></div>
        ) : items.length === 0 ? (
          <div className="prompt-library-page__state"><StatePanel className="prompt-library-page__state-panel" title="没有匹配的提示词" description="调整搜索词、模型或媒体类型后再试。" /></div>
        ) : (
          <div className={`prompt-library-page__grid${loading ? ' is-filtering' : ''}`} aria-busy={loading}>
            {itemColumns.map((columnItems, columnIndex) => (
              <div className="prompt-library-page__grid-column" key={`column-${columnIndex}`}>
                {columnItems.map((entry) => (
                  <PromptLibraryCard
                    entry={entry}
                    key={entry.id}
                    creatingProject={creatingEntryId === entry.id}
                    onCreateProject={(selectedEntry) => { void createProjectFromEntry(selectedEntry) }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {error && items.length > 0 ? <p className="prompt-library-page__inline-error">{error}</p> : null}
        {hasMore ? (
          <div className="prompt-library-page__more" ref={loadMoreSentinelRef} aria-live="polite">
            {loadMoreError ? (
              <>
                <p className="prompt-library-page__inline-error">{loadMoreError}</p>
                <button className="prompt-library-page__more-button" type="button" disabled={loadingMore} onClick={() => void loadMore()}>重试加载</button>
              </>
            ) : <span className="prompt-library-page__loading-more">{loadingMore ? '正在加载下一页…' : '继续滚动加载'}</span>}
          </div>
        ) : items.length > 0 ? <p className="prompt-library-page__end">已加载全部 {total.toLocaleString('zh-CN')} 条</p> : null}
      </section>
      <PortalFooter />
    </main>
  )
}
