import { describe, expect, it } from 'vitest'
import { updateImageOperationParameters } from '@tapcanvas/image-operation-protocol'
import { createImageOperationForSource, createPresetImageOperation } from './imageOperationFactory'
import { LIBTV_IMAGE_PRESETS } from './libTvImagePresets'

describe('image operation factory', () => {
  it('gives every nine-grid style capability an explicit executable contract', () => {
    const operation = createPresetImageOperation({
      presetKey: 'multi-camera-9',
      sourceNodeId: 'source-1',
      sourceUrl: 'https://example.com/source.png',
    })
    expect(operation.kind).toBe('multi_camera_9')
    expect(operation.output.grid).toEqual({ rows: 3, cols: 3 })
    expect(operation.inputs).toEqual([
      expect.objectContaining({ role: 'source', url: 'https://example.com/source.png' }),
    ])
  })

  it('gives every generic LibTV preset a concrete operation contract', () => {
    const genericPresets = LIBTV_IMAGE_PRESETS.filter((preset) => (
      preset.key !== 'portrait-texture' && preset.execution !== 'character-fission'
    ))
    const operations = genericPresets.map((preset) => createPresetImageOperation({
      presetKey: preset.key,
      sourceNodeId: 'source-1',
      sourceUrl: 'https://example.com/source.png',
    }))

    expect(operations).toHaveLength(14)
    expect(operations.every((operation) => operation.inputs.some((asset) => asset.role === 'source'))).toBe(true)
    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(operations.length)
  })

  it('requires an independent mask for inpaint', () => {
    expect(() => createImageOperationForSource({
      kind: 'inpaint',
      execution: 'image-edit',
      sourceNodeId: 'source-1',
      sourceUrl: 'https://example.com/source.png',
    })).toThrow('独立 mask')
  })

  it('updates editable parameters without changing operation identity or inputs', () => {
    const operation = createImageOperationForSource({
      kind: 'portrait_adjust',
      execution: 'image-edit',
      sourceNodeId: 'source-1',
      sourceUrl: 'https://example.com/source.png',
      parameters: { strength: 50 },
      additionalInputs: [{ role: 'mask', url: 'https://example.com/mask.png' }],
    })
    const updated = updateImageOperationParameters(operation, { strength: 72 })
    expect(updated.operationId).toBe(operation.operationId)
    expect(updated.inputs).toEqual(operation.inputs)
    expect(updated.parameters.strength).toBe(72)
  })
})
