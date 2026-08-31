import type { LlmNodePresetDto } from '../../api/server'
import { resolveStyleReferenceCategories, type StyleReferenceCategoryKey } from '../styleReferenceFacets'

// 风格库面板的「粗分类」标签：对标 mockup 的 全部/真人/2D/3D 四档，
// 把 styleReferenceFacets 的细分类（real_people/anime_comic/...）归并到四桶。
export type CoarseStyleCategory = 'all' | 'real' | '2d' | '3d'

export const COARSE_STYLE_CATEGORY_OPTIONS: Array<{ key: CoarseStyleCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'real', label: '真人' },
  { key: '2d', label: '2D' },
  { key: '3d', label: '3D' },
]

const FINE_TO_COARSE: Partial<Record<StyleReferenceCategoryKey, CoarseStyleCategory>> = {
  real_people: 'real',
  era: 'real',
  ethnicity_region: 'real',
  history: 'real',
  anime_comic: '2d',
  art_movement: '2d',
  game_digital: '3d',
  future: '3d',
}

export function resolveCoarseStyleCategories(preset: LlmNodePresetDto): CoarseStyleCategory[] {
  const out = new Set<CoarseStyleCategory>()
  for (const fine of resolveStyleReferenceCategories(preset)) {
    const coarse = FINE_TO_COARSE[fine]
    if (coarse) out.add(coarse)
  }
  return Array.from(out)
}

export function filterStyleLibraryPresets(input: {
  presets: readonly LlmNodePresetDto[]
  category: CoarseStyleCategory
  query: string
}): LlmNodePresetDto[] {
  const normalizedQuery = input.query.trim().toLowerCase()
  return input.presets.filter((preset) => {
    if (!preset.referenceImageUrl) return false
    if (input.category !== 'all' && !resolveCoarseStyleCategories(preset).includes(input.category)) return false
    if (!normalizedQuery) return true
    const haystack = [preset.title, preset.description || '', ...(preset.styleReference?.tags || [])]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}
