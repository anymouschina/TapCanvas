import { describe, expect, it } from 'vitest'
import {
  buildLibTvLightingOperationParameters,
  cameraFovToImageDistance,
  findClosestLightDirection,
  LIBTV_BRIGHTNESS_LEVELS,
  LIBTV_MAIN_LIGHT_DIRECTIONS,
  LIBTV_RIM_LIGHT_DIRECTIONS,
  resolveMultiAnglePresetPrompt,
  snapBrightnessToLibTvLevel,
} from './imageViewEditorContract'

describe('LibTV image view editor contract', () => {
  it('exposes all main and rim light directions from the LibTV editor', () => {
    expect(LIBTV_MAIN_LIGHT_DIRECTIONS).toHaveLength(26)
    expect(LIBTV_MAIN_LIGHT_DIRECTIONS.map((preset) => preset.label)).toEqual(expect.arrayContaining([
      '前方', '右前', '后方', '高右后', '低左前', '顶部', '底部',
    ]))
    expect(LIBTV_RIM_LIGHT_DIRECTIONS).toHaveLength(9)
  })

  it('snaps brightness to the five semantic levels', () => {
    expect(LIBTV_BRIGHTNESS_LEVELS).toHaveLength(5)
    expect(snapBrightnessToLibTvLevel(73)).toBe(75)
    expect(snapBrightnessToLibTvLevel(8)).toBe(10)
  })

  it('finds the closest direction across the azimuth wrap boundary', () => {
    const closest = findClosestLightDirection(LIBTV_MAIN_LIGHT_DIRECTIONS, {
      azimuthDeg: 358,
      elevationDeg: 7,
    })
    expect(closest.key).toBe('front')
  })

  it('submits only the lighting fields enabled by the LibTV controls', () => {
    expect(buildLibTvLightingOperationParameters({
      directionEnabled: true,
      brightnessEnabled: false,
      colorEnabled: true,
      rimEnabled: false,
      smartMode: true,
      mainDirectionKey: 'high-front-left',
      rimDirectionKey: 'back',
      colorHex: '#2d34fa',
      brightness: 73,
      smartPrompt: '  黄金时刻  ',
      referenceImageUrl: ' https://assets.example.com/light.png ',
    })).toEqual({
      UI_KeyLight: 'high-front-left',
      UI_LightColor: '#2d34fa',
      prompt: '黄金时刻',
      Reference_Image_Intent: 'https://assets.example.com/light.png',
    })
  })

  it('does not leak hidden smart-mode values into the execution contract', () => {
    expect(buildLibTvLightingOperationParameters({
      directionEnabled: false,
      brightnessEnabled: true,
      colorEnabled: false,
      rimEnabled: true,
      smartMode: false,
      mainDirectionKey: 'front',
      rimDirectionKey: 'high-back-left',
      colorHex: '#ffffff',
      brightness: 73,
      smartPrompt: '不应提交',
      referenceImageUrl: 'https://assets.example.com/hidden.png',
    })).toEqual({
      UI_RimLight: 'high-back-left',
      UI_LightBrightness: 75,
    })
  })

  it('maps LibTV shot scale to the executable camera distance range', () => {
    expect(cameraFovToImageDistance(28)).toBe(0.7)
    expect(cameraFovToImageDistance(110)).toBe(3.8)
  })

  it('injects the LibTV fisheye description only when the prompt is empty', () => {
    expect(resolveMultiAnglePresetPrompt('fisheye', '')).toContain('鱼眼畸变')
    expect(resolveMultiAnglePresetPrompt('fisheye', '保留人物全身')).toBe('保留人物全身')
    expect(resolveMultiAnglePresetPrompt('back', '')).toBe('')
  })
})
