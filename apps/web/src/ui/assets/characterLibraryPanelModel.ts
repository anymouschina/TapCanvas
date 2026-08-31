import type { AiCharacterLibraryCharacterDto } from '@tapcanvas/character-bible-protocol'

export function normalizeCharacterLibraryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getCharacterLibraryDisplayName(character: AiCharacterLibraryCharacterDto): string {
  return normalizeCharacterLibraryText(character.identity_hint)
    || normalizeCharacterLibraryText(character.name)
    || normalizeCharacterLibraryText(character.character_id)
    || '未命名角色'
}

export function getCharacterLibrarySummary(character: AiCharacterLibraryCharacterDto): string {
  return [
    character.gender,
    character.age_group,
    character.species,
    character.temperament,
  ]
    .map(normalizeCharacterLibraryText)
    .filter(Boolean)
    .join(' · ')
}

export function getCharacterLibraryPrimaryImage(character: AiCharacterLibraryCharacterDto): string {
  return [
    character.full_body_image_url,
    character.three_view_image_url,
    character.closeup_image_url,
    character.expression_image_url,
  ]
    .map(normalizeCharacterLibraryText)
    .find(Boolean) || ''
}

export function collectCharacterLibraryWorldviews(
  characters: readonly AiCharacterLibraryCharacterDto[],
): string[] {
  return Array.from(new Set(
    characters
      .map((character) => normalizeCharacterLibraryText(character.filter_worldview))
      .filter(Boolean),
  ))
}

export function filterCharacterLibraryCharacters(input: {
  characters: readonly AiCharacterLibraryCharacterDto[]
  query: string
  worldview: string
  recentOnly: boolean
  recentIds: readonly string[]
}): AiCharacterLibraryCharacterDto[] {
  const normalizedQuery = normalizeCharacterLibraryText(input.query).toLocaleLowerCase()
  const recentIdSet = new Set(input.recentIds.map(normalizeCharacterLibraryText).filter(Boolean))

  return input.characters.filter((character) => {
    const characterId = normalizeCharacterLibraryText(character.id)
    if (input.recentOnly && !recentIdSet.has(characterId)) return false
    if (input.worldview !== 'all' && normalizeCharacterLibraryText(character.filter_worldview) !== input.worldview) {
      return false
    }
    if (!normalizedQuery) return true
    const searchableText = [
      getCharacterLibraryDisplayName(character),
      character.character_id,
      character.filter_worldview,
      character.filter_theme,
      character.era,
      character.cultural_region,
      character.time_period,
      character.gender,
      character.age_group,
      character.species,
      character.outfit,
      character.distinctive_features,
    ]
      .map((value) => normalizeCharacterLibraryText(value).toLocaleLowerCase())
      .join(' ')
    return searchableText.includes(normalizedQuery)
  })
}
