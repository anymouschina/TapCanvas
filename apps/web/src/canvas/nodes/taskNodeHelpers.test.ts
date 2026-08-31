import { describe, expect, it } from 'vitest'
import {
  TEXT_NODE_DEFAULT_HEIGHT,
  TEXT_NODE_DEFAULT_WIDTH,
  getVisualNodeDefaults,
} from './taskNodeHelpers'

describe('task node reference dimensions', () => {
  it('uses the reference text-node footprint', () => {
    expect({ width: TEXT_NODE_DEFAULT_WIDTH, height: TEXT_NODE_DEFAULT_HEIGHT }).toEqual({
      width: 350,
      height: 350,
    })
  })

  it.each([
    ['image', 'image'],
    ['video', 'video'],
    ['imageEdit', 'image'],
  ] as const)('uses the reference media footprint for %s', (kind, coreKind) => {
    const defaults = getVisualNodeDefaults(kind, coreKind, false)
    expect({ width: defaults.width, height: defaults.height }).toEqual({
      width: 622,
      height: 350,
    })
  })
})
