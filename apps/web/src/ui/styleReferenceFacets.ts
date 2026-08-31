import type { LlmNodePresetDto } from '../api/server'

export type StyleReferenceCategoryKey =
  | 'all'
  | 'real_people'
  | 'era'
  | 'ethnicity_region'
  | 'history'
  | 'future'
  | 'anime_comic'
  | 'game_digital'
  | 'art_movement'

export type StyleReferenceSourceFilter = 'all' | 'base' | 'user'

export type StyleReferenceCategoryOption = {
  key: StyleReferenceCategoryKey
  label: string
}

export const STYLE_REFERENCE_CATEGORY_OPTIONS: StyleReferenceCategoryOption[] = [
  { key: 'all', label: '全部' },
  { key: 'real_people', label: '真人/影视' },
  { key: 'era', label: '年代/复古' },
  { key: 'ethnicity_region', label: '人种/地域' },
  { key: 'history', label: '历史/文化' },
  { key: 'future', label: '未来/科幻' },
  { key: 'anime_comic', label: '漫剧/动漫' },
  { key: 'game_digital', label: '游戏/数字' },
  { key: 'art_movement', label: '艺术运动' },
]

export const STYLE_REFERENCE_SOURCE_OPTIONS: Array<{ key: StyleReferenceSourceFilter; label: string }> = [
  { key: 'all', label: '全部来源' },
  { key: 'base', label: '官方参考' },
  { key: 'user', label: '我的收藏' },
]

export const STYLE_REFERENCE_BASE_LIMIT = 240
export const STYLE_REFERENCE_USER_LIMIT = 300

const CATEGORY_ALIAS_MAP: Record<string, StyleReferenceCategoryKey> = {
  real: 'real_people',
  real_people: 'real_people',
  live_action: 'real_people',
  cinematic: 'real_people',
  真人: 'real_people',
  影视: 'real_people',
  era: 'era',
  retro: 'era',
  vintage: 'era',
  年代: 'era',
  复古: 'era',
  ethnicity: 'ethnicity_region',
  region: 'ethnicity_region',
  culture: 'ethnicity_region',
  ethnicity_region: 'ethnicity_region',
  人种: 'ethnicity_region',
  地域: 'ethnicity_region',
  族群: 'ethnicity_region',
  history: 'history',
  historical: 'history',
  历史: 'history',
  文化: 'history',
  future: 'future',
  futuristic: 'future',
  scifi: 'future',
  sci_fi: 'future',
  科幻: 'future',
  未来: 'future',
  anime: 'anime_comic',
  comic: 'anime_comic',
  manga: 'anime_comic',
  manju: 'anime_comic',
  anime_comic: 'anime_comic',
  chinese_anime: 'anime_comic',
  漫剧: 'anime_comic',
  动漫: 'anime_comic',
  漫画: 'anime_comic',
  game: 'game_digital',
  digital: 'game_digital',
  game_digital: 'game_digital',
  游戏: 'game_digital',
  数字: 'game_digital',
  art: 'art_movement',
  art_movement: 'art_movement',
  艺术: 'art_movement',
  艺术运动: 'art_movement',
}

function normalizeStyleId(value: string | undefined): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const match = raw.match(/^s(\d{1,3})$/)
  if (!match) return raw
  return `s${Number(match[1])}`
}

function deriveSeededStyleCategories(styleId: string): StyleReferenceCategoryKey[] {
  const normalized = normalizeStyleId(styleId)
  const numeric = normalized.startsWith('s') ? Number(normalized.slice(1)) : Number.NaN
  if (!Number.isFinite(numeric)) return []
  const categories = new Set<StyleReferenceCategoryKey>()
  if ((numeric >= 1 && numeric <= 15) || (numeric >= 51 && numeric <= 63)) categories.add('anime_comic')
  if ((numeric >= 16 && numeric <= 25) || (numeric >= 64 && numeric <= 75) || numeric === 88 || numeric === 89 || numeric === 91 || numeric === 95 || numeric === 99) categories.add('history')
  if ((numeric >= 64 && numeric <= 75) || numeric === 21 || numeric === 53 || numeric === 54 || numeric === 55 || numeric === 73) categories.add('ethnicity_region')
  if ([8, 11, 19, 29, 31, 45, 74, 89, 91, 98].includes(numeric)) categories.add('era')
  if ([4, 28, 35, 41, 49, 61, 63, 79, 80, 94, 96, 100].includes(numeric)) categories.add('future')
  if ((numeric >= 76 && numeric <= 83) || numeric === 40) categories.add('game_digital')
  if ((numeric >= 32 && numeric <= 45) || (numeric >= 84 && numeric <= 93)) categories.add('art_movement')
  if (numeric >= 101 && numeric <= 124) categories.add('real_people')
  if (numeric >= 125 && numeric <= 152) categories.add('anime_comic')
  if (numeric >= 104 && numeric <= 110) categories.add('era')
  if (numeric >= 111 && numeric <= 118) categories.add('history')
  if (numeric >= 102 && numeric <= 119) categories.add('ethnicity_region')
  if (numeric >= 120 && numeric <= 122) categories.add('future')
  return Array.from(categories)
}

function readPresetStyleId(preset: LlmNodePresetDto): string {
  return normalizeStyleId(preset.styleReference?.styleId)
}

function normalizeCategory(raw: string): StyleReferenceCategoryKey | null {
  const key = raw.trim().toLowerCase()
  return CATEGORY_ALIAS_MAP[key] || null
}

export function resolveStyleReferenceCategories(preset: LlmNodePresetDto): StyleReferenceCategoryKey[] {
  const directCategories = (preset.styleReference?.categories || [])
    .map(normalizeCategory)
    .filter((item): item is StyleReferenceCategoryKey => Boolean(item))
  const categories = new Set<StyleReferenceCategoryKey>(directCategories)
  for (const category of deriveSeededStyleCategories(readPresetStyleId(preset))) {
    categories.add(category)
  }
  return Array.from(categories)
}

export function getStyleReferenceCategoryLabel(category: StyleReferenceCategoryKey): string {
  return STYLE_REFERENCE_CATEGORY_OPTIONS.find((item) => item.key === category)?.label || category
}

export function getPrimaryStyleReferenceCategoryLabel(preset: LlmNodePresetDto): string {
  const category = resolveStyleReferenceCategories(preset)[0]
  return category ? getStyleReferenceCategoryLabel(category) : '未分类'
}

export function buildStyleReferenceSearchText(preset: LlmNodePresetDto): string {
  const styleReference = preset.styleReference
  return [
    preset.title,
    preset.description || '',
    preset.prompt,
    styleReference?.styleId || '',
    styleReference?.era || '',
    styleReference?.region || '',
    styleReference?.ethnicity || '',
    styleReference?.medium || '',
    ...(styleReference?.tags || []),
    ...resolveStyleReferenceCategories(preset).map(getStyleReferenceCategoryLabel),
  ]
    .join(' ')
    .toLowerCase()
}

export function filterStyleReferencePresets(input: {
  presets: readonly LlmNodePresetDto[]
  source: StyleReferenceSourceFilter
  category: StyleReferenceCategoryKey
  query: string
}): LlmNodePresetDto[] {
  const normalizedQuery = input.query.trim().toLowerCase()
  return input.presets.filter((preset) => {
    if (!preset.referenceImageUrl) return false
    if (input.source !== 'all' && preset.scope !== input.source) return false
    if (input.category !== 'all' && !resolveStyleReferenceCategories(preset).includes(input.category)) return false
    if (!normalizedQuery) return true
    return buildStyleReferenceSearchText(preset).includes(normalizedQuery)
  })
}

export function inheritBaseStyleReferencesForUserPresets(input: {
  basePresets: readonly LlmNodePresetDto[]
  userPresets: readonly LlmNodePresetDto[]
}): LlmNodePresetDto[] {
  const baseStyleByImageUrl = new Map<string, NonNullable<LlmNodePresetDto['styleReference']>>()
  for (const preset of input.basePresets) {
    const imageUrl = preset.referenceImageUrl?.trim()
    if (imageUrl && preset.styleReference) {
      baseStyleByImageUrl.set(imageUrl, preset.styleReference)
    }
  }
  return input.userPresets.map((preset) => {
    if (preset.styleReference || !preset.referenceImageUrl) return preset
    const inheritedStyleReference = baseStyleByImageUrl.get(preset.referenceImageUrl)
    return inheritedStyleReference ? { ...preset, styleReference: inheritedStyleReference } : preset
  })
}
