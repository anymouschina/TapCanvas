import React from 'react'
import { ActionIcon, Badge, Button, Group, Image, SegmentedControl, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import {
  IconBrain,
  IconLayoutGrid,
  IconSearch,
} from '@tabler/icons-react'
import { PanelCard } from '../PanelCard'
import type { NanoComicShotItem } from './types'
import { getNanoComicEntityKey } from './types'
import {
  ASSET_ESTIMATED_CARD_HEIGHT_PX,
  ASSET_GRID_COLUMNS,
  ASSET_PAGE_SIZE,
  ASSET_PRELOAD_THRESHOLD_PX,
  EMPTY_PROMPT_DRAFT_KEY,
  type AssetScopeFilter,
  type PromptAssistState,
  type PromptMentionItem,
  type WorkspaceAssetItem,
  buildStoryboardStillPrompt,
  clipMultilineText,
  escapeRegExp,
} from './workspaceTabShared'

type NanoComicStoryboardTabProps = {
  shots: readonly NanoComicShotItem[]
  selectedShotId: string
  onSelectShot: (shotId: string) => void
  onPromptChange?: (input: { shotId: string; prompt: string }) => void
  onGenerateChapterScript?: () => void
  chapterScriptState?: PromptAssistState | null
  promptOverrides?: Readonly<Record<string, string>>
  onLocateInCanvas: (entityKey: string) => void
  onGenerateAsset: (assetId: string) => void
  linkedEntityKeys: ReadonlySet<string>
  emptyStateMessage?: string | null
  assetItems: readonly WorkspaceAssetItem[]
}

export default function NanoComicStoryboardTab({
  shots,
  selectedShotId,
  onSelectShot,
  onPromptChange,
  onGenerateChapterScript,
  chapterScriptState,
  promptOverrides,
  onLocateInCanvas,
  onGenerateAsset,
  linkedEntityKeys,
  emptyStateMessage,
  assetItems,
}: NanoComicStoryboardTabProps): JSX.Element {
  const promptTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const assetScrollRef = React.useRef<HTMLDivElement | null>(null)
  const mentionMetaRef = React.useRef<{ at: number; caret: number } | null>(null)
  const [mentionMenuPosition, setMentionMenuPosition] = React.useState<{ left: number; top: number } | null>(null)
  const selectedShot = React.useMemo(
    () => shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null,
    [selectedShotId, shots],
  )
  const [assetQuery, setAssetQuery] = React.useState('')
  const [assetScopeFilter, setAssetScopeFilter] = React.useState<AssetScopeFilter>('current')
  const [visibleAssetCount, setVisibleAssetCount] = React.useState(ASSET_PAGE_SIZE * 2)
  const [promptDraftByShotId, setPromptDraftByShotId] = React.useState<Record<string, string>>({})
  const [mentionOpen, setMentionOpen] = React.useState(false)
  const [mentionFilter, setMentionFilter] = React.useState('')
  const [activeMentionIndex, setActiveMentionIndex] = React.useState(0)
  const activePromptDraftKey = selectedShot?.id ?? EMPTY_PROMPT_DRAFT_KEY
  const generatedSelectedShotPromptText = selectedShot ? buildStoryboardStillPrompt(selectedShot) : ''
  const selectedShotPromptText = selectedShot
    ? promptDraftByShotId[activePromptDraftKey] ?? generatedSelectedShotPromptText
    : promptDraftByShotId[EMPTY_PROMPT_DRAFT_KEY] ?? ''
  const normalizedAssetQuery = assetQuery.trim().toLowerCase()
  const scopedAssetItems = React.useMemo(() => {
    if (assetScopeFilter === 'all') return assetItems
    return assetItems.filter((asset) => asset.isCurrentChapter !== false)
  }, [assetItems, assetScopeFilter])
  const filteredAssetItems = React.useMemo(() => {
    if (!normalizedAssetQuery) return scopedAssetItems
    return scopedAssetItems.filter((asset) => {
      const haystack = [asset.title, asset.subtitle, asset.kindLabel, asset.statusLabel, asset.note].join(' ').toLowerCase()
      return haystack.includes(normalizedAssetQuery)
    })
  }, [normalizedAssetQuery, scopedAssetItems])
  const visibleAssetItems = React.useMemo(
    () => filteredAssetItems.slice(0, visibleAssetCount),
    [filteredAssetItems, visibleAssetCount],
  )
  const hiddenAssetCount = Math.max(filteredAssetItems.length - visibleAssetItems.length, 0)
  const assetSkeletonCount = React.useMemo(
    () => Math.min(hiddenAssetCount, Math.max(ASSET_PAGE_SIZE, ASSET_GRID_COLUMNS * 6)),
    [hiddenAssetCount],
  )
  const hasMoreAssets = visibleAssetItems.length < filteredAssetItems.length
  const mentionItems = React.useMemo<PromptMentionItem[]>(() => {
    const normalizedFilter = mentionFilter.trim().toLowerCase()
    const seen = new Set<string>()
    const items: PromptMentionItem[] = []
    for (const asset of assetItems) {
      const imageUrl = String(asset.imageUrl || '').trim()
      if (!imageUrl) continue
      const mention = String(asset.title || '').trim()
      if (!mention) continue
      const dedupeKey = mention.toLowerCase()
      if (seen.has(dedupeKey)) continue
      const haystack = [asset.title, asset.subtitle, asset.kindLabel, asset.statusLabel, asset.note].join(' ').toLowerCase()
      if (normalizedFilter && !haystack.includes(normalizedFilter)) continue
      seen.add(dedupeKey)
      items.push({
        id: asset.id,
        mention,
        title: asset.title,
        subtitle: asset.subtitle,
        statusLabel: asset.statusLabel,
        imageUrl,
      })
    }
    return items.slice(0, 8)
  }, [assetItems, mentionFilter])
  const mentionLibraryItems = React.useMemo<PromptMentionItem[]>(() => {
    const seen = new Set<string>()
    const items: PromptMentionItem[] = []
    for (const asset of assetItems) {
      const imageUrl = String(asset.imageUrl || '').trim()
      const mention = String(asset.title || '').trim()
      if (!imageUrl || !mention) continue
      const dedupeKey = mention.toLowerCase()
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      items.push({
        id: asset.id,
        mention,
        title: asset.title,
        subtitle: asset.subtitle,
        statusLabel: asset.statusLabel,
        imageUrl,
      })
    }
    return items.sort((left, right) => right.mention.length - left.mention.length)
  }, [assetItems])
  const referencedMentionItems = React.useMemo<PromptMentionItem[]>(() => {
    if (!selectedShotPromptText.trim() || !mentionLibraryItems.length) return []
    return mentionLibraryItems.filter((item) => {
      const matcher = new RegExp(`(^|\\s)${escapeRegExp(`@${item.mention}`)}(?=\\s|$)`, 'i')
      return matcher.test(selectedShotPromptText)
    })
  }, [mentionLibraryItems, selectedShotPromptText])

  React.useEffect(() => {
    setVisibleAssetCount(ASSET_PAGE_SIZE * 2)
  }, [assetScopeFilter, normalizedAssetQuery, scopedAssetItems.length])

  React.useEffect(() => {
    if (!mentionOpen) {
      setActiveMentionIndex(0)
      return
    }
    setActiveMentionIndex(0)
  }, [mentionItems.length, mentionOpen])

  React.useEffect(() => {
    if (!selectedShot) return
    setPromptDraftByShotId((current) => {
      if (Object.prototype.hasOwnProperty.call(current, selectedShot.id)) return current
      return {
        ...current,
        [selectedShot.id]: buildStoryboardStillPrompt(selectedShot),
      }
    })
  }, [selectedShot])

  React.useEffect(() => {
    if (!selectedShot) return
    onPromptChange?.({
      shotId: selectedShot.id,
      prompt: selectedShotPromptText,
    })
  }, [onPromptChange, selectedShot, selectedShotPromptText])

  React.useEffect(() => {
    if (!promptOverrides) return
    setPromptDraftByShotId((current) => {
      let changed = false
      const nextDrafts: Record<string, string> = { ...current }
      for (const [shotId, prompt] of Object.entries(promptOverrides)) {
        if (!shotId) continue
        if (typeof prompt !== 'string' || !prompt.trim()) continue
        if (nextDrafts[shotId] === prompt) continue
        nextDrafts[shotId] = prompt
        changed = true
      }
      return changed ? nextDrafts : current
    })
  }, [promptOverrides])

  const loadMoreAssetItems = React.useCallback((container?: HTMLDivElement | null) => {
    setVisibleAssetCount((current) => {
      if (current >= filteredAssetItems.length) return current
      const viewportRowCount = container
        ? Math.max(1, Math.ceil(container.clientHeight / ASSET_ESTIMATED_CARD_HEIGHT_PX))
        : 1
      const viewportBatchSize = viewportRowCount * ASSET_GRID_COLUMNS * 3
      const nextStep = Math.max(ASSET_PAGE_SIZE, viewportBatchSize)
      return Math.min(current + nextStep, filteredAssetItems.length)
    })
  }, [filteredAssetItems.length])

  const handleAssetScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remaining > ASSET_PRELOAD_THRESHOLD_PX) return
    loadMoreAssetItems(target)
  }, [loadMoreAssetItems])

  React.useEffect(() => {
    const container = assetScrollRef.current
    if (!container) return
    const desiredVisibleCount = Math.min(
      filteredAssetItems.length,
      Math.max(
        ASSET_PAGE_SIZE * 2,
        Math.ceil(container.clientHeight / ASSET_ESTIMATED_CARD_HEIGHT_PX) * ASSET_GRID_COLUMNS * 4,
      ),
    )
    setVisibleAssetCount((current) => (current >= desiredVisibleCount ? current : desiredVisibleCount))
  }, [filteredAssetItems.length])

  React.useEffect(() => {
    const container = assetScrollRef.current
    if (!container) return
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
    if (remaining > ASSET_PRELOAD_THRESHOLD_PX) return
    loadMoreAssetItems(container)
  }, [loadMoreAssetItems, visibleAssetCount])

  const updateMentionMenuPosition = React.useCallback((textValue: string, caretIndex: number) => {
    const textarea = promptTextareaRef.current
    if (!textarea) return
    const promptPanel = textarea.closest('.nano-comic-storyboard__prompt-panel')
    if (!(promptPanel instanceof HTMLElement)) return
    const computedStyle = window.getComputedStyle(textarea)
    const mirror = document.createElement('div')
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordBreak = 'break-word'
    mirror.style.overflowWrap = 'break-word'
    mirror.style.boxSizing = 'border-box'
    mirror.style.width = `${textarea.clientWidth}px`
    mirror.style.font = computedStyle.font
    mirror.style.fontFamily = computedStyle.fontFamily
    mirror.style.fontSize = computedStyle.fontSize
    mirror.style.fontWeight = computedStyle.fontWeight
    mirror.style.lineHeight = computedStyle.lineHeight
    mirror.style.letterSpacing = computedStyle.letterSpacing
    mirror.style.padding = computedStyle.padding
    mirror.style.border = computedStyle.border
    mirror.style.textTransform = computedStyle.textTransform
    mirror.style.textIndent = computedStyle.textIndent
    mirror.style.tabSize = computedStyle.tabSize
    mirror.textContent = textValue.slice(0, caretIndex)
    const marker = document.createElement('span')
    marker.textContent = '@'
    mirror.appendChild(marker)
    document.body.appendChild(mirror)
    const markerRect = marker.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()
    const left = markerRect.left - mirrorRect.left - textarea.scrollLeft
    const top = markerRect.top - mirrorRect.top - textarea.scrollTop
    document.body.removeChild(mirror)
    setMentionMenuPosition({
      left: Math.max(8, Math.min(textarea.offsetLeft + left + 12, Math.max(8, promptPanel.clientWidth - 240))),
      top: Math.max(44, textarea.offsetTop + top + 30),
    })
  }, [])

  const applyMention = React.useCallback((item: PromptMentionItem) => {
    const meta = mentionMetaRef.current
    if (!meta) return
    const mention = `@${item.mention}`
    const before = selectedShotPromptText.slice(0, meta.at)
    const after = selectedShotPromptText.slice(meta.caret)
    const needsSpace = after.length === 0 || !/^\s/.test(after)
    const suffix = needsSpace ? ' ' : ''
    const nextValue = `${before}${mention}${suffix}${after}`
    const nextCaret = before.length + mention.length + suffix.length
    setPromptDraftByShotId((current) => ({ ...current, [activePromptDraftKey]: nextValue }))
    setMentionOpen(false)
    setMentionFilter('')
    setMentionMenuPosition(null)
    mentionMetaRef.current = null
    window.requestAnimationFrame(() => {
      const textarea = promptTextareaRef.current
      if (!textarea) return
      try {
        textarea.focus()
        textarea.setSelectionRange(nextCaret, nextCaret)
      } catch {
        // ignore selection failures
      }
    })
  }, [activePromptDraftKey, selectedShotPromptText])

  return (
    <div className="nano-comic-storyboard">
      <div className="nano-comic-storyboard__workspace">
        <PanelCard className="nano-comic-storyboard__asset-panel">
          <Stack className="nano-comic-storyboard__asset-stack" gap="sm">
            <Group className="nano-comic-storyboard__section-header" justify="space-between">
              <div className="nano-comic-storyboard__section-headline">
                <Title className="nano-comic-storyboard__section-title" order={4}>资产库</Title>
              </div>
              <Badge className="nano-comic-storyboard__section-badge" variant="light" radius="sm">
                {filteredAssetItems.length} 项
              </Badge>
            </Group>
            <TextInput
              className="nano-comic-storyboard__asset-search"
              placeholder="搜索角色 / 场景 / 道具"
              value={assetQuery}
              onChange={(event) => setAssetQuery(event.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
            />
            <SegmentedControl
              className="nano-comic-storyboard__asset-scope"
              size="xs"
              radius="sm"
              fullWidth
              value={assetScopeFilter}
              onChange={(value) => setAssetScopeFilter(value === 'all' ? 'all' : 'current')}
              data={[
                { value: 'all', label: '全部资产' },
                { value: 'current', label: '当前资产' },
              ]}
            />
            <div ref={assetScrollRef} className="nano-comic-storyboard__asset-scroll" onScroll={handleAssetScroll}>
              <div className="nano-comic-storyboard__asset-list">
                {visibleAssetItems.length > 0 ? visibleAssetItems.map((asset) => {
                  const assetLinked = asset.entityKey ? linkedEntityKeys.has(asset.entityKey) : false
                  const canGenerate = asset.canGenerate === true
                  const isActionable = assetLinked || canGenerate
                  return (
                    <div
                      key={asset.id}
                      className={`nano-comic-storyboard__asset-card${!isActionable ? ' nano-comic-storyboard__asset-card--disabled' : ''}`}
                    >
                      <div className="nano-comic-storyboard__asset-card-media">
                        {asset.imageUrl ? (
                          <Image className="nano-comic-storyboard__asset-card-image" src={asset.imageUrl} alt={asset.title} radius={0} />
                        ) : (
                          <div className="nano-comic-storyboard__asset-card-placeholder">
                            <IconLayoutGrid size={16} />
                            <Text className="nano-comic-storyboard__asset-card-placeholder-text" size="xs">待生成参考图</Text>
                          </div>
                        )}
                      </div>
                      <div className="nano-comic-storyboard__asset-card-body nano-comic-storyboard__asset-card-body--minimal">
                        <Text className="nano-comic-storyboard__asset-card-kind" size="xs" fw={800}>{asset.title}</Text>
                        <Group className="nano-comic-storyboard__asset-card-top" justify="space-between" align="center">
                          <Badge className="nano-comic-storyboard__asset-card-status" variant="light" radius="sm">
                            {asset.isGenerating ? '生成中' : asset.statusLabel}
                          </Badge>
                        </Group>
                        {assetLinked ? (
                          <Button
                            className="nano-comic-storyboard__asset-card-action"
                            size="xs"
                            radius="sm"
                            variant="light"
                            onClick={() => {
                              if (!asset.entityKey) return
                              onLocateInCanvas(asset.entityKey)
                            }}
                          >
                            定位
                          </Button>
                        ) : canGenerate ? (
                          <Button
                            className="nano-comic-storyboard__asset-card-action"
                            size="xs"
                            radius="sm"
                            variant="light"
                            loading={asset.isGenerating}
                            onClick={() => onGenerateAsset(asset.id)}
                          >
                            生成
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                }) : null}
                {assetSkeletonCount > 0 ? Array.from({ length: assetSkeletonCount }, (_, index) => (
                  <div
                    key={`asset-skeleton-${visibleAssetItems.length + index}`}
                    className="nano-comic-storyboard__asset-card nano-comic-storyboard__asset-card--skeleton"
                    aria-hidden="true"
                  >
                    <div className="nano-comic-storyboard__asset-card-media nano-comic-storyboard__asset-card-media--skeleton">
                      <div className="nano-comic-storyboard__asset-card-skeleton-block nano-comic-storyboard__asset-card-skeleton-block--media" />
                    </div>
                    <div className="nano-comic-storyboard__asset-card-body nano-comic-storyboard__asset-card-body--minimal">
                      <div className="nano-comic-storyboard__asset-card-skeleton-line nano-comic-storyboard__asset-card-skeleton-line--title" />
                      <div className="nano-comic-storyboard__asset-card-skeleton-line nano-comic-storyboard__asset-card-skeleton-line--badge" />
                      <div className="nano-comic-storyboard__asset-card-skeleton-line nano-comic-storyboard__asset-card-skeleton-line--action" />
                    </div>
                  </div>
                )) : null}
                {visibleAssetItems.length <= 0 && assetSkeletonCount <= 0 ? (
                  <div className="nano-comic-storyboard__empty-block">
                    <Text className="nano-comic-storyboard__empty-text">
                      {filteredAssetItems.length === 0 && normalizedAssetQuery ? '没有匹配的资产。' : '当前章节还没有可用资产。'}
                    </Text>
                    <Text className="nano-comic-storyboard__empty-hint" size="sm" c="dimmed">
                      {filteredAssetItems.length === 0 && normalizedAssetQuery
                        ? '换个关键词试试。'
                        : '先发起章节生产，或去资产库补角色卡、场景参考和核心道具。'}
                    </Text>
                  </div>
                ) : null}
              </div>
            </div>
          </Stack>
        </PanelCard>
        <div className="nano-comic-storyboard__main-column">
          <div className="nano-comic-storyboard__main-top">
            <PanelCard className="nano-comic-storyboard__editor-panel">
              <Stack className="nano-comic-storyboard__editor-stack" gap="md">
                <Group className="nano-comic-storyboard__section-header" justify="space-between" align="flex-start">
                  <div className="nano-comic-storyboard__section-headline">
                    <Title className="nano-comic-storyboard__section-title" order={4}>片段提示词</Title>
                  </div>
                  {selectedShot ? (
                    <Badge className="nano-comic-storyboard__section-badge" variant="light" radius="sm">
                      片段 {selectedShot.shotCode}
                    </Badge>
                  ) : null}
                </Group>
                <div className="nano-comic-storyboard__editor-scroll">
                  <div className="nano-comic-storyboard__prompt-panel">
                    <Group className="nano-comic-storyboard__prompt-header" justify="space-between">
                      <div className="nano-comic-storyboard__prompt-title-wrap">
                        <Text className="nano-comic-storyboard__editor-label" size="xs" fw={800}>当前章节镜头提示词</Text>
                        <Text className="nano-comic-storyboard__prompt-subtitle" size="xs" c="dimmed">
                          使用 `@角色 / @场景 / @道具` 作为一致性锚点，直接驱动当前镜头出图
                        </Text>
                        {chapterScriptState?.message ? (
                          <Text className="nano-comic-storyboard__prompt-assist-status" size="xs" c="dimmed">
                            {chapterScriptState.message}
                            {chapterScriptState.updatedAtLabel ? ` · ${chapterScriptState.updatedAtLabel}` : ''}
                          </Text>
                        ) : null}
                      </div>
                      {onGenerateChapterScript ? (
                        <ActionIcon
                          className="nano-comic-storyboard__prompt-assist-action"
                          size="sm"
                          radius="sm"
                          variant="light"
                          aria-label="生成当前章节剧本"
                          title="生成当前章节剧本"
                          loading={chapterScriptState?.status === 'running'}
                          disabled={chapterScriptState?.status === 'running'}
                          onClick={() => onGenerateChapterScript()}
                        >
                          <IconBrain size={15} />
                        </ActionIcon>
                      ) : null}
                    </Group>
                    <div className="nano-comic-storyboard__prompt-editor-shell">
                      {referencedMentionItems.length > 0 ? (
                        <div className="nano-comic-storyboard__prompt-chip-row">
                          {referencedMentionItems.map((item) => (
                            <span key={item.id} className="nano-comic-storyboard__prompt-chip">
                              {item.imageUrl ? <img className="nano-comic-storyboard__prompt-chip-thumb" src={item.imageUrl} alt={item.title} /> : null}
                              <span className="nano-comic-storyboard__prompt-chip-label">@{item.title}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <Textarea
                        ref={promptTextareaRef}
                        className="nano-comic-storyboard__prompt-input"
                        value={selectedShotPromptText}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value
                          const caret = typeof event.currentTarget.selectionStart === 'number' ? event.currentTarget.selectionStart : nextValue.length
                          const before = nextValue.slice(0, caret)
                          const lastAt = before.lastIndexOf('@')
                          const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
                          setPromptDraftByShotId((current) => ({ ...current, [activePromptDraftKey]: nextValue }))
                          if (lastAt >= 0 && lastAt >= lastSpace) {
                            const nextFilter = before.slice(lastAt + 1)
                            if (!/\s/.test(nextFilter)) {
                              setMentionFilter(nextFilter)
                              setMentionOpen(true)
                              mentionMetaRef.current = { at: lastAt, caret }
                              window.requestAnimationFrame(() => updateMentionMenuPosition(nextValue, lastAt))
                              return
                            }
                          }
                          setMentionOpen(false)
                          setMentionFilter('')
                          setMentionMenuPosition(null)
                          mentionMetaRef.current = null
                        }}
                        onBlur={() => {
                          setMentionOpen(false)
                          setMentionFilter('')
                          setMentionMenuPosition(null)
                          mentionMetaRef.current = null
                        }}
                        onSelect={(event) => {
                          const caret = typeof event.currentTarget.selectionStart === 'number' ? event.currentTarget.selectionStart : 0
                          const before = event.currentTarget.value.slice(0, caret)
                          const lastAt = before.lastIndexOf('@')
                          const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
                          if (lastAt >= 0 && lastAt >= lastSpace) {
                            const nextFilter = before.slice(lastAt + 1)
                            if (!/\s/.test(nextFilter)) {
                              setMentionFilter(nextFilter)
                              setMentionOpen(true)
                              mentionMetaRef.current = { at: lastAt, caret }
                              window.requestAnimationFrame(() => updateMentionMenuPosition(event.currentTarget.value, lastAt))
                              return
                            }
                          }
                          setMentionOpen(false)
                          setMentionFilter('')
                          setMentionMenuPosition(null)
                          mentionMetaRef.current = null
                        }}
                        onClick={(event) => {
                          const caret = typeof event.currentTarget.selectionStart === 'number' ? event.currentTarget.selectionStart : 0
                          const before = event.currentTarget.value.slice(0, caret)
                          const lastAt = before.lastIndexOf('@')
                          const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
                          if (lastAt >= 0 && lastAt >= lastSpace) {
                            const nextFilter = before.slice(lastAt + 1)
                            if (!/\s/.test(nextFilter)) {
                              setMentionFilter(nextFilter)
                              setMentionOpen(true)
                              mentionMetaRef.current = { at: lastAt, caret }
                              window.requestAnimationFrame(() => updateMentionMenuPosition(event.currentTarget.value, lastAt))
                              return
                            }
                          }
                          setMentionOpen(false)
                          setMentionFilter('')
                          setMentionMenuPosition(null)
                          mentionMetaRef.current = null
                        }}
                        onKeyUp={(event) => {
                          if (!mentionOpen) return
                          const caret = typeof event.currentTarget.selectionStart === 'number' ? event.currentTarget.selectionStart : event.currentTarget.value.length
                          const meta = mentionMetaRef.current
                          if (!meta) return
                          mentionMetaRef.current = { at: meta.at, caret }
                          window.requestAnimationFrame(() => updateMentionMenuPosition(event.currentTarget.value, meta.at))
                        }}
                        onScroll={(event) => {
                          if (!mentionOpen) return
                          const meta = mentionMetaRef.current
                          if (!meta) return
                          updateMentionMenuPosition(event.currentTarget.value, meta.at)
                        }}
                        onKeyDown={(event) => {
                          if (!mentionOpen) return
                          if (event.key === 'ArrowDown') {
                            if (!mentionItems.length) return
                            event.preventDefault()
                            setActiveMentionIndex((current) => (current + 1) % mentionItems.length)
                            return
                          }
                          if (event.key === 'ArrowUp') {
                            if (!mentionItems.length) return
                            event.preventDefault()
                            setActiveMentionIndex((current) => (current - 1 + mentionItems.length) % mentionItems.length)
                            return
                          }
                          if (event.key === 'Enter' || event.key === 'Tab') {
                            const activeItem = mentionItems[activeMentionIndex]
                            if (!activeItem) return
                            event.preventDefault()
                            applyMention(activeItem)
                            return
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setMentionOpen(false)
                            setMentionFilter('')
                            setMentionMenuPosition(null)
                            mentionMetaRef.current = null
                          }
                        }}
                        placeholder="在这里输入或编辑当前镜头提示词，支持 @角色 / @场景 / @道具"
                        autosize={false}
                      />
                    </div>
                    {mentionOpen ? (
                      <div
                        className="nano-comic-storyboard__mention-menu"
                        style={mentionMenuPosition ? { left: mentionMenuPosition.left, top: mentionMenuPosition.top } : undefined}
                      >
                        <Text className="nano-comic-storyboard__mention-title" size="xs">引用当前资产</Text>
                        {mentionItems.length > 0 ? mentionItems.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`nano-comic-storyboard__mention-item${index === activeMentionIndex ? ' nano-comic-storyboard__mention-item--active' : ''}`}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              applyMention(item)
                            }}
                            onMouseEnter={() => setActiveMentionIndex(index)}
                          >
                            {item.imageUrl ? (
                              <img className="nano-comic-storyboard__mention-item-thumb" src={item.imageUrl} alt={item.title} />
                            ) : (
                              <span className="nano-comic-storyboard__mention-item-thumb nano-comic-storyboard__mention-item-thumb--placeholder" aria-hidden="true">@</span>
                            )}
                            <span className="nano-comic-storyboard__mention-item-copy">
                              <span className="nano-comic-storyboard__mention-item-main">@{item.title}</span>
                              <span className="nano-comic-storyboard__mention-item-meta">{item.statusLabel}{item.subtitle ? ` · ${item.subtitle}` : ''}</span>
                            </span>
                          </button>
                        )) : (
                          <Text className="nano-comic-storyboard__mention-empty" size="xs">没有匹配的资产引用</Text>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Stack>
            </PanelCard>
            <PanelCard className="nano-comic-storyboard__preview-panel">
              <Stack className="nano-comic-storyboard__preview-stack" gap="md">
                <Group className="nano-comic-storyboard__section-header" justify="space-between">
                  <div className="nano-comic-storyboard__section-headline">
                    <Title className="nano-comic-storyboard__section-title" order={4}>分镜图片结果</Title>
                  </div>
                </Group>
                <div className="nano-comic-storyboard__stage-image-shell">
                  {String(selectedShot?.previewImageUrl || '').trim() ? (
                    <Image
                      className="nano-comic-storyboard__stage-image"
                      src={String(selectedShot?.previewImageUrl || '').trim()}
                      alt={selectedShot?.title || '当前镜头结果'}
                      radius={0}
                    />
                  ) : (
                    <div className="nano-comic-storyboard__stage-empty">
                      <Text className="nano-comic-storyboard__empty-text">
                        {selectedShot ? '当前镜头还没有分镜结果。' : '当前章节还没有可预览镜头。'}
                      </Text>
                    </div>
                  )}
                </div>
              </Stack>
            </PanelCard>
          </div>
          <PanelCard className="nano-comic-storyboard__strip-panel">
            <Group className="nano-comic-storyboard__section-header" justify="space-between">
              <div className="nano-comic-storyboard__section-headline">
                <Title className="nano-comic-storyboard__section-title" order={4}>章节镜头板</Title>
              </div>
              <Badge className="nano-comic-storyboard__section-badge" variant="light" radius="sm">
                {shots.length} 个镜头
              </Badge>
            </Group>
            <div className="nano-comic-storyboard__strip">
              {shots.length > 0 ? shots.map((shot) => {
                const isSelected = selectedShot?.id === shot.id
                const hasPrompt = Boolean(String(shot.script || shot.note || shot.continuityHint || '').trim())
                const shotEntityKey = getNanoComicEntityKey('shot', shot.id)
                const isLinked = linkedEntityKeys.has(shotEntityKey)
                return (
                  <button
                    key={shot.id}
                    type="button"
                    className={`nano-comic-storyboard__strip-card${isSelected ? ' nano-comic-storyboard__strip-card--selected' : ''}`}
                    onClick={() => onSelectShot(shot.id)}
                  >
                    <div className="nano-comic-storyboard__strip-card-media">
                      {shot.previewImageUrl ? (
                        <Image className="nano-comic-storyboard__strip-card-image" src={shot.previewImageUrl} alt={shot.title} radius={0} />
                      ) : (
                        <div className="nano-comic-storyboard__strip-card-placeholder">
                          <Text size="xs">待生成分镜</Text>
                        </div>
                      )}
                    </div>
                    <div className="nano-comic-storyboard__strip-card-body">
                      <Group className="nano-comic-storyboard__strip-card-head" justify="space-between" align="flex-start">
                        <Text className="nano-comic-storyboard__strip-card-code" size="xs" fw={800}>镜头 {shot.shotCode}</Text>
                        <Badge className="nano-comic-storyboard__shot-row-status" variant="light" radius="sm">
                          {shot.productionStatus}
                        </Badge>
                      </Group>
                      <Text className="nano-comic-storyboard__strip-card-title" size="sm" fw={700} lineClamp={2}>{shot.title}</Text>
                      <Text className="nano-comic-storyboard__strip-card-summary" size="xs" c="dimmed" lineClamp={2}>
                        {clipMultilineText(buildStoryboardStillPrompt(shot), 72)}
                      </Text>
                      <Group className="nano-comic-storyboard__strip-card-foot" justify="space-between">
                        <Text className="nano-comic-storyboard__strip-card-meta" size="xs">
                          {hasPrompt ? '已带镜头提示词' : '待补镜头提示词'}
                        </Text>
                        {isLinked ? (
                          <Text className="nano-comic-storyboard__strip-card-meta" size="xs" c="dimmed">已入画布</Text>
                        ) : null}
                      </Group>
                    </div>
                  </button>
                )
              }) : (
                <div className="nano-comic-storyboard__empty-block">
                  <Text className="nano-comic-storyboard__empty-text">当前章节还没有镜头板。</Text>
                  <Text className="nano-comic-storyboard__empty-hint" size="sm" c="dimmed">
                    {emptyStateMessage || '请先生成章节剧本和分镜资产。'}
                  </Text>
                </div>
              )}
            </div>
          </PanelCard>
        </div>
      </div>
    </div>
  )
}
