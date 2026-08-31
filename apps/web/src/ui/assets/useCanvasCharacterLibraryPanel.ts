import React from 'react'
import {
  buildCharacterBibleFromDto,
  buildCharacterReferenceImages,
  type AiCharacterLibraryCharacterDto,
} from '@tapcanvas/character-bible-protocol'
import { listAiCharacterLibraryCharacters } from '../../api/server'
import { useRFStore } from '../../canvas/store'
import { upsertSemanticNodeAnchorBinding } from '../../canvas/utils/semanticBindings'
import { toast } from '../toast'
import { useUIStore } from '../uiStore'
import {
  collectCharacterLibraryWorldviews,
  filterCharacterLibraryCharacters,
  getCharacterLibraryDisplayName,
  normalizeCharacterLibraryText,
} from './characterLibraryPanelModel'

const RECENT_CHARACTER_IDS_KEY = 'tapcanvas.character-library.recent-ids.v1'
const RECENT_CHARACTER_LIMIT = 30

function readRecentCharacterIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_CHARACTER_IDS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeCharacterLibraryText)
      .filter(Boolean)
      .slice(0, RECENT_CHARACTER_LIMIT)
  } catch {
    return []
  }
}

function persistRecentCharacterId(characterId: string, currentIds: readonly string[]): string[] {
  const normalizedId = normalizeCharacterLibraryText(characterId)
  if (!normalizedId) return [...currentIds]
  const nextIds = [normalizedId, ...currentIds.filter((id) => id !== normalizedId)]
    .slice(0, RECENT_CHARACTER_LIMIT)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RECENT_CHARACTER_IDS_KEY, JSON.stringify(nextIds))
  }
  return nextIds
}

export function useCanvasCharacterLibraryPanel(mounted: boolean) {
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const addNode = useRFStore((state) => state.addNode)
  const [characters, setCharacters] = React.useState<AiCharacterLibraryCharacterDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [error, setError] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [worldview, setWorldview] = React.useState('all')
  const [recentOnly, setRecentOnly] = React.useState(false)
  const [recentIds, setRecentIds] = React.useState<string[]>(readRecentCharacterIds)
  const [selectedCharacterId, setSelectedCharacterId] = React.useState('')

  const loadCharacters = React.useCallback(async (mode: 'initial' | 'refresh') => {
    mode === 'initial' ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await listAiCharacterLibraryCharacters({
        offset: 0,
        limit: 500,
        withTotal: true,
      })
      setCharacters(Array.isArray(result.characters) ? result.characters : [])
    } catch (loadError: unknown) {
      setCharacters([])
      setSelectedCharacterId('')
      setError(loadError instanceof Error ? loadError.message : '角色库加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    void loadCharacters('initial')
  }, [loadCharacters, mounted])

  const worldviewOptions = React.useMemo(
    () => collectCharacterLibraryWorldviews(characters),
    [characters],
  )

  const visibleCharacters = React.useMemo(
    () => filterCharacterLibraryCharacters({
      characters,
      query,
      worldview,
      recentOnly,
      recentIds,
    }),
    [characters, query, recentIds, recentOnly, worldview],
  )

  React.useEffect(() => {
    if (!selectedCharacterId) return
    const selectionStillVisible = visibleCharacters.some(
      (character) => normalizeCharacterLibraryText(character.id) === selectedCharacterId,
    )
    if (!selectionStillVisible) setSelectedCharacterId('')
  }, [selectedCharacterId, visibleCharacters])

  const selectedCharacter = React.useMemo(
    () => characters.find(
      (character) => normalizeCharacterLibraryText(character.id) === selectedCharacterId,
    ) || null,
    [characters, selectedCharacterId],
  )

  const selectedReferences = React.useMemo(
    () => selectedCharacter ? buildCharacterReferenceImages(selectedCharacter) : [],
    [selectedCharacter],
  )

  const applySelectedCharacter = React.useCallback(async () => {
    if (!selectedCharacter || applying) return
    const references = buildCharacterReferenceImages(selectedCharacter)
    if (!references.length) {
      toast('当前角色没有可用图片，无法应用到画布', 'error')
      return
    }
    setApplying(true)
    try {
      const roleName = getCharacterLibraryDisplayName(selectedCharacter)
      const characterBible = buildCharacterBibleFromDto(selectedCharacter)
      const primaryReference = references[0]
      addNode('taskNode', roleName, {
        kind: 'image',
        autoLabel: false,
        prompt: `@${roleName.replace(/\s+/g, '_')}`,
        imageUrl: primaryReference.url,
        imageResults: references.map((reference) => ({
          url: reference.url,
          title: reference.label,
        })),
        imagePrimaryIndex: 0,
        status: 'success',
        source: 'ai_character_library',
        roleName,
        roleCardReferenceImages: references.map((reference) => reference.url),
        characterBible,
        characterLibraryCharacterId: selectedCharacter.id,
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: null,
          next: {
            kind: 'character',
            refId: characterBible.id,
            label: roleName,
            imageUrl: primaryReference.url,
            referenceView: primaryReference.slot === 'threeView' ? 'three_view' : 'role_card',
            note: `@${roleName} | source=ai_character_library`,
          },
        }),
      })
      setRecentIds((currentIds) => persistRecentCharacterId(selectedCharacter.id, currentIds))
      setActivePanel(null)
      toast(`已将「${roleName}」应用到画布`, 'success')
    } catch (applyError: unknown) {
      toast(applyError instanceof Error ? applyError.message : '角色应用失败', 'error')
    } finally {
      setApplying(false)
    }
  }, [addNode, applying, selectedCharacter, setActivePanel])

  return {
    characters,
    loading,
    refreshing,
    applying,
    error,
    query,
    setQuery,
    worldview,
    setWorldview,
    recentOnly,
    setRecentOnly,
    selectedCharacterId,
    setSelectedCharacterId,
    worldviewOptions,
    visibleCharacters,
    selectedCharacter,
    selectedReferences,
    loadCharacters,
    applySelectedCharacter,
  }
}
