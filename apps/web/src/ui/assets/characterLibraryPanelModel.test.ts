import { describe, expect, it } from 'vitest'
import type { AiCharacterLibraryCharacterDto } from '@tapcanvas/character-bible-protocol'
import {
  collectCharacterLibraryWorldviews,
  filterCharacterLibraryCharacters,
  getCharacterLibraryDisplayName,
  getCharacterLibraryPrimaryImage,
} from './characterLibraryPanelModel'

function character(
  input: Partial<AiCharacterLibraryCharacterDto>,
): AiCharacterLibraryCharacterDto {
  return {
    id: '',
    name: '',
    projectId: null,
    character_id: '',
    group_number: '',
    era: '',
    cultural_region: '',
    genre: '',
    time_period: '',
    appearance_background: '',
    scene: '',
    gender: '',
    age_group: '',
    species: '',
    physique: '',
    height_level: '',
    skin_color: '',
    hair_length: '',
    hair_color: '',
    temperament: '',
    outfit: '',
    distinctive_features: '',
    identity_hint: '',
    full_body_image_url: '',
    three_view_image_url: '',
    expression_image_url: '',
    closeup_image_url: '',
    filter_worldview: '',
    filter_theme: '',
    filter_scene: '',
    imported_at: '',
    updated_at: '',
    ...input,
  }
}

describe('characterLibraryPanelModel', () => {
  const characters = [
    character({
      id: 'ancient-hero',
      identity_hint: '青衣剑客',
      filter_worldview: '古代历史',
      temperament: '沉稳',
      full_body_image_url: 'https://assets.example/hero.png',
    }),
    character({
      id: 'future-pilot',
      name: '星际驾驶员',
      filter_worldview: '科幻未来',
      outfit: '银色太空服',
      three_view_image_url: 'https://assets.example/pilot.png',
    }),
  ]

  it('按角色名、属性与世界观筛选', () => {
    expect(filterCharacterLibraryCharacters({
      characters,
      query: '太空服',
      worldview: '科幻未来',
      recentOnly: false,
      recentIds: [],
    })).toEqual([characters[1]])
  })

  it('最近使用只保留已应用角色', () => {
    expect(filterCharacterLibraryCharacters({
      characters,
      query: '',
      worldview: 'all',
      recentOnly: true,
      recentIds: ['ancient-hero'],
    })).toEqual([characters[0]])
  })

  it('提供稳定的展示名称、主图与世界观列表', () => {
    expect(getCharacterLibraryDisplayName(characters[0])).toBe('青衣剑客')
    expect(getCharacterLibraryPrimaryImage(characters[1])).toBe('https://assets.example/pilot.png')
    expect(collectCharacterLibraryWorldviews(characters)).toEqual(['古代历史', '科幻未来'])
  })
})
