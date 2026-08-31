import React from 'react'
import { ActionIcon, Button, Group, Loader, Modal, ScrollArea, Text, Textarea, TextInput } from '@mantine/core'
import { IconBraces, IconSearch } from '@tabler/icons-react'
import { listPromptLibrary, type PromptLibraryCard as PromptLibraryCardDto, type PromptMediaKind } from '../../../../api/promptLibrary'
import { PromptLibraryCard } from '../../../../portal/PromptLibraryCard'
import { CanvasPromptLibraryDetailModal } from './CanvasPromptLibraryDetailModal'

type CanvasPromptLibraryPickerProps = Readonly<{
  mediaType: PromptMediaKind
  currentPrompt?: string
  onPromptChange?: (promptText: string) => void
  disabled?: boolean
  onSelect: (promptText: string) => void
}>

type PickerTab = 'library' | 'custom'

function mediaTypeLabel(mediaType: PromptMediaKind): string {
  return mediaType === 'video' ? '视频' : '图片'
}

function getPromptLibraryColumnCount(width: number): number {
  if (width < 560) return 1
  if (width < 900) return 2
  if (width < 1200) return 3
  return 4
}

export function CanvasPromptLibraryPicker({ mediaType, currentPrompt = '', onPromptChange, disabled = false, onSelect }: CanvasPromptLibraryPickerProps): JSX.Element {
  const [opened, setOpened] = React.useState(false)
  const [detailOpened, setDetailOpened] = React.useState(false)
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<PromptLibraryCardDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const pageRef = React.useRef(0)
  const hasMoreRef = React.useRef(false)
  const loadingMoreRef = React.useRef(false)
  const requestGenerationRef = React.useRef(0)
  const wasOpenedRef = React.useRef(false)
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null)
  const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const selectedIdRef = React.useRef<string | null>(null)
  const [draftPrompt, setDraftPrompt] = React.useState('')
  const [activeTab, setActiveTab] = React.useState<PickerTab>('library')
  const [columnCount, setColumnCount] = React.useState(() => getPromptLibraryColumnCount(typeof window === 'undefined' ? 1280 : window.innerWidth))

  const selectedEntry = React.useMemo(() => items.find((entry) => entry.id === selectedId) ?? null, [items, selectedId])
  const itemColumns = React.useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as PromptLibraryCardDto[])
    items.forEach((entry, index) => columns[index % columnCount]?.push(entry))
    return columns
  }, [columnCount, items])

  React.useEffect(() => {
    const handleResize = (): void => setColumnCount(getPromptLibraryColumnCount(window.innerWidth))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 240)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  React.useEffect(() => {
    if (!detailOpened) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDetailOpened(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [detailOpened])

  React.useEffect(() => {
    if (opened && !wasOpenedRef.current) setDraftPrompt(currentPrompt)
    wasOpenedRef.current = opened
  }, [currentPrompt, opened])

  React.useEffect(() => {
    if (!opened) return
    let active = true
    requestGenerationRef.current += 1
    setLoading(true)
    setLoadingMore(false)
    loadingMoreRef.current = false
    setError(null)
    setLoadMoreError(null)
    setItems([])
    pageRef.current = 0
    setHasMore(false)
    hasMoreRef.current = false
    void listPromptLibrary({ query: query || undefined, mediaType, sort: 'time_desc', page: 1, pageSize: 30 })
      .then((result) => {
        if (!active) return
        setItems(result.items)
        setTotal(result.total)
        pageRef.current = result.page
        const nextHasMore = result.page * result.pageSize < result.total
        setHasMore(nextHasMore)
        hasMoreRef.current = nextHasMore
        const currentId = selectedIdRef.current
        if (currentId && !result.items.some((entry) => entry.id === currentId)) {
          selectedIdRef.current = null
          setSelectedId(null)
          setDraftPrompt('')
          setDetailOpened(false)
        }
      })
      .catch((reason: unknown) => {
        if (!active) return
        setItems([])
        setTotal(0)
        pageRef.current = 0
        setHasMore(false)
        hasMoreRef.current = false
        selectedIdRef.current = null
        setSelectedId(null)
        setDraftPrompt('')
        setError(reason instanceof Error ? reason.message : '加载提示词失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [mediaType, opened, query])

  const loadNextPage = React.useCallback((): void => {
    if (!opened || !hasMoreRef.current || loadingMoreRef.current) return
    const nextPage = pageRef.current + 1
    const requestGeneration = requestGenerationRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    void listPromptLibrary({ query: query || undefined, mediaType, sort: 'time_desc', page: nextPage, pageSize: 30 })
      .then((result) => {
        if (requestGeneration !== requestGenerationRef.current) return
        setItems((current) => {
          const existingIds = new Set(current.map((entry) => entry.id))
          return [...current, ...result.items.filter((entry) => !existingIds.has(entry.id))]
        })
        setTotal(result.total)
        pageRef.current = result.page
        const nextHasMore = result.page * result.pageSize < result.total
        setHasMore(nextHasMore)
        hasMoreRef.current = nextHasMore
      })
      .catch((reason: unknown) => {
        if (requestGeneration !== requestGenerationRef.current) return
        setLoadMoreError(reason instanceof Error ? reason.message : '加载更多提示词失败')
      })
      .finally(() => {
        if (requestGeneration !== requestGenerationRef.current) return
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }, [mediaType, opened, query])

  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    const sentinel = loadMoreSentinelRef.current
    if (!viewport || !sentinel || !opened || loading || !hasMore || loadMoreError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextPage()
    }, { root: viewport, rootMargin: '240px 0px', threshold: 0.01 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMoreError, loadNextPage, loading, opened, items.length])

  const handleSelectEntry = (entry: PromptLibraryCardDto): void => {
    selectedIdRef.current = entry.id
    setSelectedId(entry.id)
    setDraftPrompt(entry.promptText)
    setDetailOpened(true)
  }

  const handleApply = (): void => {
    const promptText = draftPrompt.trim()
    if (!promptText) return
    onSelect(promptText)
    setDetailOpened(false)
    setOpened(false)
  }

  const label = `从${mediaTypeLabel(mediaType)}提示词库填入`

  return (
    <>
      <ActionIcon
        className="task-node-prompt__toolbar-button canvas-prompt-library-picker__trigger"
        variant="subtle"
        size="xs"
        disabled={disabled}
        aria-label={label}
        title={label}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          setActiveTab('library')
          setOpened(true)
        }}
      >
        <IconBraces className="task-node-prompt__toolbar-icon canvas-prompt-library-picker__trigger-icon" size={12} />
      </ActionIcon>

      <Modal
        className="canvas-prompt-library-modal"
        classNames={{
          overlay: 'canvas-prompt-library-modal__overlay',
          content: 'canvas-prompt-library-modal__content',
          header: 'canvas-prompt-library-modal__header',
          title: 'canvas-prompt-library-modal__title',
          close: 'canvas-prompt-library-modal__close',
          body: 'canvas-prompt-library-modal__body',
        }}
        opened={opened}
        trapFocus={!detailOpened}
        onClose={() => {
          if (detailOpened) return
          setOpened(false)
        }}
        title={`选择${mediaTypeLabel(mediaType)}提示词`}
        centered
        size="min(1240px, calc(100vw - 32px))"
        zIndex={4300}
        closeOnClickOutside={!detailOpened}
        closeOnEscape={!detailOpened}
        closeButtonProps={{ 'aria-label': '关闭提示词库' }}
        overlayProps={{ backgroundOpacity: 0.72, blur: 7 }}
      >
        <div className="canvas-prompt-library-modal__tabs" role="tablist" aria-label="提示词来源">
          <button className={`canvas-prompt-library-modal__tab${activeTab === 'library' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'library'} onClick={() => setActiveTab('library')}>公共案例</button>
          <button className={`canvas-prompt-library-modal__tab${activeTab === 'custom' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'custom'} onClick={() => setActiveTab('custom')}>自定义提示词</button>
        </div>

        {activeTab === 'library' ? <div className="canvas-prompt-library-modal__layout nodrag nopan nowheel" aria-hidden={detailOpened ? true : undefined} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
          <section className="canvas-prompt-library-modal__catalog">
            <div className="canvas-prompt-library-modal__toolbar">
              <TextInput
                className="canvas-prompt-library-modal__search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.currentTarget.value)}
                placeholder="搜索人物、风格、镜头或场景"
                aria-label="搜索提示词库"
                leftSection={<IconSearch className="canvas-prompt-library-modal__search-icon" size={15} />}
              />
              <Text className="canvas-prompt-library-modal__count-value" size="xs" c="dimmed">{total.toLocaleString('zh-CN')} 条</Text>
            </div>

            <ScrollArea className="canvas-prompt-library-modal__results" type="hover" viewportRef={scrollViewportRef} viewportProps={{ 'data-testid': 'canvas-prompt-library-scroll-viewport', onScroll: (event) => {
              const viewport = event.currentTarget
              if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 240) loadNextPage()
            } }}>
              {loading ? (
                <Group className="canvas-prompt-library-modal__state" justify="center" gap="xs">
                  <Loader className="canvas-prompt-library-modal__loader" size="xs" />
                  <Text className="canvas-prompt-library-modal__state-text" size="xs" c="dimmed">正在加载提示词…</Text>
                </Group>
              ) : error ? (
                <Text className="canvas-prompt-library-modal__state canvas-prompt-library-modal__state--error" size="xs">{error}</Text>
              ) : items.length === 0 ? (
                <Text className="canvas-prompt-library-modal__state" size="xs" c="dimmed">没有匹配的提示词</Text>
              ) : (
                <div className="canvas-prompt-library-modal__card-grid">
                  {itemColumns.map((column, columnIndex) => (
                    <div className="canvas-prompt-library-modal__card-column" key={`prompt-column-${columnIndex}`}>
                      {column.map((entry) => (
                        <PromptLibraryCard
                          key={entry.id}
                          entry={entry}
                          selectionMode
                          selected={entry.id === selectedId}
                          onSelect={handleSelectEntry}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {loadingMore ? <Group aria-live="polite" className="canvas-prompt-library-modal__load-more" justify="center" gap="xs"><Loader className="canvas-prompt-library-modal__loader" size="xs" /><Text className="canvas-prompt-library-modal__state-text" size="xs" c="dimmed">正在加载更多…</Text></Group> : null}
              {loadMoreError ? <Group aria-live="polite" className="canvas-prompt-library-modal__load-more canvas-prompt-library-modal__load-more--error" justify="center" gap="xs"><Text className="canvas-prompt-library-modal__state-text" size="xs">{loadMoreError}</Text><Button className="canvas-prompt-library-modal__load-more-retry" variant="subtle" size="compact-xs" onClick={loadNextPage}>重试</Button></Group> : null}
              {!loading && hasMore && !loadingMore && !loadMoreError ? <div className="canvas-prompt-library-modal__load-more-action"><Button className="canvas-prompt-library-modal__load-more-button" variant="subtle" size="compact-sm" onClick={loadNextPage}>加载更多提示词</Button></div> : null}
              {hasMore ? <div ref={loadMoreSentinelRef} className="canvas-prompt-library-modal__load-more-sentinel" aria-hidden="true" /> : null}
              {!loading && !loadingMore && !loadMoreError && items.length > 0 && !hasMore ? <Text className="canvas-prompt-library-modal__load-more-end" size="xs" c="dimmed">已展示全部 {total.toLocaleString('zh-CN')} 条</Text> : null}
            </ScrollArea>
          </section>

        </div> : (
          <section className="canvas-prompt-library-modal__custom nodrag nopan nowheel">
            <Group className="canvas-prompt-library-modal__custom-heading" justify="space-between" gap="xs">
              <Text className="canvas-prompt-library-modal__custom-title" fw={650}>自定义提示词</Text>
              <Text className="canvas-prompt-library-modal__custom-count" size="xs" c="dimmed">{draftPrompt.length} 字</Text>
            </Group>
            <Textarea
              className="canvas-prompt-library-modal__custom-textarea"
              value={draftPrompt}
              onChange={(event) => {
                const nextPrompt = event.currentTarget.value
                setDraftPrompt(nextPrompt)
                onPromptChange?.(nextPrompt)
              }}
              aria-label="自定义提示词"
              placeholder={`输入当前${mediaTypeLabel(mediaType)}节点的自定义提示词`}
              autosize
              minRows={12}
              maxRows={20}
              autoFocus
            />
            <Group className="canvas-prompt-library-modal__custom-actions" justify="flex-end" gap="xs">
              <Button className="canvas-prompt-library-modal__custom-cancel" variant="subtle" color="gray" onClick={() => setActiveTab('library')}>返回公共案例</Button>
              <Button className="canvas-prompt-library-modal__custom-apply" disabled={!draftPrompt.trim()} onClick={handleApply}>保存并填入节点</Button>
            </Group>
          </section>
        )}

        <CanvasPromptLibraryDetailModal
          opened={detailOpened}
          mediaType={mediaType}
          entry={selectedEntry}
          draftPrompt={draftPrompt}
          onDraftPromptChange={setDraftPrompt}
          onBack={() => setDetailOpened(false)}
          onApply={handleApply}
        />
      </Modal>
    </>
  )
}
