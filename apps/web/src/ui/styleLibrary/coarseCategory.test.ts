import { describe, it, expect } from 'vitest'
import { resolveCoarseStyleCategories, filterStyleLibraryPresets } from './coarseCategory'
import type { LlmNodePresetDto } from '../../api/server'

function preset(over: Partial<LlmNodePresetDto>): LlmNodePresetDto {
  return {
    id: 'x',
    title: '风格',
    prompt: '',
    type: 'image',
    scope: 'base',
    referenceImageUrl: 'https://cdn/x.webp',
    ...over,
  } as LlmNodePresetDto
}

describe('resolveCoarseStyleCategories', () => {
  it('真人细分类归并到 real', () => {
    const p = preset({ styleReference: { categories: ['real_people'] } as any })
    expect(resolveCoarseStyleCategories(p)).toContain('real')
  })

  it('动漫归并到 2d、游戏/数字归并到 3d', () => {
    expect(resolveCoarseStyleCategories(preset({ styleReference: { categories: ['anime'] } as any }))).toContain('2d')
    expect(resolveCoarseStyleCategories(preset({ styleReference: { categories: ['game'] } as any }))).toContain('3d')
  })

  it('国漫扩展卡 s125-s152 归并到 2d', () => {
    const chineseAnime = preset({
      id: 's152',
      styleReference: { styleId: 's152', categories: ['chinese_anime'] },
    })
    expect(resolveCoarseStyleCategories(chineseAnime)).toContain('2d')
  })
})

describe('filterStyleLibraryPresets', () => {
  const presets = [
    preset({ id: 'a', title: '真人写实', styleReference: { categories: ['real_people'] } as any }),
    preset({ id: 'b', title: '日式动漫', styleReference: { categories: ['anime'] } as any }),
    preset({ id: 'c', title: '无图', referenceImageUrl: undefined }),
  ]

  it('剔除无图 preset', () => {
    const r = filterStyleLibraryPresets({ presets, category: 'all', query: '' })
    expect(r.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('按粗分类过滤', () => {
    expect(filterStyleLibraryPresets({ presets, category: 'real', query: '' }).map((p) => p.id)).toEqual(['a'])
    expect(filterStyleLibraryPresets({ presets, category: '2d', query: '' }).map((p) => p.id)).toEqual(['b'])
  })

  it('按标题搜索', () => {
    expect(filterStyleLibraryPresets({ presets, category: 'all', query: '动漫' }).map((p) => p.id)).toEqual(['b'])
  })
})
