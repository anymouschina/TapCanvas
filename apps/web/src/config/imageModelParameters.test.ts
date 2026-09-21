import { describe, expect, it } from 'vitest'
import { readImageParameterSpecs, readImageParameterValues, updateImageParameterValues, imageModelParameterExtras } from './imageModelParameters'

describe('image model parameter transport', () => {
  it('keeps settings separate by exact model and survives JSON persistence', () => {
    const data = { imageModelParameters: { 'mj-v8.2': { stylize: 100, raw: true }, other: { strength: 0.5 } } }
    const saved = JSON.parse(JSON.stringify({ imageModelParameters: updateImageParameterValues(data, 'mj-v8.2', 'stylize', 0) })) as unknown
    expect(imageModelParameterExtras(saved, 'mj-v8.2')).toEqual({ modelParameters: { stylize: 0, raw: true } })
    expect(readImageParameterValues(saved, 'other')).toEqual({ strength: 0.5 })
    expect(imageModelParameterExtras(saved, 'third')).toEqual({})
  })
  it('only displays explicitly declared advanced scalar parameters', () => {
    expect(readImageParameterSpecs({ runtimeParameters: [
      { key: 'prompt', type: 'string', label: '提示词' },
      { key: 'stylize', type: 'integer', label: '风格化程度', scope: 'image_advanced', default: 100, min: 0, max: 1000 },
      { key: 'images', type: 'array', label: '参考图', scope: 'image_advanced' },
    ] })).toEqual([{ key: 'stylize', type: 'integer', label: '风格化程度', default: 100, min: 0, max: 1000 }])
  })
})
