import { describe, expect, it } from 'vitest'

import {
  normalizeCreationStage,
  normalizeProductionLayer,
  normalizeProductionNodeMetaRecord,
} from './productionMeta'

describe('production metadata protocol', () => {
  it.each([
    ['blocking_diagram', 'spatial_blocking'],
    ['keyframe', 'beat_keyframe'],
  ] as const)('preserves %s/%s evidence without image-layer inference', (productionLayer, creationStage) => {
    expect(normalizeProductionLayer(productionLayer)).toBe(productionLayer)
    expect(normalizeCreationStage(creationStage)).toBe(creationStage)
    expect(
      normalizeProductionNodeMetaRecord({
        kind: 'image',
        productionLayer,
        creationStage,
      }),
    ).toMatchObject({ productionLayer, creationStage })
  })
})
