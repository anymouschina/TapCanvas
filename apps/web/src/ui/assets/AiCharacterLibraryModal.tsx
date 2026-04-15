import React from 'react'
import {
  Modal,
  Stack,
  Group,
  Text,
  Loader,
  Center,
  Card,
  SimpleGrid,
  Badge,
  ActionIcon,
  TextInput,
  Popover,
  Checkbox,
  ScrollArea,
} from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import {
  listAiCharacterLibraryCharacters,
  type AiCharacterLibraryCharacterDto,
  type AiCharacterLibrarySyncStateDto,
} from '../../api/server'

type CharacterFilterState = {
  gender: string
  ageGroup: string
  species: string
  physique: string
  heightLevel: string
  skinColor: string
  hairLength: string
  hairColor: string
  temperament: string
}

type FilterKey = keyof CharacterFilterState

type AiCharacterLibraryModalProps = {
  opened: boolean
  onClose: () => void
  onApplyToCanvas: (character: AiCharacterLibraryCharacterDto) => Promise<void> | void
}

const DEFAULT_WORLDVIEW_OPTIONS = ['古代历史', '近代历史', '当代现实', '科幻未来', '架空幻想'] as const
const CHARACTER_PAGE_SIZE = 40
const SCROLL_LOAD_THRESHOLD_PX = 320

const DEFAULT_FILTERS: CharacterFilterState = {
  gender: '',
  ageGroup: '',
  species: '',
  physique: '',
  heightLevel: '',
  skinColor: '',
  hairLength: '',
  hairColor: '',
  temperament: '',
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function getCharacterDisplayName(character: AiCharacterLibraryCharacterDto): string {
  return normalizeText(character.identity_hint) || normalizeText(character.character_id) || '未命名角色'
}

function buildCharacterSummary(character: AiCharacterLibraryCharacterDto): string {
  return [
    normalizeText(character.gender),
    normalizeText(character.age_group),
    normalizeText(character.physique),
    normalizeText(character.temperament),
  ].filter(Boolean).join(' · ')
}

function CharacterGalleryTile(input: {
  label: string
  url: string
  className: string
}) {
  const src = normalizeText(input.url)
  return (
    <div className={`${input.className} ai-character-library-gallery-tile-button`}>
      {src ? (
        <img className="ai-character-library-gallery-image" src={src} alt={input.label} />
      ) : (
        <Center className="ai-character-library-gallery-image ai-character-library-image--empty">
          <Text className="ai-character-library-image-empty-label" size="xs" c="dimmed">
            {input.label}
          </Text>
        </Center>
      )}
      <span className="ai-character-library-gallery-label">{input.label}</span>
    </div>
  )
}

function FilterPopover(input: {
  label: string
  value: string
  values: string[]
  opened: boolean
  onOpenedChange: (opened: boolean) => void
  onChange: (next: string) => void
}) {
  const hasValue = !!normalizeText(input.value)
  return (
    <Popover
      opened={input.opened}
      onChange={input.onOpenedChange}
      position="bottom-start"
      withArrow={false}
      shadow="md"
      offset={10}
      width={248}
    >
      <Popover.Target>
        <button
          type="button"
          className={`ai-character-library-filter-tag${hasValue ? ' is-active' : ''}`}
          onClick={() => input.onOpenedChange(!input.opened)}
        >
          <span className="ai-character-library-filter-tag-prefix">+</span>
          <span className="ai-character-library-filter-tag-label">
            {hasValue ? input.value : input.label}
          </span>
          <IconChevronDown size={16} />
        </button>
      </Popover.Target>
      <Popover.Dropdown className="ai-character-library-filter-dropdown">
        <Stack gap={8}>
          {input.values.map((item) => {
            const checked = input.value === item
            return (
              <label key={`${input.label}-${item}`} className="ai-character-library-filter-option">
                <Checkbox
                  className="ai-character-library-filter-checkbox"
                  checked={checked}
                  onChange={() => {
                    input.onChange(checked ? '' : item)
                    input.onOpenedChange(false)
                  }}
                />
                <span className="ai-character-library-filter-option-text">{item}</span>
              </label>
            )
          })}
          {hasValue ? (
            <button
              type="button"
              className="ai-character-library-filter-clear"
              onClick={() => {
                input.onChange('')
                input.onOpenedChange(false)
              }}
            >
              清除筛选
            </button>
          ) : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

export function AiCharacterLibraryModal(props: AiCharacterLibraryModalProps): JSX.Element {
  const [characters, setCharacters] = React.useState<AiCharacterLibraryCharacterDto[]>([])
  const [facetCharacters, setFacetCharacters] = React.useState<AiCharacterLibraryCharacterDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [syncState, setSyncState] = React.useState<AiCharacterLibrarySyncStateDto | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [nextOffset, setNextOffset] = React.useState(0)
  const [hasMore, setHasMore] = React.useState(false)
  const [error, setError] = React.useState('')
  const [selectedWorldview, setSelectedWorldview] = React.useState('all')
  const [searchKeyword, setSearchKeyword] = React.useState('')
  const [selectedCharacterId, setSelectedCharacterId] = React.useState('')
  const [detailOpened, setDetailOpened] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [filters, setFilters] = React.useState<CharacterFilterState>(DEFAULT_FILTERS)
  const [openFilterKey, setOpenFilterKey] = React.useState<FilterKey | null>(null)
  const resultsScrollRef = React.useRef<HTMLDivElement | null>(null)

  const loadFacetCharacters = React.useCallback(async () => {
    const result = await listAiCharacterLibraryCharacters({
      offset: 0,
      limit: 500,
    })
    setFacetCharacters(Array.isArray(result.characters) ? result.characters : [])
    setSyncState(result.syncState)
  }, [])

  const queryParams = React.useMemo(() => ({
    filterWorldview: selectedWorldview !== 'all' ? selectedWorldview : undefined,
    gender: filters.gender || undefined,
    ageGroup: filters.ageGroup || undefined,
    species: filters.species || undefined,
    physique: filters.physique || undefined,
    heightLevel: filters.heightLevel || undefined,
    skinColor: filters.skinColor || undefined,
    hairLength: filters.hairLength || undefined,
    hairColor: filters.hairColor || undefined,
    temperament: filters.temperament || undefined,
  }), [
    filters.ageGroup,
    filters.gender,
    filters.hairColor,
    filters.hairLength,
    filters.heightLevel,
    filters.physique,
    filters.skinColor,
    filters.species,
    filters.temperament,
    selectedWorldview,
  ])

  const loadCharactersFirstPage = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listAiCharacterLibraryCharacters({
        offset: 0,
        limit: CHARACTER_PAGE_SIZE,
        ...queryParams,
      })
      const nextCharacters = Array.isArray(result.characters) ? result.characters : []
      setCharacters(nextCharacters)
      setTotal(result.total)
      setSyncState(result.syncState)
      setNextOffset(nextCharacters.length)
      setHasMore(nextCharacters.length < result.total)
      if (nextCharacters.length > 0) {
        setSelectedCharacterId((prev) => {
          const matched = nextCharacters.some((item) => normalizeText(item.id) === normalizeText(prev))
          return matched ? prev : normalizeText(nextCharacters[0]?.id)
        })
      } else {
        setSelectedCharacterId('')
      }
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '角色库加载失败')
      setCharacters([])
      setTotal(0)
      setNextOffset(0)
      setHasMore(false)
      setSelectedCharacterId('')
    } finally {
      setLoading(false)
    }
  }, [queryParams])

  const loadMoreCharacters = React.useCallback(async () => {
    if (loading || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const result = await listAiCharacterLibraryCharacters({
        offset: nextOffset,
        limit: CHARACTER_PAGE_SIZE,
        ...queryParams,
      })
      const incoming = Array.isArray(result.characters) ? result.characters : []
      setCharacters((prev) => {
        const seen = new Set(prev.map((item) => normalizeText(item.id)))
        const merged = prev.slice()
        for (const item of incoming) {
          const itemId = normalizeText(item.id)
          if (!itemId || seen.has(itemId)) continue
          seen.add(itemId)
          merged.push(item)
        }
        setNextOffset(merged.length)
        setHasMore(merged.length < result.total && incoming.length > 0)
        return merged
      })
      setTotal(result.total)
      setSyncState(result.syncState)
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '角色库加载失败')
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loading, loadingMore, nextOffset, queryParams])

  React.useEffect(() => {
    if (!props.opened) return
    void loadFacetCharacters()
  }, [loadFacetCharacters, props.opened])

  React.useEffect(() => {
    if (!props.opened) return
    void loadCharactersFirstPage()
  }, [loadCharactersFirstPage, props.opened])

  React.useEffect(() => {
    if (props.opened) return
    setDetailOpened(false)
    setOpenFilterKey(null)
  }, [props.opened])

  React.useEffect(() => {
    const container = resultsScrollRef.current
    if (!container) return
    container.scrollTop = 0
  }, [selectedWorldview, filters])

  const worldviewOptions = React.useMemo(() => {
    const dynamic = facetCharacters.map((item) => normalizeText(item.filter_worldview)).filter(Boolean)
    return ['all', ...Array.from(new Set([...DEFAULT_WORLDVIEW_OPTIONS, ...dynamic]))]
  }, [facetCharacters])

  const filteredCharacters = React.useMemo(() => {
    const keyword = normalizeText(searchKeyword).toLowerCase()
    if (!keyword) return characters
    return characters.filter((item) => {
      const haystack = [
        getCharacterDisplayName(item),
        item.identity_hint,
        item.era,
        item.cultural_region,
        item.time_period,
        item.scene,
        item.outfit,
        item.distinctive_features,
      ].map((value) => normalizeText(value).toLowerCase()).join(' ')
      return haystack.includes(keyword)
    })
  }, [characters, searchKeyword])

  const selectedCharacter = React.useMemo(() => {
    return filteredCharacters.find((item) => normalizeText(item.id) === selectedCharacterId)
      || characters.find((item) => normalizeText(item.id) === selectedCharacterId)
      || filteredCharacters[0]
      || characters[0]
      || null
  }, [characters, filteredCharacters, selectedCharacterId])

  const filterValueOptions = React.useMemo(() => {
    const collect = (pick: (item: AiCharacterLibraryCharacterDto) => string): string[] =>
      Array.from(new Set(facetCharacters.map((item) => normalizeText(pick(item))).filter(Boolean))).slice(0, 24)
    return {
      gender: collect((item) => item.gender),
      ageGroup: collect((item) => item.age_group),
      species: collect((item) => item.species),
      physique: collect((item) => item.physique),
      heightLevel: collect((item) => item.height_level),
      skinColor: collect((item) => item.skin_color),
      hairLength: collect((item) => item.hair_length),
      hairColor: collect((item) => item.hair_color),
      temperament: collect((item) => item.temperament),
    }
  }, [facetCharacters])

  const handleApply = React.useCallback(async () => {
    if (!selectedCharacter || applying) return
    setApplying(true)
    try {
      await props.onApplyToCanvas(selectedCharacter)
      setDetailOpened(false)
      props.onClose()
    } finally {
      setApplying(false)
    }
  }, [applying, props, selectedCharacter])

  const currentIndex = React.useMemo(() => {
    if (!selectedCharacter) return -1
    return filteredCharacters.findIndex((item) => normalizeText(item.id) === normalizeText(selectedCharacter.id))
  }, [filteredCharacters, selectedCharacter])

  const handleStepSelected = React.useCallback((direction: -1 | 1) => {
    if (!filteredCharacters.length || currentIndex < 0) return
    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= filteredCharacters.length) return
    setSelectedCharacterId(normalizeText(filteredCharacters[nextIndex]?.id))
  }, [currentIndex, filteredCharacters])

  const handleResultsScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (loading || loadingMore || !hasMore) return
    const target = event.currentTarget
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remaining <= SCROLL_LOAD_THRESHOLD_PX) {
      void loadMoreCharacters()
    }
  }, [hasMore, loadMoreCharacters, loading, loadingMore])

  const detailTitle = selectedCharacter ? getCharacterDisplayName(selectedCharacter) : 'AI角色库'
  const syncMetaLabel = syncState?.lastSyncedAt ? `已同步到本地 · ${syncState.lastSyncedAt}` : '本地角色库'

  return (
    <Modal
      className="ai-character-library-modal"
      opened={props.opened}
      onClose={props.onClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      radius={0}
      zIndex={1200}
    >
      <div className="ai-character-library-root">
        <div className="ai-character-library-shell">
          <div className="ai-character-library-header">
            <Text className="ai-character-library-header-title" size="xl" fw={800}>
              AI角色库
            </Text>
            <ActionIcon
              className="ai-character-library-header-close"
              variant="subtle"
              color="gray"
              onClick={props.onClose}
              aria-label="关闭角色库"
            >
              <IconX size={20} />
            </ActionIcon>
          </div>
          <div className="ai-character-library-content">
            <aside className="ai-character-library-sidebar">
              <div className="ai-character-library-sidebar-meta">
                <Text className="ai-character-library-sidebar-meta-text" size="xs" c="dimmed">
                  {syncMetaLabel}
                </Text>
              </div>
              {worldviewOptions.map((item) => {
                const isActive = selectedWorldview === item
                return (
                  <button
                    key={item}
                    type="button"
                    className={`ai-character-library-sidebar-item${isActive ? ' is-active' : ''}`}
                    onClick={() => setSelectedWorldview(item)}
                  >
                    <span>{item === 'all' ? '全部角色' : item}</span>
                    {item !== 'all' ? <IconChevronRight size={16} /> : null}
                  </button>
                )
              })}
            </aside>
            <section className="ai-character-library-main">
              <Stack className="ai-character-library-main-stack" gap="md">
                <Group className="ai-character-library-toolbar" justify="space-between" align="flex-start">
                  <Stack className="ai-character-library-toolbar-copy" gap={4}>
                    <Text className="ai-character-library-toolbar-title" size="lg" fw={700}>
                      {selectedWorldview === 'all' ? '全部角色' : selectedWorldview}
                    </Text>
                    <Text className="ai-character-library-toolbar-subtitle" size="sm" c="dimmed">
                      当前结果 {filteredCharacters.length} / 本地总数 {total}
                    </Text>
                  </Stack>
                  <TextInput
                    className="ai-character-library-search"
                    leftSection={<IconSearch size={14} />}
                    placeholder="搜索角色、时代、服装或特征"
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.currentTarget.value)}
                  />
                </Group>
                <ScrollArea className="ai-character-library-filter-line-scroll" type="never">
                  <Group className="ai-character-library-filter-line" gap={14} wrap="nowrap">
                    <FilterPopover
                      label="性别"
                      values={filterValueOptions.gender}
                      value={filters.gender}
                      opened={openFilterKey === 'gender'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'gender' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, gender: next }))}
                    />
                    <FilterPopover
                      label="年龄段"
                      values={filterValueOptions.ageGroup}
                      value={filters.ageGroup}
                      opened={openFilterKey === 'ageGroup'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'ageGroup' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, ageGroup: next }))}
                    />
                    <FilterPopover
                      label="物种"
                      values={filterValueOptions.species}
                      value={filters.species}
                      opened={openFilterKey === 'species'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'species' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, species: next }))}
                    />
                    <FilterPopover
                      label="体格"
                      values={filterValueOptions.physique}
                      value={filters.physique}
                      opened={openFilterKey === 'physique'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'physique' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, physique: next }))}
                    />
                    <FilterPopover
                      label="身高"
                      values={filterValueOptions.heightLevel}
                      value={filters.heightLevel}
                      opened={openFilterKey === 'heightLevel'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'heightLevel' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, heightLevel: next }))}
                    />
                    <FilterPopover
                      label="肤色"
                      values={filterValueOptions.skinColor}
                      value={filters.skinColor}
                      opened={openFilterKey === 'skinColor'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'skinColor' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, skinColor: next }))}
                    />
                    <FilterPopover
                      label="发长"
                      values={filterValueOptions.hairLength}
                      value={filters.hairLength}
                      opened={openFilterKey === 'hairLength'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'hairLength' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, hairLength: next }))}
                    />
                    <FilterPopover
                      label="发色"
                      values={filterValueOptions.hairColor}
                      value={filters.hairColor}
                      opened={openFilterKey === 'hairColor'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'hairColor' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, hairColor: next }))}
                    />
                    <FilterPopover
                      label="气质"
                      values={filterValueOptions.temperament}
                      value={filters.temperament}
                      opened={openFilterKey === 'temperament'}
                      onOpenedChange={(opened) => setOpenFilterKey(opened ? 'temperament' : null)}
                      onChange={(next) => setFilters((prev) => ({ ...prev, temperament: next }))}
                    />
                  </Group>
                </ScrollArea>
                <div
                  className="ai-character-library-results"
                  ref={resultsScrollRef}
                  onScroll={handleResultsScroll}
                >
                  {loading ? (
                    <Center className="ai-character-library-loading">
                      <Loader />
                    </Center>
                  ) : error ? (
                    <Center className="ai-character-library-error">
                      <Stack gap={8} align="center">
                        <Text className="ai-character-library-error-text" c="red">
                          {error}
                        </Text>
                      </Stack>
                    </Center>
                  ) : filteredCharacters.length === 0 ? (
                    <Center className="ai-character-library-empty">
                      <Text className="ai-character-library-empty-text" c="dimmed">
                        当前筛选条件下没有角色
                      </Text>
                    </Center>
                  ) : (
                    <Stack className="ai-character-library-results-stack" gap="sm">
                      <SimpleGrid
                        className="ai-character-library-grid"
                        cols={{ base: 2, md: 4, xl: 5 }}
                        spacing="md"
                      >
                        {filteredCharacters.map((character) => {
                          const characterId = normalizeText(character.id)
                          const isSelected = selectedCharacterId === characterId
                          return (
                            <Card
                              key={characterId}
                              className={`ai-character-library-card${isSelected ? ' is-selected' : ''}`}
                              padding={0}
                              radius="md"
                              onClick={() => {
                                setSelectedCharacterId(characterId)
                                setDetailOpened(true)
                              }}
                            >
                              <div className="ai-character-library-card-media">
                                {normalizeText(character.full_body_image_url) ? (
                                  <img
                                    className="ai-character-library-card-image"
                                    src={character.full_body_image_url}
                                    alt={getCharacterDisplayName(character)}
                                  />
                                ) : (
                                  <Center className="ai-character-library-card-image ai-character-library-image--empty">
                                    <Text className="ai-character-library-image-empty-label" size="xs" c="dimmed">
                                      角色立绘
                                    </Text>
                                  </Center>
                                )}
                              </div>
                              <div className="ai-character-library-card-body">
                                <Text className="ai-character-library-card-title" fw={700}>
                                  {getCharacterDisplayName(character)}
                                </Text>
                                <Text className="ai-character-library-card-subtitle" size="sm" c="dimmed">
                                  {buildCharacterSummary(character)}
                                </Text>
                              </div>
                            </Card>
                          )
                        })}
                      </SimpleGrid>
                      {loadingMore ? (
                        <Center className="ai-character-library-loading-more" py="xs">
                          <Loader size="sm" />
                        </Center>
                      ) : null}
                    </Stack>
                  )}
                </div>
              </Stack>
            </section>
          </div>
        </div>
      </div>

      <Modal
        className="ai-character-library-detail-modal"
        opened={props.opened && detailOpened && !!selectedCharacter}
        onClose={() => setDetailOpened(false)}
        fullScreen
        withCloseButton={false}
        padding={0}
        radius={0}
        zIndex={1210}
      >
        {selectedCharacter ? (
          <div className="ai-character-library-detail-root">
            <div className="ai-character-library-detail-shell">
              <div className="ai-character-library-detail-header">
                <Group className="ai-character-library-detail-title-row" gap="md">
                  <ActionIcon
                    className="ai-character-library-detail-back"
                    variant="subtle"
                    color="gray"
                    onClick={() => setDetailOpened(false)}
                    aria-label="返回列表"
                  >
                    <IconChevronLeft size={20} />
                  </ActionIcon>
                  <Text className="ai-character-library-detail-title" fw={800}>
                    {detailTitle}
                  </Text>
                  <Text className="ai-character-library-detail-meta" c="dimmed">
                    {[normalizeText(selectedCharacter.filter_worldview), normalizeText(selectedCharacter.filter_theme)].filter(Boolean).join(' · ')}
                  </Text>
                </Group>
                <Group className="ai-character-library-detail-nav" gap="xs">
                  <ActionIcon
                    className="ai-character-library-detail-step"
                    variant="subtle"
                    color="gray"
                    disabled={currentIndex <= 0}
                    onClick={() => handleStepSelected(-1)}
                    aria-label="上一个角色"
                  >
                    <IconChevronLeft size={20} />
                  </ActionIcon>
                  <ActionIcon
                    className="ai-character-library-detail-step"
                    variant="subtle"
                    color="gray"
                    disabled={currentIndex < 0 || currentIndex >= filteredCharacters.length - 1}
                    onClick={() => handleStepSelected(1)}
                    aria-label="下一个角色"
                  >
                    <IconChevronRight size={20} />
                  </ActionIcon>
                  <ActionIcon
                    className="ai-character-library-detail-close"
                    variant="subtle"
                    color="gray"
                    onClick={props.onClose}
                    aria-label="关闭角色库"
                  >
                    <IconX size={20} />
                  </ActionIcon>
                </Group>
              </div>
              <div className="ai-character-library-detail-content">
                <div className="ai-character-library-detail-gallery">
                  <div className="ai-character-library-detail-gallery-top">
                    <CharacterGalleryTile
                      className="ai-character-library-gallery-card ai-character-library-gallery-card--portrait"
                      label="角色立绘"
                      url={selectedCharacter.full_body_image_url}
                    />
                    <CharacterGalleryTile
                      className="ai-character-library-gallery-card ai-character-library-gallery-card--closeup"
                      label="肖像特写"
                      url={selectedCharacter.closeup_image_url}
                    />
                    <CharacterGalleryTile
                      className="ai-character-library-gallery-card ai-character-library-gallery-card--expression"
                      label="表情九宫格"
                      url={selectedCharacter.expression_image_url}
                    />
                  </div>
                  <CharacterGalleryTile
                    className="ai-character-library-gallery-card ai-character-library-gallery-card--three-view"
                    label="三视图"
                    url={selectedCharacter.three_view_image_url}
                  />
                </div>
                <div className="ai-character-library-detail-side">
                  <Stack className="ai-character-library-detail-side-stack" gap="lg">
                    <div className="ai-character-library-detail-attributes">
                      <Text className="ai-character-library-detail-section-title" fw={700}>
                        角色属性
                      </Text>
                      <div className="ai-character-library-detail-attr-grid">
                        {[
                          ['大类', selectedCharacter.era],
                          ['文化区域', selectedCharacter.cultural_region],
                          ['时代', selectedCharacter.time_period],
                          ['性别', selectedCharacter.gender],
                          ['年龄段', selectedCharacter.age_group],
                          ['物种', selectedCharacter.species],
                          ['体格', selectedCharacter.physique],
                          ['身高', selectedCharacter.height_level],
                          ['肤色', selectedCharacter.skin_color],
                          ['发长', selectedCharacter.hair_length],
                          ['发色', selectedCharacter.hair_color],
                          ['气质', selectedCharacter.temperament],
                          ['场景', selectedCharacter.scene],
                        ].map(([label, value]) => (
                          <div key={`${label}-${value}`} className="ai-character-library-detail-attr-item">
                            <Text className="ai-character-library-detail-attr-label" c="dimmed">
                              {label}
                            </Text>
                            <Text className="ai-character-library-detail-attr-value">
                              {normalizeText(value) || '未填写'}
                            </Text>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ai-character-library-detail-copy-block">
                      <Text className="ai-character-library-detail-section-title" fw={700}>
                        辨识特征
                      </Text>
                      <Text className="ai-character-library-detail-copy">
                        {normalizeText(selectedCharacter.distinctive_features) || '未填写'}
                      </Text>
                    </div>

                    <div className="ai-character-library-detail-copy-block">
                      <Text className="ai-character-library-detail-section-title" fw={700}>
                        着装描述
                      </Text>
                      <Text className="ai-character-library-detail-copy">
                        {normalizeText(selectedCharacter.outfit) || '未填写'}
                      </Text>
                    </div>

                    <div className="ai-character-library-detail-badges">
                      {[selectedCharacter.filter_worldview, selectedCharacter.filter_theme, selectedCharacter.appearance_background]
                        .map((value) => normalizeText(value))
                        .filter(Boolean)
                        .map((value) => (
                          <Badge key={value} className="ai-character-library-detail-badge" variant="outline" size="lg">
                            {value}
                          </Badge>
                        ))}
                    </div>

                    <button
                      type="button"
                      className="ai-character-library-apply-button"
                      onClick={() => { void handleApply() }}
                      disabled={applying}
                    >
                      {applying ? '应用中…' : '应用到画布'}
                    </button>
                  </Stack>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </Modal>
  )
}
