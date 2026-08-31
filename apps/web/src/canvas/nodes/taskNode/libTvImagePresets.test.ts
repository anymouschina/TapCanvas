import { describe, expect, it } from 'vitest'
import {
  findLibTvImagePreset,
  LIBTV_IMAGE_NINE_GRID_PRESET_KEYS,
  LIBTV_IMAGE_PRESET_GROUPS,
  LIBTV_IMAGE_PRESETS,
} from './libTvImagePresets'

describe('LibTV image preset catalogue', () => {
  it('exposes the four LibTV groups and all 16 executable capabilities', () => {
    expect(LIBTV_IMAGE_PRESET_GROUPS.map((group) => group.label)).toEqual([
      '分镜叙事',
      '质感调节',
      '空间与机位',
      '设定图',
    ])
    expect(LIBTV_IMAGE_PRESETS).toHaveLength(16)
    expect(new Set(LIBTV_IMAGE_PRESETS.map((preset) => preset.key)).size).toBe(16)
  })

  it('keeps every normal preset executable and routes panorama to its dedicated pipeline', () => {
    const panorama = findLibTvImagePreset('panorama-720')
    expect(panorama).toMatchObject({
      label: '720°全景图',
      execution: 'panorama',
    })
    expect(panorama?.prompt).toContain('2:1')
    expect(panorama?.prompt).toContain('无缝衔接')

    const imageEditPresets = LIBTV_IMAGE_PRESETS.filter((preset) => preset.execution === 'image-edit')
    expect(imageEditPresets).toHaveLength(14)
    expect(imageEditPresets.every((preset) => preset.prompt.trim().length > 0)).toBe(true)

    const characterFission = findLibTvImagePreset('character-fission')
    expect(characterFission).toMatchObject({
      label: '角色裂变',
      execution: 'character-fission',
    })
  })

  it('matches the eleven presets and exact order exposed by the Liblib image toolbar', () => {
    expect(LIBTV_IMAGE_NINE_GRID_PRESET_KEYS.map((key) => findLibTvImagePreset(key)?.label)).toEqual([
      '多机位九宫格',
      '剧情推演四宫格',
      '角色脸部三视图',
      '角色设定图',
      '场景设定图',
      '产品设定图',
      '25宫格连贯分镜',
      '电影级光影校正',
      '角色三视图',
      '画面推演 - 3秒后',
      '画面推演 - 5秒前',
    ])
  })
})
