import React from 'react'
import { ActionIcon, Button, Group, Loader, Modal, ScrollArea, Text, TextInput } from '@mantine/core'
import { IconBraces, IconCheck, IconPhoto, IconSearch, IconVideo } from '@tabler/icons-react'
import { listPromptLibrary, type PromptLibraryCard as PromptLibraryCardDto, type PromptMediaKind } from '../../api/promptLibrary'
import { PromptLibraryCard } from '../../portal/PromptLibraryCard'
import { CanvasPromptLibraryDetailModal } from '../../canvas/nodes/taskNode/components/CanvasPromptLibraryDetailModal'

type PromptMediaFilter = 'all' | PromptMediaKind

type ChatPromptLibraryPickerProps = Readonly<{
  disabled?: boolean
  onSelect: (promptText: string) => void
}>

function mediaTypeLabel(mediaType: PromptMediaFilter): string {
  if (mediaType === 'video') return '视频'
  if (mediaType === 'image') return '图片'
  return '全部'
}

function getColumnCount(width: number): number {
  if (width < 560) return 1
  if (width < 900) return 2
  if (width < 1200) return 3
  return 4
}

/** 聊天输入框里的提示词库入口。选择只回填输入框，不会隐式发送消息。 */
export function ChatPromptLibraryPicker({ disabled = false, onSelect }: ChatPromptLibraryPickerProps): JSX.Element {
  const [opened, setOpened] = React.useState(false)
  const [detailOpened, setDetailOpened] = React.useState(false)
  const [mediaFilter, setMediaFilter] = React.useState<PromptMediaFilter>('all')
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<PromptLibraryCardDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [draftPrompt, setDraftPrompt] = React.useState('')
  const [columnCount, setColumnCount] = React.useState(() => getColumnCount(typeof window === 'undefined' ? 1280 : window.innerWidth))
  const requestGenerationRef = React.useRef(0)
  const selectedIdRef = React.useRef<string | null>(null)
  const pageRef = React.useRef(0)
  const hasMoreRef = React.useRef(false)
  const loadingMoreRef = React.useRef(false)
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null)
  const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null)

  const selectedEntry = React.useMemo(
    () => items.find((entry) => entry.id === selectedId) ?? null,
    [items, selectedId],
  )
  const itemColumns = React.useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as PromptLibraryCardDto[])
    items.forEach((entry, index) => columns[index % columnCount]?.push(entry))
    return columns
  }, [columnCount, items])

  React.useEffect(() => {
    const handleResize = (): void => setColumnCount(getColumnCount(window.innerWidth))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 240)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  React.useEffect(() => {
    if (!opened) return
    let active = true
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    setLoading(true)
    setError(null)
    setLoadMoreError(null)
    setLoadingMore(false)
    loadingMoreRef.current = false
    setItems([])
    setTotal(0)
    setHasMore(false)
    hasMoreRef.current = false
    pageRef.current = 0
    void listPromptLibrary({
      query: query || undefined,
      mediaType: mediaFilter === 'all' ? undefined : mediaFilter,
      sort: 'time_desc',
      page: 1,
      pageSize: 30,
    })
      .then((result) => {
        if (!active || generation !== requestGenerationRef.current) return
        setItems(result.items)
        setTotal(result.total)
        pageRef.current = result.page
        const nextHasMore = result.page * result.pageSize < result.total
        setHasMore(nextHasMore)
        hasMoreRef.current = nextHasMore
        const currentSelectedId = selectedIdRef.current
        if (currentSelectedId && !result.items.some((entry) => entry.id === currentSelectedId)) {
          selectedIdRef.current = null
          setSelectedId(null)
          setDraftPrompt('')
          setDetailOpened(false)
        }
      })
      .catch((reason: unknown) => {
        if (!active || generation !== requestGenerationRef.current) return
        setItems([])
        setTotal(0)
        setError(reason instanceof Error ? reason.message : '加载提示词失败')
      })
      .finally(() => {
        if (active && generation === requestGenerationRef.current) setLoading(false)
      })
    return () => { active = false }
  }, [mediaFilter, opened, query])

  const loadNextPage = React.useCallback((): void => {
    if (!opened || !hasMoreRef.current || loadingMoreRef.current || loading) return
    const nextPage = pageRef.current + 1
    const generation = requestGenerationRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    void listPromptLibrary({
      query: query || undefined,
      mediaType: mediaFilter === 'all' ? undefined : mediaFilter,
      sort: 'time_desc',
      page: nextPage,
      pageSize: 30,
    })
      .then((result) => {
        if (generation !== requestGenerationRef.current) return
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
        if (generation !== requestGenerationRef.current) return
        setLoadMoreError(reason instanceof Error ? reason.message : '加载更多提示词失败')
      })
      .finally(() => {
        if (generation !== requestGenerationRef.current) return
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }, [loading, mediaFilter, opened, query])

  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    const sentinel = loadMoreSentinelRef.current
    if (!viewport || !sentinel || !opened || loading || !hasMore || loadMoreError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextPage()
    }, { root: viewport, rootMargin: '240px 0px', threshold: 0.01 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, items.length, loadMoreError, loadNextPage, loading, opened])

  const selectEntry = React.useCallback((entry: PromptLibraryCardDto): void => {
    selectedIdRef.current = entry.id
    setSelectedId(entry.id)
    setDraftPrompt(entry.promptText)
    setDetailOpened(true)
  }, [])

  const applyPrompt = React.useCallback((): void => {
    const promptText = draftPrompt.trim()
    if (!promptText) return
    onSelect(promptText)
    setDetailOpened(false)
    setOpened(false)
  }, [draftPrompt, onSelect])

  const closePicker = React.useCallback((): void => {
    if (detailOpened) return
    setOpened(false)
  }, [detailOpened])

  return (
    <>
      <ActionIcon
        className="tc-ai-chat__input-prompt-picker"
        variant="subtle"
        size="sm"
        disabled={disabled}
        aria-label="选择提示词"
        aria-expanded={opened}
        title="从提示词库选择"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setOpened(true)}
      >
        <IconBraces size={16} stroke={1.8} />
      </ActionIcon>

      <Modal
        className="tc-chat-prompt-library-modal"
        classNames={{
          overlay: 'tc-chat-prompt-library-modal__overlay',
          content: 'tc-chat-prompt-library-modal__content',
          header: 'tc-chat-prompt-library-modal__header',
          title: 'tc-chat-prompt-library-modal__title',
          close: 'tc-chat-prompt-library-modal__close',
          body: 'tc-chat-prompt-library-modal__body',
        }}
        opened={opened}
        centered
        title="选择提示词"
        size="min(1240px, calc(100vw - 32px))"
        zIndex={10060}
        trapFocus={!detailOpened}
        closeOnClickOutside={!detailOpened}
        closeOnEscape={!detailOpened}
        closeButtonProps={{ 'aria-label': '关闭提示词库' }}
        overlayProps={{ backgroundOpacity: 0.72, blur: 7 }}
        onClose={closePicker}
      >
        <div className="tc-chat-prompt-library-modal__layout" aria-hidden={detailOpened ? true : undefined}>
          <div className="tc-chat-prompt-library-modal__toolbar">
            <TextInput
              className="tc-chat-prompt-library-modal__search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.currentTarget.value)}
              placeholder="搜索人物、风格、镜头或场景"
              aria-label="搜索提示词库"
              leftSection={<IconSearch size={15} />}
            />
            <div className="tc-chat-prompt-library-modal__filters" role="tablist" aria-label="提示词类型">
              {(['all', 'image', 'video'] as const).map((filter) => (
                <Button
                  key={filter}
                  className={`tc-chat-prompt-library-modal__filter${mediaFilter === filter ? ' is-active' : ''}`}
                  variant="subtle"
                  size="compact-xs"
                  role="tab"
                  aria-selected={mediaFilter === filter}
                  onClick={() => setMediaFilter(filter)}
                  leftSection={filter === 'image' ? <IconPhoto size={13} /> : filter === 'video' ? <IconVideo size={13} /> : undefined}
                >
                  {mediaTypeLabel(filter)}
                  {mediaFilter === filter ? <IconCheck className="tc-chat-prompt-library-modal__filter-check" size={12} /> : null}
                </Button>
              ))}
            </div>
            <Text className="tc-chat-prompt-library-modal__count" size="xs" c="dimmed">{total.toLocaleString('zh-CN')} 条</Text>
          </div>

          <ScrollArea className="tc-chat-prompt-library-modal__results" type="hover" viewportRef={scrollViewportRef} viewportProps={{ onScroll: (event) => {
            const viewport = event.currentTarget
            if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 240) loadNextPage()
          } }}>
            {loading ? (
              <Group className="tc-chat-prompt-library-modal__state" justify="center" gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">正在加载提示词…</Text>
              </Group>
            ) : error ? (
              <Text className="tc-chat-prompt-library-modal__state tc-chat-prompt-library-modal__state--error" size="xs">{error}</Text>
            ) : items.length === 0 ? (
              <Text className="tc-chat-prompt-library-modal__state" size="xs" c="dimmed">没有匹配的提示词</Text>
            ) : (
              <div className="tc-chat-prompt-library-modal__grid">
                {itemColumns.map((column, columnIndex) => (
                  <div className="tc-chat-prompt-library-modal__column" key={`chat-prompt-column-${columnIndex}`}>
                    {column.map((entry) => (
                      <PromptLibraryCard
                        key={entry.id}
                        entry={entry}
                        selectionMode
                        selected={entry.id === selectedId}
                        onSelect={selectEntry}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {loadingMore ? <Group className="tc-chat-prompt-library-modal__load-more" justify="center" gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">正在加载更多…</Text></Group> : null}
            {loadMoreError ? <Group className="tc-chat-prompt-library-modal__load-more" justify="center" gap="xs"><Text size="xs" c="red">{loadMoreError}</Text><Button variant="subtle" size="compact-xs" onClick={loadNextPage}>重试</Button></Group> : null}
            {!loading && hasMore && !loadingMore && !loadMoreError ? <div className="tc-chat-prompt-library-modal__load-more-action"><Button className="tc-chat-prompt-library-modal__load-more-button" variant="subtle" size="compact-sm" onClick={loadNextPage}>加载更多提示词</Button></div> : null}
            {hasMore ? <div ref={loadMoreSentinelRef} className="tc-chat-prompt-library-modal__load-more-sentinel" aria-hidden="true" /> : null}
            {!loading && !loadingMore && !loadMoreError && items.length > 0 && !hasMore ? <Text className="tc-chat-prompt-library-modal__load-more-end" size="xs" c="dimmed">已展示全部 {total.toLocaleString('zh-CN')} 条</Text> : null}
          </ScrollArea>
        </div>

        <CanvasPromptLibraryDetailModal
          opened={detailOpened}
          mediaType={selectedEntry?.mediaType ?? 'image'}
          entry={selectedEntry}
          draftPrompt={draftPrompt}
          applyLabel="填入输入框"
          onDraftPromptChange={setDraftPrompt}
          onBack={() => setDetailOpened(false)}
          onApply={applyPrompt}
        />
      </Modal>
    </>
  )
}
